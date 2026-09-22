# agent-runtime

`agent-runtime` executes portable `AgentProfile` values through an `AgentEnvironmentProvider`.
It owns execution flow, cancellation, usage, multi-turn state, coordination, and improvement workflows.
It does not own provider credentials, product policy, domain tools, or evaluation definitions.

## Start Here

Read these before adding an execution wrapper:

1. [`README.md`](./README.md) for installation and the smallest working examples.
2. [`docs/concepts.md`](./docs/concepts.md) for the profile, provider, and environment model.
3. [`docs/canonical-api.md`](./docs/canonical-api.md) to choose an entry point.
4. [`docs/architecture.md`](./docs/architecture.md) for package ownership and internal boundaries.
5. [`docs/api`](./docs/api/) for generated signatures.

For benchmark work, read [`bench/README.md`](./bench/README.md).

## Dependency Direction

```text
agent-interface
      |
      +--> agent-eval
      +--> agent-knowledge
                |
                v
          agent-runtime
```

- `agent-interface` owns portable profiles and environment contracts.
- `agent-eval` owns cases, outcomes, comparisons, traces, and optimizer contracts.
- `agent-knowledge` owns sources, indexes, retrieval, memory adapters, and knowledge evaluation.
- `agent-runtime` composes those packages into running workflows.

Lower packages must not import Runtime.
Move a portable contract down or inject behavior through a callback instead.

## API Rules

- An agent is an `AgentProfile`.
- Execution is supplied by an `AgentEnvironmentProvider`.
- Provider configuration belongs at the application boundary, never in a profile.
- Use `streamAgentTurn` for one turn and `openEnvironmentRun` for a persistent session.
- Use `runInteraction` for a known set of actors taking turns.
- Use `runAgentRounds` when application code plans bounded batches.
- Use `supervise` when a model creates and steers workers dynamically.
- Use `runStrategy` for a fixed search or refinement policy.
- Use `improve` to evaluate proposed profile or code changes.
- Use `runKnowledgeImprovementJob` to produce reviewable knowledge-base changes.

Do not preserve a removed API with aliases or adapters inside this package.
There are no external legacy consumers to protect.
Change first-party consumers in the same release.

## Code Map

- `src/runtime/environment-*.ts` owns environment creation, turns, continuation, branching, and cleanup.
- `src/runtime/run-loop.ts` implements `runAgentRounds`.
- `src/runtime/supervise/` implements dynamic worker coordination and shared budgets.
- `src/interaction/` implements persistent named-actor interactions.
- `src/improvement/` composes Runtime execution with Agent Eval optimizers.
- `src/knowledge/` composes Runtime agents with Agent Knowledge callbacks.
- `src/intelligence/` records runs and supplies approved context.
- `src/mcp/` exposes delegation tools to external agents.
- `bench/` is the separately published `@tangle-network/agent-bench` package.

## State Ownership

- Provider sessions retain model context.
- Interaction journals retain fixed-actor turns across process restarts.
- Supervisor journals retain dynamic worker state.
- Agent Eval stores evaluation and optimization records.
- Agent Knowledge stores knowledge and memory state.
- Applications own users, billing, authorization, and activation decisions.

Do not combine these stores because their concurrency and identity rules differ.

## Commands

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm run verify:package
pnpm run docs:check
```

Use `pnpm run verify:bench` when Runtime changes affect `@tangle-network/agent-bench`.

## Local Rules

- Fail when a required capability or result is missing.
- Keep provider errors and usage data intact.
- Close owned environments in every completion and failure path.
- Compare agent changes on the same cases and resource limits.
- Keep generated API docs generated.
- Do not add historical implementation narratives to source comments.
- Do not add tool attribution to commits or pull requests.
