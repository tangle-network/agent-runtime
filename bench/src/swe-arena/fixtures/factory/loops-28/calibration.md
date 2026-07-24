# Calibration — factory.loops.28

Run 2026-07-23, node v24.13.0, pnpm 11.15.1, local mirror `/home/drew/code/loops` (read-only; work in throwaway clones).

## Gold run — base + real PR impl (tests excluded) must PASS

```
git clone /home/drew/code/loops work/lp-28-gold
git -C work/lp-28-gold checkout 3ca55b9eb24adae9d5c8383dc785bd610e1db5b0
git -C /home/drew/code/loops diff 3ca55b9e 7805270f -- ':(exclude)tests/' > lp28-impl.patch
git -C work/lp-28-gold apply lp28-impl.patch
for t in best-effort worker-clone worker-evidence; do
  git -C /home/drew/code/loops show 7805270f:tests/$t.test.ts > work/lp-28-gold/tests/$t.test.ts
done
cd work/lp-28-gold && pnpm install
npx vitest run tests/best-effort.test.ts tests/worker-clone.test.ts tests/worker-evidence.test.ts
```

Output:

```
 Test Files  3 passed (3)
      Tests  20 passed (20)
```

Re-run (flakiness check): `PASS (20) FAIL (0)`.

## Base run — judge tests on bare base must FAIL

Same clone/checkout of `3ca55b9e`, overlay only the three test files, `pnpm install`, same vitest command.

Output:

```
 Test Files  3 failed (3)
      Tests  no tests
```

All three fail at collection: `src/best-effort.ts`, `src/worker-clone.ts`, `src/worker-evidence.ts` do not exist at base.

## Judge-set notes

- Tests spawn `git` in temporary directories with identity passed inline, and use symlink/chmod, so they are POSIX-only. The judge runs in the pinned factory container with network disabled and no operator environment. **Excluded: none.**
- `tests/worker-evidence.test.ts` imports the bound constants (`EVIDENCE_MAX_CHARS` etc.) and asserts **relative to them** (`length ≤ EVIDENCE_MAX_CHARS`, tail contains `'v'.repeat(VERIFY_TAIL_CHARS)`) — exact values are the builder's choice; the names and semantics are contract and are in `spec.md`. Not trimmed: self-referencing bounds have behavioral content (bounding + tail retention).
- One pinned prose contract: the best-effort delivery commit subject must contain `best-effort delivery from <label>` and `no worker passed the verify gate` — promoted into `spec.md` as acceptance criteria.
- Judge imports `@tangle-network/agent-runtime/loops` (`gitWorkspace`, `runInWorkspace`) — a published npm dependency already in the base lockfile, not sibling unmerged work.
- Scope note: the merged PR also tuned worker budgets and prompts (`extensions/pi/`, `src/top-model.ts`); the judge does not cover those, so this instance grades the three library modules only. The spec describes the modules as the deliverable.
