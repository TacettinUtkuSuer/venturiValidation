#!/usr/bin/env bash
# Tüm testler: birim (node) + uçtan uca (Playwright/Chromium).
# Gereken: node, playwright (npm i -g playwright veya NODE_PATH ile), http-server (npx http-server).
set -e
cd "$(dirname "$0")/.."
node tests/build-check.js
node tests/unit-calib.js
PORT=${PORT:-8123}
if ! curl -s -o /dev/null "http://localhost:$PORT/index.html"; then
  npx --yes http-server -p "$PORT" -s -c-1 . >/dev/null 2>&1 &
  SERVER=$!
  trap 'kill $SERVER' EXIT
  sleep 2
fi
BASE="http://localhost:$PORT" node tests/e2e.js
