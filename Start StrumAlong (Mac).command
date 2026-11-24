#!/bin/bash
# Starts a small web server for this folder (only this computer can reach it) and opens Chrome.
cd "$(dirname "$0")"
PORT=8732
if ! nc -z 127.0.0.1 $PORT 2>/dev/null; then
  python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
  sleep 1
fi
open -a "Google Chrome" "http://localhost:$PORT/" 2>/dev/null || open "http://localhost:$PORT/"
