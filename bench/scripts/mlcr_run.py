"""MLCR v1.1 through its publisher's own runner and scorer (Wisedocs-AI/medical-long-context-reasoning `mlcr`).

The runner reaches models through providers registered by name (Vertex, Anthropic on GCP, Azure OpenAI). As its README's
"Adding a new provider" describes, this registers one more for an OpenAI-compatible endpoint: `agent_bench_endpoint` for the
target and `agent_bench_judge` for a substituted judge, each referenced from a model config written beside the publisher's in
configs/models (agent-bench-*.yaml, rewritten every run). No publisher file changes.

The experiment is the publisher's configs/experiments/smoke.yaml, its committed experiment, with `models` set to the target and
the worker count set for the endpoint; `--limit N` keeps the first N matrix rows, the runner's own sample. The data is the
Wisedocs/mlcr-dataset release at a pinned revision, written into the git-ignored cases/ and filler_files/ trees by the
publisher's own download code, in this checkout only: it carries no license, so it is never committed or redistributed.

Scoring is the publisher's score_run: the conciseness gate, then the jury. The publisher's jury is its three judges on their own
providers and credentials; a substituted judge is one model on its own endpoint, a jury of one. Thinking levels are not sent to
an OpenAI-compatible endpoint. Only ids, verdicts and counts are written.

Usage: python mlcr_run.py <checkout> <base url> <model> <key env var> <task count|all> <judge model|publisher> <judge url|-> <out.json>
"""
import csv
import json
import os
import sys
import time
from pathlib import Path

import yaml

checkout, base, model, keyvar, limit, judge_model, judge_url, out = sys.argv[1:9]
checkout = Path(checkout)
sys.path.insert(0, str(checkout / 'src'))

from openai import OpenAI  # noqa: E402
from mlcr import download  # noqa: E402
from mlcr.cli import main as mlcr  # noqa: E402
from mlcr.providers.base import ChatResponse, PermanentProviderError, Provider, map_provider_error  # noqa: E402
from mlcr.providers.registry import register  # noqa: E402
from mlcr.scoring import _DEFAULT_JUDGE_MODELS, score_run  # noqa: E402

DATA_REVISION = '1198206e2df96febf9fd13c110981e5b40515285'


class EndpointProvider(Provider):
    """Chat Completions against an OpenAI-compatible endpoint, with the message layout of the publisher's Azure provider."""

    def __init__(self, name, url, key):
        self.name = name
        self.client = OpenAI(base_url=url, api_key=key)

    def call(self, req):
        if req.images:
            raise PermanentProviderError('the agent-bench endpoint provider runs the text modality only')
        content = [{'type': 'text', 'text': text} for text in (req.prefix_text, req.user_text) if text]
        messages = ([{'role': 'system', 'content': req.system}] if req.system else []) + [{'role': 'user', 'content': content}]
        started = time.monotonic()
        try:
            response = self.client.chat.completions.create(
                model=req.model_cfg.model, messages=messages,
                max_tokens=req.model_cfg.max_output_tokens, temperature=req.model_cfg.temperature,
            )
        except Exception as error:
            raise map_provider_error(error) from error
        usage = response.usage
        return ChatResponse(
            text=response.choices[0].message.content or '',
            usage={'prompt_tokens': usage.prompt_tokens, 'completion_tokens': usage.completion_tokens} if usage else {},
            latency_ms=int((time.monotonic() - started) * 1000),
        )


register('agent_bench_endpoint', lambda: EndpointProvider('agent_bench_endpoint', base, os.environ[keyvar]))
if judge_url != '-':
    register('agent_bench_judge', lambda: EndpointProvider('agent_bench_judge', judge_url, os.environ.get('AGENT_BENCH_JUDGE_KEY') or 'loopback'))

# The release at the pinned revision, through the publisher's own writers for the harness tree.
marker = checkout / 'cases' / f'.agent-bench-{DATA_REVISION}'
if not marker.exists():
    from datasets import load_dataset
    rows = {name: load_dataset(download.REPO_ID, name, split='train', revision=DATA_REVISION) for name in ('questions', 'cases_summaries', 'filler_files')}
    download._write_cases(checkout, rows['questions'], rows['cases_summaries'])
    download._write_fillers(checkout, rows['filler_files'])
    marker.write_text(DATA_REVISION + '\n')

models = checkout / 'configs' / 'models'
# The publisher's GPT configs: 16384 output tokens at temperature 1.0.
(models / 'agent-bench-target.yaml').write_text(yaml.safe_dump({'id': 'agent-bench-target', 'provider': 'agent_bench_endpoint', 'model': model, 'max_output_tokens': 16384, 'temperature': 1.0}))
if judge_url != '-':
    (models / 'agent-bench-judge.yaml').write_text(yaml.safe_dump({'id': 'agent-bench-judge', 'provider': 'agent_bench_judge', 'model': judge_model, 'max_output_tokens': 16384, 'temperature': 1.0}))

experiment = yaml.safe_load((checkout / 'configs' / 'experiments' / 'smoke.yaml').read_text())
workers = max(1, int(os.environ.get('AGENT_BENCH_MAX_CONCURRENCY') or 2))
experiment.update(name='agent-bench', models=['agent-bench-target'], output_dir='agent-bench-runs', concurrency={'max_workers': workers})
config = checkout / 'configs' / 'experiments' / 'agent-bench.yaml'
config.write_text(yaml.safe_dump(experiment, sort_keys=False))

runs = checkout / 'agent-bench-runs'
before = set(runs.iterdir()) if runs.is_dir() else set()
code = mlcr(['run', str(config), '--repo-root', str(checkout), '--no-previous-runs', *([] if limit == 'all' else ['--limit', limit])])
if code:
    sys.exit(f'mlcr run exited {code}')
[run_dir] = [path for path in runs.iterdir() if path not in before]

judges = [models / f'{name}.yaml' for name in _DEFAULT_JUDGE_MODELS] if judge_url == '-' else [models / 'agent-bench-judge.yaml']
score_run(run_dir, judge_model_configs=judges, max_workers=workers)

# results_scoring.csv follows responses.csv, one row per results/<row_id>/result.json in sorted order.
with (run_dir / 'results_scoring.csv').open(newline='') as handle:
    scored = list(csv.DictReader(handle))
metas = [json.loads(path.read_text()).get('metadata', {}) for path in sorted((run_dir / 'results').glob('*/result.json'))]
if len(metas) != len(scored):
    sys.exit(f'{len(scored)} scored rows for {len(metas)} results')
examples = []
for meta, row in zip(metas, scored):
    if meta.get('case_uuid') != row.get('case_uuid'):
        sys.exit('scored rows and results are not in the same order')
    examples.append({
        'id': f"{meta['case_uuid']}/{Path(meta['prompt_path']).stem}",
        'difficulty': row.get('difficulty', ''),
        'concise': row.get('judge_concise', ''),
        'complete': row.get('judge_complete', ''),
        'accurate': row.get('judge_accurate', ''),
        'correct': row.get('judge_correct', ''),
        'judge_error': bool(row.get('judge_error')),
        'response_chars': len(row.get('response', '')),
    })
with open(out, 'w', encoding='utf-8') as handle:
    json.dump({'judges': [path.stem for path in judges], 'examples': examples}, handle, indent=2)
