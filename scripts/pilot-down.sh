#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT_DIR/tmp/run"
PID_FILE="$RUN_DIR/server-pilot.pid"
KILL_PORT_LISTENERS="${1:-}"

if [ -f "$PID_FILE" ]; then
  pid="$(cat "$PID_FILE")"
  if kill -0 "$pid" 2>/dev/null; then
    cmdline="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$cmdline" == *"dist/index.js"* ]]; then
      kill "$pid" || true
      sleep 0.5
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" || true
      fi
      echo "stopped pilot server pid $pid"
    else
      echo "skipping pilot pid $pid (unexpected command: $cmdline)"
    fi
  else
    echo "pilot server pid $pid not running"
  fi
  rm -f "$PID_FILE"
else
  echo "pilot server pid file missing"
fi

listeners="$(lsof -ti tcp:3000 -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$listeners" ]; then
  echo "found listeners on :3000 -> $listeners"
  if [ "$KILL_PORT_LISTENERS" = "--kill-port-listeners" ]; then
    kill $listeners 2>/dev/null || true
    sleep 0.5
    remaining="$(lsof -ti tcp:3000 -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "$remaining" ]; then
      kill -9 $remaining 2>/dev/null || true
    fi
    echo "killed listeners on :3000"
  fi
fi
