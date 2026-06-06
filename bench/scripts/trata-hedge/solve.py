"""trata-hedge-bench solver — our system's analyst, graded by THEIR Gemini judge.

Reads a task's instruction.md + data corpus, writes a cited analysis to answer.txt.
The corpus is large (~5MB/task), so a single-shot router call is a LOWER-BOUND
baseline (it sees only what fits in context) — the bench is built for agentic
exploration, which our sandbox runtime provides (see README; pending sandbox health).

Notes learned the hard way:
- router.tangle.tools is behind Cloudflare bot-fight: a default Python-urllib
  User-Agent gets 403 (CF 1010) on large bodies → send a browser UA.
- gpt-4.1 is NOT keyed for direct router calls (403); gpt-4o / claude-sonnet-4-6 /
  gpt-4o-mini are. Very large bodies (~350KB) can 503 — keep DATA_BUDGET in range.

  WORKER_MODEL=gpt-4o DATA_BUDGET=160000 python3 solve.py <env-dir> <out.txt>
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

env = Path(sys.argv[1])
out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/thb-answer.txt"
model = os.environ.get("WORKER_MODEL", "gpt-4o")
budget = int(os.environ.get("DATA_BUDGET", "160000"))
instruction = (env / "instruction.md").read_text()
data_dir = env / "environment" / "data"


def rank(p: Path) -> int:
    s = str(p)
    return (0 if "earnings_call" in s else 1 if "financials" in s else 2 if "company_profiles" in s
            else 3 if "press_releases" in s else 4)


files = sorted((p for p in data_dir.rglob("*") if p.is_file()), key=rank)
blocks, used, cited = [], 0, []
for p in files:
    rel = p.relative_to(data_dir)
    try:
        c = p.read_text(errors="replace")
    except Exception:
        continue
    if used + len(c) > budget:
        continue
    used += len(c)
    cited.append(str(rel))
    blocks.append(f"\n=== FILE: data/{rel} ===\n{c}")
print(f"[solve] {len(cited)}/{len(files)} files in context ({used} chars)", file=sys.stderr)

prompt = (
    instruction
    + "\n\n--- AVAILABLE DATA (cite files by their `data/<path>` name inline) ---\n"
    + "".join(blocks)
    + "\n\n--- END DATA ---\nWrite ONLY the full analysis (no preamble). Inline-cite every claim with its `data/<path>`."
)

key = os.environ["TANGLE_API_KEY"]
base = os.environ.get("ROUTER_BASE", "https://router.tangle.tools/v1")
body = json.dumps({
    "model": model,
    "messages": [{"role": "user", "content": prompt}],
    "temperature": float(os.environ.get("TEMPERATURE", "0.5")),
    "max_tokens": int(os.environ.get("MAX_TOKENS", "6000")),
}).encode()
req = urllib.request.Request(
    f"{base}/chat/completions", data=body,
    headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        # browser UA: router is behind Cloudflare bot-fight, default urllib UA → 403 on big bodies
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    },
)
try:
    with urllib.request.urlopen(req, timeout=300) as r:
        resp = json.load(r)
except urllib.error.HTTPError as e:
    print(f"[solve] HTTP {e.code}: {e.read().decode(errors='replace')[:400]}", file=sys.stderr)
    raise
answer = resp["choices"][0]["message"]["content"]
Path(out).write_text(answer)
print(f"[solve] wrote {len(answer)} chars -> {out} (model={model})", file=sys.stderr)
