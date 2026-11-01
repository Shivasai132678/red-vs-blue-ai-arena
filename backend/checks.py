"""The evaluation pipeline: every check that runs against a submitted prompt.

All checks run on every evaluation, in a fixed order, so the evidence shows what each
control would have done. A production gateway would normally stop at the first block.
"""

from __future__ import annotations

import base64
import binascii
import re
import time
from typing import Any, Protocol

from backend.azure_content_safety import API_VERSION, AzureResponse, ContentSafetyError
from backend.config import Settings
from backend.models import CheckResult, CheckSpec, CheckStatus

CHECKS: list[CheckSpec] = [
    CheckSpec(
        id="prompt_shields",
        name="Prompt Shields",
        source="azure",
        service=f"Azure AI Content Safety · POST text:shieldPrompt ({API_VERSION})",
        description="Detects user prompt attacks (jailbreaks) and indirect attacks embedded in documents.",
        required=True,
    ),
    CheckSpec(
        id="text_moderation",
        name="Harm category analysis",
        source="azure",
        service=f"Azure AI Content Safety · POST text:analyze ({API_VERSION})",
        description="Scores Hate, Sexual, Violence and Self-harm severity; the lab blocks at the configured threshold.",
        required=True,
    ),
    CheckSpec(
        id="azure_blocklist",
        name="Custom blocklist",
        source="azure",
        service=f"Azure AI Content Safety · blocklistNames on text:analyze ({API_VERSION})",
        description="Matches terms from a blocklist stored in the Content Safety resource. Optional.",
        required=False,
    ),
    CheckSpec(
        id="obfuscation_heuristic",
        name="Obfuscation heuristic",
        source="local",
        service="Local rule in this application (not an Azure service)",
        description="Decodes Base64 segments and normalizes leetspeak, then looks for instruction-override phrases.",
        required=False,
    ),
]
SPECS = {c.id: c for c in CHECKS}


class ContentSafety(Protocol):
    async def shield_prompt(self, user_prompt: str, documents: list[str]) -> AzureResponse: ...
    async def analyze_text(self, text: str, blocklist_names: list[str]) -> AzureResponse: ...
    async def list_blocklists(self) -> AzureResponse: ...
    async def aclose(self) -> None: ...


def _result(
    check_id: str,
    order: int,
    status: CheckStatus,
    reason: str,
    details: dict[str, Any],
    duration_ms: int,
    error_code: str | None = None,
) -> CheckResult:
    spec = SPECS[check_id]
    return CheckResult(
        check_id=spec.id,
        name=spec.name,
        source=spec.source,
        service=spec.service,
        order=order,
        required=spec.required,
        status=status,
        reason=reason,
        details=details,
        duration_ms=duration_ms,
        error_code=error_code,
    )


def _error(check_id: str, order: int, exc: ContentSafetyError, duration_ms: int) -> CheckResult:
    details = {"http_status": exc.http_status, "request_id": exc.request_id}
    return _result(check_id, order, "error", f"Check failed: {exc.message}", details, duration_ms, exc.code)


def _not_configured(check_id: str, order: int) -> CheckResult:
    return _result(
        check_id,
        order,
        "error",
        "Check not performed: Azure Content Safety endpoint and key are not configured.",
        {},
        0,
        "not_configured",
    )


def _elapsed(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


async def _prompt_shields(prompt: str, document: str | None, client: ContentSafety, order: int) -> CheckResult:
    started = time.perf_counter()
    try:
        resp = await client.shield_prompt(prompt, [document] if document else [])
    except ContentSafetyError as exc:
        return _error("prompt_shields", order, exc, _elapsed(started))

    user_flag = bool(resp.data.get("userPromptAnalysis", {}).get("attackDetected"))
    docs = resp.data.get("documentsAnalysis", []) or []
    doc_flags = [i for i, d in enumerate(docs) if d.get("attackDetected")]
    if user_flag and doc_flags:
        reason = "Attack detected in the user prompt and in the attached document."
    elif user_flag:
        reason = "User prompt attack detected (userPromptAnalysis.attackDetected = true)."
    elif doc_flags:
        reason = "Indirect attack detected in the attached document (documentsAnalysis.attackDetected = true)."
    else:
        reason = "No attack detected in the user prompt" + (" or document." if document else ".")
    details = {
        "request_id": resp.request_id,
        "rate_limit_retries": resp.rate_limit_retries,
        "http_status": resp.http_status,
        "userPromptAnalysis": resp.data.get("userPromptAnalysis"),
        "documentsAnalysis": docs,
    }
    status: CheckStatus = "flagged" if user_flag or doc_flags else "passed"
    return _result("prompt_shields", order, status, reason, details, _elapsed(started))


async def _moderation_and_blocklist(
    prompt: str, document: str | None, client: ContentSafety, settings: Settings, order: int
) -> tuple[CheckResult, CheckResult]:
    """One text:analyze call produces both harm-category and blocklist evidence."""
    blocklists = [settings.blocklist_name] if settings.blocklist_name else []
    text = prompt if not document else f"{prompt}\n\n{document}"
    started = time.perf_counter()
    try:
        resp = await client.analyze_text(text, blocklists)
    except ContentSafetyError as exc:
        moderation = _error("text_moderation", order, exc, _elapsed(started))
        if not blocklists:
            return moderation, _blocklist_skipped(order + 1)
        blocklist = _result(
            "azure_blocklist",
            order + 1,
            "error",
            "Check failed: the shared text:analyze call did not complete.",
            {"http_status": exc.http_status},
            0,
            exc.code,
        )
        return moderation, blocklist

    duration = _elapsed(started)
    categories = resp.data.get("categoriesAnalysis", []) or []
    over = [c for c in categories if (c.get("severity") or 0) >= settings.harm_threshold]
    if over:
        listed = ", ".join(f"{c['category']} (severity {c['severity']})" for c in over)
        reason = f"Severity at or above threshold {settings.harm_threshold}: {listed}."
    else:
        reason = f"All harm categories below threshold {settings.harm_threshold}."
    moderation = _result(
        "text_moderation",
        order,
        "flagged" if over else "passed",
        reason,
        {
            "request_id": resp.request_id,
            "rate_limit_retries": resp.rate_limit_retries,
            "http_status": resp.http_status,
            "threshold": settings.harm_threshold,
            "categoriesAnalysis": categories,
            "analyzed": "prompt and document" if document else "prompt",
        },
        duration,
    )
    if not blocklists:
        return moderation, _blocklist_skipped(order + 1)

    matches = resp.data.get("blocklistsMatch", []) or []
    if matches:
        terms = ", ".join(f"'{m.get('blocklistItemText')}'" for m in matches)
        b_reason = f"Matched blocklist '{settings.blocklist_name}': {terms}."
    else:
        b_reason = f"No terms from blocklist '{settings.blocklist_name}' matched."
    blocklist = _result(
        "azure_blocklist",
        order + 1,
        "flagged" if matches else "passed",
        b_reason,
        {"request_id": resp.request_id, "blocklist": settings.blocklist_name, "blocklistsMatch": matches},
        0,
    )
    return moderation, blocklist


def _blocklist_skipped(order: int) -> CheckResult:
    return _result(
        "azure_blocklist",
        order,
        "skipped",
        "Not performed: no Azure blocklist is configured (AZURE_CONTENT_SAFETY_BLOCKLIST).",
        {},
        0,
    )


# --- Local obfuscation heuristic -------------------------------------------------

BASE64_TOKEN = re.compile(r"[A-Za-z0-9+/]{16,}={0,2}")
LEET_MAP = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"})
OVERRIDE_PHRASES = re.compile(
    r"ignore (all |any )?(the )?(previous|prior|above) (instructions|rules)"
    r"|disregard (all |your )?(previous |prior )?(instructions|rules)"
    r"|reveal (the |your )?(system prompt|password|secret)"
    r"|system prompt"
    r"|bypass (all )?(restrictions|safety|filters)",
    re.IGNORECASE,
)


def _decode_base64_segments(text: str) -> list[str]:
    decoded: list[str] = []
    for token in BASE64_TOKEN.findall(text):
        padded = token + "=" * (-len(token) % 4)
        try:
            raw = base64.b64decode(padded, validate=True)
            value = raw.decode("utf-8")
        except (binascii.Error, UnicodeDecodeError, ValueError):
            continue
        if value and sum(ch.isprintable() for ch in value) / len(value) > 0.9:
            decoded.append(value)
    return decoded


def _obfuscation(prompt: str, document: str | None, order: int) -> CheckResult:
    started = time.perf_counter()
    findings: list[str] = []
    decoded_all: list[str] = []
    for label, text in (("prompt", prompt), ("document", document or "")):
        if not text:
            continue
        decoded = _decode_base64_segments(text)
        decoded_all.extend(decoded)
        if any(OVERRIDE_PHRASES.search(d) for d in decoded):
            findings.append(f"Base64 in the {label} decodes to an instruction-override phrase")
        normalized = text.translate(LEET_MAP)
        # Only flag leetspeak when normalizing reveals a phrase the original text hides.
        if OVERRIDE_PHRASES.search(normalized) and not OVERRIDE_PHRASES.search(text):
            findings.append(f"Character substitution in the {label} hides an instruction-override phrase")

    if findings:
        reason = "; ".join(findings) + "."
    elif decoded_all:
        reason = "Base64 content decoded; no instruction-override phrases found."
    else:
        reason = "No encoded or character-substituted instructions found."
    return _result(
        "obfuscation_heuristic",
        order,
        "flagged" if findings else "passed",
        reason,
        {"decoded_segments": decoded_all, "rule": "base64 decode + leetspeak normalization, keyword match"},
        _elapsed(started),
    )


async def run_checks(
    prompt: str, document: str | None, client: ContentSafety | None, settings: Settings
) -> list[CheckResult]:
    if client is None:
        results = [_not_configured("prompt_shields", 1), _not_configured("text_moderation", 2), _blocklist_skipped(3)]
    else:
        shields = await _prompt_shields(prompt, document, client, 1)
        moderation, blocklist = await _moderation_and_blocklist(prompt, document, client, settings, 2)
        results = [shields, moderation, blocklist]
    results.append(_obfuscation(prompt, document, 4))
    return results
