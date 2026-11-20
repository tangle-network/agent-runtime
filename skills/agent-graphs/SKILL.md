---
name: agent-graphs
description: Design factories and fixed AgentGraph roles, routes, delegation, checks and budgets.
---

# Agent Graphs

An excellent graph beats the best known result for its task, from a single agent or a published workflow, at equal measured cost, and a real run traverses every edge it declares.

## Set the bar

Before choosing roles, [set the bar](https://github.com/drewstone/dotfiles/blob/main/claude/skills/be-ambitious/SKILL.md#set-the-bar): the best known result for this task class with its source (the strongest design in [Factory's catalog](https://github.com/tangle-network/factory/blob/main/README.md), the registry's best run for this task digest, or a published multi-agent workflow for the same task) beside our number, the current graph's or single agent's accepted-result rate and cost per accepted result.
Target a number that beats it through a change of topology (independent proposers with a referee, a verifier route, a bounded repair loop), not more retries, and name the outside check: the deliverable's completion check on a real task, which the graph's agents cannot edit.
The graph is finished when that check shows the target met or the measured gap and its cause explain the miss; loader and topology admission are necessary, not sufficient.

## Choose the composition

Use `runGraph` when roles are known before execution and their relationships must be explicit Runtime data.
When the order, branches, repair loops and stop rules are known too, author a flow graph: `entry` plus `routes` edges, with no root and no brain.
Parallel stages are a fork (`to` lists several nodes, spawned at once) and waiting for all of them is a join (`from` lists several nodes); converging plain routes into one running node throw `GraphRouteError` with reason `target-live`.
A loop per item is a flow graph inside a maps item, and a flow graph can run as a `run_graph` subtask.
A caller-decided branch can use a gate (`gates: [{ id, question, choices }]` with one routes edge per choice matching `/choice`), answered by `decideGate` while the run is held; factory human review ends the run instead, as below.
Keep a root (delegation edges) only when a model must decide what runs next; a root brain that only orders fixed stages is the anti-pattern a flow graph replaces.
Use dynamic supervision when the agent must discover or create roles while working, and a maintained composition when it already provides the required behavior.
A graph earns its place by beating the best single agent on the target; a request for review alone does not need one.

Read the current [API decision table](https://github.com/tangle-network/agent-runtime/blob/main/docs/canonical-api.md), [AgentGraph contract](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/graph.ts) and a relevant [runnable example](https://github.com/tangle-network/agent-runtime/tree/main/examples/graphs).

## Graph files and placement

Keep one canonical YAML or JSON graph file; Runtime's `loadGraphFile` owns parsing, parameters, profiles, topology and digest generation, and the designer authors data rather than another parser or runner.
The consumer supplies Bridge-owned seat resolution and connection bindings.
Qualify the file with the existing `graph run --dry-run` consumer, repair its concrete diagnostics, then run that same file through the admitted execution path.
Read the installed CLI help for accepted options and the current loader contract for supported expressions and vertices; proposed later milestones are not executable capabilities.

One Sandbox hosts the graph run, and Bridge executes its agent nodes through their complete materialized profiles; parallel nodes share that Sandbox through the supported Bridge sessions, and the local path uses the same transport against its caller-owned workspace.
Backend placement, authentication and environment lifecycle stay in the consumer's existing runtime composition.

## Design a factory

Use the vocabulary from the [software-factory design reference](https://github.com/mattpocock/skills/pull/1316) when a consumer needs recurring work across graph executions.
A **task** defines repeatable work, such as implementation or review, on a ticket, PR, or codebase; a **run** is one execution of it, with any graph nodes and agent sessions it needs.
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

One product may fill several slots; reuse each existing owner and its durable records.
Name the runner too, and retain work and decisions through the owning services before its process exits.
An observability signal that should change work reaches the tracker or git host through an explicit task or ticket source.

Triggers are **accelerators** and checks are **brakes**: deterministic checks, independent automated review, then human decisions.
Honor the consumer's existing merge and release policy rather than adding approval gates.
Introduce automated triggers one at a time with an explicit throttle (a sampling rate, schedule, or concurrency cap), and raise admission after reviewing failures and accepted outcomes.
Bound repair cycles by attempts and budget, then record unresolved work for human review.

Factory runs never wait for a human: publish the question or review request durably and finish, and a later human decision triggers a new run that reads that record.
An in-run graph gate holds execution, so it does not implement this boundary.

For every task, answer what triggers it, which services it reads and writes, what runs next, where humans re-enter, and how overlapping runs avoid duplicate work; for each ticket source, how duplicate tickets are prevented.
The design is complete when every slot has an owner, every task has those answers, and trigger throttles and repair limits are explicit.

## Author the required relationships

Give each required role a complete AgentProfile and the capabilities its task needs.
Preserve requested parallel instances and independent reviewers rather than collapsing their distinct work into a root prompt.
When authoring nodes, directives, routes, traversal limits, or analyst routes, read [the graph contract](https://github.com/tangle-network/agent-runtime/blob/main/skills/agent-graphs/references/authoring.md); the runtime validates structure and prompt references before execution.
Keep the shared budget, per-worker allocation, concurrency, and supported limits in their API fields, sized from measured execution cost; a prior run is not a universal minimum budget.

## Prove the graph against the bar

Check profiles, routes, directives and traversal limits with the maintained loader and topology admission before model execution.
Then run the intended Bridge backend, profiles, tools and the outside check on a real representative task, including a rejected completion, and compare result and cost with the bar; offline control-flow tests do not show that a real agent solves the task.
Inspect served model identity, native usage, transcripts, cost and token accounting, edge delivery records, exhausted edges and the journal.
An expected edge with zero traversals did not exercise its relationship, unless it is a branch the test chose not to take.
A flow run that ends early names why on `stopped`; a settle no routes edge matches throws `GraphRouteError` with the ledger; each gate visit is one `gate:<id>` ledger row whose `gate.by` names who decided.
Unknown usage is missing evidence, not zero cost, and a passing check proves only the outcome it tests.
When measuring a proposed change to this skill, read [measurement](https://github.com/tangle-network/agent-runtime/blob/main/skills/agent-graphs/references/measurement.md) before reusing its historical cases or results.

## Then consider

- `loop-writer` when a required dynamic policy cannot be expressed through existing Runtime APIs.
- `evolve` when the graph must climb a measured target across generations.
- `verify` when the real task meets the target and publishing or consumer integration checks remain.
