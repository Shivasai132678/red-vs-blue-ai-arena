from backend.models import CATEGORY_LABELS
from backend.scenarios import SCENARIOS, get_scenario


def test_ids_are_unique() -> None:
    ids = [s.id for s in SCENARIOS]
    assert len(ids) == len(set(ids))


def test_every_category_is_known_and_covered() -> None:
    used = {s.category for s in SCENARIOS}
    assert used <= set(CATEGORY_LABELS)
    for required in (
        "normal_request",
        "direct_injection",
        "indirect_injection",
        "secret_extraction",
        "encoded_instruction",
        "benign_document",
    ):
        assert required in used


def test_both_benign_and_malicious_expectations_exist() -> None:
    expected = {s.expected.outcome for s in SCENARIOS if s.expected}
    assert expected == {"blocked", "allowed"}


def test_indirect_scenarios_carry_a_document() -> None:
    for s in SCENARIOS:
        if s.category in ("indirect_injection", "benign_document"):
            assert s.document, s.id


def test_inputs_fit_service_limits() -> None:
    for s in SCENARIOS:
        assert len(s.prompt) + len(s.document or "") <= 10_000


def test_get_scenario() -> None:
    assert get_scenario(SCENARIOS[0].id) == SCENARIOS[0]
    assert get_scenario("missing") is None
