# Improve a profile

## When to use it

Use `improve()` to assess a candidate on cases hidden from its optimization method.
The selected surface can be one field, several fields, or the complete profile.

Runtime freezes the input profile, exposes only the selected surface to one complete optimization method, and re-measures the baseline and selected candidate on the final-test partition. It returns a detached candidate. It never mutates the live profile and it never activates the result.

This example demonstrates the maintained profile improvement API.

## Run it

```bash
pnpm build
pnpm tsx examples/improve/improve.ts
```

The example is offline.
An Eval analyst registry inspects a deterministic trace through Runtime's `observe` adapter and sends its findings into `improve`.
Its method, agent, and judge are deterministic, allowing inspection of partition separation, cost receipts, and the final decision.

```text
improve() proposed a detached prompt candidate and measured it on final-test scenarios
decision: ship  lift: 1.000
candidate prompt: PROMOTED
live prompt unchanged: BASELINE
```

## What the call owns

1. Extract the exact profile coordinate named by `surface`.
2. Bind resumable work to `executionRef`, the complete baseline profile, and the selected surface.
3. Let the supplied method generate and select candidates using train and selection cases only.
4. Independently execute the frozen baseline and selected candidate on the untouched final-test cases.
5. Return `ship` only when the configured paired comparison clears its evidence policy.
6. Leave review and activation to separate, explicit operations.

A candidate does not need optimizer lineage. `proposeAuthoredAgentProfileImprovement` admits a complete profile authored by a person or supervisor to the same sealed measurement, review, and activation path. Hand-authored and optimizer-produced changes face the same gate.

## What this example does not prove

The literal `BASELINE` → `PROMOTED` fixture proves the integration contract. It does not establish that GEPA, Omni, SkillOpt, Prime Agent, an RLM analyst, or any other method improves a real benchmark.

For a production method, replace the deterministic method with `officialGepa(...)`, `officialSkillOpt(...)`, or another complete method from `@tangle-network/agent-eval`, then supply real disjoint partitions and the benchmark's own evaluator.

Paid reproductions and learning campaigns belong in consuming labs, with registered partitions, budgets, and retained results.
The older `bench/src/swe-self-improve.mts` driver uses `runStrategyEvolution`; it does not verify this API.

See [`docs/improve.md`](../../docs/improve.md) for optimizer setup, redaction, provenance, proposals, review, and activation.
