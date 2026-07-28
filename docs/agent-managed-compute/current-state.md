# Agent-Managed Compute Audit (2026-07-18)

> This is a dated audit record, not the current package manifest.
> Check `package.json` and the generated API docs for the release in your checkout.

## Tested Baseline

On 2026-07-18, the release candidate passed all 148 runtime test files with 1,558 active tests and 2 skips, plus build, source and example type checks, packed-package verification, documentation checks, and all 25 agent-bench TypeScript files plus its Pier bridge.

The tested package set was `agent-runtime` 0.97.0, `agent-knowledge` 4.1.0, `agent-eval` 0.122.8, `agent-interface` 0.31.0, and `sandbox` 0.11.1 from the locked install.

The full suite includes these focused local coordination files:

```bash
pnpm exec vitest run \
  tests/kernel/coordination-mcp.test.ts \
  tests/kernel/supervisor-agent.test.ts \
  tests/kernel/coordination.test.ts \
  tests/kernel/event-bus.test.ts \
  tests/mcp/task-queue-durable.test.ts \
  src/runtime/environment-provider.test.ts
```

Those tests establish that the local primitives work.

They do not establish distributed recovery, secure remote use, or production performance.

## What Exists

| Area | Implementation | Honest capability |
|---|---|---|
| Recursive execution | `src/runtime/supervise/types.ts`, `scope.ts`, `supervisor.ts` | A driver can start child agents recursively under one budget and depth limit. |
| Agent-facing coordination | `src/mcp/tools/coordination.ts` | A driver can call `spawn_agent`, `observe_agent`, `steer_agent`, `await_event`, `ask_parent`, and `stop`. |
| Native MCP transport | `src/runtime/supervise/coordination-mcp.ts` | A local agent runner can call coordination actions over HTTP. |
| Driver reasoning | `src/runtime/supervise/coordination-driver.ts` | A model can choose coordination actions dynamically. |
| Child execution | `Executor` and `createExecutor` | Router, bridge, CLI, sandbox, worktree, and custom implementations share one execution contract. |
| Provider adapters | `src/runtime/environment-provider.ts` | External environment providers can be adapted into the runtime. |
| Tree records | `SpawnJournal` and `ResultBlobStore` | Completed child decisions and content-addressed outputs can be replayed for inspection. |
| Conversation records | `ConversationJournal` | A single conversation writer can resume from committed turns. |
| Async delegation records | `DelegationTaskQueue` | A one-shot task can persist status and reconnect to a detached session when configured. |
| Workspace isolation | `src/runtime/workspace.ts`, worktree executors | Parallel coding agents can work in isolated checkouts and return commits or patches. |

## Critical Findings

### 1. A supervised tree does not resume

`Supervisor.run` always begins the tree, appends a new root event, and calls `root.act` from the start.

It never loads the prior tree to recover active children or the driver's prior decision state.

See `src/runtime/supervise/supervisor.ts:68` and `src/runtime/supervise/supervisor.ts:75`.

A direct probe ran the same `runId` twice against the same journal.

The root executed twice and the journal contained two root spawn events:

```json
{"calls":2,"first":"winner","second":"winner","rootSpawnEvents":2}
```

`replaySpawnTree` reconstructs completed settlements for analysis.

It is not coordinator recovery.

Any document that calls the current supervised tree resumable is overstating the implementation.

### 2. Delegation idempotency is process-local

`DelegationTaskQueue.submit` checks only its local `byIdempotencyKey` map.

It does not atomically claim the key in `DelegationStore`.

See `src/mcp/task-queue.ts:306` and `src/mcp/delegation-store.ts:24`.

Two queue instances sharing one store both accepted the same key:

```json
{"a":{"taskId":"a","reused":false},"b":{"taskId":"b","reused":false}}
```

This permits duplicate remote work and duplicate side effects after concurrent submission or failover.

### 3. The coordination MCP is not safe to expose remotely

`serveCoordinationMcp` accepts arbitrary HTTP POST requests and invokes tools without authenticating the caller or binding it to a run.

See `src/runtime/supervise/coordination-mcp.ts:92`.

It also accepts an unbounded request body and exposes a configurable host.

Binding to `127.0.0.1` is a useful default, but it is not a remote security model.

### 4. Coordination events disappear with the coordinator process

`createEventBus` stores its queue, history, sequence, and subscribers in memory.

See `src/runtime/supervise/event-bus.ts:76`.

The `history()` method is an in-memory log, not a durable record.

A coordinator restart loses unread questions, findings, and steering history.

### 5. There are three independent records of a run

Supervised trees use `SpawnJournal`.

Conversations use `ConversationJournal`.

One-shot delegation uses `DelegationStore`.

Each has different identifiers, state transitions, recovery behavior, and concurrency assumptions.

The duplication makes cross-feature recovery and cost accounting unreliable.

## High Findings

### 6. The historical live proof is not an acceptance test

`bench/src/atom-mcp-e2e.mts` is useful exploratory code, but it cannot support a current production claim.

The script asks the supervisor to call `spawn_worker`, while the current MCP exports `spawn_agent`.

See `bench/src/atom-mcp-e2e.mts:178` and `src/mcp/tools/coordination.ts:473`.

The script prints a failed verdict without setting a failing process exit code.

See `bench/src/atom-mcp-e2e.mts:212`.

It records zero tokens and zero cost for real model-backed worker calls.

See `bench/src/atom-mcp-e2e.mts:136`.

It also describes local worktree and bridge execution as real boxes, which is not what the code runs.

No raw run artifact is committed with the script.

The historical commit proves that someone ran a useful experiment.

It does not prove that the current branch passes a live distributed scenario.

### 7. Cancellation records intent, not confirmed termination

`DelegationTaskQueue.cancel` marks a task `cancelled` even when the underlying runner ignores the abort signal and continues producing effects.

See `src/mcp/task-queue.ts:362`.

For remote compute, cancellation must distinguish `cancel_requested` from confirmed `cancelled`.

### 8. Steering support depends on the executor

`Scope.send` succeeds only when the active executor implements `deliver`.

Router tools, bridge sessions, and bridge worktree executors do.

The one-shot sandbox executor does not provide the same mid-run control.

The capability must be reported before the driver chooses a policy that depends on live steering.

### 9. The public run model is fragmented

`runConversation` owns a separate turn loop and journal.

`runPersonified` and `runAgentic` build policies over `Supervisor`.

`runLoop` is a sandbox-specific round engine.

`supervise` is the dynamic driver path.

These are legitimate behaviors, but they are presented as unrelated entry points instead of policy choices over shared execution state.

## Medium Findings

### 10. File persistence is single-process infrastructure

`FileDelegationStore` rewrites the full record set for each mutation.

`FileSpawnJournal` scans the full JSONL file before appending and has no cross-process compare-and-set.

These implementations are appropriate for local runs and tests.

They must not be presented as distributed stores.

### 11. Conversation resume assumes one writer

The conversation journal correctly resumes committed turns, but its documentation explicitly forbids multiple drivers writing the same `runId`.

See `docs/durability-adapters.md:206`.

That is a good constraint and should become an enforced ownership rule rather than an application warning.

### 12. Current tests stop at the process boundary

The real HTTP test proves HTTP to MCP to `Scope.spawn`.

Its worker is an in-memory test executor.

The provider tests prove adapter behavior with local fakes.

There is no automated test that kills a coordinator, reconnects to a real remote session, rejects duplicate commands, and completes the same run.

### 13. Package layering and direct release lines are aligned

At the time of this audit, the `agent-knowledge` main branch had no dependency or source import from `agent-runtime`.

`agent-runtime` now owns the batteries-included composition through `src/knowledge/improvement-job.ts`.

That is the intended dependency direction and removes the former package cycle.

The audited runtime manifest required `agent-knowledge` `^4.1.0`, developed against `agent-eval` 0.122.8, and exposed matching peer ranges for `agent-eval`, `agent-interface`, and `sandbox`.

Older copies may still appear inside transitive dependencies that own their contracts internally.
The direct runtime edges share the current public contract versions.

Future dependency changes must update the manifest, lockfile, compatibility tests, and generated API reference together.

## Decision

Keep the recursive execution model and provider adapter design.

Do not scale the current MCP server or task queue directly.

First unify logical run state and restart recovery, then make MCP a secure remote view of that state.
