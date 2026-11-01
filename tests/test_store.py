from datetime import UTC, datetime
from pathlib import Path

from backend.models import Evaluation, ScenarioRef
from backend.store import EvaluationStore


def make_eval(
    eval_id: str, category: str = "direct_injection", outcome: str | None = None, sources: list[str] | None = None
) -> Evaluation:
    return Evaluation(
        id=eval_id,
        batch_id=None,
        created_at=datetime.now(UTC),
        status="completed" if outcome else "queued",
        scenario=ScenarioRef(id="s", name="S", category=category, purpose="p"),  # type: ignore[arg-type]
        prompt="p",
        document=None,
        expected=None,
        outcome=outcome,  # type: ignore[arg-type]
        detection_sources=sources or [],  # type: ignore[arg-type]
    )


def test_insert_get_update(tmp_path: Path) -> None:
    store = EvaluationStore(tmp_path / "db.sqlite")
    ev = make_eval("1")
    store.save(ev)
    assert store.get("1") == ev
    store.save(ev.model_copy(update={"status": "checking"}))
    got = store.get("1")
    assert got is not None and got.status == "checking"
    assert store.get("nope") is None


def test_list_is_newest_first_and_filters(tmp_path: Path) -> None:
    store = EvaluationStore(tmp_path / "db.sqlite")
    store.save(make_eval("a", category="normal_request", outcome="allowed"))
    store.save(make_eval("b", category="direct_injection", outcome="blocked", sources=["azure"]))
    store.save(make_eval("c", category="direct_injection", outcome="blocked", sources=["local"]))
    assert [e.id for e in store.list()] == ["c", "b", "a"]
    assert [e.id for e in store.list(category="direct_injection")] == ["c", "b"]
    assert [e.id for e in store.list(outcome="allowed")] == ["a"]
    assert [e.id for e in store.list(source="azure")] == ["b"]


def test_persists_across_instances(tmp_path: Path) -> None:
    EvaluationStore(tmp_path / "db.sqlite").save(make_eval("x"))
    assert EvaluationStore(tmp_path / "db.sqlite").get("x") is not None


def test_mark_interrupted_fails_unfinished(tmp_path: Path) -> None:
    store = EvaluationStore(tmp_path / "db.sqlite")
    store.save(make_eval("q"))
    store.save(make_eval("done", outcome="allowed"))
    assert store.mark_interrupted() == 1
    q = store.get("q")
    assert q is not None and q.status == "check_failed" and q.outcome == "check_failed"
    done = store.get("done")
    assert done is not None and done.status == "completed"


def test_clear(tmp_path: Path) -> None:
    store = EvaluationStore(tmp_path / "db.sqlite")
    store.save(make_eval("x"))
    store.clear()
    assert store.list() == []
