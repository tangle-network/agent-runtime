#!/usr/bin/env bash
# commit0 judge prerequisites: ensure the per-repo Docker image exists for each
# argument — a repo short name (`wcwidth`, `tinydb`, …) or a split (`lite`, `all`).
#
# The judge (scripts/commit0_judge.py) grades on commit0's LOCAL Docker backend,
# whose execution context only CREATES containers from an existing image —
# `rebuild_image` is honored by the Modal backend only. Without the image every
# judge call fails with ImageNotFound ("commit0 harness failed"), so images must
# exist BEFORE a gate run.
#
# Fast path: pull the official prebuilt image (docker.io/wentingzhao/<repo>:v0 —
# the exact tag commit0's spec.repo_image_tag resolves). Fallback: build locally
# via commit0.harness.build (minutes + multi-GB per repo; skips existing images).
#
#   ./src/commit0-prereqs.sh wcwidth tinydb      # individual repos
#   ./src/commit0-prereqs.sh lite                # a whole split
#   COMMIT0_VENV=.venv-commit0 ./src/commit0-prereqs.sh wcwidth
set -euo pipefail
cd "$(dirname "$0")/.." # bench/

venv="${COMMIT0_VENV:-.venv-commit0}"
dataset="${COMMIT0_DATASET:-wentingzhao/commit0_combined}"
split="${COMMIT0_SPLIT:-test}"

[ $# -ge 1 ] || { echo "usage: $0 <repo-or-split> [more…]" >&2; exit 2; }
[ -x "$venv/bin/python" ] || { echo "missing $venv/bin/python — create it per benchmarks/commit0.ts preflight (pip install commit0 datasets)" >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "Docker daemon unavailable — commit0 judges on --backend local" >&2; exit 2; }

for target in "$@"; do
  image="wentingzhao/$(printf '%s' "$target" | tr '[:upper:]' '[:lower:]'):v0"
  if docker image inspect "$image" >/dev/null 2>&1; then
    echo "ok: $image already present"
    continue
  fi
  if docker pull "$image" >/dev/null 2>&1; then
    echo "ok: pulled $image"
    continue
  fi
  # No hub image (or the target is a split name): build through the harness,
  # which skips repos whose image already exists.
  echo "building $target via commit0.harness.build (this takes minutes per repo)…"
  "$venv/bin/python" -c '
import sys
from commit0.harness.build import main
main(sys.argv[1], sys.argv[2], sys.argv[3], 1, 1)
' "$dataset" "$split" "$target"
done
echo "prereqs done."
