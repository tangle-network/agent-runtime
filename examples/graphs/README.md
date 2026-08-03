# graphs — agent topologies as plain data

Four runnable topologies for `runGraph` (the agent-graph layer over `supervise()`).
Each file's graph is a ≤25-line data literal — nodes are canonical `AgentProfile`s, edges are typed values carrying versioned registry directives — and each `main()` prints the EDGE LEDGER as the proof artifact: every traversal, its outcome (`delivered | stripped | empty | unpropagated`), its byte count, and the concrete worker it reached.

All four run offline at $0 (scripted driver brain + in-process leaf workers, in [`shared.ts`](./shared.ts) — the same seams the kernel's own graph tests use).

```bash
pnpm tsx examples/graphs/collaborates-review-loop.ts
pnpm tsx examples/graphs/best-of-n.ts
pnpm tsx examples/graphs/watchdog-steer.ts
pnpm tsx examples/graphs/shot-loop.ts
```

| Example | Topology | What the ledger proves |
|---|---|---|
| [`collaborates-review-loop.ts`](./collaborates-review-loop.ts) | root + implementer + reviewer; `analyzes` critique → reviewer, `analyzes` verdict → driver | Peer collaboration is MEDIATED: findings cross worker→worker only as a ledgered lens route (a direct worker-to-worker channel is not a first-class edge), and a route with no live target is `unpropagated`, never dropped. |
| [`best-of-n.ts`](./best-of-n.ts) | root + two candidate coder nodes, one `delegates` edge each, `maxLiveWorkers: 2` | Breadth is two edges in the data: exactly two delivered spawn traversals, winner decided by the deliverable. |
| [`watchdog-steer.ts`](./watchdog-steer.ts) | root + one builder with a live trace; shipped online detector panel (`watchTrace`) | Mid-run intervention: the detector fires while the worker runs, and the corrective steer lands as the delegates edge's second delivered traversal BEFORE settle. |
| [`shot-loop.ts`](./shot-loop.ts) | reviewer(root) ↔ coder; `delegates maxTraversals: 3`, `analyzes` verify → reviewer | The multishot loop as data: each shot and each verify report is one ledgered traversal, the shot budget lives on the edge, and the deliverable gates on the verdict. |

The offline proof for all four (exact ledger counts, outcomes, destinations) lives in `tests/examples/graph-topologies.test.ts`.

## Two ledger semantics worth knowing

- A mid-run steer increments its delegates edge's traversal count but is only CAP-CHECKED at
  spawn time — each steer consumes future spawn budget on that edge, so `maxTraversals: 3`
  means "3 shots" only on a steer-free edge.
- `workerId` on a ledger row is the DESTINATION for delegates/steer/routed-analyzes rows, but
  the SOURCE worker for driver-destined finding rows.
