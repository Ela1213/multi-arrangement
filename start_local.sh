#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
DATA_DIR="${STUDY_DATA_ROOT:-$ROOT/data}"
PYTHON_BIN="${PYTHON_BIN:-$ROOT/.venv/bin/python}"
export PYTHON_BIN
PROFILE="${STUDY_PROFILE:-formal}"
API_PORT="${API_PORT:-8500}"
WEB_PORT="${PORT:-3500}"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Create the Python 3.12 environment first: python3.12 -m venv .venv && .venv/bin/python -m pip install -r backend/requirements.txt" >&2
  exit 1
fi
if ! node --version | grep -Eq '^v(2[4-9]|[3-9][0-9])\.'; then
  echo "Node.js 24 or newer is required." >&2
  exit 1
fi

mkdir -p "$DATA_DIR"
export APP_ENV=development
export STUDY_PROFILE="$PROFILE"
export STUDY_DATA_ROOT="$DATA_DIR"
export EXPERIMENTER_KEY_SECRET="${EXPERIMENTER_KEY_SECRET:-local-dev-signing-secret}"
export DATABASE_URL="sqlite:////${DATA_DIR#/}/ma.sqlite3"
export PYTHONPATH="$ROOT/backend"
export MA_API_ORIGIN="http://127.0.0.1:$API_PORT"
export MA_EXPERIMENTER_KEY_FILE="$DATA_DIR/experimenter-key.txt"
export HOST=127.0.0.1
export PORT="$WEB_PORT"

"$PYTHON_BIN" -m uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" >"$DATA_DIR/api.log" 2>&1 &
API_PID=$!
cleanup() { kill "$API_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

ready=0
for _ in {1..50}; do
  if "$PYTHON_BIN" -c "import urllib.request; urllib.request.urlopen('$MA_API_ORIGIN/health/db', timeout=1)" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.2
done
if [[ "$ready" != 1 ]]; then
  echo "Arrangement API failed to start; see $DATA_DIR/api.log" >&2
  exit 1
fi

"$PYTHON_BIN" prepare_study.py
echo "Researcher setup: http://127.0.0.1:$WEB_PORT/setup"
echo "Participant pilot: http://127.0.0.1:$WEB_PORT/?participant_id=PILOT001"
node server.mjs
