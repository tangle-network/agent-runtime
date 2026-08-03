# Agent-Managed Compute

This directory is the canonical plan for agents that allocate, steer, and recover compute through `agent-runtime`.

## Verdict

The repository is on the right architectural track, but it is not yet a distributed coordination system.

The core execution model is sound:

- An `AgentProfile` describes the agent.
- A `Scope` lets a driver spawn, observe, steer, and stop children.
- A `Supervisor` owns the shared budget and child lifecycle.
- An `Executor` runs one child on a selected backend.
- An `AgentEnvironmentProvider` exposes external compute and resumable sessions.
- MCP exposes coordination actions to an agent runner as native tools.

The missing work is operational, not conceptual.

Coordination state is currently process-local, supervised trees do not resume after coordinator restart, the HTTP MCP endpoint has no authentication, and the public run APIs overlap.

## Product Definition

Agent-managed compute means an agent may decide at runtime to:

1. do work itself,
2. start one or more child agents,
3. choose their profiles and compute providers,
4. inspect progress and outputs,
5. send corrections or follow-up instructions,
6. stop or replace work that is failing,
7. preserve useful state across process failure,
8. finish only when an independent check accepts the result.

The runtime manages logical work, budgets, recovery, and records.

Compute providers manage machines, containers, sessions, process health, and placement.

MCP is the tool-facing control adapter.

MCP is not the scheduler or durable state store.

## Documents

| Document | Purpose |
|---|---|
| [current-state.md](./current-state.md) | What is implemented, what was tested, and what is only claimed. |
| [architecture.md](./architecture.md) | The converged execution model, package ownership, and target public API. |
| [reliability.md](./reliability.md) | Failure behavior, recovery rules, security, concurrency, and workspace safety. |
| [roadmap.md](./roadmap.md) | Dependency-ordered implementation plan with completion criteria. |
| [validation.md](./validation.md) | Tests, failure injection, live-provider runs, and benchmark acceptance targets. |

These six files are the only active planning documents for this effort.

The broader [runtime architecture](../architecture.md), [call-routing protocol](../agent-bus-protocol.md), [environment-provider implementation record](../research/environment-provider-adapter-spec.md), [context-lifecycle research](../research/smart-loops-context-lifecycle.md), and [interactive-session proposal](../research/interactive-sessions-spec.md) remain source references.

When a source reference conflicts with this directory about distributed readiness or implementation order, this directory wins.

The older [simplification tracker](../research/simplification-plan.md) is historical and is superseded by [roadmap.md](./roadmap.md) for execution and API convergence.

## Source Document Ledger

This table tracks the existing documents that materially overlap this plan.

| Document | Classification | Use |
|---|---|---|
| [Runtime architecture](../architecture.md) | Current reference | Recursive agent model and package-wide architecture. |
| [Canonical API](../canonical-api.md) | Current reference | Shipped entry points and anti-duplication guidance. |
| [Execution model](../execution-model.md) | Current reference | Existing executor and driver behavior. |
| [Agent bus protocol](../agent-bus-protocol.md) | Current reference | Call-routing headers and depth controls. It is not durable coordination state. |
| [Durability adapters](../durability-adapters.md) | Current reference | Conversation persistence only. It does not provide supervised-tree recovery. |
| [Environment provider adapter](../research/environment-provider-adapter-spec.md) | Current source | Provider contract and adapter implementation history. |
| [Context lifecycle](../research/smart-loops-context-lifecycle.md) | Current source | Long-run context and knowledge transfer research. |
| [Interactive sessions](../research/interactive-sessions-spec.md) | Historical input | Session UX and tmux exploration. Its completion checklist is not current acceptance evidence. |
| [Long-horizon agent map](../research/long-horizon-agent-map.md) | Historical input | Earlier product and control design. |
| [RSI atom masterplan](../research/rsi-atom-masterplan.md) | Historical input | Earlier recursive-agent build plan. |
| [Simplification plan](../research/simplification-plan.md) | Superseded plan | Earlier API and module inventory. |
| [`atom-mcp-e2e.mts`](../../bench/src/atom-mcp-e2e.mts) | Historical experiment | Useful prototype with stale tool names and incomplete result accounting. |

## Status Summary

| Capability | Current status | Evidence |
|---|---|---|
| Agent calls coordination actions through real HTTP MCP | Implemented in one process | `tests/kernel/coordination-mcp.test.ts` |
| Driver dynamically spawns, waits for, and selects children | Implemented | `tests/kernel/coordination-driver.test.ts` |
| Recursive driver starts another driver | Implemented | `tests/kernel/coordination-driver.test.ts` |
| Shared budget and depth limits across a tree | Implemented | `src/runtime/supervise/budget.ts`, `src/runtime/supervise/scope.ts` |
| Provider-neutral compute adapter | Implemented | `src/runtime/environment-provider.ts` |
| One-shot delegation restart recovery | Partially implemented | `src/mcp/task-queue.ts` |
| Conversation turn restart recovery | Implemented for one writer | `src/conversation/run-conversation.ts` |
| Supervised tree restart recovery | Not implemented | `src/runtime/supervise/supervisor.ts` |
| Durable cross-process coordination messages | Not implemented | `src/runtime/supervise/event-bus.ts` |
| Authenticated remote coordination MCP | Not implemented | `src/runtime/supervise/coordination-mcp.ts` |
| Concurrent coordinator failover | Not implemented | Current file stores have no compare-and-set or ownership claim. |
| One simple multi-round public API | Not implemented | `runConversation`, `runPersonified`, `runAgentic`, and `runAgentRounds` overlap. |
| Acyclic runtime and knowledge packages | Implemented | `agent-knowledge` imports no runtime code; `agent-runtime` owns the optional composition in `src/knowledge/`; direct release lines align, while transitive packages may retain internal copies. |

## Scope Boundaries

This work must not turn `agent-runtime` into a machine scheduler.

Use existing provider systems for compute allocation and process lifecycle.

This work must not put knowledge policy into the runtime.

`agent-knowledge` remains the general knowledge engine, and an agent may use it as a tool or work product during a run.

This work must not create another profile format.

`AgentProfile` remains the portable description of agent behavior.

This work must not promise exactly-once network delivery.

It must provide idempotent commands, deduplicated events, and one accepted terminal result.
