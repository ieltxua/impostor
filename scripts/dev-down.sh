#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT_DIR/tmp/run"
KILL_PORT_LISTENERS="${1:-}"

stop_from_pid_file() {
  local name="$1"
  local expected="$2"
  local pid_file="$RUN_DIR/$name.pid"

  if [ ! -f "$pid_file" ]; then
    echo "$name pid file missing"
    return
  fi

  local pid
  pid="$(cat "$pid_file")"

  if ! kill -0 "$pid" 2>/dev/null; then
    echo "$name pid $pid not running"
    rm -f "$pid_file"
    return
  fi

  local cmdline
  cmdline="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  if [[ "$cmdline" != *"$expected"* ]]; then
    echo "skipping $name pid $pid (unexpected command: $cmdline)"
    rm -f "$pid_file"
    return
  fi

  kill "$pid" || true
  sleep 0.5
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" || true
  fi
  echo "stopped $name pid $pid"
  rm -f "$pid_file"
}

stop_from_pid_file "server-dev" "src/index.ts"
stop_from_pid_file "client-dev" "vite"

for port in 3000 5173; do
  pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "found listeners on :$port -> $pids"
    if [ "$KILL_PORT_LISTENERS" = "--kill-port-listeners" ]; then
      kill $pids 2>/dev/null || true
      sleep 0.5
      remaining="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
      if [ -n "$remaining" ]; then
        kill -9 $remaining 2>/dev/null || true
      fi
      echo "killed listeners on :$port"
    fi
  fi
done
