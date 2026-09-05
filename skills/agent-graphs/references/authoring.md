# AgentGraph authoring contract

Use the current [graph types and validation](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/graph.ts) for exact fields.
Start from a matching [example](https://github.com/tangle-network/agent-runtime/tree/main/examples/graphs) rather than copying a second graph runner.

## Nodes and work

AgentGraph requires nodes, edges, a deliverable, and a shared budget.
Each node holds an id and a canonical AgentProfile; its profile name matches the node id for routing.
Standing roles belong in the profile prompt, with explicit tools and resources.
Put the concrete mission in the deliverable description and supply an independent completion check that rejects incomplete output.

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

## Check the result

Inspect delivered, stripped, empty, and unpropagated edge records and their byte counts.
Read exhausted edges even when execution ended through completion, budget, or cancellation rather than a thrown error.
Check journal records when recovery or auditability is part of the task.
Preserve run, profile, directive, and artifact identity so a resumed or measured run cannot silently change its inputs.
