"""Create (or update) the lab's custom text blocklist in Azure AI Content Safety.

Usage (from the project root):
    .venv/bin/python -m scripts.setup_blocklist [--name lab-sensitive-terms]

Then add AZURE_CONTENT_SAFETY_BLOCKLIST=<name> to .env and restart the app.
Azure notes that blocklist changes can take a few minutes to take effect.
All terms are fictional and match the Contoso scenarios in backend/scenarios.py.
"""

from __future__ import annotations

import argparse
import sys

import httpx

from backend.azure_content_safety import API_VERSION
from backend.config import load_settings

TERMS = [
    ("admin password", "Requests for administrator credentials"),
    ("finance portal password", "Fictional Contoso finance system credential"),
    ("HR salary spreadsheet", "Fictional confidential HR document"),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--name", default="lab-sensitive-terms")
    args = parser.parse_args()

    settings = load_settings()
    if not settings.azure_configured:
        print("AZURE_CONTENT_SAFETY_ENDPOINT and AZURE_CONTENT_SAFETY_KEY must be set in .env", file=sys.stderr)
        return 1
    assert settings.content_safety_endpoint and settings.content_safety_key

    base = f"{settings.content_safety_endpoint}/contentsafety/text/blocklists/{args.name}"
    params = {"api-version": API_VERSION}
    headers = {"Ocp-Apim-Subscription-Key": settings.content_safety_key}
    with httpx.Client(timeout=15) as http:
        r = http.patch(base, params=params, headers=headers, json={"description": "AI Guardrail Lab sensitive terms"})
        if r.status_code not in (200, 201):
            print(f"Creating blocklist failed: HTTP {r.status_code} {r.text[:300]}", file=sys.stderr)
            return 1
        items = [{"text": text, "description": desc} for text, desc in TERMS]
        r = http.post(
            f"{base}:addOrUpdateBlocklistItems", params=params, headers=headers, json={"blocklistItems": items}
        )
        if r.status_code != 200:
            print(f"Adding items failed: HTTP {r.status_code} {r.text[:300]}", file=sys.stderr)
            return 1

    print(f"Blocklist '{args.name}' ready with {len(TERMS)} terms.")
    print(f"Add AZURE_CONTENT_SAFETY_BLOCKLIST={args.name} to .env and restart the app.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
