#!/bin/bash
# Double-click on macOS (or run ./run.command) to start the AI Guardrail Evaluation Lab.
# Settings are read from .env by the app itself; this script only prepares and starts it.

cd "$(dirname "$0")" || exit 1

pause_and_exit() { read -r -p "Press Enter to close..."; exit 1; }

echo "AI Guardrail Evaluation Lab"
echo

command -v python3 >/dev/null 2>&1 || { echo "Python 3.12+ is required: https://www.python.org/downloads/"; pause_and_exit; }
command -v npm >/dev/null 2>&1 || { echo "Node.js 20+ is required to build the interface: https://nodejs.org/"; pause_and_exit; }

if [ ! -f ".env" ]; then
  echo "Note: no .env file found. Azure checks will report 'not configured'. See .env.example."
fi

if [ ! -x ".venv/bin/python" ] || ! .venv/bin/python -c "import fastapi" >/dev/null 2>&1; then
  echo "Setting up the Python environment..."
  rm -rf .venv
  python3 -m venv .venv || { echo "Could not create the virtual environment."; pause_and_exit; }
fi
.venv/bin/pip install -q -r requirements.txt || { echo "Python dependency install failed."; pause_and_exit; }

# Build the interface when it is missing or older than its sources.
if [ ! -f frontend/dist/index.html ] || [ -n "$(find frontend/src frontend/index.html -newer frontend/dist/index.html 2>/dev/null | head -1)" ]; then
  echo "Building the interface..."
  (cd frontend && { [ -d node_modules ] || npm install --silent; } && npm run build --silent) || { echo "Interface build failed."; pause_and_exit; }
fi

echo
echo "Starting at http://127.0.0.1:8000  (Ctrl+C to stop)"
( sleep 2 && open "http://127.0.0.1:8000" ) &
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
read -r -p "Server stopped. Press Enter to close..."
