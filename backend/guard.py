"""Blue team defense.

Layers, checked in order:
  1. blocklist            - custom terms the app never allows (e.g. the admin password)
  2. prompt_shield_user   - jailbreak / prompt-injection in the user's message
  3. prompt_shield_doc    - injected instructions hidden inside a pasted document
  4. content_filter       - harmful-content categories (violence, hate, etc.)

Two modes:
  * demo  (default) - rule-based detection that mirrors the Azure layers. Runs anywhere.
  * azure           - calls the Azure AI Content Safety "shieldPrompt" API for layers 2-3.
                      Only used when AZURE_CONTENT_SAFETY_ENDPOINT and
                      AZURE_CONTENT_SAFETY_KEY are set. Untested until you add keys.
"""

import os
import re
from dataclasses import dataclass, asdict

LAYER_LABELS = {
    "blocklist": "Custom blocklist",
    "prompt_shield_user": "Prompt Shields (jailbreak detected)",
    "prompt_shield_doc": "Prompt Shields (indirect attack in document)",
    "content_filter": "Foundry content filter (harmful content)",
}

BLOCKLIST = ["admin password", "confidential password", "secret password"]

JAILBREAK_PATTERNS = [
    r"\bDAN\b",
    r"no rules",
    r"ignore (all )?(your )?(previous|prior) instructions",
    r"disregard your rules",
    r"pretend (you are|to be)",
    r"system prompt",
]
# Note: encoded/obfuscated and fictional/translated attacks are deliberately not
# covered by these demo rules. Real guardrails miss some of these too, and the
# battle report shows which attacks got through.

INDIRECT_PATTERNS = [
    r"<!--.*?(system|instruction|disregard).*?-->",
    r"\bSYSTEM:",
]

HARMFUL_PATTERNS = [
    r"hurt someone",
    r"graphic (scene|violence)",
    r"how to (make|build) (a )?(bomb|weapon)",
]


class AzureShieldError(Exception):
    """Raised when Azure is configured but the Prompt Shields call fails."""


@dataclass
class Verdict:
    blocked: bool
    layer: str | None
    reason: str | None
    simulated: bool

    def to_dict(self):
        d = asdict(self)
        d["layer_label"] = LAYER_LABELS.get(self.layer, "") if self.layer else None
        return d


def _matches(patterns, text):
    return any(re.search(p, text, re.IGNORECASE | re.DOTALL) for p in patterns)


def _demo_check(prompt: str, document: str | None) -> Verdict:
    lowered = prompt.lower()
    for term in BLOCKLIST:
        if term in lowered:
            return Verdict(True, "blocklist", f"Matched blocked term '{term}'", True)
    if _matches(JAILBREAK_PATTERNS, prompt):
        return Verdict(True, "prompt_shield_user", "Jailbreak pattern detected in user prompt", True)
    if document and _matches(INDIRECT_PATTERNS, document):
        return Verdict(True, "prompt_shield_doc", "Hidden instruction found inside document", True)
    if _matches(HARMFUL_PATTERNS, prompt):
        return Verdict(True, "content_filter", "Violence category exceeded severity threshold", True)
    return Verdict(False, None, None, True)


def _azure_shield(prompt: str, document: str | None) -> Verdict:
    """Calls Azure AI Content Safety shieldPrompt. Untested until keys are added."""
    import httpx  # imported lazily so demo mode needs no Azure packages

    endpoint = os.environ["AZURE_CONTENT_SAFETY_ENDPOINT"].rstrip("/")
    key = os.environ["AZURE_CONTENT_SAFETY_KEY"]
    body = {"userPrompt": prompt, "documents": [document] if document else []}
    try:
        resp = httpx.post(
            f"{endpoint}/contentsafety/text:shieldPrompt",
            params={"api-version": "2024-09-01"},
            headers={"Ocp-Apim-Subscription-Key": key},
            json=body,
            timeout=10,
        )
    except httpx.HTTPError as exc:
        raise AzureShieldError(f"Could not reach Azure Content Safety: {exc}") from exc
    if resp.status_code != 200:
        raise AzureShieldError(
            f"Azure Content Safety returned HTTP {resp.status_code}: {resp.text[:300]}"
        )
    data = resp.json()
    if data.get("userPromptAnalysis", {}).get("attackDetected"):
        return Verdict(True, "prompt_shield_user", "Prompt Shields flagged the user prompt", False)
    for doc in data.get("documentsAnalysis", []):
        if doc.get("attackDetected"):
            return Verdict(True, "prompt_shield_doc", "Prompt Shields flagged the document", False)
    # Blocklist and harmful-content checks still run locally in azure mode
    return _content_and_blocklist_only(prompt)


def _content_and_blocklist_only(prompt: str) -> Verdict:
    lowered = prompt.lower()
    for term in BLOCKLIST:
        if term in lowered:
            return Verdict(True, "blocklist", f"Matched blocked term '{term}'", False)
    if _matches(HARMFUL_PATTERNS, prompt):
        return Verdict(True, "content_filter", "Violence category exceeded severity threshold", False)
    return Verdict(False, None, None, False)


def check(prompt: str, document: str | None = None) -> Verdict:
    """Run the Blue defense on one attack. Returns the first layer that blocks it."""
    if mode() == "azure":
        # No silent fallback: if Azure fails, the error is raised and shown in the app.
        return _azure_shield(prompt, document)
    return _demo_check(prompt, document)


def mode() -> str:
    if os.environ.get("AZURE_CONTENT_SAFETY_ENDPOINT") and os.environ.get("AZURE_CONTENT_SAFETY_KEY"):
        return "azure"
    return "demo"
