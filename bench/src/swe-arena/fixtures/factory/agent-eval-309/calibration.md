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

## Spec-reachability gate (added 2026-07-24, after the control-arm result)

The first two gates admitted this instance and it still could not discriminate arms: all seven measured
runs failed the SAME 17 of 30 hidden tests, and only 2 tests ever differed between runs.
The cause was the spec rewrite, not the arms — 17 tests asserted on names the spec never stated
(`keepThreshold`, `saturated`, `minTasksWithGap`, `HeadroomInput`, `taskId`, `baselinePassRate`,
`b10`/`b01`, `meanDelta`/`medianDelta`/`nMissing`/`metricNames`/`wilcoxon`, and the `'gap'`/`'saturated'`
classification values), so no builder could reach them.

`tsx src/swe-arena/calibrate.ts --factory-reachability <instanceDir>` reports it mechanically.
Before the spec repair: **13 of 30 reachable, 17 unreachable** — which is exactly the 13/30 both
supervisor reps scored and the 17 every run failed.

Repair chosen: **enrich the spec, exclude nothing.** Every missing token is a public API name, an
option name, an exported type name, an enum value, or an error-message fragment — all of which a PM
ticket can state without leaking implementation. After the rewrite:

```
REACHABILITY factory.agent-eval.309: 30/30 reachable, 0 unreachable; judged denominator 30 of 30 authored
CALIBRATE factory.agent-eval.309: gold 30/30 resolved=true; base 0/30 resolved=false; reachability ok → ADMITTED
```

Denominator is unchanged at **30** (authored 30, excluded 0) because enrichment was sufficient.
