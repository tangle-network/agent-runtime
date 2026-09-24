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
An intent record proves durable admission intent, not whether the provider created an environment.
Driver attempt records and final failures preserve bounded, redacted cause chains.
Error summaries include valid numeric HTTP statuses even when the provider message omits them.
When retry failures differ, the final error includes the first failure before the last cause.
These summaries expose admission failures without authorizing replacement of unresolved executions.

Provider manager recovery restores the original task and accepted output for the current invocation.
A later deliberate manager invocation receives a separate input record.
Usage reconciliation credits only previously unrecorded spend and preserves unknown token or dollar channels.
Nested managers are reconstructed through the existing profile builder and retain their original finalizer.
Backend output alone cannot replace the manager's finalized output.
Recovery revokes journal writers on failure and drains writes already admitted before releasing ownership.
Cancellation and cleanup failures preserve accepted output; budget and execution-evidence violations remain failures.

The built-in provider recovery path supports one-shot, nonsteering execution.
Retained execution does not create a steering capability the provider lacks.
Spawn-journal append validation keeps only rebuildable node, admission, and cursor indexes.
Healthy appends do not reload prior events; cold reads validate each record once.
File replacement, truncation, changed metadata, or a failed write invalidates the append index.
Recovery validates the actual retained bytes before accepting another append.
The index is not a second durable record or a cross-process ownership fence.
File-backed journal readers process a fixed file prefix one JSONL record at a time, rather than allocating the entire history as a string.
Observer restart verifies the complete digest chain while retaining only its last record.
Root-stream receipt hashing and event counting inspect the same raw-byte prefix, including any uncommitted tail in the hash.
A malformed committed record or a short snapshot read remains an error; only malformed unterminated tail records are ignored.
Public methods that return history arrays still retain their selected records in memory, and individual records remain subject to Node limits.
This removes the whole-file string limit; it is not constant-memory arbitrary replay or distributed snapshot isolation.
Observer records detach their inputs before queued I/O, so later hook mutations cannot rewrite the evidence being saved.
Completed director invocations reset the consecutive transport-failure counter even when the pursuit remains incomplete.
The failure-attempt, deadline, cancellation, and resource bounds still apply.
Successful incomplete invocations do not consume `driverRetry.maxAttempts`; only failed invocations consume that allowance.
Use `repromptOnUnmet: 'until-complete'` with a completion check and finite positive budget deadline to omit the continuation count cap.
Numeric continuation caps retain their meaning, and zero still disables continuation.

The file run lock protects one local coordinator.
It does not fence provider mutations from a partitioned coordinator on another machine.
No deployed or live multi-provider recovery proof is claimed here.

An authenticated coordination listener bound to a wildcard accepts its actual local socket address and port.
This supports proxies that rewrite HTTP `Host` to the container's IP without trusting forwarded hostname headers.
Public endpoint initialization, configured credential audience, path, origin, and bearer checks remain mandatory.

The sections below define distributed requirements beyond this local recovery boundary.

Executor results carry an optional explicit execution outcome, separate from application output and scoring verdicts.
A failed provider turn settles its child as `down`, preserving its reason, measured spend, and content-addressed partial artifact.
The outcome keeps the provider's machine `errorCode` when the provider reports one.
A root driver turn that ends with a failed outcome is a driver failure under `driverRetry`, with the same bounds as a thrown failure.
A failure without a code is transient; a code the bridge never retries, such as `capability_denied`, is terminal.
A refusal for capacity is `unavailable`: HTTP 429, 503 or 529, or an upstream code such as the router's `provider_quota_exhausted`.
A harness that prints the router's refusal as text keeps the code in it, so the text is read for that code; text can only lengthen a retry, never end a run.
An `unavailable` failure pauses the driver, then re-enters it with the original task.
The pause starts at `driverRetry.unavailablePauseMs` (15 s) and doubles to `maxUnavailablePauseMs` (5 min).
A pause consumes neither `maxAttempts` nor `maxConsecutiveFailures`; only the deadline, the budget, cancellation and `enabled: false` end it.
Each pause is journaled as a `paused` event on the manager node, with the refused attempt's duration and the pause, as infrastructure time.
A provider-backed leaf whose turn is refused this way keeps its environment and pauses by the same rule.
It then continues in the same environment and harness session, with an instruction to pick up where it stopped.
The instruction names neither the provider nor the refusal.
Each continuation is the leaf's next invocation: a new `execution-input`, its own admissions, and its own result.
The refused turn's result stays in the journal, and each result carries the leaf's spend so far.
A continuation counts no iteration of its own, and each pause is journaled as a `paused` event on the leaf.
Only the leaf's deadline, cancellation and budget end its pauses; `ProviderExecutorOptions.unavailablePause: false` ends the leaf on the refused turn instead.
A process that stops during a continuation recovers that invocation in the same environment, and the leaf's identity stays its original task.
A leaf continues only on a retained provider path under a Scope, and not with workspace retention.
The failed result and its spend stay in the journal.
Its environment is handled as a successful turn's: it is not force-killed.
The retry starts a new invocation, which reuses the retained owner environment.
A resumed run replays a committed failed owner result as the same failure rather than as a delivered turn.
Accepted failures keep that status through cancellation races and coordinator recovery.
Recoverable tool failures inside a completed turn do not fail the child.

Terminal success and failure receipts preserve observed usage and explicit completeness flags.
Canonical input totals include cached input, and canonical output totals include reasoning.
Reasoning counters classify output; Runtime does not add them to an inclusive output total.
A reasoning-only observation remains a lower bound, not a complete output measurement.
Repeated cumulative failure and completion receipts do not count the same work twice.
Incomplete receipts stay incomplete through streamed progress, transport failure, and retained results.
Provider cost estimates remain distinct from verified billing receipts.

Provider executors carry reported prompt-cache classes through child settlement and root accounting.
Retained recovery credits each class only for previously unrecorded usage.
Fresh executions can refine earlier token totals when cache classes arrive in a later cumulative receipt.
Duplicate snapshots do not add tokens, and each executor folds its own snapshots before joining the shared pool.
Recovery does not refund historical input already metered without cache classes.
That accounting stays explicitly incomplete, even if a later replay supplies the missing classification.
An absent cache counter remains absent, while a reported zero remains zero.
Sandbox's `effectiveBackend.model` reports a platform binding, not an upstream inference receipt.
The provider executor leaves upstream model identity unknown without response-observed evidence.

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

A retained interaction can name an inner adapter provider different from the outer environment provider.
Runtime checks its exact run, environment, session, execution, and interaction coordinates.
The provider checks the inner identity against its durable interaction record before accepting a response.

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

- a bearer token scoped to one live run and actor,
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
By default, credentials remain valid while their scope is live, within its original absolute deadline.
Closing the listener or aborting the scope rejects its credentials immediately.
Set `authentication.ttlMs` to require an additional finite expiry.
Long-lived bearer credentials increase exposure; use narrow grants, protected storage, and revocable signing keys.
Runtime does not renew credentials automatically or refresh credentials inside a retained environment.
If specified, `ttlMs` must cover the manager invocation and expected coordinator downtime.
Neither key rotation nor coordinator restart extends the original scope deadline.
Set `coordination.publicUrl` to the caller-owned reachable endpoint or an actor-aware endpoint resolver.
The resolver can return a promise and receives the bound port, run identity, actor identity, and manager signal.
Runtime awaits resolution before admitting the manager, while the listener refuses requests.
Cancellation or the manager deadline stops waiting and closes the listener; resolver failures do the same.
Pass the supplied signal to endpoint provisioning so cancellation can stop that external operation too.
Omit `coordination.port` to allocate a separate port for each concurrent manager.
Runtime does not provision a proxy or tunnel.
Remote public endpoints require HTTPS.

Before provider admission, Runtime checks each configured public endpoint with authenticated `initialize` and `tools/list` requests.
The returned grants must match that manager's exact tool names.
The check takes at most 10 seconds, or `coordination.requestTimeoutMs` when shorter, and stops on manager cancellation.
Responses are limited to 1 MiB independently of the incoming request limit, and redirects are refused.
Failure closes the listener and reports a credential-free cause before inference starts.
This verifies the operator's public route; it does not establish reachability from the provider's network.
Omitting `coordination.publicUrl` preserves local-only startup without this network check.

For same-host coordinator restart, configure `authentication.signingKeys` with an active key ID and a secret key map.
Keep the public URL, run ID, actor ID, tool grants, and verification key stable until the retained credential expires.
Stable keys support resumed coordination within the original scope deadline and any explicit credential expiry.
After expiry, the retained session can reattach, but its coordination requests receive HTTP 401.
A new active key can mint credentials while previous keys verify existing credentials.
Remove a verification key to revoke its credentials across coordinator restarts.
Listener-local `rotateCredential()` revocation does not survive restart.
The file run lock remains the single-owner fence; these credentials do not enable concurrent distributed failover.

Provider managers require `capabilities.create.runtimeAttachments.mcp` and an authenticated public endpoint.
Runtime passes the MCP server through `CreateAgentEnvironmentInput.runtimeAttachments`, preserving the canonical profile.
Credential headers remain runtime-only and must not appear in receipts or journals.
Retained manager recovery uses the original admitted backend input and validates its intent before reconnecting.
Deliberate re-prompts retain the manager's environment and conversation, with a fresh execution and turn identity.
Retrying an interrupted turn retains its original identities and does not create replacement work.
The scope's existing `retainedAtSettlement` policy releases or preserves the environment after all manager turns.
An unconfirmed release remains explicit in the journal and final result.

The HTTP adapter bounds request bytes, body and action deadlines, concurrent work, and request rates.
A timed-out action keeps its admission slot until execution settles.
A 504 response does not prove the action had no effects; reuse existing semantic spawn keys when reconciling.
`submit_result` and method node tools do not wait for that deadline: at half the request timeout, and at most 15 s, they return a pending result.
An identical call joins the running action and returns its outcome, so a long completion check still reaches the manager with its verdict and reason.
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
An overrun is committed and recorded on the settlement as `budgetViolation`, naming each overspent channel with its reserved and spent amounts.
It does not change the outcome: a child that completed settles `done` with its output, and later reservations are refused from the reduced balance.
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


## Long-running executions

Run duration, transport deadlines, and credential lifetime are separate controls.
The execution clock and cancellation-aware waits use chunked timers, so a duration beyond the host timer range does not become a one-millisecond deadline.
Polling, retry, turn, and shutdown waits retain their caller-selected semantics; expiry and cancellation still stop new work.
A disabled request timeout does not disable the parent execution budget or cancellation.
Finite time bounds must remain representable as safe absolute timestamps.

A CLI worker gets its requested graceful shutdown before escalation. Sending a signal is not proof of process exit; cleanup acknowledges actual termination.
This covers the direct subprocess, not arbitrary descendants that escaped its execution boundary.
Returned output, cleanup status, and accounting remain distinct facts.
Provider dollar totals preserve billed and estimated portions separately, including an unknown remainder when additional observed work has no billing receipt.

These contracts do not make a coordinator immortal or a local file lock a distributed lease.
Use durable storage, retain the exact run's dependency cohort for recovery, and provide a reachable coordination endpoint.
Choose a credential lifetime that covers the intended manager invocation and recovery interval; Runtime does not silently renew credentials inside a retained provider environment.
A simulated long-clock test proves timer behavior, not months of observed production uptime.
