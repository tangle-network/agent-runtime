# Improve one profile field

## When to use it

Use this when you must change one part of an agent and prove the change is better.
`improve()` runs a complete optimization method against one profile field, such as the prompt, a skill, memory, or code.
Runtime keeps the final-test cases away from the method, compares the selected candidate with the baseline, and returns a detached candidate.
It never changes the input profile.

Use a sibling instead when the job is different.
[`../self-improving-loop`](../self-improving-loop) unrolls the same flow step by step, so you can see which part owns each phase.
[`../self-improving-coder`](../self-improving-coder) runs it on a coding task graded by real tests.
[`../strategy-evolution`](../strategy-evolution) searches coordination tactics instead of a profile field.
[`../intelligence-recommend`](../intelligence-recommend) starts from a run trace and ends at a reviewable proposal.

## How to use it

```bash
pnpm build && pnpm tsx examples/improve/improve.ts
```

The example runs offline.
It supplies a deterministic method, agent, and judge: the method returns `PROMOTED`, and the judge scores that literal string as `1`.
The partition firewall, the final comparison, the cost receipts, and the confidence interval are production code.

```text
improve() proposed a detached prompt candidate and measured it on final-test scenarios
decision: ship  lift: 1.000
candidate prompt: PROMOTED
live prompt unchanged: BASELINE
```

Six steps run inside the call.

1. Runtime extracts the exact profile field named by `surface`.
2. Runtime binds saved work to `executionRef` plus the complete baseline profile.
3. The method generates and selects a candidate from the train and selection cases.
4. Runtime scores the baseline and the candidate on the untouched final-test cases.
5. Runtime returns `ship` only when the paired confidence interval clears the required lift.
6. Approval and activation stay separate operations.

To go live, replace the scripted method with `officialGepa(...)`, `officialSkillOpt(...)`, or another complete method from `@tangle-network/agent-eval`.
Those methods need an optimizer object, an optional Python process, and a redaction review.
[`docs/improve.md`](../../docs/improve.md) is the reference for all of it, including the production proposal, review, and activation path.

## Why this exists

A prompt edit that looks better is not a measured gain.
This call separates the three sets — train, selection, and final test — so the method never sees the cases that decide the release.
The result is a detached candidate plus an interval, so a human approves a number instead of a hunch.
