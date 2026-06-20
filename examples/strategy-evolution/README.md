# strategy-evolution

The policy-search research journey: `runStrategyEvolution` + `promotionGate`.

Per generation the engine authors a population of candidate optimization strategies from the current
tournament's losses, plays them against the incumbent at equal budget, and advances a champion. One
final promotion decision runs on a fresh holdout slice the search never touched — through
`promotionGate`, a seeded paired-bootstrap CI rather than a point comparison.

You supply three things:

- an **`Environment`** — your domain's five hooks (`open`/`tools`/`call`/`score`/`close`) and its own
  deployable check (never an LLM's opinion);
- a **`tasks(offset, n)`** supplier that returns DISJOINT slices — the train set draws `[0, trainN)`,
  the holdout draws past it, so a good holdout score is not memorization of the practice tasks;
- an **author `chat`** client (agent-eval's `createChatClient`) — the model that writes candidates.

The engine owns the tournament, the cost-aware champion selection, and the gate.

## Run

```bash
TANGLE_API_KEY=<router key> pnpm tsx examples/strategy-evolution/strategy-evolution.ts
```

Optional env: `WORKER_MODEL` (the worker that drives the env, default `gpt-4o-mini`), `AUTHOR_MODEL`
(the strategy author, default `deepseek-v4-flash`), `ROUTER_BASE`.

It prints the gen0 vs final champion, the promotion verdict (`promoted` + `reason`), the paired task
count `n`, and the held-out lift with its bootstrap CI.

## Going further

The real config carries more knobs the example leaves at their defaults — see
`StrategyEvolutionConfig` in `@tangle-network/agent-runtime/loops`:

- `objective: 'cost'` — promote a candidate that ties the score *cheaper* (non-inferiority gate).
- `band: { holdoutPoolN }` — concentrate the gate on tasks with headroom (a reference screen drops
  already-solved tasks before either finalist runs).
- `reproducerCheck` — re-implement the champion from a short summary and re-score it; a reproduction
  gap is an overfitting signal.
- `checkpoint: { path, resume }` — write the phase ledger so a restart re-pays at most one phase.
