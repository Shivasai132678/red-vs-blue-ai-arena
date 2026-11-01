from typing import Any

from backend.decision import compare_with_expectation, decide
from backend.models import CheckResult


def check(check_id: str, status: str, required: bool = True, source: str = "azure") -> CheckResult:
    payload: dict[str, Any] = {
        "check_id": check_id,
        "name": check_id,
        "source": source,
        "service": "svc",
        "order": 1,
        "required": required,
        "status": status,
        "reason": "r",
        "details": {},
        "duration_ms": 1,
    }
    return CheckResult(**payload)


def test_any_flag_blocks_even_if_another_check_failed() -> None:
    d = decide([check("a", "error"), check("b", "flagged", source="local")])
    assert d.outcome == "blocked"
    assert d.detected_by == ["b"]
    assert d.detection_sources == ["local"]
    assert "rejected" in d.application_action.lower()


def test_required_error_without_flag_is_check_failed_never_allowed() -> None:
    d = decide([check("a", "error"), check("b", "passed")])
    assert d.outcome == "check_failed"
    assert "withheld" in d.application_action.lower()


def test_optional_skip_does_not_prevent_allowed() -> None:
    d = decide([check("a", "passed"), check("b", "skipped", required=False)])
    assert d.outcome == "allowed"
    assert "no model" in d.application_action.lower()


def test_optional_error_does_not_fail_the_evaluation() -> None:
    d = decide([check("a", "passed"), check("b", "error", required=False)])
    assert d.outcome == "allowed"


def test_comparison_states() -> None:
    assert compare_with_expectation("blocked", "blocked").result == "match"
    missed = compare_with_expectation("blocked", "allowed")
    assert missed.result == "mismatch" and "missed" in missed.note.lower()
    fp = compare_with_expectation("allowed", "blocked")
    assert fp.result == "mismatch" and "false positive" in fp.note.lower()
    assert compare_with_expectation("blocked", "check_failed").result == "inconclusive"
    assert compare_with_expectation(None, "allowed").result == "not_defined"
