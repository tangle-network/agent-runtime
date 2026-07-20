# Reliability And Security

## Required Invariants

The implementation is complete only when all of these hold:

1. One logical invocation has at most one accepted terminal result.
2. Retried commands do not start duplicate physical work.
3. Provider events may be delivered more than once without duplicating effects.
4. A stale coordinator cannot commit after ownership moves to another process.
5. Every accepted child has a parent, profile reference, budget, provider reference, and output reference.
6. Actual reported spend is never replaced with fabricated zero usage.
7. Cancellation is not terminal until the provider confirms termination or the runtime reports it as uncertain.
8. A coordinator restart does not discard acknowledged questions, steering actions, or accepted outputs.
9. An unauthenticated or cross-run caller cannot invoke coordination actions.
10. Parallel workspace writes cannot silently overwrite one another.

## Delivery Semantics

Network messages are at least once.

Commands and events require stable identities:

```text
runId
invocationId
commandId
commandSequence
providerEnvironmentId
providerSessionId
providerEventId
coordinatorGeneration
```

The runtime deduplicates commands by `(runId, commandId)`.

The runtime deduplicates provider events by `(invocationId, providerEventId)`.

Provider mutations are emitted from a durable command outbox.

Each mutation carries `(invocationId, coordinatorGeneration, commandSequence)`.

The provider adapter or its session broker rejects any generation below the highest accepted generation and any repeated sequence with different content.

A database ownership claim without this external fencing is insufficient because a partitioned old coordinator may still send a late steer or cancel.

Acceptance is a compare-and-set transition from nonterminal state to one terminal state.

Duplicate terminal events return the recorded result when identical and fail loudly when inconsistent.

## Run Ownership

The durable store must support:

```ts
claimRun(runId, ownerId, ttlMs)
renewRun(runId, ownerId, generation, ttlMs)
append(runId, generation, expectedRevision, events)
read(runId, afterRevision)
releaseRun(runId, ownerId, generation)
```

The exact public storage API may differ.

The required semantics may not.

An expired owner may continue running in memory, but its next durable append must fail.

Its next provider mutation must also fail at the provider adapter or session broker.

The new owner then reconnects to provider sessions recorded before the failure.

## Invocation States

```text
planned
  -> dispatching
  -> running
  -> cancel_requested
  -> completed | failed | cancelled | lost
```

`dispatching` is durable before the external provider call.

The provider creation call uses `invocationId` as its idempotency key.

`running` includes the environment and session references needed for reconnect.

`cancel_requested` means the command was sent but termination is not yet confirmed.

`lost` means the provider can no longer find the environment and no accepted result exists.

The runtime must not rewrite `lost` as successful or retry the effect silently.

## Recovery Procedure

After coordinator restart:

1. acquire run ownership with a higher generation,
2. replay durable run events from the last snapshot,
3. rebuild budget reservations and accepted spend,
4. list nonterminal invocations,
5. reconnect through the recorded provider and environment ids,
6. replay provider events from each recorded event cursor,
7. reconcile any terminal provider status,
8. resume the driver from durable interaction state,
9. start new work only after reconciliation completes.

An independent cleanup process periodically lists provider resources by run and invocation metadata, adopts known resources, and terminates confirmed orphans after the configured retention interval.

The driver cannot be resumed from model context alone.

Its durable state must include the compact task state, actor session references, unread events, and policy position.

## Provider Requirements

The existing `AgentEnvironmentProvider` contract is the physical compute boundary.

Distributed-capable providers must report support for:

- idempotent creation,
- environment lookup,
- session continuation,
- event replay from a cursor,
- cancellation status,
- usage reporting,
- workspace operations when required,
- checkpoint and fork when offered,
- placement metadata.

Distributed steering additionally requires generation fencing for provider mutations.

An adapter without fencing may run one-shot idempotent work, but it cannot claim safe multi-round failover.

Drivers must not depend on unsupported capabilities.

For example, a policy that requires mid-turn steering must reject a provider that only supports one-shot execution.

Provider conformance tests belong in the shared provider test package.

## MCP Security

Remote coordination MCP requires:

- a short-lived bearer token scoped to one run and actor,
- an audience bound to the MCP endpoint,
- expiration and key rotation,
- a maximum request size,
- a request deadline,
- action-level authorization,
- per-run rate and concurrency limits,
- structured audit events,
- no secrets in tool results or logs.

The default remains loopback-only.

Non-loopback binding without authentication must fail at construction.

Browser access requires an authenticated proxy and origin checks.

## Backpressure

The shared budget limits total work.

Separate limits are still required for:

- live child count,
- provider creation rate,
- queued event count and bytes,
- unread questions,
- per-run blob bytes,
- retry attempts,
- driver turns,
- wall-clock duration.

When a limit is reached, the runtime stops admitting new work and leaves current state inspectable.

It must not drop accepted events silently.

## Workspace Concurrency

Each coding invocation receives an isolated workspace by default.

An accepted result names its base revision and produced revision.

Integration verifies that the base still matches or performs an explicit merge.

Conflicts create a new integration task.

Only the integration owner may update the shared branch.

This supports many agents working in parallel without pretending that arbitrary concurrent file writes are safe.

## Data Retention

The run journal stores compact decisions and references.

Large transcripts, traces, and outputs live in blob storage.

Retention policy must be configurable by data class:

- run decisions,
- model transcripts,
- tool inputs and outputs,
- workspace artifacts,
- knowledge writes,
- secrets and personal data.

Deleting a run must either delete referenced private blobs or record why shared content-addressed blobs remain.

## Explicit Non-Goals

- Do not build a machine scheduler in `agent-runtime`.
- Do not implement a consensus algorithm.
- Do not require exactly-once network delivery.
- Do not allow multiple active coordinators for one run.
- Do not use one shared mutable checkout as the default parallel workspace.
- Do not make every provider pretend it supports live steering or sessions.
- Do not merge agent knowledge state into coordinator state.
