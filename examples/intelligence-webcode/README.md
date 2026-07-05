# Run a coding benchmark and get a per-run bill and trace for every attempt

This runs a small suite of coding tasks across different agent setups (a "harness × model" grid) and,
for **every single attempt**, tells you four things: did it pass the hidden tests, what did it cost in
dollars, where inside the run that cost went (which tools burned it), and the full trace of what the
agent did. The tasks are deliberately picked so the model **cannot** know the answer from training —
they use an API released after the model's cutoff, so the agent has to search the web to solve them.

## Why it matters

"Which agent is best" is the easy question. The expensive one is "what is each run actually costing me
and what did it do to earn that cost." This example bolts a complete cost-and-trace layer onto a real,
hidden-test-graded benchmark so you get a spend breakdown per attempt instead of one fuzzy total at the
end — and it proves the off switch works: run the grid at full instrumentation, then run it again with
tracing turned off, and you get the **same passes with zero instrumentation spend**.

## How it works

Three layers, all wrapped around each single benchmark cell (`intelligence-webcode.ts`):

| Layer | What it does |
|---|---|
| **Boundary** | `withTangleIntelligence(cell, { effort })` wraps the whole run. `effort` ranges `off · eco · standard · thorough · max`; `off` is the provable floor — instrumentation spend clamped to 0, the task still runs. |
| **Cost waterfall** | `createWaterfallCollector()` records cost per tool/phase during the run. The sum of its parts **is** the billed total, so there's no second tally that can drift from reality. |
| **Trace export** | `createOtelExporter()` streams every step to your OTLP trace collector. It's a no-op until you set `OTEL_EXPORTER_OTLP_ENDPOINT`, so you can run without one. |

Each task runs in its own throwaway cloud sandbox, the agent solves it, then the exact hidden test
suite (`pytest`) grades it by whether the code actually runs.

## Run the full thing — needs a Tangle key

```bash
# one-time: download the 33-task dataset
examples/webcode-matrix/data/fetch.sh

# EFFORT defaults to 'standard'; OTEL endpoint is optional
SANDBOX_API_KEY=$TANGLE_API_KEY EFFORT=standard \
  pnpm tsx examples/intelligence-webcode/intelligence-webcode.ts
```

You'll see a per-attempt table plus one sample cost breakdown:

```
intelligence-webcode · effort=standard · project=webcode-bench
harness·model                 task          result  cost     wall

opencode·gpt-4o               task-01       PASS    $0.0123  8.4s
  — per-tool cost waterfall (layer 2), one cell —
  <per-tool $ breakdown>
...
```

**Prove the off-switch:** run once with `EFFORT=standard`, once with `EFFORT=off` — identical passes,
zero instrumentation spend the second time. Use `LIMIT=1` to try a single task first.

## Files

| File | What's in it |
|---|---|
| `intelligence-webcode.ts` | Wires the three layers onto each benchmark cell and prints the table |
| `README.md` | This file |

## Honest scope

This is the **observability + billing view** of a benchmark, not the benchmark itself. It imports the
task set and the harness × model grid from `../webcode-matrix` (the sibling example that ranks who
wins) and answers a different question: what each run cost and what it did. It needs a real sandbox key
and network — there is no fully-offline mode, because the whole point is metering real runs.
