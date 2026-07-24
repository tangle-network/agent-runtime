# Calibration — factory.agent-eval.309

Run 2026-07-23, node v24.13.0, pnpm 11.15.1, local mirror `/home/drew/code/agent-eval` (read-only; work in throwaway clones).

## Gold run — base + real PR impl (tests excluded) must PASS

```
git clone /home/drew/code/agent-eval work/ae-309-gold
git -C work/ae-309-gold checkout 5fe8d0c83a7e38f2893b2d7a0f6cd62dd5430521
# impl-only patch: full PR diff minus its test files
git -C /home/drew/code/agent-eval diff 5fe8d0c8 9b0a4f82 \
  -- ':(exclude)src/capability-headroom.test.ts' ':(exclude)src/paired-arms.test.ts' \
  > ae309-impl.patch
git -C work/ae-309-gold apply ae309-impl.patch
# judge tests overlaid from the merge commit
git -C /home/drew/code/agent-eval show 9b0a4f82:src/paired-arms.test.ts        > work/ae-309-gold/src/paired-arms.test.ts
git -C /home/drew/code/agent-eval show 9b0a4f82:src/capability-headroom.test.ts > work/ae-309-gold/src/capability-headroom.test.ts
cd work/ae-309-gold && pnpm install
npx vitest run src/paired-arms.test.ts src/capability-headroom.test.ts
```

Output:

```
 ✓ src/capability-headroom.test.ts (13 tests) 4ms
 ✓ src/paired-arms.test.ts (17 tests) 12ms
 Test Files  2 passed (2)
      Tests  30 passed (30)
```

Re-run (flakiness check): `PASS (30) FAIL (0)` — deterministic (seeded bootstrap; no wall-clock/net/fs dependence).

## Base run — judge tests on bare base must FAIL

Same clone/checkout of `5fe8d0c8`, overlay only the two test files, `pnpm install`, same vitest command.

Output:

```
 Test Files  2 failed (2)
      Tests  no tests
```

Both files fail at collection: `src/paired-arms.ts` and `src/capability-headroom.ts` do not exist at base. Producing those modules is the task.

## Judge-set notes

- No flaky or env-dependent tests found; both files are pure in-process assertions (0 spawns, 0 network, 0 env keys). **Excluded: none.**
- The tests pin exact error-message substrings (validation regexes). Rather than trimming, those substrings were promoted into `spec.md` as explicit acceptance criteria — they are fail-loud contract, not incidental internals.
- Tests import by public module path (`./paired-arms`, `./capability-headroom`) and use `mcnemar` from the pre-existing `src/statistics` — the builder must produce those module paths; that IS the spec.
- Vitest config at base has no `include` restriction; explicit file args run colocated `src/*.test.ts` fine.
