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

## Pass 2 — doc consolidation (2026-06-15): `docs/research/` 28 → 14

Retired 14 design-research docs whose content is now **shipped code, in `.evolve/current.json`, or self-declared subsumed/retracted.** Durable conclusions live in the SSOT (`rsi-atom-masterplan.md`), `architecture.md`, and the evidence ledger (`.evolve/current.json` + memory). Inbound links fixed (top index `docs/README.md`, `harvest-corpus.ts` comment → `.evolve/current.json`, the two gated belief specs, `optimization-space.md`'s suite links). **Kept** the canonical-referenced maps (`optimization-space.md`, `leapfrog-program.md` — the freshly-dated spine still links them), the SSOT, the two gated belief specs, the postmortem guardrail, the build-lists, the product-direction maps, and the 3 agent-lab tombstones.

| Retired | Why |
|---|---|
| `recursive-execution-atom.md` | design that SHIPPED — the keystone atom is built; subsumed by the masterplan + `architecture.md`. |
| `flat-harness-design.md` | self-declared **subsumed** (Plane A, recovered as the simplest `act` body). |
| `observed-orchestration-patterns.md` | grounding artifact for the now-shipped keystone — historical. |
| `architecture-alternatives.md` | 6-paradigm steelman; verdict reached ("keep the tree, graft 6 ideas") and consolidated into `architecture.md`. |
| `layer-within-run.md` | optimization-space suite; "mostly settled" — boundary law now in `current.json`/`eval-substrate.md`. |
| `layer-across-run.md` | suite; "MEASURED — naive priming FAILS (−11.6pp)" — result in `current.json`. |
| `layer-domain-generality.md` · `layer-economics.md` · `layer-intelligence-serving.md` · `layer-agent-authored.md` | suite per-layer stress-tests — evidence superseded by `current.json`. |
| `long-horizon-benchmark-survey.md` | survey; picks made (commit0 / τ²-bench) and in use. |
| `program-research-plan.md` | fund-or-kill audit; its "kill the RSI frame" verdict was itself superseded (the frame shipped). |
| `codex-techniques-audit.md` | advisory adoption report — actionable items done or ticketed. |
| `product-integration-playbook.md` | superseded by the shipped product + `docs/intelligence-sdk.md`. |

Gates re-verified: no broken markdown links into the 14 from any kept/canonical doc or `src/`; only prose/comment *concept* mentions remain in the two gated belief specs (acceptable — the concepts stand).

See [atom-compression-plan.md](./atom-compression-plan.md) for the full build-list these feed.
