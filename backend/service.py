"""Evaluation service: queues submissions and runs them one at a time.

A single background worker processes the queue sequentially. That keeps the
queued -> checking -> completed states real (they are persisted, not simulated in the
browser) and naturally paces requests to the Azure resource during batch runs.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
import uuid
from datetime import UTC, datetime
from typing import Literal

from backend.azure_content_safety import ContentSafetyError
from backend.checks import ContentSafety, run_checks
from backend.config import Settings
from backend.decision import compare_with_expectation, decide
from backend.models import Evaluation, EvaluationRequest, Expectation, Scenario, ScenarioRef
from backend.store import EvaluationStore

log = logging.getLogger("lab.evaluations")

VerificationState = Literal["unverified", "verified", "failed"]


def _now() -> datetime:
    return datetime.now(UTC)


class Verification:
    def __init__(self) -> None:
        self.state: VerificationState = "unverified"
        self.checked_at: datetime | None = None
        self.message: str | None = None
        self.blocklist_exists: bool | None = None


class EvaluationService:
    def __init__(self, settings: Settings, store: EvaluationStore, client: ContentSafety | None) -> None:
        self.settings = settings
        self.store = store
        self.client = client
        self.verification = Verification()
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._worker: asyncio.Task[None] | None = None

    # --- lifecycle --------------------------------------------------------------

    async def start(self) -> None:
        interrupted = self.store.mark_interrupted()
        if interrupted:
            log.warning("Marked %d unfinished evaluation(s) from a previous run as check_failed", interrupted)
        self._worker = asyncio.create_task(self._run_worker(), name="evaluation-worker")

    async def stop(self) -> None:
        if self._worker:
            self._worker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._worker
        if self.client:
            await self.client.aclose()

    # --- submission ---------------------------------------------------------------

    def submit_scenarios(self, scenarios: list[Scenario], batch_id: str | None = None) -> list[Evaluation]:
        evaluations = [
            self._new_evaluation(
                ScenarioRef(id=s.id, name=s.name, category=s.category, purpose=s.purpose),
                s.prompt,
                s.document,
                s.expected,
                batch_id,
            )
            for s in scenarios
        ]
        return self._enqueue(evaluations)

    def submit_custom(self, req: EvaluationRequest) -> Evaluation:
        assert req.prompt is not None
        expected = (
            Expectation(outcome=req.expected_outcome, rationale="Set by the user when submitting the prompt.")
            if req.expected_outcome
            else None
        )
        ref = ScenarioRef(id=None, name=req.label or "Custom prompt", category="custom", purpose=None)
        return self._enqueue([self._new_evaluation(ref, req.prompt, req.document or None, expected, None)])[0]

    def _new_evaluation(
        self, ref: ScenarioRef, prompt: str, document: str | None, expected: Expectation | None, batch_id: str | None
    ) -> Evaluation:
        return Evaluation(
            id=uuid.uuid4().hex[:12],
            batch_id=batch_id,
            created_at=_now(),
            status="queued",
            scenario=ref,
            prompt=prompt,
            document=document,
            expected=expected,
        )

    def _enqueue(self, evaluations: list[Evaluation]) -> list[Evaluation]:
        for ev in evaluations:
            self.store.save(ev)
            self._queue.put_nowait(ev.id)
            log.info("evaluation %s queued scenario=%s batch=%s", ev.id, ev.scenario.id or "custom", ev.batch_id)
        return evaluations

    # --- processing -------------------------------------------------------------

    async def _run_worker(self) -> None:
        while True:
            eval_id = await self._queue.get()
            try:
                await self.process(eval_id)
            except Exception:  # never let one evaluation stop the worker
                log.exception("evaluation %s crashed", eval_id)
                self._fail(eval_id, "Internal error while running checks.")
            finally:
                self._queue.task_done()

    async def process(self, eval_id: str) -> Evaluation | None:
        ev = self.store.get(eval_id)
        if ev is None or ev.status != "queued":
            return ev
        started_at = _now()
        ev = ev.model_copy(update={"status": "checking", "started_at": started_at})
        self.store.save(ev)
        log.info("evaluation %s checking", eval_id)

        started = time.perf_counter()
        checks = await run_checks(ev.prompt, ev.document, self.client, self.settings)
        decision = decide(checks)
        comparison = compare_with_expectation(ev.expected.outcome if ev.expected else None, decision.outcome)
        duration_ms = round((time.perf_counter() - started) * 1000)

        ev = ev.model_copy(
            update={
                "status": "check_failed" if decision.outcome == "check_failed" else "completed",
                "completed_at": _now(),
                "duration_ms": duration_ms,
                "checks": checks,
                "outcome": decision.outcome,
                "detected_by": decision.detected_by,
                "detection_sources": decision.detection_sources,
                "decision_reason": decision.reason,
                "application_action": decision.application_action,
                "comparison": comparison,
            }
        )
        self.store.save(ev)
        log.info(
            "evaluation %s %s outcome=%s detected_by=%s duration=%dms",
            eval_id,
            ev.status,
            decision.outcome,
            ",".join(decision.detected_by) or "-",
            duration_ms,
        )
        return ev

    def _fail(self, eval_id: str, reason: str) -> None:
        ev = self.store.get(eval_id)
        if ev is None:
            return
        self.store.save(
            ev.model_copy(
                update={
                    "status": "check_failed",
                    "outcome": "check_failed",
                    "completed_at": _now(),
                    "decision_reason": reason,
                    "application_action": "Request withheld (fail closed): checks did not complete.",
                }
            )
        )

    # --- connection verification ------------------------------------------------

    async def verify_connection(self) -> Verification:
        v = self.verification
        v.checked_at = _now()
        if self.client is None:
            v.state, v.message, v.blocklist_exists = "failed", "Endpoint and key are not configured.", None
            return v
        try:
            resp = await self.client.list_blocklists()
        except ContentSafetyError as exc:
            v.state, v.message, v.blocklist_exists = "failed", exc.message, None
            log.warning("connection verification failed: %s", exc.code)
            return v
        names = {b.get("blocklistName") for b in resp.data.get("value", [])}
        v.state = "verified"
        v.message = f"Test call succeeded (HTTP {resp.http_status}, {resp.duration_ms} ms)."
        v.blocklist_exists = self.settings.blocklist_name in names if self.settings.blocklist_name else None
        log.info("connection verified in %d ms", resp.duration_ms)
        return v
