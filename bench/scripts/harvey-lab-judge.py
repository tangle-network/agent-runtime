"""Harvey LAB's own `lab_core.evaluation.run_eval`, with one judge provider added: `bridge/<harness/model>`.

The publisher's Judge picks an SDK from the judge model's name (claude-, gpt-, gemini-, mistral-), and its standard pair
(claude-sonnet-4-6 + gpt-5.5) bills per token. A judge served on a subscription seat reaches the benchmark through a CLI
Bridge instead: a judge named `bridge/<harness/model>` sends the publisher's own prompt as one tool-less chat completion to
AGENT_BENCH_JUDGE_URL and reads the verdict with the publisher's own parser. Rubrics, prompts, scoring, the all-pass rule and
every other judge name stay the publisher's code. A run judged this way is not official, and agent-bench records it so.

Usage, from the Harvey LAB checkout: uv run python harvey-lab-judge.py <run_eval arguments>
"""
import os
import runpy
import sys

import openai
from lab_core.evaluation import judge

PREFIX = 'bridge/'
publisher_detect, publisher_init, publisher_evaluate = judge._detect_provider, judge.Judge.__init__, judge.Judge.evaluate


def detect(model):
    return 'bridge' if model.startswith(PREFIX) else publisher_detect(model)


def init(self, model='claude-sonnet-4-6'):
    if not model.startswith(PREFIX):
        return publisher_init(self, model)
    self.model, self.provider = model, 'bridge'
    self.client = openai.OpenAI(base_url=os.environ['AGENT_BENCH_JUDGE_URL'], api_key=os.environ.get('AGENT_BENCH_JUDGE_KEY') or 'loopback')


def evaluate(self, prompt_template, variables, temperature=0.0, _retries=2):
    if self.provider != 'bridge':
        return publisher_evaluate(self, prompt_template, variables, temperature, _retries)
    prompt, last = prompt_template.format(**variables), None
    for _ in range(_retries):
        try:
            # tool_choice none: the judge answers from the prompt alone, without the harness's own tools.
            response = self.client.chat.completions.create(model=self.model[len(PREFIX):], tool_choice='none',
                                                           messages=[{'role': 'user', 'content': prompt}])
            return judge.Judge._parse_json(response.choices[0].message.content or '')
        except Exception as error:  # the publisher's judges retry any failure the same way
            last = error
    raise ValueError(f'Judge returned unparseable response after {_retries} attempts: {last}')


judge._detect_provider, judge.Judge.__init__, judge.Judge.evaluate = detect, init, evaluate
sys.argv[0] = 'lab_core.evaluation.run_eval'
runpy.run_module('lab_core.evaluation.run_eval', run_name='__main__', alter_sys=True)
