# graphs — agent topologies as plain data

Seven runnable topologies for `runGraph` (the agent-graph layer over `supervise()`).
Each file's graph is a ≤25-line data literal — nodes are canonical `AgentProfile`s, edges are typed values carrying versioned registry directives — and each `main()` prints the EDGE LEDGER as the proof artifact: every traversal, its outcome (`delivered | stripped | empty | unpropagated`), its continuity stamp (`fresh | resume | steer`), its byte count, and the concrete worker it reached.

All seven run offline at $0 (scripted driver brain + in-process leaf workers, in [`shared.ts`](./shared.ts) — the same seams the kernel's own graph tests use; `user-sim-conversation` runs the REAL `chatTransportExecutor` through an injected scripted transport).

```bash
pnpm tsx examples/graphs/collaborates-review-loop.ts
pnpm tsx examples/graphs/best-of-n.ts
pnpm tsx examples/graphs/watchdog-steer.ts
pnpm tsx examples/graphs/shot-loop.ts
pnpm tsx examples/graphs/shot-loop-resumed.ts
pnpm tsx examples/graphs/user-sim-conversation.ts
pnpm tsx examples/graphs/analyst-agent-review.ts
```

| Example | Topology | What the ledger proves |
|---|---|---|
| [`collaborates-review-loop.ts`](./collaborates-review-loop.ts) | root + implementer + reviewer; `analyzes` critique → reviewer, `analyzes` verdict → driver | Peer collaboration is MEDIATED: findings cross worker→worker only as a ledgered lens route (a direct worker-to-worker channel is not a first-class edge), and a route with no live target is `unpropagated`, never dropped. |
| [`best-of-n.ts`](./best-of-n.ts) | root + two candidate coder nodes, one `delegates` edge each, `maxLiveWorkers: 2` | Breadth is two edges in the data: exactly two delivered spawn traversals, winner decided by the deliverable. |
| [`watchdog-steer.ts`](./watchdog-steer.ts) | root + one builder with a live trace; `watchWorkers` passthrough runs the shipped online detector panel | Mid-run intervention: the detector's finding reaches the driver over the bus, and the corrective steer lands as the delegates edge's second delivered traversal BEFORE settle. |
| [`shot-loop.ts`](./shot-loop.ts) | reviewer(root) ↔ coder; `delegates maxTraversals: 3`, `analyzes` verify → reviewer | The multishot loop as data: each shot and each verify report is one ledgered traversal, the shot budget lives on the edge, and the deliverable gates on the verdict. |
| [`shot-loop-resumed.ts`](./shot-loop-resumed.ts) | reviewer(root) ↔ coder; `delegates maxTraversals: 3, continuity: 'resume'` | Continuity as data: shot 1 spawns `fresh`, shots 2+ RESUME the coder's prior settled session — the executor seam receives `resume: { ofWorker, sequence }`, the ledger stamps every hop's continuity, and all shots spend from the one conserved pool. |
| [`user-sim-conversation.ts`](./user-sim-conversation.ts) | user-sim persona (root) ↔ product-agent chat worker; `delegates continuity: 'resume'` | A CONVERSATION as a graph (#721): the simulated user is a NODE (persona profile), the product agent runs on `chatTransportExecutor` (a bare chat-completions conversation, no sandbox), each dialogue turn is one ledgered traversal, and the wire-captured requests prove one growing message history re-attached across three workers. |
| [`analyst-agent-review.ts`](./analyst-agent-review.ts) | root + implementer; `analyzes` whose analyst is the `reviewer` NODE (no delegates edge to it) | The analyst as a tool-equipped AGENT: the reviewer node is spawned on the implementer's settle with directive + trace evidence as its task, its settle output IS the finding, and its spend lands in the one conserved budget. |

The offline proof for all seven (exact ledger counts, outcomes, destinations) lives in `tests/examples/graph-topologies.test.ts` and `tests/examples/user-sim-conversation.test.ts`.

## Three ledger semantics worth knowing

- A mid-run steer increments its delegates edge's traversal count but is only CAP-CHECKED at
  spawn time — each steer consumes future spawn budget on that edge, so `maxTraversals: 3`
  means "3 shots" only on a steer-free edge.
- `workerId` on a ledger row is the DESTINATION for delegates/steer/routed-analyzes rows, but
  the SOURCE worker for driver-destined finding rows.
- `continuity` on a ledger row is how the hop CONTINUED: spawn traversals stamp their effective
  spawn mode (`fresh` = new session, `resume` = re-attached to the node's latest settled
  session), and every mid-run delivery into an already-live recipient — a driver steer leg and
  every analyzes delivery — stamps `steer`.
