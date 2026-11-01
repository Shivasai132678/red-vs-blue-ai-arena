"""AI Guardrail Evaluation Lab - FastAPI application.

Run:  uvicorn backend.main:app     (from the project root)
Open: http://127.0.0.1:8000        (serves the built frontend from frontend/dist)
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.azure_content_safety import ContentSafetyClient
from backend.checks import CHECKS, ContentSafety
from backend.config import PROJECT_ROOT, Settings, load_settings
from backend.models import CATEGORY_LABELS, BatchRequest, Category, EvaluationRequest, Outcome, Source
from backend.scenarios import SCENARIOS, get_scenario
from backend.service import EvaluationService
from backend.store import EvaluationStore

APP_NAME = "Red vs Blue: AI Guardrail Arena"
APP_VERSION = "1.0.0"
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"


class LabError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        self.status, self.code, self.message = status, code, message


def _error(status: int, code: str, message: str, details: Any = None) -> JSONResponse:
    body: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        body["details"] = details
    return JSONResponse(status_code=status, content={"error": body})


def create_app(settings: Settings | None = None, client: ContentSafety | None = None) -> FastAPI:
    settings = settings or load_settings()
    if client is None and settings.azure_configured:
        assert settings.content_safety_endpoint and settings.content_safety_key
        client = ContentSafetyClient(
            settings.content_safety_endpoint, settings.content_safety_key, timeout_s=settings.request_timeout_s
        )
    service = EvaluationService(settings, EvaluationStore(settings.db_path), client)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await service.start()
        yield
        await service.stop()

    app = FastAPI(title=APP_NAME, version=APP_VERSION, lifespan=lifespan)

    @app.exception_handler(LabError)
    async def _lab_error(_: Request, exc: LabError) -> JSONResponse:
        return _error(exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        problems = [{"loc": [str(p) for p in e.get("loc", ())], "msg": str(e.get("msg", ""))} for e in exc.errors()]
        first = str(problems[0]["msg"]) if problems else "Invalid request"
        return _error(422, "validation_error", first.removeprefix("Value error, "), problems)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = "not_found" if exc.status_code == 404 else "http_error"
        return _error(exc.status_code, code, str(exc.detail))

    def status_payload() -> dict[str, Any]:
        v = service.verification
        return {
            "app": {"name": APP_NAME, "version": APP_VERSION},
            "azure": {
                "configured": settings.azure_configured,
                "endpoint_host": settings.endpoint_host,
                "verification": {
                    "state": v.state,
                    "checked_at": v.checked_at.isoformat() if v.checked_at else None,
                    "message": v.message,
                },
                "blocklist": {"name": settings.blocklist_name, "exists": v.blocklist_exists},
            },
            "checks": [
                {
                    **spec.model_dump(),
                    "order": i,
                    "configured": spec.source == "local"
                    or (settings.azure_configured and (spec.id != "azure_blocklist" or bool(settings.blocklist_name))),
                }
                for i, spec in enumerate(CHECKS, start=1)
            ],
            "settings": {"harm_threshold": settings.harm_threshold},
            "model": {
                "connected": False,
                "note": "No language model is connected. Allowed inputs are not sent to a model, "
                "so no model responses are produced or evaluated.",
            },
        }

    @app.get("/api/status")
    def get_status() -> dict[str, Any]:
        return status_payload()

    @app.post("/api/status/verify")
    async def verify() -> dict[str, Any]:
        await service.verify_connection()
        return status_payload()

    @app.get("/api/scenarios")
    def list_scenarios() -> dict[str, Any]:
        return {"scenarios": [s.model_dump() for s in SCENARIOS], "categories": CATEGORY_LABELS}

    @app.post("/api/evaluations", status_code=202)
    def create_evaluation(req: EvaluationRequest) -> dict[str, Any]:
        if req.scenario_id:
            scenario = get_scenario(req.scenario_id)
            if scenario is None:
                raise LabError(404, "scenario_not_found", f"No scenario with id '{req.scenario_id}'")
            return service.submit_scenarios([scenario])[0].model_dump(mode="json")
        return service.submit_custom(req).model_dump(mode="json")

    @app.post("/api/evaluations/batch", status_code=202)
    def create_batch(req: BatchRequest) -> dict[str, Any]:
        scenarios = []
        for scenario_id in req.scenario_ids:
            scenario = get_scenario(scenario_id)
            if scenario is None:
                raise LabError(404, "scenario_not_found", f"No scenario with id '{scenario_id}'")
            scenarios.append(scenario)
        batch_id = uuid.uuid4().hex[:8]
        evaluations = service.submit_scenarios(scenarios, batch_id=batch_id)
        return {"batch_id": batch_id, "evaluations": [e.model_dump(mode="json") for e in evaluations]}

    @app.get("/api/evaluations")
    def list_evaluations(
        category: Category | None = None,
        outcome: Outcome | None = None,
        source: Source | None = None,
        batch_id: str | None = None,
    ) -> dict[str, Any]:
        items = service.store.list(category=category, outcome=outcome, source=source, batch_id=batch_id)
        return {"evaluations": [e.model_dump(mode="json") for e in items]}

    @app.get("/api/evaluations/{eval_id}")
    def get_evaluation(eval_id: str) -> dict[str, Any]:
        ev = service.store.get(eval_id)
        if ev is None:
            raise LabError(404, "evaluation_not_found", f"No evaluation with id '{eval_id}'")
        return ev.model_dump(mode="json")

    @app.delete("/api/evaluations", status_code=204)
    def clear_evaluations() -> Response:
        service.store.clear()
        return Response(status_code=204)

    if FRONTEND_DIST.is_dir():
        app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
    else:

        @app.get("/", response_class=HTMLResponse)
        def frontend_missing() -> str:
            return (
                "<h1>Frontend not built</h1><p>Run <code>npm install && npm run build</code> in "
                "<code>frontend/</code>, or use <code>./run.command</code>.</p>"
            )

    return app
