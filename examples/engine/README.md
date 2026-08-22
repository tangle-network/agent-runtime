# engine — graphs the scheduler runs

`examples/graphs/` shows `runGraph`: a supervisor **model** reads a brief and decides what to
spawn. This directory shows the **engine**: the graph itself is the schedule, so no model chooses
whether a step happens.

| example | what it proves |
| --- | --- |
| [`review-loop.ts`](./review-loop.ts) | fan-out to three auditors, a `join: 'all'` verdict, guards on both arms of one output, a rebuild cycle bounded by `maxTraversals`, one pure edge projection, and a terminal completion check |
| [`codemode.ts`](./codemode.ts) | the same job as JSON tool calls and as CODE: 8 model turns vs 1, over the same operations and the same answer |

```
pnpm tsx examples/engine/review-loop.ts
```

```
review-loop → winner
shipped: {"shipped":"export function rate(x: number): number { return x * 2 }"}
  round 1: rejected — audit-security: hardcoded credential in source
  round 2: rejected — audit-style: bare `any` defeats the type check
  round 3: PASSED
  16 node settlements, 24 edge traversals
```

Every node is a `script` kind, so the run is offline, deterministic and free. Swapping one for an
`agent` node is a config change, not a rewrite — that is what the node-kind registry buys.

`tests/examples/engine-review-loop.test.ts` pins the behaviour, including the arm a successful run
cannot show: a build that never satisfies its reviewers is ended by the edge cap with
`GraphEdgeCapError` rather than spinning.

## code mode

`codemode.ts` runs one job two ways over the same operations table:

```
  code mode : 1 model turn ,  7 operation calls  → {"total":45}
  tool calls: 8 model turns,  7 operation calls  → {"total":45}
```

A `codemode` node asks the model once for a program written against the operations it grants, then
runs it — the loop and the `continue` happen inside the program instead of costing a round trip
each. Three things make that safe to offer, and none of them can live in a prompt:

1. **The API is the grant.** What the model is shown is generated from the same table the runner
   binds, so an ungranted call cannot be described into existence.
2. **The host owns where code runs.** The kind declares a `codeRunner` effect and runs nothing
   itself; the engine refuses before spending if no runner was supplied. `inlineCodeRunner()` is a
   lint plus a function call — a development convenience, **not** a sandbox.
3. **Spend reaches the kernel.** Each operation reports what it cost and the node totals it into
   the settlement the kernel journals, so code mode cannot spend outside the budget.
