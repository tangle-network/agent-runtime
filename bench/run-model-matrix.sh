#!/usr/bin/env bash
# MODEL × CELL matrix: the 4-cell AIME grid per worker model, sequential (one model at
# a time — keeps router load comparable across models for the latency columns).
# κ treatment: compressor fixed to deepseek-v4-flash (gpt-4o-mini fallback) for every
# model, so the compression operator is constant; each run re-compresses (temp 0.2) —
# near-identical, noted as a caveat for cross-model κ deltas.
set -uo pipefail
cd "$(dirname "$0")"
MODELS=(
  deepseek-v4-flash
  deepseek-v4-pro
  moonshotai/kimi-k2.6
  zai/glm-4.7
  gpt-5.4-mini
  gpt-5.5
  claude-haiku-4-5
  claude-sonnet-4-6
)
for MODEL in "${MODELS[@]}"; do
  SAFE=$(echo "$MODEL" | tr '/.' '--')
  echo "=== matrix: $MODEL ==="
  ENV=aime CELLS=base,steer,compress,steer+compress \
    N=20 HOLDOUT=12 HOLDOUT_OFFSET=4 BUDGET=3 INNER_TURNS=2 CONCURRENCY=3 \
    KAPPA=llm-50 WORKER_MODEL="$MODEL" \
    OUT="/tmp/matrix-$SAFE.json" \
    npx tsx src/ablation-grid.mts 2>&1 | tail -12
  echo "=== done: $MODEL ==="
done
echo "MATRIX COMPLETE"
