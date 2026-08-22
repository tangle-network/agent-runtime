# engine — graphs the scheduler runs

`examples/graphs/` shows `runGraph`: a supervisor **model** reads a brief and decides what to
spawn. This directory shows the **engine**: the graph itself is the schedule, so no model chooses
whether a step happens.

| example | what it proves |
| --- | --- |
| [`review-loop.ts`](./review-loop.ts) | fan-out to three auditors, a `join: 'all'` verdict, guards on both arms of one output, a rebuild cycle bounded by `maxTraversals`, one pure edge projection, and a terminal completion check |

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
