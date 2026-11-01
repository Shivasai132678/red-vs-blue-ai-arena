"""Minimal async client for Azure AI Content Safety (REST API 2024-09-01).

Only the calls this lab uses are implemented:
  * POST /contentsafety/text:shieldPrompt   - Prompt Shields (user prompt + documents)
  * POST /contentsafety/text:analyze        - harm categories and custom blocklists
  * GET  /contentsafety/text/blocklists     - lists blocklists; used to verify the connection

Failures are raised as ContentSafetyError with a stable `code`, so callers can record
them as failed checks. The subscription key is never included in an error message.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

import httpx

API_VERSION = "2024-09-01"


class ContentSafetyError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        http_status: int | None = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
        self.request_id = request_id


@dataclass(frozen=True)
class AzureResponse:
    data: dict[str, Any]
    http_status: int
    request_id: str | None
    duration_ms: int
    rate_limit_retries: int = 0


class ContentSafetyClient:
    def __init__(
        self,
        endpoint: str,
        key: str,
        timeout_s: float = 10.0,
        max_retry_wait_s: float = 5.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._key = key
        self._max_retry_wait_s = max_retry_wait_s
        self._http = httpx.AsyncClient(timeout=timeout_s, transport=transport)

    async def shield_prompt(self, user_prompt: str, documents: list[str]) -> AzureResponse:
        return await self._request(
            "POST", "/contentsafety/text:shieldPrompt", {"userPrompt": user_prompt, "documents": documents}
        )

    async def analyze_text(self, text: str, blocklist_names: list[str]) -> AzureResponse:
        body: dict[str, Any] = {"text": text, "outputType": "FourSeverityLevels"}
        if blocklist_names:
            body["blocklistNames"] = blocklist_names
            body["haltOnBlocklistHit"] = False
        return await self._request("POST", "/contentsafety/text:analyze", body)

    async def list_blocklists(self) -> AzureResponse:
        return await self._request("GET", "/contentsafety/text/blocklists", None)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _request(self, method: str, path: str, body: dict[str, Any] | None) -> AzureResponse:
        url = f"{self._endpoint}{path}"
        headers = {"Ocp-Apim-Subscription-Key": self._key}
        started = time.perf_counter()
        for attempt in range(2):  # one retry, only for HTTP 429
            try:
                resp = await self._http.request(
                    method, url, params={"api-version": API_VERSION}, headers=headers, json=body
                )
            except httpx.TimeoutException as exc:
                raise ContentSafetyError("timeout", "Azure Content Safety did not respond in time") from exc
            except httpx.HTTPError as exc:
                raise ContentSafetyError(
                    "network_error", f"Could not reach Azure Content Safety ({type(exc).__name__})"
                ) from exc

            request_id = resp.headers.get("apim-request-id")
            if resp.status_code == 429 and attempt == 0:
                await asyncio.sleep(self._retry_wait(resp))
                continue
            if resp.status_code != 200:
                raise self._error_for(resp, request_id)
            try:
                data = resp.json()
            except ValueError as exc:
                raise ContentSafetyError(
                    "invalid_response", "Azure returned a response that is not JSON", resp.status_code, request_id
                ) from exc
            return AzureResponse(
                data=data,
                http_status=resp.status_code,
                request_id=request_id,
                duration_ms=round((time.perf_counter() - started) * 1000),
                rate_limit_retries=attempt,
            )
        raise AssertionError("unreachable")

    def _retry_wait(self, resp: httpx.Response) -> float:
        try:
            wait = float(resp.headers.get("Retry-After", "1"))
        except ValueError:
            wait = 1.0
        return max(0.0, min(wait, self._max_retry_wait_s))

    def _error_for(self, resp: httpx.Response, request_id: str | None) -> ContentSafetyError:
        message = f"HTTP {resp.status_code}"
        try:
            detail = resp.json().get("error", {}).get("message")
            if detail:
                message = f"{message}: {detail}"
        except ValueError:
            pass
        message = message.replace(self._key, "[redacted]")[:300]
        if resp.status_code in (401, 403):
            code = "auth_failed"
        elif resp.status_code == 429:
            code = "rate_limited"
        elif resp.status_code == 400:
            code = "bad_request"
        else:
            code = "http_error"
        return ContentSafetyError(code, message, resp.status_code, request_id)
