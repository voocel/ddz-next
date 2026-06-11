#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Usage:
  ./start.sh   Start API, Game Server, and Web.
USAGE
  exit 0
fi

if [[ $# -gt 0 ]]; then
  echo "[start] unknown argument: ${1:-}" >&2
  echo "Usage: ./start.sh" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[start] pnpm is required but was not found in PATH." >&2
  exit 1
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

pids=()
names=()

cleanup() {
  trap - SIGINT SIGTERM EXIT
  if [[ ${#pids[@]} -gt 0 ]]; then
    echo
    echo "[start] stopping services..."
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
}

redact_database_url() {
  local value="$1"

  if [[ "$value" =~ ^([^:/?#]+://)([^:@/?#]+):([^@/?#]+)@(.+)$ ]]; then
    echo "${BASH_REMATCH[1]}****:****@${BASH_REMATCH[4]}"
    return
  fi

  echo "$value"
}

check_port() {
  local port="$1"
  local label="$2"

  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  local listeners
  listeners="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$listeners" ]]; then
    return
  fi

  echo "[start] ${label} port ${port} is already in use:" >&2
  echo "$listeners" >&2
  echo "[start] stop the existing process or change the port in .env, then run ./start.sh again." >&2
  exit 1
}

start_service() {
  local name="$1"
  shift

  "$@" &
  pids+=("$!")
  names+=("$name")
}

is_process_done() {
  local pid="$1"
  local state

  state="$(ps -o stat= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)"
  [[ -z "$state" || "$state" == Z* ]]
}

trap cleanup SIGINT SIGTERM EXIT

echo "[start] database: $(redact_database_url "${DATABASE_URL:-DATABASE_URL not set}")"
echo "[start] api: ${API_ENDPOINT:-http://localhost:3000}"
echo "[start] game: ${VITE_GAME_ENDPOINT:-http://localhost:2567}"
echo "[start] web: http://localhost:5173"
echo "[start] bot count: ${BOT_COUNT:-0}"

API_PORT="${API_PORT:-3000}"
GAME_PORT="${GAME_PORT:-2567}"
WEB_PORT="5173"

check_port "$API_PORT" "API"
check_port "$GAME_PORT" "Game Server"
check_port "$WEB_PORT" "Web"

start_service "api" pnpm --filter @ddz/api dev
start_service "game" pnpm --filter @ddz/game-server dev
start_service "web" pnpm --filter @ddz/web dev

while true; do
for index in "${!pids[@]}"; do
    pid="${pids[$index]}"
    name="${names[$index]}"
    if is_process_done "$pid"; then
      if wait "$pid"; then
        status=0
      else
        status=$?
      fi
      echo "[start] ${name} exited with code ${status}." >&2
      exit "$status"
    fi
  done
  sleep 1
done
