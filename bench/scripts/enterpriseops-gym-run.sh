#!/bin/sh
# EnterpriseOps-Gym through its publisher's own runner (ServiceNow/EnterpriseOps-Gym evaluate.py), from the publisher checkout:
#   enterpriseops-gym-run.sh <result folder> <base url> <model> <key env var> <task count|all> <task ids,> [--domain d] [--mode m] [--concurrency n]
# Writes the sampled task configs exactly as evaluate.py writes them for --hf_dataset, starts each gym's MCP server image on the
# port the configs name, writes an OpenAI-compatible (vllm provider) LLM config whose key comes from <key env var>, and runs
# evaluate.py --configs_folder. The image digests used are recorded beside the results. The publisher's pyproject does not declare
# aiohttp, which its utils/task_queue_worker.py imports, so each run adds it beside the openai extra.
set -eu
out=$1 base=$2 model=$3 keyvar=$4 tasks=$5 ids=$6
shift 6
domain=teams mode=oracle concurrency=2
while [ $# -gt 0 ]; do
  case $1 in
    --domain) domain=$2; shift 2 ;;
    --mode) mode=$2; shift 2 ;;
    --concurrency) concurrency=$2; shift 2 ;;
    *) echo "enterpriseops-gym-run: unknown option $1" >&2; exit 2 ;;
  esac
done
work=$(mktemp -d)
containers=''
cleanup() { for c in $containers; do docker rm -f "$c" >/dev/null 2>&1 || true; done; rm -rf "$work"; }
trap cleanup EXIT INT TERM
mkdir -p "$out"

uv run --extra openai --with aiohttp python - "$work/configs" "$mode" "$domain" "$tasks" "$ids" > "$work/servers" <<'PY'
import json, os, sys
from datasets import load_dataset
folder, mode, domain, limit, ids = sys.argv[1:6]
os.makedirs(folder)
wanted = [task_id for task_id in ids.split(',') if task_id]
servers, count = set(), 0
for row in load_dataset('ServiceNow-AI/EnterpriseOps-Gym', mode, split=domain):
    if wanted and row['task_id'] not in wanted:
        continue
    task = {key: json.loads(value) if key in ('gym_servers_config', 'verifiers') and isinstance(value, str) else value
            for key, value in row.items() if key not in ('task_id', 'domain')}
    with open(os.path.join(folder, f"{mode}__{domain}__{row['task_id']}.json"), 'w') as handle:
        json.dump(task, handle)
    servers.update((server['mcp_server_name'], server['mcp_server_url']) for server in task['gym_servers_config'])
    count += 1
    if not wanted and limit != 'all' and count >= int(limit):
        break
if wanted and count != len(wanted):
    sys.exit(f'only {count} of {len(wanted)} task ids exist in {mode}/{domain}')
for name, url in sorted(servers):
    print(name, url)
PY

while read -r name url; do
  case $name in
    gym-teams-mcp) image=teams ;; sn-csm-server) image=csm ;; gym-email-mcp) image=email ;; gym-itsm-mcp) image=itsm ;;
    gym-calendar) image=calendar ;; sn-hr-internal) image=hr ;; gym-google-drive-mcp) image=drive ;;
    *) echo "enterpriseops-gym-run: no published image for gym $name" >&2; exit 2 ;;
  esac
  port=${url##*:}
  port=${port%%/*}
  inner=8005
  [ "$image" = calendar ] && inner=8003
  ref="shivakrishnareddyma225/enterpriseops-gym-mcp-$image:latest"
  container="agent-bench-eog-$image-$$"
  docker run -d --rm --name "$container" -p "127.0.0.1:$port:$inner" "$ref" >/dev/null
  containers="$containers $container"
  docker image inspect --format '{{index .RepoDigests 0}}' "$ref" >> "$out/images.txt"
  tries=0
  until curl -s -o /dev/null -X POST -H 'content-type: application/json' -d '{}' "http://127.0.0.1:$port/mcp"; do
    tries=$((tries + 1))
    [ "$tries" -lt 120 ] || { echo "enterpriseops-gym-run: gym $name did not answer on port $port" >&2; exit 1; }
    sleep 1
  done
done < "$work/servers"

umask 077
KEY_VAR=$keyvar python3 - "$work/llm.json" "$model" "$base" <<'PY'
import json, os, sys
path, model, base = sys.argv[1:4]
with open(path, 'w') as handle:
    json.dump({'llm_provider': 'vllm', 'llm_model': model, 'llm_api_key': os.environ[os.environ['KEY_VAR']],
               'llm_api_endpoint': base, 'temperature': 0.0, 'max_tokens': 4096}, handle)
PY
uv run --extra openai --with aiohttp python evaluate.py --configs_folder "$work/configs" --llm_config "$work/llm.json" --output_folder "$out" \
  --orchestrator react --concurrency "$concurrency" --num_runs 1
