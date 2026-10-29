# Red vs Blue: AI Battle Arena

An attacker AI (Red) tries to jailbreak a defender AI (Blue) round by round. Blue is protected by Azure AI guardrails. Each round shows whether the attack was stopped, which layer stopped it, and what got through. The final report lists the attacks that breached Blue and the defenses that stopped the rest.

Built to match the **Secure AI solutions in the cloud** Applied Skills lab:

| Layer | Azure feature | Exam skill |
|---|---|---|
| Harmful content | Foundry content filter | Model guardrails |
| Jailbreak in user prompt | Prompt Shields (user prompt) | Model guardrails |
| Hidden instruction in a document | Prompt Shields (documents) | Model guardrails |
| Custom terms | Blocklist | Model guardrails |
| Alerts on attacks | Defender for Cloud AI threat protection | Defender for AI services |

## Modes

- **Demo mode (default):** Blue's defenses are rule-based and mirror the Azure layers. Runs anywhere with no Azure account. The header badge says `DEMO MODE`, and Defender alerts in the report are marked as simulated.
- **Azure mode:** The Prompt Shields checks call Azure AI Content Safety. Turns on when both environment variables are set:
  - `AZURE_CONTENT_SAFETY_ENDPOINT`, e.g. `https://<your-resource>.cognitiveservices.azure.com`
  - `AZURE_CONTENT_SAFETY_KEY`

  If an Azure call fails, the app falls back to demo rules so the battle still runs.

## Run it

```bash
cd red-vs-blue
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn backend.app:app --reload
```

Open http://127.0.0.1:8000 and press **Start battle**.

## Run the tests

```bash
pytest -q
```

## Project layout

```
backend/
  app.py       FastAPI app, battle engine, report
  guard.py     Blue's defenses: demo rules + Azure Prompt Shields client
  attacks.py   Library of attack prompts for Red
frontend/
  index.html   Battle arena UI (no build step)
tests/
  test_battle.py
```

## Notes

- The Red AI uses a fixed library of known attack patterns, not new jailbreaks. This keeps battles repeatable and safe to demo.
- Attacks written to get past the demo rules (encoded text, fiction framing, translate-then-obey) are deliberately left unblocked. Real guardrails miss some of these too, and the report shows which ones got through.
- The Azure path calls `POST {endpoint}/contentsafety/text:shieldPrompt` (api-version `2024-09-01`). Check the current API version in the Azure docs before relying on it.
- Defender for Cloud alerts appear in the portal after traffic is logged. They aren't instant, so they may not show up during a battle.
