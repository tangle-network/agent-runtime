# Structural rollout policy — integration design

Status: design accepted 2026-07-09; measured basis in `supervisor-lab/docs/results/structural-lever-humaneval.md`.

## Measured basis

Best-of-k selection + self-repair, grounded ONLY on task-visible checks (shown examples + model-authored asserts), graded on hidden tests:

| model × dataset | baseline → full loop | lift | p (exact sign test) |
|---|---|---|---|
| Llama-3-8B × MBPP (n=427) | 51.8% → 73.1% | **+21.3pp** | 2.3e-51 (+226/−13) |
| Llama-3-8B × HumanEval (n=164) | 43.9% → 62.2% | +18.3pp | 9.2e-11 |
| Qwen2.5-7B × HumanEval (n=164) | 82.4% → 91.5% | +9.0pp | 1.0e-8 |
| Qwen2.5-7B × MBPP (n=427) | 76.7% → 85.2% | +8.5pp | 4.6e-16 |
| glm-4.5-air / glm-5.2 × HumanEval (saturated 99.4/99.7%) | null | −0.6 / −0.4pp | the only regressions are the two calibration-flagged wrong-example tasks (/47, /116) |

Every positive cell captures ≥93% of the pass@k bound. Selection is 85–92% of the effect; repair is a small always-positive increment. Prompt-diversity per slot is a paired null (+0.6pp). Independently verified: 1,968/1,968 regrade cells, 328/328 selection replays, 0 hidden-test leaks.

## The finding that shapes the design

The runtime already owns five of the six pieces:
1. best-of-k + repair strategy family — `src/runtime/strategy.ts` `sample`/`refine`/`sampleThenRefine` (:755/:760/:1003), authored via `defineStrategy` (:834)
2. jailed check execution — `createVerifierEnvironment` (`src/runtime/verifier-environment.ts:68`), agent-eval `testJudge`/`runJudgeFleet`, `@tangle-network/sandbox` — retire the bench rigs' bespoke `docker run` jails
3. selection + audit — `defaultSelectWinner` + `SelectionReceipt` (`src/runtime/run-loop.ts:1131`, `types.ts:160`)
4. visible/hidden firewall as typed field routing — agent-eval `FieldDestination`: `develop-against` (the visible-check source) vs `grading-only`, with `assertNoHiddenLeak` + `gradeOnHidden`
5. config/knob plumbing — `budget` on runBenchmark/runAgentic/superviseSurface; `directives.ts` for slot prefixes

The ONLY net-new seam: **the model authors its own visible checks** (`CheckSource`).

## Design (no caller changes)

New module `src/runtime/structural-rollout.ts`:
- `CheckSource<Task>` — `generate(task, ctx) → VisibleCheck[]` from agent-visible/develop-against fields only. Default impl lifted from the proven `bench/src/hev-structural.mts generateTests` (:282) with the MBPP lesson baked in: **official shown examples outrank model-authored guesses in scoring** (guesses are 17–70% wrong depending on model × spec richness; unweighted they can flip selection negative).
- `CheckRunner` — `run(candidate, checks, ctx) → { passed, total, failureOutput }`, backend = sandbox exec / agent-eval `testJudge`, result shaped to `SurfaceScore`.
- `structuralRollout({ policy, checkSource, checkRunner }) → Strategy` — a fourth member of the sample/refine family via `defineStrategy`; argmax by weighted visible score, ≤`repairRounds` repair shots steered by `failureOutput`, keep-best-by-score. Emits `SelectionReceipt`s.
- `StructuralRolloutPolicy { k, repairRounds, testgen, diverse?, temperature? }` — promoted from the rig env vars; later an optimizable surface for `improve()`.

Placement rule: this is an INFERENCE-TIME capability (wraps the model call). It does not go into `improve()`/`selfImprove` (training-time); `improve()` may later tune the policy knobs.

Extend-don't-fork list: strategy family, verifier-environment, selectWinner/receipts, agent-eval field routing + judges, the rigs' `generateTests`/`extractRepairCode` as default impls.

## Known behavior to preserve/handle
- Wrong visible examples poison repair at saturation (glm regressions on /47,/116): repair must never replace a candidate that passes MORE official checks with one that passes fewer; consider a no-repair-when-only-defect-signal guard.
- Repair value concentrates at low k (~+12pp at k=1, +1–3pp at k=5): default policy `k=5, repairRounds=2, testgen=6`; low-compute preset `k=1, repairRounds=2`.
- Exact-equality float asserts are a known wrong-test class (HumanEval/2 case).
