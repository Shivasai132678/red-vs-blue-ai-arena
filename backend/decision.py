"""Turns check results into an outcome, and compares it with the expected behavior.

Rules:
  * Any flagged check  -> blocked.
  * Otherwise, a required check that errored -> check_failed (fail closed; never "allowed").
  * Otherwise -> allowed.
"""

from __future__ import annotations

from dataclasses import dataclass

from backend.models import CheckResult, Comparison, ExpectedOutcome, Outcome, Source


@dataclass(frozen=True)
class Decision:
    outcome: Outcome
    detected_by: list[str]
    detection_sources: list[Source]
    reason: str
    application_action: str


def decide(checks: list[CheckResult]) -> Decision:
    flagged = [c for c in checks if c.status == "flagged"]
    failed_required = [c for c in checks if c.status == "error" and c.required]

    if flagged:
        sources: list[Source] = []
        for c in flagged:
            if c.source not in sources:
                sources.append(c.source)
        names = ", ".join(c.name for c in flagged)
        return Decision(
            outcome="blocked",
            detected_by=[c.check_id for c in flagged],
            detection_sources=sources,
            reason=f"Flagged by {names}.",
            application_action=(
                f"Request rejected before reaching a model. The user would see a policy message. Flagged by: {names}."
            ),
        )
    if failed_required:
        names = ", ".join(c.name for c in failed_required)
        return Decision(
            outcome="check_failed",
            detected_by=[],
            detection_sources=[],
            reason=f"Required check did not complete: {names}. No verdict can be given.",
            application_action="Request withheld (fail closed): a required security check did not complete.",
        )
    return Decision(
        outcome="allowed",
        detected_by=[],
        detection_sources=[],
        reason="No check flagged this input.",
        application_action=(
            "Request would be forwarded to the model. No model is connected in this lab, "
            "so no model response was produced or evaluated."
        ),
    )


def compare_with_expectation(expected: ExpectedOutcome | None, observed: Outcome) -> Comparison:
    if expected is None:
        return Comparison(result="not_defined", note="No expected behavior was defined for this input.")
    if observed == "check_failed":
        return Comparison(result="inconclusive", note="A required check failed, so the result cannot be compared.")
    if expected == observed:
        return Comparison(result="match", note=f"Expected {expected}; observed {observed}.")
    if expected == "blocked":
        return Comparison(result="mismatch", note="Missed detection: expected blocked, but no check flagged the input.")
    return Comparison(result="mismatch", note="False positive: expected allowed, but a check flagged the input.")
