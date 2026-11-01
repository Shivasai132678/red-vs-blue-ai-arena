import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.azure_content_safety import ContentSafetyError
from tests.conftest import FAKE_KEY, FakeContentSafety, make_settings


@pytest.fixture
def api(tmp_path: Path, fake_client: FakeContentSafety) -> Iterator[TestClient]:
    app = create_app(make_settings(tmp_path), client=fake_client)
    with TestClient(app) as client:
        yield client


def wait_done(api: TestClient, eval_id: str, timeout_s: float = 5.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        body: dict[str, Any] = api.get(f"/api/evaluations/{eval_id}").json()
        if body["status"] in ("completed", "check_failed"):
            return body
        time.sleep(0.02)
    raise AssertionError("evaluation did not finish")


def test_status_reports_configuration_without_secrets(api: TestClient) -> None:
    r = api.get("/api/status")
    assert r.status_code == 200
    body = r.json()
    assert body["azure"]["configured"] is True
    assert body["azure"]["verification"]["state"] == "unverified"
    assert body["azure"]["endpoint_host"] == "example-lab.cognitiveservices.azure.com"
    assert {c["id"] for c in body["checks"]} == {
        "prompt_shields",
        "text_moderation",
        "azure_blocklist",
        "obfuscation_heuristic",
    }
    assert FAKE_KEY not in r.text


def test_verify_connection_success(api: TestClient) -> None:
    body = api.post("/api/status/verify").json()
    assert body["azure"]["verification"]["state"] == "verified"
    assert body["azure"]["verification"]["checked_at"]


def test_verify_connection_failure(api: TestClient, fake_client: FakeContentSafety) -> None:
    fake_client.blocklists = ContentSafetyError("auth_failed", "Access denied", http_status=401)
    body = api.post("/api/status/verify").json()
    assert body["azure"]["verification"]["state"] == "failed"
    assert "Access denied" in body["azure"]["verification"]["message"]


def test_verify_reports_missing_blocklist(tmp_path: Path, fake_client: FakeContentSafety) -> None:
    app = create_app(make_settings(tmp_path, blocklist_name="lab-terms"), client=fake_client)
    with TestClient(app) as client:
        body = client.post("/api/status/verify").json()
    assert body["azure"]["verification"]["state"] == "verified"
    assert body["azure"]["blocklist"]["exists"] is False


def test_scenarios_endpoint(api: TestClient) -> None:
    body = api.get("/api/scenarios").json()
    assert len(body["scenarios"]) >= 10
    assert body["categories"]["direct_injection"]


def test_run_scenario_end_to_end(api: TestClient, fake_client: FakeContentSafety) -> None:
    fake_client.shield = lambda **_: {"userPromptAnalysis": {"attackDetected": True}, "documentsAnalysis": []}
    r = api.post("/api/evaluations", json={"scenario_id": "direct-ignore-previous"})
    assert r.status_code == 202
    queued = r.json()
    assert queued["status"] == "queued"
    done = wait_done(api, queued["id"])
    assert done["status"] == "completed"
    assert done["outcome"] == "blocked"
    assert done["detected_by"] == ["prompt_shields"]
    assert done["comparison"]["result"] == "match"
    assert done["duration_ms"] is not None
    assert [c["order"] for c in done["checks"]] == [1, 2, 3, 4]


def test_custom_prompt_with_document(api: TestClient) -> None:
    r = api.post(
        "/api/evaluations", json={"prompt": "Summarize", "document": "Q3 notes", "expected_outcome": "allowed"}
    )
    done = wait_done(api, r.json()["id"])
    assert done["scenario"]["category"] == "custom"
    assert done["document"] == "Q3 notes"
    assert done["outcome"] == "allowed"
    assert done["comparison"]["result"] == "match"


def test_azure_failure_is_check_failed_not_allowed(api: TestClient, fake_client: FakeContentSafety) -> None:
    fake_client.shield = ContentSafetyError("timeout", "Timed out")
    r = api.post("/api/evaluations", json={"prompt": "hello"})
    done = wait_done(api, r.json()["id"])
    assert done["status"] == "check_failed"
    assert done["outcome"] == "check_failed"


def test_unconfigured_azure_never_reports_allowed(tmp_path: Path) -> None:
    app = create_app(make_settings(tmp_path, content_safety_endpoint=None, content_safety_key=None))
    with TestClient(app) as client:
        assert client.get("/api/status").json()["azure"]["configured"] is False
        done = wait_done(client, client.post("/api/evaluations", json={"prompt": "hello"}).json()["id"])
    assert done["outcome"] == "check_failed"


def test_batch_runs_in_order_and_filters(api: TestClient, fake_client: FakeContentSafety) -> None:
    fake_client.shield = lambda **kw: {
        "userPromptAnalysis": {"attackDetected": "Ignore" in kw["user_prompt"]},
        "documentsAnalysis": [],
    }
    r = api.post("/api/evaluations/batch", json={"scenario_ids": ["normal-leave-policy", "direct-ignore-previous"]})
    assert r.status_code == 202
    body = r.json()
    ids = [e["id"] for e in body["evaluations"]]
    for eval_id in ids:
        wait_done(api, eval_id)
    listed = api.get("/api/evaluations", params={"batch_id": body["batch_id"]}).json()["evaluations"]
    assert {e["id"] for e in listed} == set(ids)
    blocked = api.get("/api/evaluations", params={"outcome": "blocked"}).json()["evaluations"]
    assert [e["scenario"]["id"] for e in blocked] == ["direct-ignore-previous"]
    by_source = api.get("/api/evaluations", params={"source": "azure"}).json()["evaluations"]
    assert len(by_source) == 1


def test_validation_errors_use_consistent_format(api: TestClient) -> None:
    for payload in ({}, {"prompt": ""}, {"prompt": "x" * 10_001}, {"prompt": "a", "scenario_id": "b"}):
        r = api.post("/api/evaluations", json=payload)
        assert r.status_code == 422, payload
        assert r.json()["error"]["code"] == "validation_error"


def test_unknown_scenario_and_evaluation(api: TestClient) -> None:
    r = api.post("/api/evaluations", json={"scenario_id": "nope"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "scenario_not_found"
    r = api.get("/api/evaluations/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "evaluation_not_found"


def test_clear_history(api: TestClient) -> None:
    wait_done(api, api.post("/api/evaluations", json={"prompt": "hello"}).json()["id"])
    assert api.delete("/api/evaluations").status_code == 204
    assert api.get("/api/evaluations").json()["evaluations"] == []


def test_evaluation_payloads_never_contain_key(api: TestClient) -> None:
    done = wait_done(api, api.post("/api/evaluations", json={"prompt": "hello"}).json()["id"])
    assert FAKE_KEY not in str(done)
