# Deletion ledger — atom deep-clean

> Tracks every deletion so the dependency/upgrade pass has a precise record. Pass 1 = dead-code-only (autonomous, gates-verified). The risky migrations are listed as DEFERRED with their dependency size. Branch: `chore/atom-deep-clean`.

## Pass 1 — dead code removed (2026-06-15, gates re-verified by hand: typecheck 0, lint 0, 924 tests pass)

| Deleted | Kind | LOC | What depended on it |
|---|---|---|---|
| `bench/src/observe-steer-workspace-loop.mts` | dead mock demo (the #194 MOCK anti-pattern) | 408 | nothing (0 inbound refs; only a stale doc command + a SKILL.md note, both fixed) |
| `src/errors.ts` → `CaptureIntegrityError` | orphan pass-through re-export from agent-eval | 1 | nothing (0 internal consumers; not in the curated `src/index.ts` barrel) |
| `src/errors.ts` → `ReplayError` | orphan pass-through re-export | 1 | nothing (same) |
| `src/errors.ts` → `VerificationError` | orphan pass-through re-export | 1 | nothing (same) |
| `src/types.ts` → `AgentTaskRunSummary` | orphan interface | 20 | nothing (single self-reference; not exported via the barrel) |

**Total: 432 LOC across 3 files.** Doc-rot fixed: `loop-facade-postmortem.md` (dead `tsx` command). `test_repo/` added to `.gitignore` (stray untracked dir, not part of the clean).

## Correction (the audit caught my mistake)

The "dead recursion fences" (`strategy.ts:494`, `persona.ts:102`) are **NOT dead and were NOT removed.** Each throw is the *sole* statement in an `act(): Promise<Outcome<…>>` method — they are **load-bearing fail-loud guards** ("a spawned leaf/child run as a driver throws rather than silently returning a vacuous outcome"). Removing the throw leaves an empty body that breaks the return-type contract, and faking a return value violates the repo's no-fallbacks/fail-loud rule. The earlier cut-list mislabeled these as dead code; the conservative pass correctly left them. **Update `atom-compression-plan.md`: drop "delete dead fences"; the recursion is unblocked by the Supervisor's executor-resolution path, not by deleting these guards.**

## DEFERRED — the careful migrations (NOT autonomous; each its own verified step)

| Target | Dependency size | Why deferred |
|---|---|---|
| Delete `createDriver`/`TopologyPlanner` (the dumb planner) | **12 caller files** (loop-runner + bench harnesses + tests) | Real migration onto `defineStrategy`/Supervisor; must verify each caller. |
| Collapse `runAgentic` ≡ `runPersonified` | callers of the one removed | Bounded but touches the public barrel + bench. |
| `AgentProfile` superset (agent-eval ⊇ SDK shape) | every profile-builder | Cross-package substrate change; a substrate release. |

See [atom-compression-plan.md](./atom-compression-plan.md) for the full build-list these feed.
