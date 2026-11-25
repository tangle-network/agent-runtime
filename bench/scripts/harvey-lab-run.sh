#!/bin/sh
# Harvey LAB through its publisher's own harness and rubric grader (harveyai/harvey-labs lab_core), from the publisher checkout:
#   harvey-lab-run.sh <result folder> <base url> <model> <key env var> <task count|all> <task ids,> <judge> [--area a] [--max-turns n] [--parallel n]
# Each task runs lab_core.harness.run with the publisher's baseten/ adapter (OpenAI-compatible chat completions with tools) at
# <base url>, in the sandbox image built from the pinned checkout's own Dockerfile, then lab_core.evaluation.run_eval.
# <judge> is `publisher` (the LAB standard pair, claude-sonnet-4-6 + gpt-5.5, which bills ANTHROPIC_API_KEY and OPENAI_API_KEY)
# or bridge/<harness/model>, a substituted judge on a CLI Bridge at AGENT_BENCH_JUDGE_URL (harvey-lab-judge.py).
# Tasks are the given ids, or the first <task count> task ids in sorted order (under tasks/<area> with --area).
# Each run's results/<run id> folder moves to <result folder>, and tasks.tsv maps run ids to task ids.
set -eu
out=$1 base=$2 model=$3 keyvar=$4 tasks=$5 ids=$6 judge=$7
shift 7
area='' max_turns=200 parallel=2
while [ $# -gt 0 ]; do
  case $1 in
    --area) area=$2; shift 2 ;;
    --max-turns) max_turns=$2; shift 2 ;;
    --parallel) parallel=$2; shift 2 ;;
    *) echo "harvey-lab-run: unknown option $1" >&2; exit 2 ;;
  esac
done
here=$(cd "$(dirname "$0")" && pwd)
PATH="$PWD/.agent-bench/bin:$PATH"
export PATH
if [ "$judge" = publisher ] && { [ -z "${ANTHROPIC_API_KEY:-}" ] || [ -z "${OPENAI_API_KEY:-}" ]; }; then
  echo "harvey-lab-run: the publisher's judges need ANTHROPIC_API_KEY and OPENAI_API_KEY; pass --judge bridge/<harness/model> to substitute one" >&2
  exit 2
fi
mkdir -p "$out"
if [ -n "$ids" ]; then
  list=$(echo "$ids" | tr ',' '\n')
else
  list=$(find "tasks${area:+/$area}" -name task.json | sed 's|^tasks/||; s|/task.json$||' | sort)
  [ "$tasks" = all ] || list=$(echo "$list" | head -n "$tasks")
fi
[ -n "$list" ] || { echo "harvey-lab-run: no tasks under tasks${area:+/$area}" >&2; exit 2; }
image=$(cat .agent-bench/sandbox-image)
BASETEN_BASE_URL=$base
BASETEN_API_KEY=$(printenv "$keyvar")
export BASETEN_BASE_URL BASETEN_API_KEY
for task in $list; do
  run="agent-bench-$$-$(echo "$task" | tr '/' '_')"
  printf '%s\t%s\n' "$run" "$task" >> "$out/tasks.tsv"
  # A harness or grading failure leaves the task without scores, which the parser counts as failed.
  uv run python -m lab_core.harness.run --model "baseten/$model" --task "$task" --run-id "$run" --max-turns "$max_turns" \
    --sandbox-image "$image" || echo "harvey-lab-run: the harness failed on $task" >&2
  if [ "$judge" = publisher ]; then
    uv run python -m lab_core.evaluation.run_eval --run-id "$run" --task "$task" --parallel "$parallel" || echo "harvey-lab-run: grading failed on $task" >&2
  else
    uv run python "$here/harvey-lab-judge.py" --run-id "$run" --task "$task" --judges "$judge" --parallel "$parallel" || echo "harvey-lab-run: grading failed on $task" >&2
  fi
  [ ! -d "results/$run" ] || mv "results/$run" "$out/$run"
done
