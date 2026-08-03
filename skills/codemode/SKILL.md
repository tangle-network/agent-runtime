---
name: codemode
description: "Author agent graphs from ideas or loose context — runGraph, orchestration, workflows-as-code."
---

# Codemode: ideas into agent graphs

You are turning intent into a program, not into a conversation.
A graph is plain data — profiles as nodes, versioned prompt directives as edges — executed by `runGraph`, which composes `supervise()` and records every directive that crosses an edge in a ledger.
The output of this skill is never "an agent did things"; it is a graph whose ledger and deliverable verdict prove what happened.

## Choose the dialect first

| Problem shape | Use | Why |
| --- | --- | --- |
| Topology known before running; needs repeatability, caps, an audit trail | `runGraph` static graph (this skill) | Every traversal ledgered; caps fail loud; topology is reviewable data |
| Topology discovered while working (fan-out over a list you find mid-run) | `dynamic-workflows` skill — script over `spawn_agent`/`parallel` | A static graph cannot add nodes at runtime |
| One-shot-able by a single strong agent; no parallelism, no independent verification | No orchestration at all | Measured: a harness-driven root costs ~11× a plain router loop; composition must earn that |

When unsure, write the deliverable check first (below). If one agent could produce bytes that pass it, you do not need a graph.

## The contract, compressed

`AgentGraph = { nodes, edges, deliverable, budget }` — all four mandatory; `runGraph(graph, options)` validates everything before any compute, so configuration faults throw instead of burning budget.

**Nodes** — `{ id, profile }`. The profile is the entire description of the node: `prompt.systemPrompt` is its standing role, tools/mcp/resources its capabilities. `profile.name` must equal `id` — the name IS the node's identity for pinning and analyst routing.

**Edges** — two kinds, both carrying a versioned directive (`PromptHandle`, e.g. `promptHandle('delegates/worker-brief/v1')`):

- `delegates` `{ from, to, directive, maxTraversals? }` — work flowing from the one root to a worker. One edge per worker: to change the brief, register a new directive **version**, never a second edge. Each spawn *and* each mid-run steer consumes a traversal (default cap 32); the cap is the cyclic-run backstop and refuses loudly when exhausted.
- `analyzes` `{ analyst, over, to, directive, maxTraversals? }` — a lens (from `options.analysts`, **never a node id**) observing settled workers and routing findings to a node. Analysts are environment: if the rubric were a node, workers could address and game it.

**Topology (current: P0)** — exactly one root (delegates, never delegated to); every delegates edge originates at the root; every other node must be reachable by a delegates edge. Deeper delegation chains are not yet expressible — do not fake them with prompt instructions.

**Deliverable** — the independent termination oracle: `{ check: (out) => boolean, describe? }`. `describe` doubles as the root's task text — **the real mission goes here**, or your driver runs with a generic one-liner. `check` must accept genuinely-done output and reject junk; a throwing check is fail-closed (never delivered), so a shape mismatch silently burns the run to `budget-exhausted`.

**Budget** — one conserved pool for the whole graph; cycles without conservation never terminate.

## Budget from the floors, not from optimism

`perWorker` defaults to a quarter of the pool. A `pi` worker spends **31,211 input tokens** (measured minimum, `WORKER_TOKEN_FLOOR`) before any useful work — so a pool under ~125k tokens with defaulted `perWorker` gets every spawn refused `below-runtime-floor`. Live history: five of six root-authored child budgets were below the floor before the refusal existed.

- Workers on a measured harness: give each at least floor + working headroom (pi: ≥60k), and set `perWorker` explicitly.
- Workers on an unmeasured harness (`claude-code`, `codex`, …): the floor is **unknown, not zero** — budget generously and treat "settled with nothing produced" as a probable floor kill.
- A refused spawn still consumes an edge traversal. A driver retry-looping on refusals burns the cap; the refusal hint says to **raise** `maxTokens` — never retry smaller.

## Authoring procedure

1. **Deliverable first.** Write `check` as a mechanical test over bytes or state. If you cannot, you do not understand the task yet — stop and clarify, don't graph.
2. **Fewest distinct roles.** A node earns existence only if you would write its standing prompt differently from every other node's. Roles you cannot differentiate belong in one node.
3. **Author each node's profile**: `name` = id, `systemPrompt` = the standing role, capabilities only what that role needs.
4. **One delegates edge per worker** with a versioned brief; size `maxTraversals` as expected spawns + expected steers (they share the count, and only spawns are cap-checked).
5. **Analysts only for observation that must be unaddressable** — quality lenses, safety reads. `over` must list **worker** nodes: an `analyzes` over the root validates but never fires (the root never settles as a worker).
6. **Budget from step 4 of the floors section.**
7. **Run offline before live** (below), then swap the backend.

## Prove it offline before spending

Every topology is provable with zero network: inject a scripted `brain` for the driver, a stub `backend`/`makeWorkerAgent` for leaves, and default in-memory journal/blobs. The four `examples/graphs/` topologies are the templates. Offline the deliverable may be a rubber stamp (`out !== undefined`); live it must be real — a stamp makes the first settle "win" regardless of quality.

## Read the evidence, or you shipped nothing

A graph "worked" only if its records say so:

| Read | For |
| --- | --- |
| `result.result.kind` + `reason` | winner / why not; `spentTotal` with `tokensKnown`/`usdKnown` — unknown is flagged, never zeroed |
| `result.ledger` | every traversal: `delivered` / `stripped` (authority narrowed it) / `empty` / `unpropagated`, with byte counts. An edge you expected with **zero traversals** = mis-routing |
| `result.exhaustedEdges` | **always** — `GraphEdgeCapError` throws only on a no-winner, non-lifecycle ending; a `budget-exhausted` run returns normally with exhausted caps listed |
| journal `edge` events | the durable twin of the ledger, for post-hoc and cross-run analysis |

## Potholes

| Pothole | Rule |
| --- | --- |
| `analyzes.over` includes the root | Validates, never fires. Lens over workers only |
| Analyzes `maxTraversals` used as a stop | It is observability-only; exhaustion ledgered `unpropagated`, never refuses. Only delegates caps stop a loop |
| Real task only in an imagined spawn payload | The driver's task is `deliverable.describe` — put the mission there |
| Second delegates edge to the same worker | Refused. Version the directive |
| Renaming a profile to "fix" a name/id mismatch | The equality is identity, not style — set both from one constant |
| Driver-authored spawn profiles adding capabilities | Ignored by design; only node selection crosses. Capabilities live in node profiles |
| Reading only for `GraphEdgeCapError` | Misses cap exhaustion on lifecycle endings — read `exhaustedEdges` |
| Trusting `$0` spend | `usdKnown: false` means unmetered, not free |

## Improving this skill

This file is an optimizable surface. `skills/codemode/IMPROVE.md` maps the loop — author-from-case → offline `runGraph` → deterministic ledger scoring → gated skill revision — onto agent-eval's existing machinery (`skillOptOptimizationMethod` takes skill text as its surface; `runImprovementLoop` gates promotion on a held-out set). Improve the skill through that loop, never by ad-hoc edits after a single bad run.

## Then consider

| Condition | Next skill | What to pass |
| --- | --- | --- |
| Worker profiles need real authoring | authoring-agent-profiles (supervisor-lab) | the node list and each role's one-line mission |
| Topology turns out runtime-discovered | dynamic-workflows (supervisor-lab) | the deliverable check and role prompts you already wrote |
| A skill revision needs its lift measured | generate-eval / eval-engineering | the cases and the ledger-scoring judge from IMPROVE.md |
