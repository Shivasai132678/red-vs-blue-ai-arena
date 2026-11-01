"""ASGI entrypoint: `uvicorn backend.main:app`. Kept separate so importing the app
factory (e.g. in tests) has no side effects."""

import logging

from backend.app import create_app

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()
