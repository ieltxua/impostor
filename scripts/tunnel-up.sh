#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT_DIR/tmp/run"
mkdir -p "$RUN_DIR"

PORT="${1:-3000}"
PROVIDER="${2:-cloudflared}"

case "$PROVIDER" in
  cloudflared)
    if ! command -v cloudflared >/dev/null 2>&1; then
      echo "cloudflared not installed. macOS: brew install cloudflared"
      exit 1
    fi
    cmd=(cloudflared tunnel --url "http://localhost:$PORT")
    ;;
  ngrok)
    if ! command -v ngrok >/dev/null 2>&1; then
      echo "ngrok not installed. macOS: brew install ngrok"
      exit 1
    fi
    cmd=(ngrok http "$PORT")
    ;;
  localtunnel)
    if command -v lt >/dev/null 2>&1; then
      cmd=(lt --port "$PORT")
    else
      cmd=(npx localtunnel --port "$PORT")
    fi
    ;;
  *)
    echo "unsupported provider: $PROVIDER"
    echo "usage: ./scripts/tunnel-up.sh [port] [cloudflared|ngrok|localtunnel]"
    exit 1
    ;;
esac

echo "starting tunnel: ${cmd[*]}"
"${cmd[@]}" | tee "$RUN_DIR/tunnel-$PROVIDER.log"
