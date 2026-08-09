#!/usr/bin/env bash
# Craft — run file server + Vite dev server together.
set -e

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "[craft] starting file server on http://localhost:8787"
bun server/index.ts &
SERVER_PID=$!

cd apps/editor
bun run dev
