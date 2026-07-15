# Validation Plan

## Rule

No distributed capability is complete because a unit test passed or a model printed a success message.

Each claim requires a machine-checked run artifact containing the exact command, commit, package versions, provider, model, task, events, usage, result, and failure injections.

## Layer 1: Contract Tests

Run for every durable store:

- conditional ownership claim,
- ownership renewal and expiry,
- stale-generation append rejection,
- durable provider-command outbox replay,
- monotonic revision,
- duplicate command return,
- duplicate event suppression,
- conflicting terminal event rejection,
- snapshot and replay equivalence,
- retention without dangling private blobs.

Run for every compute provider:

- create and destroy,
- idempotent create,
- terminal event required,
- abort propagation,
- environment lookup,
- session continuation when declared,
- event replay from cursor when declared,
- usage propagation,
- workspace operations when declared,
- capability mismatch rejection,
- stale-generation provider command rejection when distributed steering is declared.

## Layer 2: Two-Agent Recovery Test

The primary scenario uses one driver and one worker.

The worker edits a real repository fixture and must pass a deterministic test.

The driver starts the worker, observes progress, sends two steering commands, and accepts only the checked commit.

Run the scenario with coordinator termination at each point:

1. before dispatch intent is recorded,
2. after intent but before provider creation returns,
3. after environment creation but before the reference is recorded,
4. while the worker is running,
5. after a steering command is recorded but before delivery,
6. after the provider emits completion but before runtime acceptance,
7. after acceptance but before the caller receives the result,
8. during cancellation,
9. while an old coordinator is partitioned and sends a delayed command after takeover.

For each point, run 100 repetitions.

Acceptance targets:

- 900 of 900 runs complete or return the expected honest terminal failure.
- Zero runs start duplicate physical work for one invocation id.
- Zero runs accept two terminal results.
- Zero acknowledged steering commands disappear.
- Zero delayed stale-coordinator commands affect the provider after takeover.
- Zero accepted workspace commits are duplicated.
- Provider-reported tokens and cost differ from recorded totals by at most 1 percent.
- All provider resources are gone or intentionally retained within the configured cleanup interval.

## Layer 3: Event Disorder Test

Inject 10,000 events with duplicates, delay, and reordering.

The final state must equal the ordered reference execution.

Test duplicate completion, completion after cancellation request, stale coordinator events, missing event ranges, and replay from an old cursor.

Acceptance targets:

- Zero duplicate side effects.
- Zero invalid state transitions accepted.
- Every missing event range causes replay or an explicit `lost` result.
- Memory and queued bytes stay under configured limits.

## Layer 4: Parallel Agent Test

Run 32 child invocations with a live limit of 8 across at least two providers.

Use isolated workspaces and one integration owner.

Inject one provider outage, one coordinator restart, four worker cancellations, and duplicate completion delivery.

Acceptance targets:

- Live workers never exceed 8.
- Root budget and provider quotas are never exceeded by new admissions.
- All 32 invocations end in an explicit terminal state.
- No workspace update is silently overwritten.
- The coordinator answers status requests throughout the run.
- No resources remain after cleanup.

## Layer 5: MCP Security Test

Test:

- missing token,
- expired token,
- wrong audience,
- wrong run,
- wrong actor,
- replayed command,
- oversized request,
- slow request body,
- request flood,
- non-loopback bind without authentication.

Acceptance targets:

- Every unauthorized action is rejected before handler execution.
- Retried authorized commands are idempotent.
- Audit records identify run, actor, action, and result without secrets.
- Load limits preserve status and cancellation access for the run owner.

## Layer 6: Live Provider Runs

At minimum, run the same two-agent scenario on:

1. Tangle sandbox provider,
2. CLI bridge provider,
3. one external provider implementation.

These runs use real provider sessions and real model calls.

No fake executor may satisfy this layer.

Persist the raw run artifact and a summarized `agent-eval` record.

## Layer 7: Workload Benchmarks

`agent-bench` should own reusable suites for:

| Suite | What it measures |
|---|---|
| deterministic repository repair | Basic delegation, steering, workspace integration, and checked completion |
| HumanEval-style code tasks | Dynamic retry and allocation against equal-compute best-of-N |
| Terminal-Bench tasks | Long-running tool use, environment recovery, and operational correctness |
| long-horizon repository change | Fresh-context continuation, milestones, restart, and integration conflicts |
| research synthesis | Parallel research, source quality, deduplication, and final synthesis |
| knowledge-base improvement | Ingestion, claim validation, retrieval repair, freshness, and held-out answer quality |
| memory from traces | Cross-run retention, relevance, contamination resistance, and transfer to fresh tasks |

Every comparison uses the same task set, model access, token limit, dollar limit, time limit, and provider class.

## Required Output Columns

Every run row includes:

- commit and package versions,
- date and exact command,
- task and split,
- model and provider,
- root policy,
- actor profiles,
- child count and recursion depth,
- live concurrency,
- dispatch retries,
- duplicate commands and events suppressed,
- coordinator restarts,
- provider reconnects,
- cancellations requested and confirmed,
- accepted output and deterministic check result,
- input, output, and reasoning tokens when available,
- cost,
- wall time,
- MCP action count and latency,
- run-store append latency,
- workspace conflicts,
- orphan resources,
- terminal reason.

Report per-run rows plus minimum, median, p90, p95, p99, and maximum for numeric fields.

## Performance Targets

Measure runtime overhead separately from model and provider time.

Initial acceptance targets:

- Local coordination command p95 under 50 ms at 100 requests per second.
- Durable append p95 under 100 ms on the selected production store.
- Runtime coordination overhead below 5 percent of total wall time on long model-backed tasks.
- Status read p95 under 250 ms with 1,000 active runs.
- Recovery begins within two ownership intervals after coordinator loss.

These are starting service targets, not benchmark results.

They must be revised from measured production-like runs.

## Promotion Decision

Ship the distributed path only when:

1. all deterministic failure tests pass,
2. all required providers pass conformance,
3. all three live provider runs produce retained artifacts,
4. security tests pass,
5. dynamic allocation does not regress checked task success or reliability against equal compute,
6. fresh held-out tasks confirm any claimed quality improvement,
7. the old local path remains available until migration evidence is complete.

A failed or underpowered benchmark remains open work.

It is not evidence that agent-managed compute is ineffective.
