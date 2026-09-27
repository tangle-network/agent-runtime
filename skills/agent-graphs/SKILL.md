---
name: agent-graphs
description: Author fixed AgentGraph roles with explicit delegation, analysis, completion, and budgets.
---

# Agent Graphs

Use `runGraph` when roles are known before execution and their relationships must be explicit Runtime data.
Use a smaller maintained composition when it provides the required behavior.
Use dynamic supervision when the agent must discover or create roles while working.
A request for review alone does not require a graph.

Read the current [API decision table](https://github.com/tangle-network/agent-runtime/blob/main/docs/canonical-api.md), [AgentGraph contract](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/graph.ts), and a relevant [runnable example](https://github.com/tangle-network/agent-runtime/tree/main/examples/graphs).
These distinguish the fixed AgentGraph API from other graph or supervision contracts.

## Author the required relationships

Define the artifact and independent completion check before choosing roles.
Give each required role a complete AgentProfile and capabilities appropriate to its task.
Preserve requested parallel instances and independent reviewers rather than collapsing their distinct work into a root prompt.

When authoring nodes, directives, traversal limits, or analyst routes, read [the graph contract](references/authoring.md).
The runtime validates structure and prompt references before execution.
Keep the shared budget, per-worker allocation, concurrency, and supported limits in their actual API fields.
Use measured execution cost when available; do not turn a prior run into a universal minimum budget.

## Prove the graph

Use the maintained example pattern with injected test execution to check routes, directives, traversal limits, and both successful and rejected completion.
Then exercise the intended backend, profiles, tools, and completion check on a real representative task.
Offline control-flow tests do not establish that a real agent solves the task.

Inspect the terminal result, complete cost and token accounting, edge delivery records, exhausted edges, and journal evidence.
An expected edge with zero traversals did not exercise its intended relationship.
Unknown usage is missing evidence, not zero cost.
A passing check proves only the outcome it actually tests.

When measuring a proposed change to this skill, read [measurement](references/measurement.md) before reusing its historical cases or results.
Ordinary graph construction does not require an optimization campaign.

## Then consider

- `loop-writer` when a required dynamic policy cannot be expressed through existing Runtime APIs.
- `verify` when the real task works and publishing or consumer integration checks remain.
