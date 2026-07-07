#!/usr/bin/env bash
set -uo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$BENCH_DIR/.." && pwd)"
cd "$BENCH_DIR"

docker rm -f tb-sidecar-smoke >/dev/null 2>&1 || true
SMOKE_ID=$(docker run -d --name tb-sidecar-smoke alpine sleep 600)
echo "smoke container: $SMOKE_ID"

TSX="${TSX:-$REPO_DIR/node_modules/.bin/tsx}"
rm -f /tmp/sc-port /tmp/sc-events.jsonl /tmp/sc-events.jsonl.final.json
env TB_TARGET_CONTAINER="$SMOKE_ID" \
    OPENAI_API_KEY=dummy OPENAI_BASE_URL=https://router.tangle.tools/v1 \
    WORKER_MODEL=zai-coding-plan/glm-5.2 \
    TB_SIDECAR_PORT_FILE=/tmp/sc-port TB_SIDECAR_LOG=/tmp/sc-events.jsonl \
    TB_WORKER_WORKDIR=/ \
    "$TSX" src/tb-supervisor-sidecar.mts > /tmp/sc-stdout.log 2>&1 &
SIDECAR_PID=$!
echo "sidecar pid $SIDECAR_PID"

for i in $(seq 1 40); do
  [ -f /tmp/sc-port ] && break
  if ! kill -0 "$SIDECAR_PID" 2>/dev/null; then echo "SIDECAR DIED"; cat /tmp/sc-stdout.log; exit 1; fi
  sleep 0.5
done
PORT=$(cat /tmp/sc-port 2>/dev/null)
echo "sidecar port: $PORT"
URL="http://172.17.0.1:${PORT}/mcp"

echo "=== tools/list ==="
curl -s -X POST "$URL" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 600
echo

echo "=== spawn_agent (worker docker-execs into container) ==="
curl -s -X POST "$URL" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"spawn_agent","arguments":{"profile":{"name":"smoke-worker"},"task":"echo SMOKE_WORKER_RAN"}}}'
echo
sleep 6
echo "=== await_event ==="
curl -s -X POST "$URL" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"await_event","arguments":{}}}' | head -c 800
echo

echo "=== stop sidecar (SIGTERM) -> dumps final ledger ==="
kill -TERM "$SIDECAR_PID" 2>/dev/null
wait "$SIDECAR_PID" 2>/dev/null
echo "=== events log ==="
cat /tmp/sc-events.jsonl
echo "=== final ledger ==="
cat /tmp/sc-events.jsonl.final.json 2>/dev/null | head -c 1500
echo
docker rm -f tb-sidecar-smoke >/dev/null 2>&1 || true
