#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="${STUDY_DATA_ROOT:-/data}"
MATERIALS_DIR="${STUDY_MATERIALS_ROOT:-$DATA_DIR/materials}"
PYTHON_BIN="${PYTHON_BIN:-python}"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${PORT:-3500}"
if [[ -z "${PUBLIC_BASE_URL:-}" && -n "${RENDER_EXTERNAL_URL:-}" ]]; then
  export PUBLIC_BASE_URL="$RENDER_EXTERNAL_URL"
fi

if [[ "${APP_ENV:-development}" == "production" ]]; then
  : "${EXPERIMENTER_KEY_SECRET:?Set EXPERIMENTER_KEY_SECRET}"
  : "${RESEARCHER_ADMIN_KEY:?Set RESEARCHER_ADMIN_KEY}"
  : "${PUBLIC_BASE_URL:?Set PUBLIC_BASE_URL}"
fi
mkdir -p "$DATA_DIR" "$MATERIALS_DIR/public/stimuli"
for name in arrangement.config.json words.txt word-images.json; do
  if [[ ! -e "$MATERIALS_DIR/$name" ]]; then cp "$ROOT/$name" "$MATERIALS_DIR/$name"; fi
done
if [[ ! -e "$MATERIALS_DIR/public/instruction-reference.png" ]]; then
  cp "$ROOT/public/instruction-reference.png" "$MATERIALS_DIR/public/instruction-reference.png"
fi
for image in "$ROOT"/public/stimuli/*; do
  [[ -f "$image" ]] || continue
  target="$MATERIALS_DIR/public/stimuli/${image##*/}"
  if [[ ! -e "$target" ]]; then cp "$image" "$target"; fi
done

export STUDY_PROFILE="${STUDY_PROFILE:-formal}"
export STUDY_DATA_ROOT="$DATA_DIR" STUDY_MATERIALS_ROOT="$MATERIALS_DIR"
export PYTHON_BIN PYTHONPATH="$ROOT/backend"
export MA_API_ORIGIN="http://127.0.0.1:$API_PORT"
export MA_EXPERIMENTER_KEY_FILE="$DATA_DIR/experimenter-key.txt"
export HOST="${HOST:-0.0.0.0}" PORT="$WEB_PORT"
"$PYTHON_BIN" -m uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" &
API_PID=$!
WEB_PID=""
cleanup() {
  if [[ -n "$WEB_PID" ]]; then kill "$WEB_PID" 2>/dev/null || true; fi
  kill "$API_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
ready=0
for _ in {1..100}; do
  if "$PYTHON_BIN" -c "import urllib.request; urllib.request.urlopen('$MA_API_ORIGIN/health/db', timeout=1)" >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 0.2
done
if [[ "$ready" != 1 ]]; then echo "API not ready" >&2; exit 1; fi
"$PYTHON_BIN" "$ROOT/prepare_study.py"
node "$ROOT/server.mjs" &
WEB_PID=$!
if (( BASH_VERSINFO[0] >= 5 )); then
  wait -n "$API_PID" "$WEB_PID"
else
  wait "$WEB_PID"
fi
