"""HealthBench Professional through openai/simple-evals' own HealthBenchEval, with the settings its
--healthbench-professional-mode requires: the Professional data, GPT-5.4 at low reasoning effort as the rubric grader,
and length adjustment (center 2000 characters, 1.47 points per 500 on the 0-100 scale, the paper's values).

The Professional release ships conversations and rubric items in its own fields; HealthBenchEval reads HealthBench rows.
Each row is mapped field for field (messages -> prompt, criterion_text -> criterion, id -> prompt_id; use_case, type and
difficulty become example tags) into a temporary file that is never kept. Sampling (the publisher's seeded sample for a
task count), the grader prompt, rubric scoring, length adjustment and aggregation are the publisher's code.

The target answers through the publisher's ChatCompletionSampler on the target endpoint. The publisher's grader runs on the
same endpoint; a substituted judge runs as a ChatCompletionSampler on its own endpoint. Only ids, scores and counts are
written: the authors ask that examples not be revealed.

Usage: python healthbench_professional_run.py <checkout> <data.jsonl> <base url> <model> <key env var> <task count|all>
       <task ids,> <judge model> <judge url|-> <out.json>
"""
import json
import os
import sys
import tempfile

checkout, data, base, model, keyvar, limit, ids, judge_model, judge_url, out = sys.argv[1:11]

# simple-evals is a package of relative imports named for its directory: expose the checkout as `simple_evals`.
package_root = tempfile.mkdtemp()
os.symlink(checkout, os.path.join(package_root, 'simple_evals'))
sys.path.insert(0, package_root)

from openai import OpenAI  # noqa: E402
from simple_evals.healthbench_eval import HealthBenchEval, calculate_length_adjusted_score  # noqa: E402
from simple_evals.sampler.chat_completion_sampler import OPENAI_SYSTEM_MESSAGE_API, ChatCompletionSampler  # noqa: E402
from simple_evals.sampler.responses_sampler import ResponsesSampler  # noqa: E402

CENTER, PENALTY_PER_500 = 2000.0, 0.0147

rows = [json.loads(line) for line in open(data, encoding='utf-8') if line.strip()]
wanted = [task for task in ids.split(',') if task]
if wanted:
    by_id = {row['id']: row for row in rows}
    missing = [task for task in wanted if task not in by_id]
    if missing:
        sys.exit(f'{len(missing)} of {len(wanted)} task ids are not in HealthBench Professional')
    rows = [by_id[task] for task in wanted]


def healthbench_row(row):
    return {
        'prompt': row['conversation']['messages'],
        'rubrics': [{'criterion': item['criterion_text'], 'points': item['points'], 'tags': []} for item in row['rubric_items']],
        'example_tags': [f"use_case:{row['use_case']}", f"type:{row['type']}", f"difficulty:{row['difficulty']}"],
        'prompt_id': row['id'],
    }


converted = os.path.join(package_root, 'healthbench_professional.jsonl')
with open(converted, 'w', encoding='utf-8') as handle:
    for row in rows:
        handle.write(json.dumps(healthbench_row(row)) + '\n')

# The publisher's samplers build a default OpenAI client on construction; each is replaced with its endpoint's client below.
os.environ.setdefault('OPENAI_API_KEY', 'replaced-per-sampler')
target = ChatCompletionSampler(model=model, system_message=OPENAI_SYSTEM_MESSAGE_API, max_tokens=2048)
target.client = OpenAI(base_url=base, api_key=os.environ[keyvar])
if judge_url == '-':
    grader = ResponsesSampler(model=judge_model, reasoning_model=True, reasoning_effort='low')
    grader.client = OpenAI(base_url=base, api_key=os.environ[keyvar])
else:
    grader = ChatCompletionSampler(model=judge_model, max_tokens=2048)
    grader.client = OpenAI(base_url=judge_url, api_key=os.environ.get('AGENT_BENCH_JUDGE_KEY') or 'loopback')

threads = max(1, int(os.environ.get('AGENT_BENCH_MAX_CONCURRENCY') or 2))
evaluation = HealthBenchEval(
    grader_model=grader,
    num_examples=None if wanted or limit == 'all' else int(limit),
    n_threads=threads,
    input_path=converted,
    length_adjustment_center=CENTER,
    length_adjustment_penalty_per_500_chars=PENALTY_PER_500,
)
result = evaluation(target)

examples = []
for example in result.metadata['example_level_metadata']:
    response = example['completion'][0]['content']
    items = example['rubric_items']
    examples.append({
        'prompt_id': example['prompt_id'],
        'overall_score': example['score'],
        'length_adjusted': calculate_length_adjusted_score(example['score'], response, center=CENTER, penalty_per_500_chars=PENALTY_PER_500),
        'response_chars': len(response),
        'positive_met': sum(1 for item in items if item['points'] > 0 and item['criteria_met']),
        'positive_total': sum(1 for item in items if item['points'] > 0),
        'negative_met': sum(1 for item in items if item['points'] < 0 and item['criteria_met']),
    })
with open(out, 'w', encoding='utf-8') as handle:
    json.dump({'score': result.score, 'metrics': result.metrics, 'examples': examples}, handle, indent=2)
