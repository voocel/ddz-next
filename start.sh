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

# 监听指定端口的 PID 列表（unix 走 lsof，Windows/Git Bash 走 netstat）
listening_pids() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -u || true
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | awk -v addr=":${port}" '/LISTENING/ && $2 ~ addr"$" {print $NF}' | sort -u || true
  fi
}

stop_pid() {
  local pid="$1"
  local force="$2"

  if command -v taskkill >/dev/null 2>&1; then
    taskkill //F //PID "$pid" >/dev/null 2>&1 || true
  elif [[ "$force" == "force" ]]; then
    kill -9 "$pid" 2>/dev/null || true
  else
    kill "$pid" 2>/dev/null || true
  fi
}

# 端口被占则自动停掉旧进程（多为上次残留的 dev server）；两轮（先温和后强杀）仍占用才报错
free_port() {
  local port="$1"
  local label="$2"
  local force="" pid pids

  pids="$(listening_pids "$port")"
  if [[ -z "$pids" ]]; then
    return
  fi

  echo "[start] ${label} port ${port} is in use; stopping old process(es): ${pids//$'\n'/ }"
  for _ in 1 2; do
    for pid in $pids; do
      stop_pid "$pid" "$force"
    done
    for _ in 1 2 3 4 5 6; do
      pids="$(listening_pids "$port")"
      if [[ -z "$pids" ]]; then
        return
      fi
      sleep 0.5
    done
    force="force"
  done

  echo "[start] could not free ${label} port ${port}; still held by: ${pids//$'\n'/ }" >&2
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

free_port "$API_PORT" "API"
free_port "$GAME_PORT" "Game Server"
free_port "$WEB_PORT" "Web"

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
