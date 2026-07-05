# Say what you want in one sentence; get a result checked against reality

Hand `delegate()` a plain-English instruction and a pass/fail check. A supervisor model reads the
instruction, decides what kind of worker the job needs, builds that worker with exactly the tools it
should have, and runs it — then settles the run **only when your check passes against the real world**,
never on the worker's say-so.

```ts
const result = await delegate(
  'Create a file named out.txt containing exactly the word hello …',
  {
    backend,                                          // where the worker runs + which tools it gets
    router: { routerBaseUrl, routerKey, model },      // the model that powers the supervisor
    deliverable: fileDeliverable(targetAbs, target),  // the pass/fail check, read off disk
    budget: { maxIterations: 40, maxTokens: 200_000, maxUsd: 0.5 },
  },
)
```

## Why it matters

Most "AI agent" wiring makes you pick the worker, write its role, list its tools, then trust whatever
it reports back. `delegate()` inverts that: you supply the **intent** and a **check**, and it authors
the worker for you. The check is ground truth — in this example the run is only a `winner` when
`out.txt` actually exists and contains `hello`, read straight off the filesystem. A confident "I did
it!" from a worker that wrote nothing still **fails** the run. And `budget` is a hard ceiling on
iterations, tokens, and dollars, so a stuck run can't drain your key; `result.spentTotal` reports what
it cost whether it won or gave up.

## The three inputs

- **`backend`** — where the worker runs and what it can touch. Here the worker gets exactly ONE tool: a
  `write_file` confined to a scratch directory it cannot escape. Nothing else.
- **`deliverable`** — the completion check, `{ check: () => …, describe: '…' }`. It reads disk, so the
  result is trustworthy instead of self-reported. Always pass one.
- **`budget`** — the hard ceiling above.

## Run it — needs a Tangle router key

There is no offline mode; `delegate.ts` exits immediately without a key, because a real model both
supervises the run and powers the worker.

```bash
TANGLE_API_KEY=<your Tangle router key> pnpm tsx examples/delegate/delegate.ts
```

You'll watch the supervisor author a worker, the worker call `write_file` once, and the disk check pass:

```
=== delegate() ===
brain / worker : deepseek-v4-flash / deepseek-v4-flash
result.kind    : winner
file           : "hello" @ /tmp/delegate-xxxx/out.txt
spentTotal     : {"iterations":…,"tokens":{"input":…,"output":…},"usd":…,"ms":…}
worker out     : "DONE"
```

Optional env: `WORKER_MODEL` sets the worker's model, `BRAIN_MODEL` the supervisor's, `MODEL` sets both
(all default to `deepseek-v4-flash`); `TANGLE_ROUTER_URL` overrides the router endpoint
(`https://router.tangle.tools/v1`).

## Files

| file | what it is |
|---|---|
| `delegate.ts` | the intent, the options, and the run |
| `shared.ts` | the confined `write_file` tool, the disk-truth check, the scratch dir, and the worker backend |

## Honest scope

The task here — write one file — is deliberately trivial; the point is the **pattern**: intent in,
worker authored for you, result verified against reality. The truth-check itself is a plain filesystem
read that needs no key, and the whole loop is guarded end-to-end by `tests/delegate-example.test.ts`
(a paid live test when `TANGLE_API_KEY` is set, skipped for $0 otherwise).
