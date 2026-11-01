# Red vs Blue: AI Guardrail Arena

An attacker (Red) fires prompt-injection attacks at a defender (Blue) protected by Azure AI
Content Safety. Every round is a **live evaluation** against a real Azure resource, and the arena
animation only shows a result once Azure has actually returned one.

Built for the Microsoft Applied Skills course **Secure AI solutions in the cloud**, to demonstrate
and explain AI input controls with real evidence. Results describe this scenario set against
this Azure resource at the time of the run. They are not a general measure of security effectiveness.

## How a match works

1. **Setup:** the defense loadout shows every shield layer, where it runs (Azure or a local
   rule), and the Azure link state. *Configured* (credentials present) is shown separately from
   *Verified* (a live test call succeeded). Choose which attack categories and normal-traffic
   probes to include, or write your own attack (with an optional document for indirect injection).
2. **Rounds:** Red fires each prompt as a projectile. Normal requests fly as white "user
   traffic". The shields scan while the server runs the real checks (`queued → checking →
   completed | check failed`), then the projectile is stopped at the layer that flagged it, or
   passes through.
3. **Bars:** Blue's *shield integrity* drops by 1/N for each attack that gets through. Red's
   *attack strength* drops by 1/N for each attack that is blocked (N = attacks in the match).
   Failed checks move neither bar. A blocked normal request counts as a **false alarm**.
4. **Debrief (no winner):** attacks stopped out of attacks with a verdict, which layer stopped
   what, missed attacks, false alarms and check failures, each linking to its evidence.

The **Evidence log** stores every evaluation (SQLite) and can be filtered by category, result
and detection source. Each evaluation's evidence covers the prompt and document, expected vs
observed behavior, every check in order with its source and raw service response (including
Azure request IDs and rate-limit retries), the decision, and the application action.

## Checks

| # | Check | Runs in | API |
|---|---|---|---|
| 1 | Prompt Shields (user prompt + documents) | **Azure** | `POST /contentsafety/text:shieldPrompt` (2024-09-01) |
| 2 | Harm category analysis (Hate, Sexual, Violence, Self-harm) | **Azure** | `POST /contentsafety/text:analyze` |
| 3 | Custom blocklist (optional) | **Azure** | `blocklistNames` on `text:analyze` |
| 4 | Obfuscation heuristic (Base64 / character substitution) | **Local rule** in this app | n/a |

Decision rules (`backend/decision.py`):

- Any check flags the input → **Blocked**.
- Otherwise, if a required check failed (timeout, auth, rate limit, not configured) →
  **Check failed**. The request is withheld (fail closed) and is never counted as allowed.
- Otherwise → **Allowed**. No language model is connected, so "allowed" only means no check
  flagged the input. It does not mean a model was compromised.

The lab runs every check on every input to collect complete evidence. A production gateway
would normally stop at the first block.

## Setup

Requirements: Python 3.12+, Node.js 20+, an Azure AI Content Safety resource (the F0 free tier
works).

```bash
cp .env.example .env        # then fill in endpoint and key
./run.command               # creates .venv, builds the UI, starts http://127.0.0.1:8000
```

`run.command` can also be double-clicked in Finder. If the folder came from a download or chat
app and macOS blocks `.venv` libraries, delete `.venv`; the script recreates it. The app reads `.env` itself (path resolved
from the project folder), so `uvicorn backend.main:app` loads the same settings.

### Optional: Azure blocklist

```bash
.venv/bin/python -m scripts.setup_blocklist          # creates 'lab-sensitive-terms' in your resource
echo "AZURE_CONTENT_SAFETY_BLOCKLIST=lab-sensitive-terms" >> .env
```

### Development

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn backend.main:app --reload          # API on :8000
cd frontend && npm install && npm run dev            # UI on :5173 (proxies /api)
```

## Quality checks

```bash
.venv/bin/ruff check backend tests scripts && .venv/bin/mypy && .venv/bin/python -m pytest --cov=backend
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
```

Backend tests mock Azure (`respx` and a fake client), so they run offline.

## Security notes

- The Content Safety key stays on the server. It is excluded from the settings `repr`, never
  returned by the API, and scrubbed from error messages. API responses expose only the endpoint host.
- `.env` and `data/` (evaluation history) are git-ignored.
- All scenario data is fictional (Contoso / Fabrikam).

## Limitations

- Only input-side controls are evaluated. No model is connected, so model output and
  output-side filters are not tested.
- No Foundry content filter, Defender for Cloud alert or model deployment is used or claimed.
- Results are for this curated scenario set; they are not a general detection rate.
- The obfuscation heuristic is a simple local rule written for this lab and is easy to evade.

## Project layout

```
backend/
  main.py                 ASGI entrypoint (uvicorn backend.main:app)
  app.py                  FastAPI app factory and routes
  config.py               settings from .env / environment
  azure_content_safety.py async REST client (errors mapped to stable codes)
  checks.py               the check pipeline
  decision.py             outcome rules and expected-vs-observed comparison
  service.py              evaluation queue and worker, connection verification
  store.py                SQLite history
  scenarios.py            curated scenario library
  models.py               pydantic models
frontend/                 React + TypeScript + Vite arena (src/hooks/useMatch.ts drives a match,
                          src/lib/match.ts derives the scoring from real results)
scripts/setup_blocklist.py
tests/                    pytest suite
```
