#!/usr/bin/env bash
# The whole demo at one URL: chat, inspector and docs at http://localhost:3000
#
#   ./demo.sh                     your own conversations (schema aim_live)
#   ./demo.sh --schema aim_app    the seeded demo data
#   ./demo.sh --port 3005         the front door on another port
#
# Starts three servers and stops them on Ctrl-C:
#   :3000  the inspector (web/), which also serves /chat and /docs by proxy
#   :8765  the companion's chat (companion/), writing to the chosen schema
#   :3101  the docs site (site/), built with SITE_MODE=demo into site/build-demo
# A chat server already running on its port is reused if it uses the same schema.
# Needs what the README's quick start sets up: the database, Ollama, API key, npm installs.
set -euo pipefail
cd "$(dirname "$0")"

SCHEMA=aim_live
WEB_PORT=${PORT:-3000}
CHAT_PORT=${COMPANION_PORT:-8765}
DOCS_PORT=${DOCS_PORT:-3101}
while [ $# -gt 0 ]; do
  case "$1" in
    --schema) SCHEMA=$2; shift 2 ;;
    --port) WEB_PORT=$2; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done
SCHEMA_UPPER=$(printf '%s' "$SCHEMA" | tr '[:lower:]' '[:upper:]')

listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
wait_for() {  # port, name
  for _ in $(seq 1 120); do listening "$1" && return 0; sleep 0.5; done
  echo "demo: $2 didn't start on :$1" >&2; exit 1
}

# Each server runs in its own process group (set -m), so stopping it also stops
# what npm and uv started under it, and Ctrl-C reaches only this script's trap.
set -m
PIDS=""
cleanup() {
  for pid in $PIDS; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if listening "$WEB_PORT"; then
  echo "demo: :$WEB_PORT is in use. Stop that server, or pick another port with --port." >&2
  exit 1
fi
# Next allows one dev server per folder, and web/ may already have one on another port.
lock_pid=$(sed -n 's/.*"pid": *\([0-9]*\).*/\1/p' web/.next/dev/lock 2>/dev/null || true)
if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
  lock_url=$(sed -n 's/.*"appUrl": *"\([^"]*\)".*/\1/p' web/.next/dev/lock)
  echo "demo: the inspector is already running from web/ at $lock_url (pid $lock_pid), and Next allows one" >&2
  echo "      per folder. Stop it (kill $lock_pid) and run ./demo.sh again." >&2
  exit 1
fi

# Chat. Reuse a running one only if it writes to the schema the inspector will read.
if listening "$CHAT_PORT"; then
  running=$(curl -fsS "http://127.0.0.1:$CHAT_PORT/api/info" 2>/dev/null | sed -n 's/.*"db_user": *"\([^"]*\)".*/\1/p')
  if [ "$running" != "$SCHEMA" ]; then
    echo "demo: a chat server on :$CHAT_PORT uses '${running:-unknown}', not '$SCHEMA'. Stop it, or pass --schema ${running:-...}." >&2
    exit 1
  fi
  echo "demo: reusing the chat server on :$CHAT_PORT ($SCHEMA)"
else
  (cd companion && COMPANION_DASHBOARD_URL="http://localhost:$WEB_PORT" \
    exec uv run companion --web --db-user "$SCHEMA" --port "$CHAT_PORT") &
  PIDS="$PIDS $!"
fi

# Docs. Rebuild when anything it's built from is newer than the last build.
if [ ! -f site/build-demo/index.html ] || [ -n "$(find docs site/src site/docusaurus.config.ts site/sidebars.ts web/src/lib \
     -newer site/build-demo/index.html -type f -print -quit)" ]; then
  echo "demo: building the docs (about a minute)"
  (cd site && SITE_MODE=demo npx docusaurus build --out-dir build-demo >/dev/null)
fi
(cd site && SITE_MODE=demo exec npx docusaurus serve --dir build-demo --host 127.0.0.1 --port "$DOCS_PORT" --no-open >/dev/null) &
PIDS="$PIDS $!"

# The front door. Env wins over web/.env.local, so the inspector reads the chat's schema.
(cd web && AIM_SCHEMA="$SCHEMA_UPPER" COMPANION_URL="http://127.0.0.1:$CHAT_PORT" DOCS_URL="http://127.0.0.1:$DOCS_PORT" \
  exec npm run dev -- --port "$WEB_PORT") &
WEB_PID=$!
PIDS="$PIDS $WEB_PID"

wait_for "$CHAT_PORT" chat
wait_for "$DOCS_PORT" docs
wait_for "$WEB_PORT" inspector
curl -fsS -o /dev/null "http://localhost:$WEB_PORT/" 2>/dev/null || true  # first compile
if ! kill -0 "$WEB_PID" 2>/dev/null; then echo "demo: the inspector stopped; see above" >&2; exit 1; fi
echo
echo "  Agent Memory Playground ($SCHEMA): http://localhost:$WEB_PORT"
echo "  chat /chat · inspector /runs /memories · docs /docs    Ctrl-C stops everything"
echo
wait
