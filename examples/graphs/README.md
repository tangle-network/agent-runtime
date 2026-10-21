# graphs — agent topologies as plain data

Runnable topologies for `runGraph` (the agent-graph layer over `supervise()`).
Each file's graph is a ≤25-line data literal — nodes are canonical `AgentProfile`s, edges are typed values carrying versioned registry directives — and each `main()` prints the EDGE LEDGER as the proof artifact: every traversal, its outcome (`delivered | stripped | empty | unpropagated`), its continuity stamp (`fresh | resume | steer`), its byte count, and the concrete worker it reached.

Every example runs offline at $0 (scripted driver brain + in-process leaf workers, in [`shared.ts`](./shared.ts) — the same seams the kernel's own graph tests use; a flow graph (`entry` plus `routes` edges) needs no brain at all; `user-sim-conversation` runs the REAL `chatTransportExecutor` through an injected scripted transport) except [`sandbox-e2e.ts`](./sandbox-e2e.ts), which is live and skips cleanly without credentials.

```bash
pnpm tsx examples/graphs/<example>.ts        # any file in the tables below
pnpm vitest run tests/examples               # the ledger proofs and the deduplication audit
```

## Core topologies

| Example | Topology | What the ledger proves |
|---|---|---|
| [`collaborates-review-loop.ts`](./collaborates-review-loop.ts) | root + implementer + reviewer; `analyzes` critique → reviewer, `analyzes` verdict → driver | Peer collaboration is MEDIATED: findings cross worker→worker only as a ledgered lens route (a direct worker-to-worker channel is not a first-class edge), and a route with no live target is `unpropagated`, never dropped. |
| [`best-of-n.ts`](./best-of-n.ts) | root + two candidate coder nodes, one `delegates` edge each, `workerSlots: 2` | Breadth is two edges in the data: exactly two delivered spawn traversals, winner decided by the deliverable. |
| [`watchdog-steer.ts`](./watchdog-steer.ts) | root + one builder with a live trace; `watchWorkers` passthrough runs the shipped online detector panel | Mid-run intervention: the detector's finding reaches the driver over the bus, and the corrective steer lands as the delegates edge's second delivered traversal BEFORE settle. |
| [`shot-loop.ts`](./shot-loop.ts) | reviewer(root) ↔ coder; `delegates maxTraversals: 3`, `analyzes` verify → reviewer | The multishot loop as data: each shot and each verify report is one ledgered traversal, the shot budget lives on the edge, and the deliverable gates on the verdict. |
| [`shot-loop-resumed.ts`](./shot-loop-resumed.ts) | reviewer(root) ↔ coder; `delegates maxTraversals: 3, continuity: 'resume'` | Continuity as data: shot 1 spawns `fresh`, shots 2+ RESUME the coder's prior settled session — the executor seam receives `resume: { ofWorker, sequence }`, the ledger stamps every hop's continuity, and all shots spend from the one conserved pool. |
| [`user-sim-conversation.ts`](./user-sim-conversation.ts) | user-sim persona (root) ↔ product-agent chat worker; `delegates continuity: 'resume'` | A CONVERSATION as a graph (#721): the simulated user is a NODE (persona profile), the product agent runs on `chatTransportExecutor` (a bare chat-completions conversation, no sandbox), each dialogue turn is one ledgered traversal, and the wire-captured requests prove one growing message history re-attached across three workers. |
| [`analyst-agent-review.ts`](./analyst-agent-review.ts) | root + implementer; `analyzes` whose analyst is the `reviewer` NODE (no delegates edge to it) | The analyst as a tool-equipped AGENT: the reviewer node is spawned on the implementer's settle with directive + trace evidence as its task, its settle output IS the finding, and its spend lands in the one conserved budget. |

[`designer-live.ts`](./designer-live.ts) is the live meta-graph: a real model authors and replays graphs through the designer tools. It has no fixed graph of its own.

## Corpus catalog: the patterns 660 Claude Workflows actually use

These examples come from a study of 660 Claude Workflow scripts (2026-07-01 to 2026-10-15), reduced to 243 control-flow families and classified by pattern. Counts are scripts, weighted by family: **primary** is the script's main pattern, **secondary** a pattern it also uses. This table is the one place the counts are stated; each example names its pattern id and points here. A pattern the core topologies above already cover has no new file.

| Claude Workflow pattern | Scripts (primary / secondary) | Example | What the ledger proves | Expressed as |
|---|---|---|---|---|
| P03 static fan-out → synthesize | 148 / 81 | [`static-fanout-synthesize.ts`](./static-fanout-synthesize.ts) | One `delegates` traversal per fixed dimension; a synthesis analyst NODE's findings reach the root, one per settle, and the root delivers their join as `result.out`. One high-risk dimension flips the delivered recommendation to hold. | Fixed graph |
| P05 per-item pipeline | 117 / 27 | [`per-item-pipeline.ts`](./per-item-pipeline.ts) | One verify row per finder settle; a publisher is spawned before the last verification, or the run would deadlock. | Fixed graph |
| P11 build → review → fix | 100 / 42 | [`collaborates-review-loop.ts`](./collaborates-review-loop.ts), [`shot-loop.ts`](./shot-loop.ts), [`shot-loop-resumed.ts`](./shot-loop-resumed.ts) | Already covered above. | Fixed graph |
| P02 sequential role chain | 94 / 88 | [`role-chain.ts`](./role-chain.ts) | Scout, builder, reviewer in order from two `routes` edges; each task carries the previous worker's exact result as evidence (a different scout finding changes the builder's brief), and the terminal reviewer's result is `result.out`. | Flow graph |
| P12 isolated parallel writers | 48 / 70 | [`isolated-writers-integrate.ts`](./isolated-writers-integrate.ts) | Three writer traversals, then the integrator after the last settle. Each writer is its own node, so on the sandbox backend its own box replaces a git worktree. | Fixed graph |
| P04 discovered fan-out → reduce | 36 / 21 | [`discovered-fanout-reduce.ts`](./discovered-fanout-reduce.ts) | N traversals on ONE edge (`maxTraversals`), then a reducer. Peak live readers, measured from execute start to settle, equals `workerSlots`: 2, and 4 in the control. | Fixed graph; the item list is the root's, found in its own turn |
| P06 adversarial verify + P07 lens-diverse verify | 10 + 7 / 176 + 118 (majority-of-N in 19, lens-diverse in 127) | [`skeptic-majority.ts`](./skeptic-majority.ts) | Three skeptic analyst nodes on three model families fire on the claimant's settle; the root delivers its 2-of-3 decision as `result.out`, carrying the claim when kept and only the votes when dropped. | Fixed graph |
| P13 conditional / early exit | 0 / 169 | [`conditional-skip.ts`](./conditional-skip.ts) | The verifier edge fires only when `/findings/0` exists; with zero findings it has zero traversals and the default edge finishes as `nothing-found`. | Flow graph; the gate is a route condition |
| P08 judge panel / best-of-N | 31 / 19 | [`judge-panel.ts`](./judge-panel.ts), [`best-of-n.ts`](./best-of-n.ts) | Two judge nodes score each attempt they read (6 rows); `result.out` is the top-scoring attempt's own output. `best-of-n` is the panel-free form. | Fixed graph |
| P09 loop-until-dry + P10 completeness critic | 3 + 0 / 2 + 33 | [`loop-until-dry.ts`](./loop-until-dry.ts) | The critic settles its dry streak; a resumed finder is routed back until the streak reaches 2, which finishes the loop before the cap. | Flow graph; the stop rule is a field the critic settles |
| P18 hierarchical + P15 nested | 7 + 1 / 6 + 0 | [`hierarchical-nested.ts`](./hierarchical-nested.ts) | A node holding the spawn grant runs as a nested supervisor; its workers' ids sit under its own. | Fixed graph with a nested supervisor node; its offline brain is a scripted router peer |
| P23 ordered waves + P24 dependency DAG | 2 + 2 / 0 (12 + 2 more as novel mentions) | [`dependency-waves.ts`](./dependency-waves.ts) | The ledger order respects the DAG; same-wave nodes are spawned in one turn. | Fixed graph; the dependencies are the driver's release rule |
| P25 proof gate before an irreversible step | 0 / 0 (3 novel mentions) | [`proof-gate.ts`](./proof-gate.ts) | The proof node settles `{ bytes, ok }` from the backup result it was handed; the purge edge fires only when `/ok` is true, so with an empty backup the destructive edge has zero traversals. | Flow graph |
| P22 arm comparison | 2 / 8 | [`arm-comparison.ts`](./arm-comparison.ts) | One task under three graphs; three registry records; `pickBestGraph` selects the cheapest delivery and `lookupGraph` replays it. | Three fixed graphs plus the graph registry |
| P20 watch / poll | 1 / 1 | [`watchdog-steer.ts`](./watchdog-steer.ts) | Already covered above. | Fixed graph |
| P06 with one analyst | (inside the 297 single-skeptic scripts) | [`analyst-agent-review.ts`](./analyst-agent-review.ts) | Already covered above. | Fixed graph |
| (live check of the above) | — | [`sandbox-e2e.ts`](./sandbox-e2e.ts) | A worker in a real Sandbox box graded by an in-box check, two skeptics on different families, per-node cost. Skips without credentials. | Fixed graph on the `sandbox` backend |

### Patterns that are deliberately not examples

- **P01 single agent (46 / 0).** One agent call has no topology; run it with the executor or `supervise()` directly.
- **P21 independent lanes (3 / 2).** `static-fanout-synthesize` without the synthesis analyst: the same edges and no `analyzes`.
- **P19 research sweep → deep read → synthesize (3 / 0).** `discovered-fanout-reduce` (the sweep) followed by `role-chain` (read, then synthesize); no new shape.
- **P17 multi-modal sweep (0 / 4) and P16 tournament (0 / 1).** The first is `static-fanout-synthesize` with methods as the dimensions; the second is `judge-panel` repeated.
- **P26 before/after probe and P27 priority admission (1 mention each).** An evaluation design and a scheduling policy, not topologies.

### What a fixed graph says, and what it leaves to the driver

Reading these examples against the corpus shows five things the graph form does not carry in its data. Each is stated where it applies.

- **A decision reaches the result only through the root.** Without a submission the run returns what the default finalizer picks, the first highest-scoring delivered worker, and analyst findings never change that pick. A root that decides (`judge-panel`, `skeptic-majority`, `static-fanout-synthesize`) is granted `observe_agent` and `submit_result`, reads what it needs, submits its decision, and declares a deliverable that only that decision passes.
- **An analyst fires on each matching settle.** A "synthesis over all three" is therefore three findings the root joins (`static-fanout-synthesize`); one agent over all outputs needs a barrier and a delegated worker (`isolated-writers-integrate`).
- **Every delegates edge names the root as `from`.** Nested workers (`hierarchical-nested`) are ledgered against the root; their worker id path (`h:s0:s0`) says who ran them.
- **A fixed order, gate or stop rule is graph data.** `role-chain`, `conditional-skip`, `proof-gate` and `loop-until-dry` are flow graphs: `entry` starts them, `routes` edges carry each result on, and no root decides. A flow's output is its terminal and `finish` results. `dependency-waves` still releases its DAG from the driver: a join of several branches is not a routes edge.
- **A discovered list is not a graph field.** `discovered-fanout-reduce` carries the ceiling (`maxTraversals`) and the concurrency (`workerSlots`); the items are the root's.

## The deduplication audit

[`catalog.ts`](./catalog.ts) lists every graph an example builds, one entry per graph (each arm of `arm-comparison` is its own entry), and compares them in two steps. `graphSignature` reduces a graph to its topology with the incidental numbers bucketed away: node count by role (one or many), each edge's kind, continuity and destination, each analyst's form and where it reports, and whether an edge declares repetition (an explicit cap above one). Widths, exact caps, model providers, root grants other than spawn, and wording are not topology. Graphs with equal signatures are then told apart by `ledgerShape`, which runs each example's offline scenarios and fingerprints what the run did: the driver's spawn waves in order, the analyzes rows, the continuity stamps and the outcomes. For example, `conditional-skip` and `role-chain` both chain stages, but one routes on a condition and finishes early while the other runs every stage. A flow graph's signature carries its entry width and its routes edges instead of a root, so a flow never shares a topology with a rooted graph.

`tests/examples/graph-signature-audit.test.ts` fails when two graphs share both fingerprints, unless one declares that it reuses the other's topology (`reuses`, with the reason: an arm of the comparison, the live run of an offline example, the same loop on another executor) and the declaration is true. It also fails when a file in this directory is neither catalogued nor named as not-a-graph, or when this README omits a catalogued example. Add an example by adding its entry there and its row here.

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
