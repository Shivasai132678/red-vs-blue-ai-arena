#!/bin/bash
# Double-click this file on macOS to start Red vs Blue in Terminal.

cd "$(dirname "$0")" || exit 1

# Load Azure settings from .env if the file exists (keep this file private).
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
  echo "Loaded settings from .env"
fi

echo "=============================================="
echo "  RED vs BLUE: AI Battle Arena"
echo "=============================================="

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is not installed. Install it from https://www.python.org/downloads/ and double-click again."
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d ".venv" ]; then
  echo "First run: creating a virtual environment (one-time)..."
  python3 -m venv .venv || { echo "Could not create virtual environment."; read -r -p "Press Enter to close..."; exit 1; }
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo "Installing dependencies (quick if already done)..."
pip install -q -r requirements.txt || { echo "Dependency install failed. Check your internet connection."; read -r -p "Press Enter to close..."; exit 1; }

echo ""
echo "Starting server at http://127.0.0.1:8000"
echo "Press Ctrl+C in this window to stop."
echo ""

# Open the browser once the server has had a moment to start.
( sleep 3 && open "http://127.0.0.1:8000" ) &

uvicorn backend.app:app --host 127.0.0.1 --port 8000
echo ""
read -r -p "Server stopped. Press Enter to close..."
