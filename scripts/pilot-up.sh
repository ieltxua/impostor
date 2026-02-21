#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT_DIR/tmp/run"
PID_FILE="$RUN_DIR/server-pilot.pid"
NO_BUILD="${1:-}"
mkdir -p "$RUN_DIR"

server_health_ok() {
  local body
  body="$(curl -fsS http://localhost:3000/health 2>/dev/null || true)"
  [[ "$body" == *'"ok":true'* ]]
}

if [ "$NO_BUILD" != "--no-build" ]; then
  echo "building shared/server/client artifacts..."
  (cd "$ROOT_DIR" && npm run build)
fi

if [ ! -f "$ROOT_DIR/server/dist/index.js" ]; then
  echo "missing server build artifact at server/dist/index.js"
  echo "run ./scripts/pilot-up.sh (without --no-build) or npm run build first"
  exit 1
fi

if [ -f "$PID_FILE" ]; then
  existing_pid="$(cat "$PID_FILE")"
  if kill -0 "$existing_pid" 2>/dev/null; then
    existing_cmd="$(ps -p "$existing_pid" -o command= 2>/dev/null || true)"
    if [[ "$existing_cmd" == *"dist/index.js"* ]]; then
      echo "pilot server already running (pid $existing_pid)"
      if server_health_ok; then
        curl -fsS http://localhost:3000/health
        exit 0
      fi
    fi
  fi
  rm -f "$PID_FILE"
fi

listeners="$(lsof -ti tcp:3000 -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$listeners" ]; then
  echo "port 3000 is already in use by pid(s): $listeners"
  echo "run ./scripts/dev-down.sh --kill-port-listeners or ./scripts/pilot-down.sh --kill-port-listeners"
  exit 1
fi

nohup bash -lc "cd '$ROOT_DIR/server' && node dist/index.js" > "$RUN_DIR/server-pilot.log" 2>&1 &
echo $! > "$PID_FILE"
echo "started pilot server pid $(cat "$PID_FILE")"

for _ in $(seq 1 40); do
  if server_health_ok; then
    echo "pilot health check:"
    curl -fsS http://localhost:3000/health
    echo
    echo "pilot url: http://localhost:3000/"
    exit 0
  fi
  sleep 0.5
done

echo "pilot server did not become healthy; last log lines:"
tail -n 40 "$RUN_DIR/server-pilot.log" || true
exit 1
