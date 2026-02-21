#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT_DIR/tmp/run"
mkdir -p "$RUN_DIR"

server_health_ok() {
  local body
  body="$(curl -fsS http://localhost:3000/health 2>/dev/null || true)"
  [[ "$body" == *'"ok":true'* ]]
}

client_health_ok() {
  curl -fsS http://localhost:5173/ >/dev/null 2>&1
}

kill_port_listeners() {
  local port="$1"
  local pids
  pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true
    sleep 0.5
    pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

ensure_server() {
  local listener
  listener="$(lsof -ti tcp:3000 -sTCP:LISTEN 2>/dev/null || true)"

  if [ -n "$listener" ]; then
    if server_health_ok; then
      echo "server listener already active on :3000 (pid $listener)"
      return
    fi
    echo "stale server listener detected on :3000 (pid $listener), restarting"
    kill_port_listeners 3000
  fi

  nohup bash -lc "cd '$ROOT_DIR' && npm run dev --workspace server" > "$RUN_DIR/server-dev.log" 2>&1 &
  echo $! > "$RUN_DIR/server-dev.pid"
  echo "started server pid $(cat "$RUN_DIR/server-dev.pid")"
}

ensure_client() {
  local listener
  listener="$(lsof -ti tcp:5173 -sTCP:LISTEN 2>/dev/null || true)"

  if [ -n "$listener" ]; then
    if client_health_ok; then
      echo "client listener already active on :5173 (pid $listener)"
      return
    fi
    echo "stale client listener detected on :5173 (pid $listener), restarting"
    kill_port_listeners 5173
  fi

  nohup bash -lc "cd '$ROOT_DIR' && npm run dev --workspace client -- --host 0.0.0.0" > "$RUN_DIR/client-dev.log" 2>&1 &
  echo $! > "$RUN_DIR/client-dev.pid"
  echo "started client pid $(cat "$RUN_DIR/client-dev.pid")"
}

wait_for_server_health() {
  for _ in $(seq 1 30); do
    if server_health_ok; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

wait_for_client_health() {
  for _ in $(seq 1 30); do
    if client_health_ok; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

ensure_server
ensure_client

if ! wait_for_server_health; then
  echo "server health check failed after startup; last log lines:"
  tail -n 40 "$RUN_DIR/server-dev.log" || true
  exit 1
fi

if ! wait_for_client_health; then
  echo "client health check failed after startup; last log lines:"
  tail -n 40 "$RUN_DIR/client-dev.log" || true
  exit 1
fi

echo "health check:"
curl -sS http://localhost:3000/health

echo
echo "app url: http://localhost:5173/"
