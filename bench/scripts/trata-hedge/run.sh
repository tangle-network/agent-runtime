#!/bin/bash
# Evaluate our system against trata-hedge-bench's OWN Gemini-3.1-pro judge.
#
# Pipeline: our solver writes a cited analysis -> their grade.py (unmodified, a
# 3-task Gemini cascade: hallucination-check -> per-move-hit -> synthesis) scores it
# against the expert analyst's documented moves (ground_truth.txt).
#
# Prereqs (all present in this environment):
#   - GOOGLE_AI_KEY  — a VALID Gemini key (NOTE: GEMINI_API_KEY in the secrets is
#                      API_KEY_INVALID; GOOGLE_AI_KEY is the working one).
#   - TANGLE_API_KEY — our router (the solver).
#   - uv + Docker.  /app is sudo-writable (grade.py hardcodes /app/answer.txt).
#
# Usage (wrap in dotenvx so the keys resolve):
#   dotenvx run -f ~/company/devops/secrets/.env.keys -f ~/company/devops/secrets/agent-state.env -- \
#     bash bench/scripts/trata-hedge/run.sh <path-to-trata-env-dir> [WORKER_MODEL]
set -euo pipefail

ENV="${1:?usage: run.sh <trata-env-dir> [model]}"
MODEL="${2:-${WORKER_MODEL:-gpt-4o}}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANS=/tmp/thb-answer.txt
REWARD=/tmp/thb-reward.txt
DETAILS=/tmp/thb-details.json

echo "[trata] solve: $ENV (model=$MODEL)"
WORKER_MODEL="$MODEL" python3 "$HERE/solve.py" "$ENV" "$ANS"

sudo -n mkdir -p /app && sudo -n cp "$ANS" /app/answer.txt && sudo -n chmod 644 /app/answer.txt

echo "[trata] grade: their grade.py (gemini-3.1-pro)"
( cd "$ENV/tests" && \
  GOOGLE_API_KEY="$GOOGLE_AI_KEY" \
  DATA_DIR="$ENV/environment/data" \
  GROUND_TRUTH_PATH="$ENV/tests/ground_truth.txt" \
  REWARD_PATH="$REWARD" DETAILS_PATH="$DETAILS" \
  uvx --with google-genai python3 grade.py >/dev/null 2>&1 ) || true

python3 - "$DETAILS" "$REWARD" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
reward = open(sys.argv[2]).read().strip() if __import__("os").path.exists(sys.argv[2]) else "?"
print(f"  sparse reward (1 iff all themes): {reward}")
print(f"  graded score (0-4): {d.get('score')} | themes_covered: {d.get('themes_covered')}/{d.get('num_themes')} | hallucinations: {d.get('hallucinations_detected')}")
for t in d.get("themes_hit", []):
    print(f"    HIT : {t.get('label')}")
for t in d.get("themes_missed", []):
    print(f"    MISS: {t.get('label')} ({len(t.get('moves_hit',[]))}/{t.get('n_moves')} moves)")
PY
