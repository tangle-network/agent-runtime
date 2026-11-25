#!/bin/sh
# MLCR v1.1 through its publisher's own runner and scorer (mlcr_run.py), from the publisher checkout:
#   mlcr-run.sh <result folder> <base url> <model> <key env var> <task count|all> <task ids,> <judge>
# <task count> keeps the runner's first N rows of the publisher's smoke experiment (--limit); task ids are not supported.
# <judge> is `publisher` (the three-model jury on the publisher's own providers and their credentials) or bridge/<harness/model>,
# a substituted judge on its own client at AGENT_BENCH_JUDGE_URL. The data is fetched into the checkout's git-ignored cases/ and
# filler_files/ on first use and never committed (no license). The result JSON lands in <result folder>.
set -eu
out=$1 base=$2 model=$3 keyvar=$4 tasks=$5 ids=$6 judge=$7
shift 7
if [ $# -gt 0 ]; then echo "mlcr-run: unknown option $1" >&2; exit 2; fi
if [ -n "$ids" ]; then echo "mlcr-run: task ids are not supported; use --tasks N, the runner's first N matrix rows" >&2; exit 2; fi
here=$(cd "$(dirname "$0")" && pwd)
checkout=$PWD
if [ "$judge" = publisher ]; then judge_model=publisher judge_url=-; else judge_model=${judge#bridge/} judge_url=$AGENT_BENCH_JUDGE_URL; fi
mkdir -p "$out"
"$checkout/.venv/bin/python" "$here/mlcr_run.py" "$checkout" "$base" "$model" "$keyvar" "$tasks" "$judge_model" "$judge_url" "$out/result.json"
