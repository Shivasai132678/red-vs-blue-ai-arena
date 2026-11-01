"""SQLite persistence for evaluation history.

Each evaluation is stored as a JSON document, with the columns used for filtering
kept alongside it. The dataset is small (a lab, not production telemetry).
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

from backend.models import Evaluation

SCHEMA = """
CREATE TABLE IF NOT EXISTS evaluations (
    id          TEXT PRIMARY KEY,
    seq         INTEGER NOT NULL,
    batch_id    TEXT,
    category    TEXT NOT NULL,
    status      TEXT NOT NULL,
    outcome     TEXT,
    sources     TEXT NOT NULL,
    payload     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evaluations_seq ON evaluations (seq);
"""

UNFINISHED = ("queued", "checking")


class EvaluationStore:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(SCHEMA)

    def save(self, ev: Evaluation) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT INTO evaluations (id, seq, batch_id, category, status, outcome, sources, payload)
                VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM evaluations), ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    status = excluded.status, outcome = excluded.outcome,
                    sources = excluded.sources, payload = excluded.payload
                """,
                (
                    ev.id,
                    ev.batch_id,
                    ev.scenario.category,
                    ev.status,
                    ev.outcome,
                    json.dumps(ev.detection_sources),
                    ev.model_dump_json(),
                ),
            )

    def get(self, eval_id: str) -> Evaluation | None:
        with self._lock:
            row = self._conn.execute("SELECT payload FROM evaluations WHERE id = ?", (eval_id,)).fetchone()
        return Evaluation.model_validate_json(row[0]) if row else None

    def list(
        self,
        category: str | None = None,
        outcome: str | None = None,
        source: str | None = None,
        batch_id: str | None = None,
    ) -> list[Evaluation]:
        clauses: list[str] = []
        params: list[str] = []
        for column, value in (("category", category), ("outcome", outcome), ("batch_id", batch_id)):
            if value:
                clauses.append(f"{column} = ?")
                params.append(value)
        if source:
            clauses.append("EXISTS (SELECT 1 FROM json_each(sources) WHERE value = ?)")
            params.append(source)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._lock:
            rows = self._conn.execute(f"SELECT payload FROM evaluations {where} ORDER BY seq DESC", params).fetchall()
        return [Evaluation.model_validate_json(r[0]) for r in rows]

    def mark_interrupted(self) -> int:
        """Fail evaluations left unfinished by a previous server process."""
        with self._lock:
            rows = self._conn.execute("SELECT payload FROM evaluations WHERE status IN (?, ?)", UNFINISHED).fetchall()
        for (payload,) in rows:
            ev = Evaluation.model_validate_json(payload)
            self.save(
                ev.model_copy(
                    update={
                        "status": "check_failed",
                        "outcome": "check_failed",
                        "decision_reason": "Interrupted: the server stopped before the checks finished.",
                        "application_action": "Request withheld (fail closed): checks did not complete.",
                    }
                )
            )
        return len(rows)

    def clear(self) -> None:
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM evaluations")

    def close(self) -> None:
        self._conn.close()
