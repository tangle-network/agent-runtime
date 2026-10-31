# Retained owner capture and retry

- A committed executor result whose outcome reports failure remains a failed attempt.
  Incomplete workspace capture cannot replace its classification. The driver retry loop owns
  transient retries, unavailable pauses, budget and deadline bounds, and cancellation.
- Before reusing a retained environment, the owner tries the existing evidence recovery path.
  If a failed attempt still lacks a complete capture, the owner records pending capture through
  the existing `execution-evidence` journal with the original execution, environment, control,
  node, and profile identifiers. The original invocation and admissions remain pending; no
  successor environment is allocated until that capture is recovered. The source stays preserved
  until its exact capture receipt authorizes cleanup.
- An accepted attempt still requires complete capture before its workspace may change.
  Pending capture keeps the pursuit re-enterable and cannot seal a winner. Partial or foreign
  captures never authorize reuse or deletion. Explicit cancellation retains its settlement rules.
- A manager that waits out an exhausted seat chain keeps no running box. Before the wait, the
  owner checkpoints its workspace. It then destroys the environment once that checkpoint is newer
  than every execution event and its capture is complete. The next drive restores from that
  checkpoint in a new environment. A box that fails either condition stays.
- A nested manager whose driver fails after its last own turn committed a failed result settles
  `down` with that failure and closes its slot: no recovery can change that result. A dispatched
  turn with no result, an accepted result, or an unfinished child keeps it `nested-recovery`
  pending.
- A nested manager that never got past its intent settles `down` with the cause when the cause is a
  schema or bound refusal (the Sandbox SDK's `INVALID_CAPABILITY_DOCUMENT` included), at the first
  attempt, or when the same transient failure without progress repeats 10 times over 5 minutes,
  inside the transient-outage window too. The root keeps waiting an outage out.

Scenario coverage lives in `tests/kernel/supervise-retained-owner-pending.test.ts`,
`tests/kernel/nested-retained-owner-journal.test.ts` and
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
  holds. A fork's one traversal spawns every node it lists; a join fires once each member has
  settled usably since it last fired, and its target's task names the members in declared order,
  never the member that settled last, so a resumed run derives the same task under the same key.
  A route that spawns a node with a settled worker in this flow names that worker as `successorOf`.
  A route into a node that still has a running worker throws
  `GraphRouteError` with reason `target-live`.
- A flow inside a maps item or a `run_graph` subtask runs under its own runtime-owned root; when it
  stops or cannot route, that subtask fails, so a down item is decided by `onItemFailure`. An edge at its cap is skipped and ledgered `unpropagated`; a settle no edge matches throws
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
- A gate is a vertex that is not an agent. Reaching it awaits the top-level run's `decideGate` while
  the process holds the run; the request carries the visit (1-based, per gate per run) and the
  reaching edge's evidence with its source's result. A choice routes on its one leaving edge, whose
  `when` matches `/choice`; a `stop` decision ends the run as a `stop` edge does, with
  `stopped.edge` `gate:<id>`, and its `by` lives only on its ledger row.
- Each gate decision is exactly one `routes` ledger row `gate:<id>` whose traversal is the visit and
  whose `gate` carries `by` and the choice or stop reason, plus its journal twin. A visit the journal
  already holds is replayed without asking the caller and is not journaled again; a visit reached
  but undecided is asked again under the same visit number.
- A decision outside the gate's choices, or a `decideGate` that throws, fails the run with no
  decision row. An undecided gate at the run's deadline ends the run as a down node does, with no
  decision row; an aborted run records none either.
- Gates are refused in a maps item's graph and a `run_graph` subtask: only the top-level run has
  `decideGate`.

Scenario coverage lives in `tests/kernel/graph-routes.test.ts` and the five flow examples in
`tests/examples/graph-corpus.test.ts`.

# Retained interactive delegation

`claimRetainedInteractiveControl` normally acquires its own provider lease. With a Runtime
`journalRoot`, an attached terminal may explicitly `offer` its verified provider claim and a
second local process may explicitly `accept` that delegation. Acceptance reuses the exact
claim and holder identity; it performs no provider generation change, so the attached terminal
keeps input and resize authority. Providers still validate every command and remain authoritative.

Delegation grants full session control, including attach, input, resize, prompts and stop. It is
only for mutually trusted processes running as the same OS principal. Runtime keeps the bounded
claim in private state beside the journal root, outside observer exports. Reading an observer
journal grants no authority. Acceptance requires the exact reference, an unexpired claim, and a
positively live offering process. Detach, close and confirmed stop revoke the matching grant;
newer provider generations fence stale cleanup. Storage is preflighted before acquisition. If
publication later fails, the error identifies successful acquisition: correct storage and
reacquire with the same holder ID before sending any command. Reacquisition may advance the
generation; it cannot replay an ambiguous prompt or stop whose digest used the earlier claim. Process death makes a leftover grant unusable.

Accepted and replayed prompt acknowledgements append one observer turn per operation ID under
a cross-process file lock. A fresh process retry repairs delivery interrupted before journaling.
The observer stores operation IDs, never prompts or control claims.

`tests/integration/retained-interactive-delegation.test.ts` proves these boundaries with separate
processes, HTTP and durable journals. Its authority server is synthetic; provider compatibility
requires the attached-terminal live proof in the consuming application.
