"""Application settings, loaded from the project's .env file and the environment.

The .env path is resolved from this file's location, so the app picks up the same
settings whether it is started from run.command, uvicorn, or a test runner.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENV_FILE = PROJECT_ROOT / ".env"
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "lab.db"
VALID_HARM_THRESHOLDS = (2, 4, 6)


@dataclass(frozen=True)
class Settings:
    content_safety_endpoint: str | None
    content_safety_key: str | None = field(repr=False)
    blocklist_name: str | None
    harm_threshold: int
    db_path: Path
    request_timeout_s: float

    @property
    def azure_configured(self) -> bool:
        return bool(self.content_safety_endpoint and self.content_safety_key)

    @property
    def endpoint_host(self) -> str | None:
        if not self.content_safety_endpoint:
            return None
        return urlparse(self.content_safety_endpoint).hostname


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip().strip('"').strip("'")
    return value or None


def load_settings(env_file: Path | None = DEFAULT_ENV_FILE) -> Settings:
    """Read settings. Values already in the environment take precedence over .env."""
    if env_file is not None and env_file.exists():
        load_dotenv(env_file, override=False)

    endpoint = _clean(os.environ.get("AZURE_CONTENT_SAFETY_ENDPOINT"))
    if endpoint:
        endpoint = endpoint.rstrip("/")
        if urlparse(endpoint).scheme != "https":
            raise ValueError("AZURE_CONTENT_SAFETY_ENDPOINT must be an https:// URL")

    raw_threshold = _clean(os.environ.get("LAB_HARM_THRESHOLD")) or "4"
    try:
        threshold = int(raw_threshold)
    except ValueError:
        threshold = -1
    if threshold not in VALID_HARM_THRESHOLDS:
        raise ValueError(f"LAB_HARM_THRESHOLD must be one of {VALID_HARM_THRESHOLDS}")

    db_path = _clean(os.environ.get("LAB_DB_PATH"))
    return Settings(
        content_safety_endpoint=endpoint,
        content_safety_key=_clean(os.environ.get("AZURE_CONTENT_SAFETY_KEY")),
        blocklist_name=_clean(os.environ.get("AZURE_CONTENT_SAFETY_BLOCKLIST")),
        harm_threshold=threshold,
        db_path=Path(db_path) if db_path else DEFAULT_DB_PATH,
        request_timeout_s=10.0,
    )
