#!/bin/sh
# Development happens inside an Apple container (https://github.com/apple/container).
#   tools/dev.sh             start the dev container + dev server (http://localhost:4200)
#   PORT=4300 tools/dev.sh   same, on another host port (the container is recreated if needed)
#   tools/dev.sh <cmd...>    run a command in the container, e.g. tools/dev.sh npm test
#   tools/dev.sh shell       open a shell in the container
set -eu
NAME=edb-dev
PORT="${PORT:-4200}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

running() { container list --quiet 2>/dev/null | grep -qx "$NAME"; }
exists() { container list --all --quiet 2>/dev/null | grep -qx "$NAME"; }
# Host port the existing container publishes for the dev server (empty if none).
published_port() {
  container inspect "$NAME" 2>/dev/null | tr -d ' \n' | grep -o '"hostPort":[0-9]*' | head -1 | cut -d: -f2
}

if exists && [ "$(published_port)" != "$PORT" ]; then
  echo "Recreating $NAME to publish port $PORT..."
  container stop "$NAME" >/dev/null 2>&1 || true
  container delete "$NAME" >/dev/null
fi

if ! running; then
  if exists; then
    container start "$NAME" >/dev/null
  else
    # The dev server always listens on 4200 inside the container; PORT is the host side.
    container run -d --name "$NAME" -v "$ROOT":/workspace -w /workspace -p "$PORT":4200 \
      --memory 8g --cpus 6 node:24 sleep infinity >/dev/null
  fi
  container exec "$NAME" sh -c 'cd /workspace && { [ -d node_modules ] || npm ci; } && npx playwright install --with-deps chromium >/dev/null'
fi

serving() { container exec "$NAME" sh -c 'curl -s -o /dev/null http://localhost:4200/' 2>/dev/null; }

if [ $# -eq 0 ]; then
  if serving; then
    echo "Dev server is already running: http://localhost:$PORT"
    echo "(Logs: tools/dev.sh tail -f /tmp/ng-serve.log)"
    exit 0
  fi
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | grep -v '^container' | grep -q LISTEN; then
    echo "Warning: something else on this Mac is also listening on port $PORT; localhost:$PORT may reach it instead." >&2
    echo "         Try another port, e.g. PORT=4300 tools/dev.sh" >&2
  fi
  echo "Dev server: http://localhost:$PORT (Ctrl+C to stop)"
  exec container exec -it "$NAME" sh -c 'cd /workspace && npm start'
elif [ "$1" = shell ]; then
  exec container exec -it "$NAME" bash
else
  exec container exec "$NAME" sh -c "cd /workspace && $*"
fi
