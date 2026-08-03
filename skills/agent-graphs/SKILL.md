---
name: agent-graphs
description: Author runGraph programs from AgentProfiles and versioned prompt directives.
---

# Agent graphs

Use this skill when every role is known before execution and the relationship between roles must be reviewable as data.
The output is an `AgentGraph` executed by `runGraph`, not a new coordinator or workflow framework.

## Choose the existing entry point

| Need | Use |
| --- | --- |
| Known roles with versioned work and analysis instructions | `runGraph` |
| A standard fixed shape such as parallel attempts, a chain, or a review panel | `fanout`, `pipeline`, `verify`, or `panel` |
| A model decides which workers to create while it works | `supervise` |
| One profile can complete the task directly | Run that profile without composition |

Do not force a dynamic task into a static graph.
Do not use a graph when a smaller shipped primitive already expresses the work.

### Strict authoring decisions (Do not under-graph)

- **Cheapness is not the dialect test:** Do not bail to `single-agent` just because a brief sounds trivial (e.g., "write a one-line file"). If the brief implies roles, observers, or a specific tight budget, author the graph.
- **Budget Floor Traps:** If a brief demands an impossibly "tight" budget (e.g., a few thousand tokens), do not dodge it by dropping to `single-agent`. Author the graph and explicitly set `budget` to the valid measured executor floor.
- **Identical-Role Parallelism:** If a brief requests N parallel instances of the same role, you MUST create N distinct worker nodes and N `delegates` edges. Do not collapse identical parallel workers into a single node.
- **Mandatory Analysts:** If a brief requires independent observation, review, or post-settle findings (e.g., "neutral decider", "review by two perspectives", "watch the worker"), you MUST author `analyzes` edges. Do not omit analysts and attempt to merge their logic into the root's prompt.
- **Caps are not stops:** Do not use an analysis edge `maxTraversals` cap as a global stop condition. To stop after N findings, use `deliverable.check` or `maxTraversals` on a `delegates` edge.

## Author the complete contract

An `AgentGraph` has four required fields: `nodes`, `edges`, `deliverable`, and `budget`.
`runGraph(graph, options)` validates graph structure and prompt references before it spends compute.

### Nodes

Each node is `{ id, profile }`, where `profile` is a complete canonical `AgentProfile`.
Set `profile.name` equal to `id` because Runtime uses that value to select and route the node.
Put the standing role in `profile.prompt.systemPrompt` and capabilities in the profile's tools, MCP, resources, hooks, and subagents.
Do not rebuild profile materialization in graph code.

### Delegation edges

A delegation edge is `{ kind: 'delegates', from, to, directive, maxTraversals? }`.
The directive is a registered, versioned `PromptHandle`, such as `promptHandle('delegates/research-brief/v1')`.
Each spawn and each later steer over the same edge consumes one traversal.
The default cap is `defaultEdgeTraversalCap`; exhaustion refuses further delegation.

The current graph form has one root and a static set of worker nodes.
Every delegation edge starts at the root, and each worker has exactly one incoming delegation edge.
Use a new directive version to change a brief instead of adding a second edge to the same worker.

### Analysis edges

An analysis edge is `{ kind: 'analyzes', analyst, over, to, directive, maxTraversals? }`.
It runs after a listed worker settles and routes findings to one node.

`analyst` has two supported forms:

- A lens id from `options.analysts` runs a caller-supplied analysis function.
- A graph node id runs that node's pinned `AgentProfile` as a tool-equipped analyst.

An analyst node has no incoming delegation edge, so the root cannot hand it ordinary work.
An id cannot be both a registered lens and an analyst node.
`over` lists delegated worker nodes only; Runtime refuses the root and analyst nodes because neither settles as an ordinary worker.
An analysis traversal cap records excess findings as `unpropagated`; it does not stop the run.

### Completion and budget

`deliverable.check(output)` is the independent completion test.
It must accept a genuinely complete result and reject junk.
Put the concrete mission in `deliverable.describe`; Runtime uses that text as the root's task.

`budget` is one conserved pool for the full graph.
Set `options.perWorker` explicitly from the actual executor cost.
For Pi, `WORKER_TOKEN_FLOOR.pi` is 31,211 input tokens before useful work, so a worker allocation below that value is refused. If a brief asks for a budget lower than the floor, do not switch to `single-agent`; output the graph with the floor allocation.
Treat an unmeasured executor floor as unknown rather than zero.
Analyst nodes spend from the same pool and need the same honest accounting as ordinary workers.

## Authoring procedure

1. **Classify correctly:** Verify if this needs `single-agent`, `dynamic-workflow`, or a static `runGraph`. If independent review or parallel workers are requested, use `runGraph`.
2. **Define completion first:** Write the completion test and its description.
3. **Select entry point:** Choose the smallest shipped entry point from the table above.
4. **Define Roles:** Give every distinct role one complete `AgentProfile`. If N parallel instances of a role are requested, create N nodes. Merge roles only if their standing prompts and capabilities are identical.
5. **Register directives:** Register a versioned directive for every edge.
6. **Delegate work:** Add one delegation edge per ordinary worker from the root.
7. **Attach analysts:** Add `analyzes` edges only when findings must be produced independently after a worker settles. Do not skip this if the brief asked for a watcher/reviewer.
8. **Size the pool:** Set budget, per-worker allocation, traversal caps, time, and concurrency from measured executor behavior. Ensure budgets meet the executor floor.
9. **Prove and inspect:** Run the structure offline, then run the real backend and inspect its result.

## Prove the graph before spending

Use an injected `brain` plus `makeWorkerAgent` to exercise graph structure without a network call.
Cover invalid profiles, unknown directives, impossible analysis routes, traversal exhaustion, successful completion, and rejected junk.
Start from the runnable programs in `examples/graphs/` rather than creating a second graph runner.

Offline execution proves control flow only.
A real task must still use the intended backend, profiles, tools, completion test, and budget before claiming the graph solves that task.

## Read the complete result

| Field | Meaning |
| --- | --- |
| `result.result.kind` and `reason` | Whether a result won and why execution ended |
| `result.result.spentTotal` | Tokens and money, including whether each total is known |
| `result.ledger` | Every delivered, stripped, empty, or unpropagated edge traversal with byte counts |
| `result.exhaustedEdges` | Every edge whose cap was reached, including normal lifecycle endings |
| Journal `edge` events | Durable copies of traversal evidence |

Zero traversals on an expected edge means the graph did not exercise that relationship.
`usdKnown: false` means cost is missing, not free.
A passing completion test proves only what that test checks.

## Common mistakes

- Bailing to `single-agent` because a brief sounds trivial, instead of respecting requested roles or applying budget floors.
- Collapsing N requested parallel identical roles into a single worker node.
- Skipping `analyzes` edges when an observer or reviewer is explicitly requested.
- Putting the task only in a spawn prompt instead of `deliverable.describe`.
- Giving a node a `profile.name` different from its id.
- Delegating ordinary work to an analyst node.
- Listing the root or an analyst node in `analyzes.over`.
- Using an analysis cap as a stop condition.
- Allowing a driver-authored spawn profile to add capabilities instead of defining them on the pinned node profile.
- Reading only thrown cap errors and missing `result.exhaustedEdges` on budget or cancellation endings.
- Treating unknown spend as zero.
- Claiming recursive or runtime-discovered structure when the current graph is a static root with workers and analysts.

## Improve only after measurement

Runtime already optimizes one inline skill through `improve(profile, { surface: 'skills', skills: { resourceName }, ... })`.
Put the exact skill bytes in `profile.resources.skills`, set `profile.resources.failOnError: true`, supply disjoint development and final-test tasks, and pass a complete Agent Eval optimization method.
Do not create a graph-specific optimizer, campaign runner, candidate store, or promotion path.

## Then consider

- `loop-writer` when the required dynamic structure still cannot be expressed by `supervise` or another shipped primitive; pass the exact missing behavior and the completion test.
- `verify` before publishing a graph consumer; pass the real backend command, expected result fields, and failure cases.
