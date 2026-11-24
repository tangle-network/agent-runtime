"""PRBench's own runner (evals.run_evals_off_platform), with a task sample and, when substituted, a judge on its own endpoint.

The publisher's runner grades every row of a split (its only limit, `debug`, keeps rows 10:12) and sends the target and the
judge through one client. Here a sample keeps the first N rows, or the given task ids, of the publisher's own dataset; and a
substituted judge gets its own client at <judge url>, so the target endpoint never answers as the judge. Loading, prompts,
rubric grading and scoring are the publisher's code. Results and caches land in the working directory.

Usage, with the PRBench checkout on PYTHONPATH: python prbench_run.py <config.yaml> <task count|all> <task ids,> <judge url|->
"""
import asyncio
import os
import sys

import evals
from config import Config
from openai import AsyncOpenAI

config_path, limit, ids, judge_url = sys.argv[1:5]
wanted = {task for task in ids.split(',') if task}
publisher_load, publisher_points = evals.load_dataset, evals.get_total_points


def load_dataset(*args, **kwargs):
    rows = publisher_load(*args, **kwargs)
    if wanted:
        rows = rows.filter(lambda row: row['task'] in wanted)
        if len(rows) != len(wanted):
            sys.exit(f'only {len(rows)} of {len(wanted)} task ids exist in this split')
        return rows
    return rows if limit == 'all' else rows.select(range(min(int(limit), len(rows))))


judge_client = None if judge_url == '-' else AsyncOpenAI(base_url=judge_url, api_key=os.environ.get('AGENT_BENCH_JUDGE_KEY') or 'loopback')


async def get_total_points(client, *args, **kwargs):
    return await publisher_points(judge_client or client, *args, **kwargs)


evals.load_dataset, evals.get_total_points = load_dataset, get_total_points
asyncio.run(evals.run_evals_off_platform(Config.from_yaml(config_path)))
