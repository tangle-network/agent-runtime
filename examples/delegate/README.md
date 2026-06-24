# delegate — the one-call delegation verb

`delegate(intent, opts)` hands an INTENT to a default authoring supervisor: a router-brained
supervisor that DECOMPOSES the intent and AUTHORS the worker profile it needs — no hardcoded
coder/researcher profile. It is a thin wrapper over `supervise()`, so the conserved-budget pool, the
completion oracle, and equal-compute accounting come for free.

```ts
const result = await delegate(
  'Create a file named out.txt containing exactly the word hello …',
  {
    backend,                       // WHERE the authored worker runs (router-tools here)
    router: { routerBaseUrl, routerKey, model },  // the supervisor brain's substrate
    deliverable: fileDeliverable(targetAbs, target), // settle ⟺ the file exists on disk
    budget: { maxIterations: 40, maxTokens: 200_000, maxUsd: 0.5 },
  },
)
```

- **`backend`** is WHERE the authored worker runs. Here the worker is granted ONE tool — a
  path-confined `write_file` — and nothing else.
- **`deliverable`** is a DISK-TRUTH oracle: the run settles `winner` only when the file actually
  exists with the right content, read off disk — never the worker judging itself. Always pass one.
- **`result.spentTotal`** reports what the whole delegation cost on BOTH paths: a `winner` carries the
  worker's spend, a `no-winner` carries what it spent before failing.

Run: `TANGLE_API_KEY=<router key> pnpm tsx examples/delegate/delegate.ts`

The reusable pieces (the `write_file` tool, the deliverable, the backend) live in `shared.ts`; the
regression proof that drives the same wiring end-to-end is `tests/delegate-example.test.ts`
(env-gated — a paid live e2e when `TANGLE_API_KEY` is set, skipped at $0 otherwise).
