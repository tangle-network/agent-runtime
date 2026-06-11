#!/usr/bin/env bash
# Sequential gym-free follow-ups: kimi matrix row (with the worker cap), glm matrix row
# (OOM victim, plain re-run), then the belief re-run on the consult channel.
set -uo pipefail
cd "$(dirname "$0")"
echo "=== matrix re-run: moonshotai/kimi-k2.6 (WORKER_MAX_TOKENS=8192) ==="
ENV=aime CELLS=base,steer,compress,steer+compress N=20 HOLDOUT=12 HOLDOUT_OFFSET=4 BUDGET=3 INNER_TURNS=2 CONCURRENCY=3 \
  KAPPA=llm-50 WORKER_MODEL=moonshotai/kimi-k2.6 WORKER_MAX_TOKENS=8192 \
  OUT=/tmp/matrix-moonshotai-kimi-k2-6.json npx tsx src/ablation-grid.mts 2>&1 | tail -10
echo "=== matrix re-run: zai/glm-4.7 ==="
ENV=aime CELLS=base,steer,compress,steer+compress N=20 HOLDOUT=12 HOLDOUT_OFFSET=4 BUDGET=3 INNER_TURNS=2 CONCURRENCY=3 \
  KAPPA=llm-50 WORKER_MODEL=zai/glm-4.7 \
  OUT=/tmp/matrix-zai-glm-4-7.json npx tsx src/ablation-grid.mts 2>&1 | tail -10
echo "=== belief re-run (consult channel, confidence floor) ==="
ARMS=sample,refine,belief N=16 OFFSET=40 BUDGET=3 INNER_TURNS=2 CONCURRENCY=4 \
  WORKER_MODEL=deepseek-v4-flash OUT=/tmp/steering-belief2.json npx tsx src/steering-modes.mts 2>&1 | tail -14
echo "FOLLOWUPS COMPLETE"
