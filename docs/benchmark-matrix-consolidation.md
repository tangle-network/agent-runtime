# Benchmark matrix consolidation

How to run any subset of `{harnesses × models × personas × scenarios × external-benchmarks}` and rank the cells, using the existing library primitives — and the plan to fold the per-product matrices onto them.

## TL;DR

The matrix capability already exists in the libraries; it is not missing.
The power lives in `runProfileMatrix` (the engine) and `bench/` (the external-benchmark registry); `agent-lab` only orchestrates subsets.
What is actually missing is consolidation: the unifying adapters sit on unmerged branches, the registry-sweep primitive (`runBenchmarks`) is unbuilt, and the products forked across two matrix primitives.

## What exists today

| Layer | Where | Crosses | Subset-runnable | Harness axis |
| --- | --- | --- | --- | --- |
| `runProfileMatrix` — the matrix engine | `@tangle-network/agent-eval/campaign` (`dist/campaign/index.d.ts:848`) | profile(harness+model) × scenario(persona) × reps; ranks `byProfile`; runs `assertRealBackend` | yes — pass subset arrays | yes — `backend.type` per cell |
| `bench/` external-benchmark registry | `@tangle-network/agent-bench` (`bench/src/adapters.ts:32`, contract `bench/src/benchmarks/types.ts:37`) | 23 benches (swe-bench, terminal-bench, dabstep, webarena, appworld, tau2, frames, simpleqa, humaneval, …) | per-bench via `bench/src/gate-cli.mts` | yes — `resolveBenchClient` (`bench/src/resolve-client.ts:36`) + `backend.type` |
| `createVerifierEnvironment` + `runBenchmark` | `src/runtime/verifier-environment.ts:67`, `src/runtime/run-benchmark.ts:132` | strategy × task, one model | n/a | no |
| `CampaignAdapter` / `RunAdapterKind` — orchestrator | `agent-lab/lib/experiment-campaign/` | products × models × arms × scenarios × reps; `--only-arm` / `--only-adapter` / `--max-cells` | yes | delegated to products |

The harness is not a field on `AgentProfile` (which carries model + persona).
It is encoded as `metadata.harness` and decoded into `sandboxOverrides.backend.type` per cell.
The canonical worked example is `examples/webcode-matrix/webcode-matrix.ts` (harness × model × task); see also `examples/coding-benchmark/benchmark.ts` (harness leaderboard via `pairwiseStats`) and `examples/product-eval` (persona axis).

## Gaps (verified 2026-06-30)

1. The unifying adapters are unmerged.
`agent-lab` main carries only `adapters.mts` + `fixture-adapter.mts`.
The product adapter (`feat/product-agent-bench-adapters`) and the external-bench adapter + catalog (`feat/benchmark-expansion-lane`) are one commit each on worktree branches with no open PRs; the `agent-runtime` external/dabstep adapters live on `feat/bench-external-adapters` / `feat/bench-dabstep-adapter`.

2. The registry-sweep primitive is absent.
`bench/src` has `run-pool.ts` but no `runBenchmarks` — running a chosen subset of the 23 benches in one call has no entry point, only the per-bench `gate-cli.mts`.

3. The products forked off the engine.
tax and legal call `runProfileMatrix`; gtm calls `runMultishotMatrix`.
Only tax puts harness on an axis.
tax has two entry points (objective `matrix.ts` plus a hand-rolled persona loop in `tests/eval/tax-agent-eval.ts`) and duplicated helpers (bench-prompt ×3, by-line scoring ×3, `FINAL_MARKER` ×2, `arg()` ×5, paired-stats ×3).

## Target architecture

```
agent-lab CampaignAdapter        (selects the subset: which products / benches / models / arms)
   ├─ runProfileMatrix               product persona/profile matrices (tax / legal / gtm)   [agent-eval]
   ├─ runBenchmarks → resolveAdapter  external coding/web benches (swe / terminal / …)        [bench]   ← to build
   └─ createVerifierEnvironment + runBenchmark   checkable-text answer domains               [agent-runtime]
harness axis = encoded in the AgentProfile (metadata.harness → backend.type), per webcode-matrix
```

The power stays in the libraries; `agent-lab` only picks subsets and merges evidence; products are thin callers.

## Plan

### Library additions (minimal, additive)

- `runBenchmarks(subset, { model, harness, reps })` in `bench/` — map `resolveAdapter` over a chosen subset of `ADAPTERS`, reuse the existing gate / `run-pool`, emit one combined report. The one genuinely-missing combinator.
- Optional: a shared `harnessOf(profile)` helper so consumers stop re-implementing the `metadata.harness` decode (currently inlined in `examples/coding-benchmark/profiles.ts`).

### Per-product fold

- tax-agent (reference fold): collapse `matrix.ts` plus the persona nested loop in `tests/eval/tax-agent-eval.ts` into one `runProfileMatrix` call with harness on the profile axis; route the inline scoring/prompt in `run_taxcalc_loop.ts` through the shared `taxcalc-score`; delete `refine-loop.ts` and the duplicated `arg()` / paired-stats. The objective XPath scorer stays as the judge.
- legal-agent: already on `runProfileMatrix` — add harness to its columns (today model × addendum only).
- gtm-agent: move off `runMultishotMatrix` onto `runProfileMatrix`, or confirm it needs multi-turn simulated-user cells before forcing it.

### Sequencing (each step independently shippable)

1. Land `agent-runtime` `feat/bench-external-adapters` + `feat/bench-dabstep-adapter` — registry complete on main.
2. Build `runBenchmarks` (depends on 1).
3. Land `agent-lab` `feat/benchmark-expansion-lane` (external-bench adapter + catalog) — consumes 1–2.
4. Land `agent-lab` `feat/product-agent-bench-adapters` (tax/legal manifest).
5. Per-product folds: tax → legal → gtm, each its own PR with before/after scores.

## Risks and watch-items

- `runProfileMatrix` has no `onlyProfiles` / `ids` filter; subset means passing subset arrays. Add a filter to the matrix options if `agent-lab`-style `--only-*` selection is wanted at the library layer.
- The objective TaxCalcBench scorer (XPath line-match) must remain the judge; folding must not swap it for an LLM judge.
- `runMultishotMatrix` (gtm) is genuinely different (multi-turn simulated user); confirm gtm's need before forcing it onto `runProfileMatrix`.
- `opencode`, `kimi-code`, `claude-code`, `codex` are all valid `BackendType`; only `opencode` / `kimi-code` are exercised by tax today. The fold should add `claude-code` / `codex` cells to actually rank harnesses.
