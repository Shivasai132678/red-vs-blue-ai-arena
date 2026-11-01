"""Data models shared by the API, the evaluation service, and the store."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

MAX_INPUT_CHARS = 10_000  # Content Safety text limit; prompt + document must fit

Category = Literal[
    "normal_request",
    "direct_injection",
    "indirect_injection",
    "secret_extraction",
    "encoded_instruction",
    "benign_document",
    "custom",
]
CATEGORY_LABELS: dict[str, str] = {
    "normal_request": "Normal request",
    "direct_injection": "Direct instruction override",
    "indirect_injection": "Indirect document injection",
    "secret_extraction": "Secret extraction",
    "encoded_instruction": "Encoded instruction",
    "benign_document": "Harmless document (false-positive probe)",
    "custom": "Custom prompt",
}

Source = Literal["azure", "local", "simulation"]
CheckStatus = Literal["flagged", "passed", "error", "skipped"]
Outcome = Literal["blocked", "allowed", "check_failed"]
ExpectedOutcome = Literal["blocked", "allowed"]
EvaluationStatus = Literal["queued", "checking", "completed", "check_failed"]
ComparisonResult = Literal["match", "mismatch", "inconclusive", "not_defined"]


class Expectation(BaseModel):
    outcome: ExpectedOutcome
    rationale: str


class Scenario(BaseModel):
    id: str
    name: str
    category: Category
    purpose: str
    prompt: str
    document: str | None = None
    expected: Expectation | None = None


class ScenarioRef(BaseModel):
    id: str | None
    name: str
    category: Category
    purpose: str | None


class CheckSpec(BaseModel):
    id: str
    name: str
    source: Source
    service: str
    description: str
    required: bool


class CheckResult(BaseModel):
    check_id: str
    name: str
    source: Source
    service: str
    order: int
    required: bool
    status: CheckStatus
    reason: str
    details: dict[str, Any] = Field(default_factory=dict)
    duration_ms: int
    error_code: str | None = None


class Comparison(BaseModel):
    result: ComparisonResult
    note: str


class Evaluation(BaseModel):
    id: str
    batch_id: str | None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_ms: int | None = None
    status: EvaluationStatus
    scenario: ScenarioRef
    prompt: str
    document: str | None
    expected: Expectation | None
    checks: list[CheckResult] = Field(default_factory=list)
    outcome: Outcome | None = None
    detected_by: list[str] = Field(default_factory=list)
    detection_sources: list[Source] = Field(default_factory=list)
    decision_reason: str | None = None
    application_action: str | None = None
    comparison: Comparison | None = None


class EvaluationRequest(BaseModel):
    """Either a library scenario or a custom prompt (with optional document)."""

    scenario_id: str | None = None
    prompt: str | None = Field(default=None, min_length=1, max_length=MAX_INPUT_CHARS)
    document: str | None = Field(default=None, max_length=MAX_INPUT_CHARS)
    label: str | None = Field(default=None, max_length=120)
    expected_outcome: ExpectedOutcome | None = None

    @model_validator(mode="after")
    def _one_source(self) -> EvaluationRequest:
        if bool(self.scenario_id) == bool(self.prompt):
            raise ValueError("Provide either scenario_id or prompt, not both")
        if self.prompt and len(self.prompt) + len(self.document or "") > MAX_INPUT_CHARS:
            raise ValueError(f"Prompt and document together must be at most {MAX_INPUT_CHARS} characters")
        return self


class BatchRequest(BaseModel):
    scenario_ids: list[str] = Field(min_length=1, max_length=50)
