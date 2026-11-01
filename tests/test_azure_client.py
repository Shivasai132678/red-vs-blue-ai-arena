import asyncio

import httpx
import pytest
import respx

from backend.azure_content_safety import ContentSafetyClient, ContentSafetyError
from tests.conftest import FAKE_KEY

ENDPOINT = "https://example-lab.cognitiveservices.azure.com"
SHIELD_URL = f"{ENDPOINT}/contentsafety/text:shieldPrompt"
ANALYZE_URL = f"{ENDPOINT}/contentsafety/text:analyze"


def client() -> ContentSafetyClient:
    return ContentSafetyClient(ENDPOINT, FAKE_KEY, timeout_s=2.0, max_retry_wait_s=0.0)


@respx.mock
def test_shield_prompt_sends_key_and_returns_request_id() -> None:
    route = respx.post(SHIELD_URL).mock(
        return_value=httpx.Response(
            200,
            json={"userPromptAnalysis": {"attackDetected": True}, "documentsAnalysis": []},
            headers={"apim-request-id": "abc-123"},
        )
    )
    result = asyncio.run(client().shield_prompt("hi", []))
    sent = route.calls.last.request
    assert sent.headers["Ocp-Apim-Subscription-Key"] == FAKE_KEY
    assert sent.url.params["api-version"] == "2024-09-01"
    assert result.data["userPromptAnalysis"]["attackDetected"] is True
    assert result.request_id == "abc-123"
    assert result.http_status == 200


@respx.mock
def test_analyze_text_includes_blocklists() -> None:
    route = respx.post(ANALYZE_URL).mock(return_value=httpx.Response(200, json={"categoriesAnalysis": []}))
    asyncio.run(client().analyze_text("hello", ["lab-terms"]))
    body = route.calls.last.request.read().decode()
    assert '"blocklistNames":["lab-terms"]' in body.replace(" ", "")
    assert "FourSeverityLevels" in body


@respx.mock
def test_auth_failure_maps_to_auth_failed_without_leaking_key() -> None:
    respx.post(SHIELD_URL).mock(
        return_value=httpx.Response(401, json={"error": {"code": "401", "message": f"bad key {FAKE_KEY}"}})
    )
    with pytest.raises(ContentSafetyError) as exc:
        asyncio.run(client().shield_prompt("hi", []))
    assert exc.value.code == "auth_failed"
    assert exc.value.http_status == 401
    assert FAKE_KEY not in str(exc.value)


@respx.mock
def test_rate_limit_is_retried_once_then_succeeds() -> None:
    route = respx.post(SHIELD_URL).mock(
        side_effect=[
            httpx.Response(429, headers={"Retry-After": "0"}),
            httpx.Response(200, json={"userPromptAnalysis": {"attackDetected": False}}),
        ]
    )
    result = asyncio.run(client().shield_prompt("hi", []))
    assert route.call_count == 2
    assert result.http_status == 200
    assert result.rate_limit_retries == 1


@respx.mock
def test_persistent_rate_limit_raises_rate_limited() -> None:
    respx.post(SHIELD_URL).mock(return_value=httpx.Response(429, headers={"Retry-After": "0"}))
    with pytest.raises(ContentSafetyError) as exc:
        asyncio.run(client().shield_prompt("hi", []))
    assert exc.value.code == "rate_limited"


@respx.mock
def test_timeout_maps_to_timeout() -> None:
    respx.post(SHIELD_URL).mock(side_effect=httpx.ReadTimeout("slow"))
    with pytest.raises(ContentSafetyError) as exc:
        asyncio.run(client().shield_prompt("hi", []))
    assert exc.value.code == "timeout"


@respx.mock
def test_network_error_maps_to_network_error() -> None:
    respx.post(SHIELD_URL).mock(side_effect=httpx.ConnectError("dns"))
    with pytest.raises(ContentSafetyError) as exc:
        asyncio.run(client().shield_prompt("hi", []))
    assert exc.value.code == "network_error"


@respx.mock
def test_non_json_response_maps_to_invalid_response() -> None:
    respx.post(SHIELD_URL).mock(return_value=httpx.Response(200, text="<html>"))
    with pytest.raises(ContentSafetyError) as exc:
        asyncio.run(client().shield_prompt("hi", []))
    assert exc.value.code == "invalid_response"
