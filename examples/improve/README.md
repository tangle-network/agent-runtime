# Improve one agent profile field

`improve()` runs a complete optimization method against one profile field.
The method receives train and selection cases.
Runtime keeps the final-test cases private, compares the selected candidate with the baseline, and returns a detached candidate.
It never changes the input profile.

```bash
pnpm tsx examples/improve/improve.ts
```

Runs offline, no credentials.

## What it does, step by step

1. Runtime extracts the exact profile field selected by `surface`.
2. The supplied `OptimizationMethod` generates and selects a candidate using train and selection cases.
3. Runtime scores the baseline and candidate on the untouched final-test cases.
4. Runtime returns `ship` only when the paired confidence interval clears the required lift.
5. Approval and activation remain separate operations.

## What you'll see

```
improve() proposed a detached prompt candidate and measured it on final-test scenarios
decision: ship  lift: 1.000
candidate prompt: PROMOTED
live prompt unchanged: BASELINE
```

The starting prompt is `BASELINE`; the candidate is `PROMOTED`.
The final-test lift is `1.000`.

## How it stays offline

The example supplies a deterministic complete method, agent, and judge.
The method returns `PROMOTED`; the judge scores that literal string as `1`.
The partition firewall, final comparison, cost receipts, and confidence interval are production code.

## Going live

Replace `scriptedWinner` with `officialGepa(...)`, `officialSkillOpt(...)`, or another complete method from `@tangle-network/agent-eval`.
The root README documents the optional Python installation for official GEPA.

## Files

| file | what it is |
|---|---|
| `improve.ts` | The profile, complete method, three partitions, agent, judge, and result |

The same path is covered by `src/improvement/improve.test.ts`.
