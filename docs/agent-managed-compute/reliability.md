# Reliability And Security

## Current recovery boundary

A file-backed run persists original profile and invocation inputs before provider admission.
The journal records intent, environment, dispatch, and accepted result in order.
Child recovery uses the configured executor factory and validates the original request before reconnecting or replaying its idempotent admission.
Scope restores each live child's original identity, deadline, reservation, and shared worker slot before its manager acts.
Recovery waits for descendant admission, while managers and children can continue communicating before either finishes.
An accepted result can be reused after environment deletion.
If retained event observation fails, Runtime reads the exact terminal result before leaving the invocation unresolved.
Recovered results preserve incomplete event observation and a bounded, redacted error summary.
Runtime refuses settlement for received events with invalid identities and for unavailable or invalid exact results.
An execution without sufficient recovery proof stays unresolved; it does not authorize replacement work.

Provider manager recovery restores the original task and accepted output for the current invocation.
A later deliberate manager invocation receives a separate input record.
Usage reconciliation credits only previously unrecorded spend and preserves unknown token or dollar channels.
Nested managers are reconstructed through the existing profile builder and retain their original finalizer.
Backend output alone cannot replace the manager's finalized output.
Recovery revokes journal writers on failure and drains writes already admitted before releasing ownership.
Cancellation and cleanup failures preserve accepted output; budget and execution-evidence violations remain failures.

The built-in provider recovery path supports one-shot, nonsteering execution.
Retained execution does not create a steering capability the provider lacks.
The file run lock protects one local coordinator.
It does not fence provider mutations from a partitioned coordinator on another machine.
No deployed or live multi-provider recovery proof is claimed here.

The sections below define distributed requirements beyond this local recovery boundary.

Executor results carry an optional explicit execution outcome, separate from application output and scoring verdicts.
A failed provider turn settles its child as `down`, preserving its reason, measured spend, and content-addressed partial artifact.
Accepted failures keep that status through cancellation races and coordinator recovery.
Recoverable tool failures inside a completed turn do not fail the child.

Terminal success and failure receipts preserve observed usage and explicit completeness flags.
Canonical input totals include cached input, and canonical output totals include reasoning.
Reasoning counters classify output; Runtime does not add them to an inclusive output total.
A reasoning-only observation remains a lower bound, not a complete output measurement.
Repeated cumulative failure and completion receipts do not count the same work twice.
Incomplete receipts stay incomplete through streamed progress, transport failure, and retained results.
Provider cost estimates remain distinct from verified billing receipts.

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
Set `coordination.authentication` to `true` to mint an ephemeral credential.
Credentials expire after 15 minutes by default; `authentication.ttlMs` can extend this to at most 24 hours.
Runtime does not renew credentials automatically or refresh credentials inside a retained environment.
Configure `ttlMs` to cover the manager invocation and expected coordinator downtime.
Run deadlines do not extend credential lifetime.
Set `coordination.publicUrl` to the caller-owned reachable endpoint or an actor-aware endpoint resolver.
Runtime does not provision a proxy or tunnel.
Remote public endpoints require HTTPS.

For same-host coordinator restart, configure `authentication.signingKeys` with an active key ID and a secret key map.
Keep the public URL, run ID, actor ID, tool grants, and verification key stable until the retained credential expires.
Stable keys support resumed coordination only before the original credential expires.
After expiry, the retained session can reattach, but its coordination requests receive HTTP 401.
A new active key can mint credentials while previous keys verify existing credentials.
Remove a verification key to revoke its credentials across coordinator restarts.
Listener-local `rotateCredential()` revocation does not survive restart.
The file run lock remains the single-owner fence; these credentials do not enable concurrent distributed failover.

Provider managers require `capabilities.create.runtimeAttachments.mcp` and an authenticated public endpoint.
Runtime passes the MCP server through `CreateAgentEnvironmentInput.runtimeAttachments`, preserving the canonical profile.
Credential headers remain runtime-only and must not appear in receipts or journals.
Retained manager recovery uses the original admitted backend input and validates its intent before reconnecting.

The HTTP adapter bounds request bytes, body and action deadlines, concurrent work, and request rates.
A timed-out action keeps its admission slot until execution settles.
A 504 response does not prove the action had no effects; reuse existing semantic spawn keys when reconciling.
A separate bounded admission path preserves owner status and cancellation during normal work saturation.
Audit records contain trusted run and actor IDs, known action names, outcome, and HTTP status.
Admission audit failure prevents action execution.

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

## Caller-named resource accounting

`Budget.resources` declares caller-owned names, explicit units, and non-negative safe-integer limits.
`Spend.resources` reports safe-integer amounts and explicit completeness flags in those same units.
Choose units fine enough for the measurement, such as GPU-milliseconds or bytes.
Fractional values and values above `Number.MAX_SAFE_INTEGER` are rejected.
Default worker partitions round each resource allocation down to an integer.
A resource usage event reports an increment; a terminal spend reports the total for the same invocation.
The runtime avoids counting streamed and terminal measurements twice.
Conflicting totals retain the larger subtotal and mark completeness unknown.
An aggregate above `Number.MAX_SAFE_INTEGER` retains that value as a lower bound and marks completeness unknown.
Original child receipts remain in the journal.
Overflow closes enforced admission and settles the affected reservation.

The existing budget pool reserves standard and named channels together before starting a child.
Each child must declare every resource enforced by its parent, with matching units.
`supervise` rejects incompatible `perWorker` resource declarations before invoking its driver.
Known settlement commits measured usage and refunds the unused allocation.
An overrun remains recorded and fails settlement.
Missing or unknown enforced measurements close admission for that dimension.
An omitted measurement becomes unknown, including when an executor terminates or cancellation interrupts reporting.
Only a proven refusal before execution can refund an unmeasured allocation as known zero.

Names, units, amounts, and unknown flags survive journal aggregation and retained execution recovery.
Unknown recovery evidence cannot grant fresh usable capacity.
These are accounting limits: callers must supply trustworthy measurements from their executors.
Standard backends cannot invent measurements for caller-defined resources.
Custom executor receipts or explicit metering must supply those measurements, including the driver's own work.
A caller-owned `ToolLoopChat` can return `resources` with each result, including explicit known-zero measurements.
GPU usage and `boxMinutes` do not convert into named resources automatically.
Estimated box lifetime remains separate evidence and does not become a measured resource receipt.

See the offline [example](../../examples/supervise/named-resources.ts).
The concurrent conservation and durable replay proof is in `tests/kernel/named-resource-budgets.test.ts`.
