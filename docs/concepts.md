# Concepts

Agent Runtime runs portable agent profiles through pluggable execution providers.

## The Model

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
turns, sessions, interactions, rounds, supervision, improvement
```

### AgentProfile

An `AgentProfile` says how an agent should behave.
It can include prompts, models, tools, skills, MCP servers, permissions, hooks, and subagents.
It does not contain API keys, service URLs, or deployment policy.

### AgentEnvironmentProvider

An `AgentEnvironmentProvider` says where and how a profile runs.
Examples include Tangle Sandbox, CLI Bridge, a trusted local process, or a test callback.
The provider reports its capabilities and creates environments.

### AgentEnvironment

An `AgentEnvironment` is one live workspace and execution context.
It can stream turns and may support session continuation, file access, commands, checkpoints, or forks.
The provider owns the implementation.
The Runtime caller owns or delegates cleanup explicitly.

## Execution Levels

Use the lowest level that matches the job.

1. `streamAgentTurn` runs one response.
2. `openEnvironmentRun` keeps one agent session alive across turns.
3. `runInteraction` gives each named actor a persistent session and passes the transcript between them.
4. `runAgentRounds` lets deterministic driver code plan bounded batches of work.
5. `supervise` lets a model create, steer, and stop workers dynamically.
6. `runStrategy` runs a fixed search or refinement policy against a task environment.

These functions share providers and profiles.
They are different control policies, not different definitions of an agent.

## State And Resume

Provider sessions preserve model context within an environment.
An interaction journal preserves actor identities, completed turns, and the stop result across process restarts.
The journal never recreates a changed interaction definition silently: callers provide a stable `definitionId`, and a mismatch fails.

Supervisor state uses its own spawn journal because a dynamic worker tree is not a turn-taking transcript.
Do not use the interaction journal as a worker-tree store.

## Knowledge And Memory

Knowledge is input to an agent, not a second execution system.
Agent Knowledge owns source ingestion, indexing, retrieval, memory adapters, freshness, and evaluation.
Runtime can call Knowledge workflows and can run agents that propose knowledge changes.
Applications decide which knowledge is mounted into a profile or exposed through tools.

## Evaluation And Improvement

Agent Eval measures behavior on cases and compares candidates.
Runtime's `improve` function connects those measurements to executable changes:

- profile fields use an optimizer supplied by Agent Eval;
- repository code runs in isolated worktrees;
- every candidate is measured on development cases;
- the selected candidate is checked on held-back cases;
- the result is returned for explicit activation.

Improvement does not mutate a live profile or knowledge base automatically.
Promotion is a separate application decision.

See [`canonical-api.md`](./canonical-api.md) for entry-point selection and [`docs/api`](./api/) for generated signatures.
