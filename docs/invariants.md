# Retained owner capture and retry

- A committed executor result whose outcome reports failure remains a failed attempt.
  Incomplete workspace capture cannot replace its classification. The driver retry loop owns
  transient retries, unavailable pauses, budget and deadline bounds, and cancellation.
- Before reusing a retained environment, the owner tries the existing evidence recovery path.
  If a failed attempt still lacks a complete capture, the owner records pending capture through
  the existing `execution-evidence` journal with the original execution, environment, control,
  node, and profile identifiers. The next invocation uses another environment. The source stays
  preserved until its exact capture receipt authorizes cleanup.
- An accepted attempt still requires complete capture before its workspace may change.
  Pending capture keeps the pursuit re-enterable and cannot seal a winner. Partial or foreign
  captures never authorize reuse or deletion. Explicit cancellation retains its settlement rules.

Scenario coverage lives in `tests/kernel/supervise-retained-owner-pending.test.ts` and
`tests/runtime/retained-capture-resume.test.ts`.

# Graph subtasks

- A `run_graph` subtask is one reservation from its caller's conserved pool. The graph's root node
  runs as a nested manager inside that reservation, so the whole graph spends only what the caller
  reserved, and its nodes are that node's subtree in the run's one journal.
- Every node of a graph runs its canonical profile plus its edge directive. A driver selects a node
  by name and nothing else it authors reaches the node. Checks and graders stay the run's; a graph
  node is never one.
- A managed child, every graph node included, settles on its own accepted `submit_result`. The
  run's check judges the result of the manager that assigned it (for a node, the manager that
  called `run_graph`), never a child's narrower one, and the run's continuation never sends a child
  back; a deliverable `resolveDeliverable` chose for the spawn still applies.
- Every edge traversal of a subtask is an `edge` event in the run's root journal tree, naming the
  graph's root node in `graph`. The subtask settles with `{ deliverable, edges }`.
- Only `run_graph` starts a graph: `spawn_worker` refuses a profile carrying
  `metadata.agentRuntimeGraph`, and a node of a graph cannot start another graph.
- `superviseGraphPursuit` owns its run directory exactly as `supervisePursuit` does: one live
  holder, `result.json` once, refusal of a settled directory, and resume from the spawn journal.

Scenario coverage lives in `tests/kernel/graph.test.ts` (`run_graph`),
`tests/durability/graph-rundir-journal.test.ts` and `tests/durability/graph-kill-resume.test.ts`.

# Flow graphs

- A graph with `entry` is a flow graph. Runtime decides its order, branches, repair loops and stops
  from graph data: its root manager is Runtime's own, its brain places no model call and meters no
  provider attempt (a no-usage turn would count as unknown spend, which a dollar-capped pool
  refuses), and a caller `brain`, `driverBackend`, `finalizer`, `maxTurns` or `compaction` is
  refused because a flow root has no reader for them.
- Entry and route spawns are runtime spawns, like map items. Each takes the admission a
  `spawn_worker` call takes, so the conserved pool, the pre-flight and node pinning judge it; its
  runtime-authored `route` marker is what pinning admits, never a model argument.
- Runtime spawns every entry when the root's coordination opens, before the root's first turn, so
  a flow cannot end `no-children-spawned` while an entry is still running.
- One usable settle fires at most one routes edge: the first in declaration order whose `when`
  holds. An edge at its cap is skipped and ledgered `unpropagated`; a settle no edge matches throws
  `GraphRouteError`, a `stop` edge returns no winner `'stopped'`, and a down flow node returns no
  winner `'all-children-down'`, each with nothing spawned after it.
- A `done` settle without a usable result (its deliverable check rejected it, or it has no result)
  is not output on a terminal node; on a node with routes edges it ends the run as a down settle
  does, `'all-children-down'` with `stopped.reason` `unusable: <why>`.
- A flow that ends early aborts its live flow workers: the run returns at the stop, it does not
  wait for siblings.
- The run's output is `{ [node]: latest usable result }` over its terminal nodes and `finish`
  sources, and the graph's deliverable alone decides whether it wins.
- Every entry, traversal, cap skip and refused route spawn is a `routes` row in the edge ledger and
  an `edge` event in the run journal.

Scenario coverage lives in `tests/kernel/graph-routes.test.ts` and the four flow examples in
`tests/examples/graph-corpus.test.ts`.
