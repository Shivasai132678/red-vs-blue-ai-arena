from pathlib import Path

import pytest

from backend.config import load_settings

ENV_KEYS = (
    "AZURE_CONTENT_SAFETY_ENDPOINT",
    "AZURE_CONTENT_SAFETY_KEY",
    "AZURE_CONTENT_SAFETY_BLOCKLIST",
    "LAB_HARM_THRESHOLD",
    "LAB_DB_PATH",
)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def test_loads_env_file_regardless_of_working_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "AZURE_CONTENT_SAFETY_ENDPOINT=https://res.cognitiveservices.azure.com/\nAZURE_CONTENT_SAFETY_KEY=abc123\n"
    )
    monkeypatch.chdir(tmp_path.parent)
    settings = load_settings(env_file)
    assert settings.azure_configured
    assert settings.content_safety_endpoint == "https://res.cognitiveservices.azure.com"


def test_key_is_not_in_repr(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "AZURE_CONTENT_SAFETY_ENDPOINT=https://res.cognitiveservices.azure.com\n"
        "AZURE_CONTENT_SAFETY_KEY=super-secret-value\n"
    )
    assert "super-secret-value" not in repr(load_settings(env_file))


def test_missing_values_mean_not_configured(tmp_path: Path) -> None:
    settings = load_settings(tmp_path / "missing.env")
    assert not settings.azure_configured
    assert settings.endpoint_host is None


def test_non_https_endpoint_is_rejected(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "AZURE_CONTENT_SAFETY_ENDPOINT=http://res.cognitiveservices.azure.com\nAZURE_CONTENT_SAFETY_KEY=abc\n"
    )
    with pytest.raises(ValueError, match="https"):
        load_settings(env_file)


@pytest.mark.parametrize("raw,expected", [("2", 2), ("4", 4), ("6", 6)])
def test_harm_threshold_accepts_valid_levels(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, raw: str, expected: int
) -> None:
    monkeypatch.setenv("LAB_HARM_THRESHOLD", raw)
    assert load_settings(tmp_path / "none.env").harm_threshold == expected


def test_harm_threshold_rejects_invalid_level(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LAB_HARM_THRESHOLD", "3")
    with pytest.raises(ValueError, match="LAB_HARM_THRESHOLD"):
        load_settings(tmp_path / "none.env")
