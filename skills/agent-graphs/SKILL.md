---
name: agent-graphs
description: Design factories and fixed AgentGraph roles, routes, delegation, checks and budgets.
---

# Agent Graphs

Use `runGraph` when roles are known before execution and their relationships must be explicit Runtime data.
When the order, branches, repair loops and stop rules are known too, author a flow graph: `entry` plus `routes` edges, with no root and no brain.
Parallel stages are a fork (`to` lists several nodes, spawned at once) and waiting for all of them is a join (`from` lists several nodes); converging plain routes into one running node throw `GraphRouteError` with reason `target-live`.
A loop per item is a flow graph inside a maps item, and a flow graph can run as a `run_graph` subtask.
A caller-decided branch can use a gate (`gates: [{ id, question, choices }]` with one routes edge per choice matching `/choice`), answered by `decideGate` while the run is held. For factory human review, end the run as described below.
Keep a root (delegation edges) only when a model must decide what runs next; a root brain that only orders fixed stages is the anti-pattern a flow graph replaces.
Use a smaller maintained composition when it provides the required behavior.
Use dynamic supervision when the agent must discover or create roles while working.
A request for review alone does not require a graph.

Read the current [API decision table](https://github.com/tangle-network/agent-runtime/blob/main/docs/canonical-api.md), [AgentGraph contract](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/graph.ts), and a relevant [runnable example](https://github.com/tangle-network/agent-runtime/tree/main/examples/graphs).
These distinguish the fixed AgentGraph API from other graph or supervision contracts.

## Design a factory

Use the vocabulary from the [software-factory design reference](https://github.com/mattpocock/skills/pull/1316) when a consumer needs recurring work across graph executions.
A **task** defines repeatable work, such as implementation or review, on a ticket, PR, or codebase.
A **run** is one execution of that task, including any graph nodes and agent sessions it needs.
A **trigger** starts a run; a **runner** supplies its execution environment.
Keep task identity stable across runs and record each run's own identity and result.

Name the product that owns each service slot before authoring the task's graph:

| Slot | Responsibility |
| --- | --- |
| Ticket tracker | Durable work requests, discussion, and human decisions |
| Ticket source | External feedback or signals that create tickets |
| Git host | Source revisions, branches, PRs, and reviews |
| Orchestrator | Admit triggers, start runs, and retain their status |
| Observability platform | Inspect run logs, traces, and failures; choose none explicitly if existing run pages suffice |

One product may fill several slots. Reuse each existing owner and its durable records.
Name the runner too; retain work and decisions through the owning services before its process exits.
An observability signal that should change work must reach the tracker or git host through an explicit task or ticket source.

Treat triggers as **accelerators** and checks as **brakes**.
Deterministic checks establish required behavior; independent automated review examines the change; human review supplies decisions and findings that improve both.
Honor the consumer's existing merge and release policy rather than adding approval gates.
Introduce automated triggers individually with an explicit throttle, such as a sampling rate, schedule, or concurrency cap; increase admission only after reviewing failures and accepted outcomes.
Bound repair cycles by attempts and budget, then record unresolved work for human review.

Factory runs never wait for a human.
Publish the question or review request durably and finish; a later human decision triggers a new run that reads that record.
An in-run graph gate holds execution and therefore does not implement this factory boundary.

Before implementation, answer for every task: what triggers it; which services it reads and writes; what runs next; where humans re-enter; and how overlapping runs avoid duplicate work.
For each ticket source, name how duplicate tickets are prevented.
The design is complete when every slot has an owner, every task has those answers, and trigger throttles and repair limits are explicit.

## Author the required relationships

Define the artifact and independent completion check before choosing roles.
Give each required role a complete AgentProfile and capabilities appropriate to its task.
Preserve requested parallel instances and independent reviewers rather than collapsing their distinct work into a root prompt.

When authoring nodes, directives, routes, traversal limits, or analyst routes, read [the graph contract](references/authoring.md).
The runtime validates structure and prompt references before execution.
Keep the shared budget, per-worker allocation, concurrency, and supported limits in their actual API fields.
Use measured execution cost when available; do not turn a prior run into a universal minimum budget.

## Prove the graph

Use the maintained example pattern with injected test execution to check routes, directives, traversal limits, and both successful and rejected completion.
Then exercise the intended backend, profiles, tools, and completion check on a real representative task.
Offline control-flow tests do not establish that a real agent solves the task.

Inspect the terminal result, complete cost and token accounting, edge delivery records, exhausted edges, and journal evidence.
An expected edge with zero traversals did not exercise its intended relationship, unless it is a branch the test chose not to take.
A flow run that ends early names why on `stopped`; a settle no routes edge matches throws `GraphRouteError` with the ledger.
Each gate visit is one `gate:<id>` ledger row whose `gate.by` names who decided.
Unknown usage is missing evidence, not zero cost.
A passing check proves only the outcome it actually tests.

When measuring a proposed change to this skill, read [measurement](references/measurement.md) before reusing its historical cases or results.
Ordinary graph construction does not require an optimization campaign.

## Then consider

- `loop-writer` when a required dynamic policy cannot be expressed through existing Runtime APIs.
- `verify` when the real task works and publishing or consumer integration checks remain.
