#!/bin/sh
# PRBench through its publisher's own runner and rubric grader (scaleapi/PRBench evals.py), from the publisher checkout:
#   prbench-run.sh <result folder> <base url> <model> <key env var> <task count|all> <task ids,> <judge> [--split legal|finance|legal_hard|finance_hard]
# Writes the publisher's config (target <model> at <base url>, the Responses API in the foreground, no cache, no web search)
# with its key file from <key env var> (mode 600, removed after), and runs evals.run_evals_off_platform through prbench_run.py.
# <judge> is `publisher` (openai/o4-mini through the same endpoint, as the publisher configures it) or bridge/<harness/model>,
# a substituted judge on its own client at AGENT_BENCH_JUDGE_URL. The result JSON and caches land in <result folder>.
set -eu
out=$1 base=$2 model=$3 keyvar=$4 tasks=$5 ids=$6 judge=$7
shift 7
split=legal
while [ $# -gt 0 ]; do
  case $1 in
    --split) split=$2; shift 2 ;;
    *) echo "prbench-run: unknown option $1" >&2; exit 2 ;;
  esac
done
here=$(cd "$(dirname "$0")" && pwd)
checkout=$PWD
mkdir -p "$out"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM
umask 077
printenv "$keyvar" > "$work/key"
if [ "$judge" = publisher ]; then judge_model=openai/o4-mini judge_url=-; else judge_model=${judge#bridge/} judge_url=$AGENT_BENCH_JUDGE_URL; fi
python3 - "$work/config.yaml" "$base" "$model" "$work/key" "$split" "$judge_model" <<'PY'
import json, sys
path, base, model, key, split, judge = sys.argv[1:7]
config = {'judge_model_name': judge, 'base_url': base, 'litellm_key_path': key, 'filename': 'result', 'split_name': split,
          'debug': False, 'trial_number': 0, 'web_search': False, 'background': False, 'final_response_source': 'sampled',
          'timeout_seconds': 3600, 'cache': False, 'response_api': 'responses', 'response_model_names': [model],
          # The publisher's reasoning effort for its own judge; a substituted judge runs at its harness default.
          'reasoning_effort_by_model': {'openai/o4-mini': 'high'}}
with open(path, 'w') as handle:
    json.dump(config, handle)  # JSON is YAML
PY
cd "$out"
PYTHONPATH=$checkout "$checkout/.venv/bin/python" "$here/prbench_run.py" "$work/config.yaml" "$tasks" "$ids" "$judge_url"
