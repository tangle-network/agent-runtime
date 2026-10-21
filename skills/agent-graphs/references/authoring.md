# AgentGraph authoring contract

Use the current [graph types and validation](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/graph.ts) for exact fields.
Start from a matching [example](https://github.com/tangle-network/agent-runtime/tree/main/examples/graphs) rather than copying a second graph runner.

## Nodes and work

AgentGraph requires nodes, edges, a deliverable, and a shared budget.
Adding `entry` makes it a flow graph: Runtime spawns each entry node with its task and traverses `routes` edges itself, so no node is a root.
Each node holds an id and a canonical AgentProfile; its profile name matches the node id for routing.
Standing roles belong in the profile prompt, with explicit tools and resources.
Put the concrete mission in the deliverable description and supply an independent completion check that rejects incomplete output.

A node whose work is mechanical composition (fan-out, filtering, pagination, cross-tool joins)
can be a CODE node: `model.metadata.codeMode` on its profile presents `tool_search` + `codemode`
instead of the raw tools, so the model authors one program per assignment instead of one tool
call per turn. The grant (`profile.tools`) is unchanged — every nested call still crosses the
authorized handler, and spend still settles on the node. Reserve code nodes for judgment-free
stretches; anything that must re-plan on an observed result belongs in an ordinary agent node.

## Edges

Delegation edges carry work from the root to a worker through registered prompt references.
A worker has one incoming delegation edge in this fixed graph form.
Keep the exact directive identity so recorded delivery can be traced to the text the worker received.
Spawns and steers consume delegation traversals; inspect exhaustion rather than assuming all requested work ran.

Analysis edges run after listed workers settle and route findings to their configured recipient.
The analyst is either a registered analysis function or a graph node with a complete profile.
An analyst node receives no ordinary delegation, and its id cannot also name a registered analysis function.
Analysis targets list delegated workers, not the root or other analysts.

Analysis traversal caps limit propagated findings; they do not stop the whole run.
Use the deliverable check or an appropriate execution limit to terminate work.
Analyst execution consumes the same shared budget as other workers.

Map edges fan out over a list that exists only at run time.
When the source node settles, the runtime reads the array at the edge's JSON pointer in its result and runs the item node once per element, with the element as its task, or runs the edge's graph per element the way `run_graph` does.
The join node then receives `{ results, failures }` in item order.
The driver spends no turn on items or the join and must not spawn them; item and join nodes are reachable only through their map edge.
`concurrency` throttles the items and never refuses one.
A list longer than `maxItems`, a pointer that does not select an array, or a `concurrency` above the run's worker slots is refused before any item runs, with a ledger row and a driver wake.
`onItemFailure: 'all-or-refuse'` starts no item after a failure and refuses the join with the failures listed; `'settled-subset'` runs every item and joins the delivered results beside the failures.
Each item reserves `itemBudget` from the shared budget.
Map state is process-local: a restarted run does not re-expand a map whose source settled before the restart.

Routes edges run a flow graph and need `entry`; a flow graph takes no delegation or analysis edge.
On each usable settle of `from`, its routes edges are tried in declaration order and the first whose `when` holds fires; one settle fires at most one edge.
`when` compares JSON scalars only (`equals`, `in`, `exists` at an RFC 6901 pointer, or `all` of several); a numeric or stateful rule is a field the node settles, such as a boolean or a counter.
A match reads `from` unless it names a node listed in the edge's `evidence`; a pointer that does not resolve does not match.
An edge without `when` is the default branch: at most one per node, and last.
A node target receives `{ from: { node, result }, evidence }` and the edge directive; `{ stop: reason }` ends the run with no winner; `{ finish: reason }` makes this settle part of the output.
The output is `{ [node]: latest usable result }` over terminal nodes (no outgoing routes or map edge) and finish sources, and the deliverable decides it.
Every routes cycle needs an edge with an explicit `maxTraversals`; an edge at its cap is skipped and matching continues, so give a repair loop a fallback edge.
`continuity: 'resume'` continues the target's latest settled session.
A map edge may leave any flow node, and its join may have routes edges.

## Check the result

Inspect delivered, stripped, empty, unpropagated, and failed edge records and their byte counts.
A map edge records one expansion row, one row per item with its index, and one join row.
A flow records one `routes:entry-><node>` row per entry and one `routes:<from>#<ordinal>-><target>` row per traversal, cap skip or refused spawn.
Read exhausted edges even when execution ended through completion, budget, or cancellation rather than a thrown error.
Check journal records when recovery or auditability is part of the task.
Preserve run, profile, directive, and artifact identity so a resumed or measured run cannot silently change its inputs.
