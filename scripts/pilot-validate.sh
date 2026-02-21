#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-dev}"

server_health_ok() {
  local body
  body="$(curl -fsS http://localhost:3000/health 2>/dev/null || true)"
  [[ "$body" == *'"ok":true'* ]]
}

if [ "$MODE" != "dev" ] && [ "$MODE" != "pilot" ]; then
  echo "usage: ./scripts/pilot-validate.sh [dev|pilot]"
  echo "  dev   -> expects localhost:3000 and localhost:5173"
  echo "  pilot -> expects localhost:3000 only"
  exit 1
fi

echo "running code validation..."
npm run test --workspace server
npm run lint --workspace server
npm run typecheck --workspace client

echo "running runtime validation ($MODE mode)..."
if ! server_health_ok; then
  echo "server health check failed on http://localhost:3000/health"
  exit 1
fi

if [ "$MODE" = "dev" ]; then
  if ! curl -fsS http://localhost:5173/ >/dev/null 2>&1; then
    echo "client check failed on http://localhost:5173/"
    exit 1
  fi
fi

echo "validation passed"
