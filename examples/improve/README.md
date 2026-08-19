# Improve one profile field

## When to use it

Use `improve()` when you must change one part of an agent and independently prove that the selected change is better on cases the optimization method never saw.

Runtime freezes the input profile, exposes only the selected surface to one complete optimization method, and re-measures the baseline and selected candidate on the final-test partition. It returns a detached candidate. It never mutates the live profile and it never activates the result.

This is the **one canonical self-improvement example** in this repository. Older strategy-evolution, coding, and step-by-step walkthroughs were removed because they duplicated this same control flow or mixed research campaigns into the public learning path.

## Run it

```bash
pnpm build
pnpm tsx examples/improve/improve.ts
```

The example is offline. Its method, agent, and judge are deterministic so the partition firewall, cost receipts, final comparison, and promotion decision can be inspected without provider noise.

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

`bench/src/swe-self-improve.mts` is the full-fidelity Runtime integration fixture for SWE-bench Verified. Paid upstream reproductions and long-horizon value campaigns belong in Discovery Lab, where budgets, revisions, partitions, and immutable result receipts can be compared without turning this examples directory into a research archive.

See [`docs/improve.md`](../../docs/improve.md) for optimizer setup, redaction, provenance, proposals, review, and activation.
