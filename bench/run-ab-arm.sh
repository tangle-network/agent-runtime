#!/usr/bin/env bash
# Run one raw/supervisor Terminal-Bench arm through the Tangle router.
#
#   ./run-ab-arm.sh <arm> <task-id> <run-id> <out-dir>
#     arm     : raw | supervisor
#     task-id : e.g. crack-7z-hash.easy
set -euo pipefail

ARM="${1:?arm: raw|supervisor}"
TASK_ID="${2:?task-id}"
RUN_ID="$(printf '%s' "${3:?run-id}" | tr '[:upper:]' '[:lower:]')"
OUT_DIR="${4:?out-dir}"

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS="${AGENT_STATE_ENV:-$HOME/company/devops/secrets/agent-state.env}"
TB_MODEL="${TB_MODEL:-zai-coding-plan/glm-5.2}"
ROUTER_KEY="$(dotenvx get TANGLE_API_KEY -f "$SECRETS" 2>/dev/null)"
if [ -z "$ROUTER_KEY" ]; then echo "FATAL: no TANGLE_API_KEY" >&2; exit 1; fi

case "$ARM" in
  raw)        AGENT_IMPORT="tb_agents.opencode_router_agent:OpenCodeRouterAgent" ;;
  supervisor) AGENT_IMPORT="tb_agents.opencode_supervisor_agent:OpenCodeSupervisorAgent" ;;
  *) echo "FATAL: arm must be raw|supervisor" >&2; exit 1 ;;
esac

mkdir -p "$OUT_DIR"
cd "$BENCH_DIR"

# Container-id publish path (arm B's sidecar reads it; harmless for arm A).
export TB_CONTAINER_ID_FILE="$OUT_DIR/.tb-container-id"
rm -f "$TB_CONTAINER_ID_FILE"

env \
  PYTHONPATH="$BENCH_DIR" \
  OPENAI_API_KEY="$ROUTER_KEY" \
  OPENAI_BASE_URL="https://router.tangle.tools/v1" \
  TB_CONTAINER_ID_FILE="$TB_CONTAINER_ID_FILE" \
  TB_AB_OUT_DIR="$OUT_DIR" \
  .venv-terminal-bench/bin/tb run \
    -d terminal-bench-core==0.1.1 \
    -t "$TASK_ID" \
    --agent-import-path "$AGENT_IMPORT" \
    -m "$TB_MODEL" \
    --output-path "$OUT_DIR/runs" \
    --run-id "$RUN_ID" \
    --n-concurrent 1 \
    --no-livestream \
    2>&1 | tee "$OUT_DIR/tb-run.log"

echo "=== results.json ==="
cat "$OUT_DIR/runs/$RUN_ID/results.json" 2>/dev/null || echo "(no results.json)"
