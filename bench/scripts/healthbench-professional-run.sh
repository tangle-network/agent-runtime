#!/bin/sh
# HealthBench Professional through openai/simple-evals' own HealthBenchEval (healthbench_professional_run.py), from the publisher checkout:
#   healthbench-professional-run.sh <result folder> <base url> <model> <key env var> <task count|all> <task ids,> <judge>
# The data is the openai/healthbench-professional release at the pinned revision, fetched into the checkout on first use and
# checked against its sha256; it is never committed (the authors ask that examples not be revealed). <judge> is `publisher`
# (gpt-5.4-2026-03-05 at low reasoning effort, through the same endpoint) or bridge/<harness/model>, a substituted judge on
# its own client at AGENT_BENCH_JUDGE_URL. The result JSON lands in <result folder>.
set -eu
out=$1 base=$2 model=$3 keyvar=$4 tasks=$5 ids=$6 judge=$7
shift 7
if [ $# -gt 0 ]; then echo "healthbench-professional-run: unknown option $1" >&2; exit 2; fi
here=$(cd "$(dirname "$0")" && pwd)
checkout=$PWD
revision=349962fd46dd02343a0d8a606491baf59154ea1a
sha=d44b08e6e952e04c945e2c406f02533d9e7a989a84e35820ee7efdff20c9e4e2
data=$checkout/.agent-bench-data/healthbench_professional_eval.jsonl
if [ ! -f "$data" ]; then
  mkdir -p "$(dirname "$data")"
  url=https://huggingface.co/datasets/openai/healthbench-professional/resolve/$revision/healthbench_professional_eval.jsonl
  curl -fsSL -o "$data.part" "$url" || { echo "healthbench-professional: could not fetch $url" >&2; exit 1; }
  mv "$data.part" "$data"
fi
got=$(sha256sum "$data" | cut -d' ' -f1)
if [ "$got" != "$sha" ]; then
  echo "healthbench-professional: $data has sha256 $got, expected $sha (openai/healthbench-professional@$revision); remove it to fetch again" >&2
  exit 1
fi
if [ "$judge" = publisher ]; then judge_model=gpt-5.4-2026-03-05 judge_url=-; else judge_model=${judge#bridge/} judge_url=$AGENT_BENCH_JUDGE_URL; fi
mkdir -p "$out"
"$checkout/.venv/bin/python" "$here/healthbench_professional_run.py" "$checkout" "$data" "$base" "$model" "$keyvar" "$tasks" "$ids" "$judge_model" "$judge_url" "$out/result.json"
