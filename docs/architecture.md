# Architecture

Agent Runtime separates an agent's portable definition from the service that executes it and from the policy that decides how many turns or workers to run.

## Package Boundaries

```text
AgentProfile
    |
    v
AgentEnvironmentProvider
    |
    v
AgentEnvironment
    |
    v
Runtime policy
```

`AgentProfile` comes from `@tangle-network/agent-interface`.
It contains prompts, models, tools, skills, MCP servers, permissions, hooks, and subagents.

`AgentEnvironmentProvider` validates a profile and creates an `AgentEnvironment`.
The provider owns service-specific authentication, placement, process execution, workspace access, and session continuation.

Runtime policies use environments without branching on provider names.
Applications construct providers and choose a policy.

## Execution Policies

| Policy | Use |
|---|---|
| `streamAgentTurn` | One streamed response |
| `openEnvironmentRun` | One persistent agent across several turns |
| `runInteraction` | A known set of actors taking turns |
| `runAgentRounds` | Application-planned batches of work |
| `supervise` | Model-directed worker creation and steering |
| `runStrategy` | A fixed search or refinement procedure |
| `runToolLoop` | A model calling local tools in one process |

These functions do not define different kinds of agents.
They apply different control policies to the same profile and provider contracts.

## Lifecycle Ownership

The caller must know who owns each environment.

- A one-turn provider input creates and destroys its environment inside Runtime.
- A caller-supplied environment remains caller-owned.
- `openEnvironmentRun` owns its environment until `close()`.
- `runInteraction` owns actor environments for the run and records continuation IDs in its journal.
- Supervisor executors own worker cleanup and report final usage.

Cleanup is idempotent because cancellation and normal completion can race.

## Persistent State

Provider sessions, interactions, and dynamic worker trees have different state models.

- Provider session IDs continue one model context.
- `InteractionJournal` stores fixed actors and ordered turns.
- Supervisor journals store changing parent-child relationships, commands, and results.

Do not substitute one store for another.
A distributed implementation must add atomic ownership and deduplication to the relevant store.

## Evaluation And Improvement

Runtime delegates measurement to `@tangle-network/agent-eval`.
The `improve` entry point runs proposed profile or code changes, records each attempt, selects on development cases, and confirms the selected change on held-back cases.

Code candidates use isolated worktrees.
Profile candidates remain data until the application activates one.
Runtime never treats a candidate's own explanation as proof that it improved behavior.

## Knowledge

`@tangle-network/agent-knowledge` owns ingestion, indexing, retrieval, memory adapters, freshness, and knowledge evaluation.
It accepts callbacks for research or content generation and never imports Runtime.

Runtime owns the optional agent-driven composition.
`runKnowledgeImprovementJob` can run an agent to propose changes, then returns a reviewable candidate for Knowledge to validate and for the application to activate.

## Public Modules

- `@tangle-network/agent-runtime` contains common entry points.
- `/loops` contains execution policies and environment utilities.
- `/interaction` contains named-actor interactions and journals.
- `/agent` contains profile execution and improvement-path helpers.
- `/intelligence` contains run recording and approved-context delivery.
- `/mcp` contains delegation tools and servers.
- `/candidate-execution` contains isolated code-candidate execution.
- `/primeintellect` contains Prime Intellect adapters.
- `/testing` contains deterministic test utilities.

Generated signatures are in [`api`](./api/).

## Design Rules

1. Add a new provider when another service owns execution.
2. Add a new policy only when current composition cannot express the required flow.
3. Keep credentials and deployment policy out of profiles.
4. Reject unsupported capabilities before starting work.
5. Preserve event order, failure details, and measured usage.
6. Keep activation separate from proposal and evaluation.
7. Remove obsolete public paths and update first-party consumers in the same release.
