"""Red vs Blue: AI Battle Arena - FastAPI backend.

Run:  uvicorn backend.app:app --reload   (from the red-vs-blue folder)
Open: http://127.0.0.1:8000
"""

import random
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend import guard
from backend.attacks import ATTACKS

START_HP = 100
RED_DAMAGE = 10   # Red loses this much HP for each attack Blue stops
BLUE_DAMAGE = 20  # Blue loses this much HP for each attack that gets through

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="Red vs Blue: AI Battle Arena")


def run_battle(rounds: int = 10, seed: int | None = None) -> dict:
    rng = random.Random(seed)
    # Shuffle the library; repeat it if more rounds are requested than attacks exist.
    pool = []
    while len(pool) < rounds:
        batch = ATTACKS[:]
        rng.shuffle(batch)
        pool.extend(batch)
    pool = pool[:rounds]

    red_hp, blue_hp = START_HP, START_HP
    results = []
    alerts = []

    for n, attack in enumerate(pool, start=1):
        verdict = guard.check(attack["prompt"], attack.get("document"))

        if verdict.blocked:
            red_hp -= RED_DAMAGE  # Red loses HP when the attack is stopped
            commentary = (
                f"Round {n}: {attack['name']} is stopped by "
                f"{guard.LAYER_LABELS[verdict.layer]}. Red takes {RED_DAMAGE} damage."
            )
            if attack["category"] in ("jailbreak", "indirect", "extraction"):
                alerts.append({
                    "round": n,
                    "severity": "High" if attack["category"] != "extraction" else "Medium",
                    "title": f"AI attack blocked: {attack['name']}",
                    "simulated": verdict.simulated,
                })
        else:
            blue_hp -= BLUE_DAMAGE  # Blue loses HP when an attack gets through
            commentary = (
                f"Round {n}: {attack['name']} SLIPS THROUGH! "
                f"Blue takes {BLUE_DAMAGE} damage."
            )

        results.append({
            "round": n,
            "attack": {
                "id": attack["id"],
                "name": attack["name"],
                "category": attack["category"],
                "prompt": attack["prompt"],
                "document": attack.get("document"),
            },
            "blocked": verdict.blocked,
            "layer": verdict.layer,
            "layer_label": guard.LAYER_LABELS.get(verdict.layer) if verdict.layer else None,
            "reason": verdict.reason,
            "red_hp": max(red_hp, 0),
            "blue_hp": max(blue_hp, 0),
            "commentary": commentary,
        })

    breached = [r for r in results if not r["blocked"]]
    stopped = [r for r in results if r["blocked"]]
    by_layer = {}
    for r in stopped:
        by_layer[r["layer_label"]] = by_layer.get(r["layer_label"], 0) + 1

    if blue_hp > red_hp:
        winner = "Blue"
    elif red_hp > blue_hp:
        winner = "Red"
    else:
        winner = "Draw"

    return {
        "mode": guard.mode(),
        "rounds": results,
        "winner": winner,
        "report": {
            "total_attacks": len(results),
            "stopped": len(stopped),
            "breached": len(breached),
            "breached_attacks": [r["attack"]["name"] for r in breached],
            "stopped_by_layer": by_layer,
            "alerts": alerts,
            "alerts_are_simulated": guard.mode() == "demo",
        },
    }


@app.get("/api/health")
def health():
    return {"status": "ok", "mode": guard.mode()}


@app.get("/api/attacks")
def list_attacks():
    return [{k: a[k] for k in ("id", "name", "category")} for a in ATTACKS]


@app.post("/api/battle")
def battle(rounds: int = Query(10, ge=1, le=30), seed: int | None = None):
    try:
        return run_battle(rounds=rounds, seed=seed)
    except guard.AzureShieldError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")


app.mount("/static", StaticFiles(directory=FRONTEND), name="static")
