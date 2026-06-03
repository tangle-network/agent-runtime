#!/usr/bin/env python3
"""Fetch FreedomIntelligence/CADBench + flatten its nested `criteria` into a flat
bullet list, writing the cleaned JSONL the CADBench adapter reads via CADBENCH_PATH.
Usage: python3 scripts/cadbench_prepare.py [out.jsonl]  (clones the HF dataset to /tmp)"""
import json, subprocess, sys, os
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/cadbench_clean.jsonl'
SRC = '/tmp/cadbench-ds'
if not os.path.exists(SRC):
    subprocess.run(['git', 'clone', '--depth', '1', 'https://huggingface.co/datasets/FreedomIntelligence/CADBench', SRC], check=True)
def flatten(x, out):
    if isinstance(x, dict):
        for v in x.values(): flatten(v, out)
    elif isinstance(x, list):
        for v in x: flatten(v, out)
    elif isinstance(x, str): out.append(x)
rows = [json.loads(l) for l in open(f'{SRC}/CADBench.jsonl', encoding='utf-8-sig') if l.strip()]
clean = []
for r in rows:
    b = []; flatten(r['criteria'], b)
    clean.append({'id': r['id'], 'name': r.get('name', ''), 'instruction': r['instruction'], 'type': r.get('type', ''), 'criteria': b})
open(OUT, 'w').write('\n'.join(json.dumps(c) for c in clean))
print(f'wrote {len(clean)} tasks -> {OUT}')
