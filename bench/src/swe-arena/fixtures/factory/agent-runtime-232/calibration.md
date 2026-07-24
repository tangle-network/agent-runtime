# Calibration — factory.agent-runtime.232

Run 2026-07-23, node v24.13.0, pnpm 11.15.1, local mirror `/home/drew/code/agent-runtime` (read-only; work in throwaway clones).

## Gold run — base + real PR impl (tests excluded) must PASS

```
git clone /home/drew/code/agent-runtime work/ar-232-gold
git -C work/ar-232-gold checkout ce6194a8e4e8468fb47d7a040f9df7366c0dda9b
git -C /home/drew/code/agent-runtime diff ce6194a8 690a8fd0 -- ':(exclude)tests/' > ar232-impl.patch
git -C work/ar-232-gold apply ar232-impl.patch
mkdir -p work/ar-232-gold/tests/mcp
git -C /home/drew/code/agent-runtime show 690a8fd0:tests/mcp/delegation-store.test.ts   > work/ar-232-gold/tests/mcp/delegation-store.test.ts
git -C /home/drew/code/agent-runtime show 690a8fd0:tests/mcp/task-queue-durable.test.ts > work/ar-232-gold/tests/mcp/task-queue-durable.test.ts
cd work/ar-232-gold && pnpm install
npx vitest run tests/mcp/delegation-store.test.ts tests/mcp/task-queue-durable.test.ts
```

Output:

```
 ✓ tests/mcp/delegation-store.test.ts (10 tests) 12ms
 ✓ tests/mcp/task-queue-durable.test.ts (11 tests) 82ms
 Test Files  2 passed (2)
      Tests  21 passed (21)
```

Re-run (flakiness check): `PASS (21) FAIL (0)`.

## Base run — judge tests on bare base must FAIL

Same clone/checkout of `ce6194a8`, overlay only the two test files, `pnpm install`, same vitest command.

Output:

```
 Test Files  2 failed (2)
      Tests  no tests
```

Both files fail at collection: `src/mcp/delegation-store` does not exist and `task-queue.ts` lacks the durable exports (`DelegationResumeDriver`, store option). Producing them is the task.

## Judge-set notes

- Hermetic: tmpdir round-trips and fake in-process drivers only; no network, no env keys, no docker. One test uses fake timers (`vi`) — deterministic. **Excluded: none.**
- The judge asserts **typed error classes** (`DelegationPersistenceError`, `DelegationStateCorruptError`) and one error `kind` string (`'DriverRestartError'`), not message prose — clean behavioral contract; all named in `spec.md`.
- `DelegationRecord`, `DelegationTaskQueue`, `hashIdempotencyInput`, and `DelegateCodeArgs` pre-exist at base; the judge extends them rather than asserting incidental internals.
- The PR also touched `README.md` — excluded from the impl patch definition of "the feature" for grading purposes (docs churn, no behavioral content). It applies cleanly either way since the impl patch used `':(exclude)tests/'` only.

## Spec-reachability gate (added 2026-07-24)

Before the spec repair: **3 of 21 reachable, 18 unreachable** — matching the one measured solo run's 3/21.
Missing tokens were the port's method names (`loadAll`, `lookupIdempotencyKey`), the queue's `flush()`,
the persisted snapshot's `version` envelope, and three queue options (`resumeDelegate`, `intervalMs`,
`onPersistError`). All are public API names, so the repair was spec enrichment, not exclusion.

```
REACHABILITY factory.agent-runtime.232: 21/21 reachable, 0 unreachable; judged denominator 21 of 21 authored
CALIBRATE factory.agent-runtime.232: gold 21/21 resolved=true; base 0/21 resolved=false; reachability ok → ADMITTED
```

Denominator unchanged at **21** (authored 21, excluded 0).
