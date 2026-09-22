# Agent-Managed Compute

Agent-managed compute means a model can create, steer, observe, and stop worker agents while one shared budget limits the whole tree.

## Current API

Use `supervise` for dynamic worker creation.
The root agent receives coordination tools and decides what workers to start based on the task and intermediate results.

Use `runInteraction` when the participants and turn order are known before the run starts.
Each interaction actor keeps its own environment and session.

Use `runAgentRounds` when application code plans each bounded batch.
Use `runStrategy` when a fixed search or refinement policy fits the task.

These are distinct policies over the same `AgentProfile` and `AgentEnvironmentProvider` contracts.

## Responsibility Split

Runtime owns:

- worker identity and parent-child relationships;
- shared token, cost, iteration, depth, and time limits;
- cancellation, steering, completion, and result records;
- persistent journals for local restart recovery;
- provider-neutral environment creation.

Providers own:

- machines, containers, and sessions;
- placement and process health;
- workspace, checkpoint, and fork capabilities;
- provider authentication and resource limits.

Applications own:

- user authorization and billing policy;
- database choice and concurrent ownership rules;
- domain tools and completion checks;
- activation of any proposed change.

## Recovery Boundaries

`FileSpawnJournal` and `FileResultBlobStore` support local process restart.
They do not provide concurrent coordinator ownership.
A distributed deployment must supply storage with atomic ownership and deduplication before two coordinators may resume the same run.

`InteractionJournal` is separate because fixed actors taking turns have different state from a dynamic worker tree.

## Required Behavior

A production integration must:

1. pass one shared budget to the full worker tree;
2. reject work that would exceed depth or budget before starting it;
3. use stable command and run identifiers for retries;
4. persist accepted state before acknowledging it;
5. propagate cancellation to every live worker;
6. return one explicit terminal result;
7. destroy owned environments in failure paths;
8. record provider usage instead of estimating missing cost.

The runnable coordination tests under `tests/loops` cover local behavior.
Provider packages own remote execution conformance tests.
