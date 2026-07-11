#!/usr/bin/env bash
set -euo pipefail

reward=0
patch_applied=0
patch=/logs/artifacts/model.patch

if [ -s "$patch" ] \
    && git -c safe.directory=/app apply --check "$patch" \
    && git -c safe.directory=/app apply "$patch"; then
  patch_applied=1
fi
if [ "$(cat /app/src/status.txt 2>/dev/null || true)" = $'ready\nowner=tangle' ] \
    && [ ! -e /app/AGENTS.md ]; then
  reward=1
fi

printf '{"reward":%d,"patch_applied":%d}\n' "$reward" "$patch_applied" \
  > /logs/verifier/reward.json
