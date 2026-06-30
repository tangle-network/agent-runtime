#!/usr/bin/env bash
# Fetch the real WebCode E2E dataset (Exa, MIT) into this directory.
set -euo pipefail
cd "$(dirname "$0")"
path="webcode-benchmark/data/e2e/code_e2e.jsonl"
echo "fetching WebCode E2E dataset → code_e2e.jsonl"
# The exa-labs/benchmarks default branch is `master`; fall back to `main` if that ever changes.
curl -fsSL "https://raw.githubusercontent.com/exa-labs/benchmarks/master/${path}" -o code_e2e.jsonl \
  || curl -fsSL "https://raw.githubusercontent.com/exa-labs/benchmarks/main/${path}" -o code_e2e.jsonl
echo "got $(wc -l < code_e2e.jsonl) tasks"
