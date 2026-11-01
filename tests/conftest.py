"""Shared fixtures: isolated settings and a scriptable fake Azure client."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from backend.azure_content_safety import AzureResponse, ContentSafetyError
from backend.config import Settings

FAKE_KEY = "test-key-should-never-leak-1234567890"


def make_settings(tmp_path: Path, **overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "content_safety_endpoint": "https://example-lab.cognitiveservices.azure.com",
        "content_safety_key": FAKE_KEY,
        "blocklist_name": None,
        "harm_threshold": 4,
        "db_path": tmp_path / "lab.db",
        "request_timeout_s": 5.0,
    }
    values.update(overrides)
    return Settings(**values)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return make_settings(tmp_path)


Responder = Callable[..., dict[str, Any]]


class FakeContentSafety:
    """Stands in for ContentSafetyClient. Each method returns canned data or raises."""

    def __init__(self) -> None:
        self.shield: Responder | ContentSafetyError = lambda **_: {
            "userPromptAnalysis": {"attackDetected": False},
            "documentsAnalysis": [],
        }
        self.analyze: Responder | ContentSafetyError = lambda **_: {
            "blocklistsMatch": [],
            "categoriesAnalysis": [{"category": c, "severity": 0} for c in ("Hate", "SelfHarm", "Sexual", "Violence")],
        }
        self.blocklists: Responder | ContentSafetyError = lambda **_: {"value": []}
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def _respond(self, name: str, handler: Responder | ContentSafetyError, **kwargs: Any) -> AzureResponse:
        self.calls.append((name, kwargs))
        if isinstance(handler, ContentSafetyError):
            raise handler
        return AzureResponse(data=handler(**kwargs), http_status=200, request_id=f"req-{name}", duration_ms=12)

    async def shield_prompt(self, user_prompt: str, documents: list[str]) -> AzureResponse:
        return await self._respond("shield", self.shield, user_prompt=user_prompt, documents=documents)

    async def analyze_text(self, text: str, blocklist_names: list[str]) -> AzureResponse:
        return await self._respond("analyze", self.analyze, text=text, blocklist_names=blocklist_names)

    async def list_blocklists(self) -> AzureResponse:
        return await self._respond("blocklists", self.blocklists)

    async def aclose(self) -> None:
        return None


@pytest.fixture
def fake_client() -> FakeContentSafety:
    return FakeContentSafety()
