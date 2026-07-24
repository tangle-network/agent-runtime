# Add matched-pair arm comparison and a capability-headroom gate to the statistics layer

## Background

agent-eval ships a statistics module (`src/statistics.ts`) with paired estimators — `mcnemar`, paired risk difference, paired bootstrap, `wilcoxonSignedRank` — but every consumer that runs a two-arm A/B over run records hand-rolls the same two things on top of it:

1. Matching baseline rows to treatment rows into pairs before feeding the paired estimators.
2. A calibrate-before-measure gate that checks the benchmark can even see the capability being measured (if the capability-absent baseline already passes a task, that task carries no signal).

Lift both into the library as new modules. Compose the existing statistics exports; do not add new math. No changes to any existing export.

## Deliverable 1 — matched-pair arm comparison (`src/paired-arms.ts`)

Input rows are arm-labeled records the caller projects from its own run data:

- `PairedArmRow`: `{ pairKey: string; repKey?: string; arm: string; pass?: boolean; metrics?: Record<string, number> }`.

### `pairArms(rows, { baselineArm, treatmentArm })`

Builds matched pairs. Hard requirements:

- **Pairing keys on row identity, never on outcome content.** A pair is an exact `(pairKey, repKey)` match across the two arms. Outcome-keyed matching is forbidden — it deflates discordant counts and manufactures fake lifts on null A/Bs.
- Single-rep tasks (one row per arm for a `pairKey`) pair directly without `repKey`.
- If any `pairKey` has multiple reps in either arm, **every** row of that `pairKey` must carry `repKey`; otherwise throw a validation error whose message names the offending pairKey and says a repKey is missing (e.g. matches `pairKey 't1' has multiple reps ... missing repKey`).
- Throw on a duplicate `repKey` within one `(pairKey, arm)` group; message names the repKey, pairKey, and arm (matches `duplicate repKey 'r1' for pairKey 't1' in arm 'off'`).
- Throw on an arm name with no rows; message lists the arms actually present (matches `no rows for arm 'onn' ... arms present: off, on`). Throw when baseline and treatment name the same arm (message contains `cannot be compared to itself`).
- Rows without a counterpart are **reported, never dropped**: result carries `unpairedBaseline` and `unpairedTreatment` arrays holding the leftover rows.
- Result shape: `{ pairs, unpairedBaseline, unpairedTreatment }`; each pair carries `pairKey`, a `repIndex` (0-based per-pair ordinal within its pairKey), and the full `baseline` / `treatment` rows.
- Deterministic under input reordering: `pairArms(shuffled)` deep-equals `pairArms(original)`.

### `comparePairedArms(rows, options)`

Runs the full comparison over the pairs:

- **Correctness**: derive discordant counts from `pass` and report them under a `correctness` result section as `b10` (treatment passes where baseline fails) and `b01` (the reverse), alongside the exact McNemar result (`mcnemar`, carrying `pValue`) and the paired `riskDifference`, with `nPairs`, `nUnpairedBaseline`, `nUnpairedTreatment` visible. `correctness` is `null` when no pair carries `pass` on both sides.
- **Efficiency**: for every metric name present, per-pair deltas (treatment − baseline) summarized with the paired bootstrap and Wilcoxon signed-rank, reported as `metricDeltas` (one entry per metric).
- Each `metricDeltas` entry carries: `name`, `n` (complete pairs), `nMissing` (pairs lacking the metric on a side), `medianDelta`, `meanDelta`, `bootstrapCi`, and `wilcoxon`.
- An explicit `metricNames` option reports the named metrics even when no pair carries them: `n` = 0, `nMissing` counted, `medianDelta`/`meanDelta` `NaN` — absent evidence stays visible instead of vanishing from the output.
- A metric with zero complete pairs reports `null` for `bootstrapCi` and `wilcoxon` — the bootstrap's all-zero sentinel must never read as a measured tight null.
- A non-finite metric value is corrupt telemetry, not a missing one: throw naming the metric (matches `non-finite value for metric 'score'`).
- Bootstrap must be seeded/deterministic so repeated runs agree; the seed arrives as `bootstrap: { seed }`.

## Deliverable 2 — capability-headroom gate (`src/capability-headroom.ts`)

### `capabilityHeadroom(rows, options)`

Input rows are `HeadroomInput`: `{ taskId: string; baselineOutcome: 'pass' | 'fail' | 'unknown' }` — one row per baseline rep of a task, projected by the caller from its own run data. `HeadroomInput` is exported.

Given per-task baseline outcomes for the capability-absent arm, report which tasks have headroom (baseline fails → task can show the capability) with fail-closed semantics:

- Outcomes are per-rep and may be pass / fail / unknown; **unknown never counts as headroom** and never counts as a known rep.
- Reject an unrecognized baseline outcome value loudly (message names the bad value, e.g. `unrecognized baselineOutcome 'passed'`); reject an empty baseline (`no baseline rows`).
- Each per-task row is `{ taskId, n, nKnown, baselinePassRate, headroom }`, where `n` counts all reps, `nKnown` counts reps with a recognized outcome, `baselinePassRate` is the pass rate over KNOWN reps (`NaN` when `nKnown` is 0), and `headroom` classifies the task as `'gap'`, `'saturated'`, or `'unknown'`.
- The classification threshold is a `keepThreshold` option, default `0`: a task is `'gap'` when its `baselinePassRate` is ≤ the threshold, `'saturated'` above it, and `'unknown'` when nothing is known. So at the default any pass saturates a task. `keepThreshold` outside `[0, 1)` throws (matches `keepThreshold must be in [0, 1)`).
- The `summary` is `{ tasksWithGap, tasksSaturated, tasksUnknown, repsUnknown }` so thin evidence stays visible.
- Numeric guards validate loudly: minimum reps must be an integer ≥ 1 (message contains `integer ≥ 1`); where two of something are required the message says `need ≥ 2`.
- Result exposes `tasks` (per-task rows) and `summary`.

### `assertCapabilityHeadroom(report, options)`

Throws an actionable error when the benchmark cannot see the capability it claims to measure; otherwise returns the headroom report.

- The bar is a `minTasksWithGap` option, default `1`: fewer tasks classified `'gap'` than the bar is a no-go.
- The error has to be actionable, so it states how many of how many tasks have baseline headroom, how many are saturated, how many are unknown, and what to do about it — e.g. `only 0 of 2 task(s) have baseline headroom (1 saturated, 1 unknown) — add tasks the baseline fails`. Falling short of a higher bar says `need ≥ 2`.
- `minTasksWithGap` must be an integer ≥ 1 (message contains `integer ≥ 1`).

## Wiring

- Export both modules' public symbols from `src/index.ts`.
- Match repo conventions: strict TS, colocated `*.test.ts` allowed, biome-clean.

## Acceptance

- `pnpm typecheck` and `pnpm exec biome check` clean.
- Hidden acceptance tests import `{ pairArms, comparePairedArms, type PairedArmRow }` from `src/paired-arms` and `{ capabilityHeadroom, assertCapabilityHeadroom }` from `src/capability-headroom`, plus `mcnemar` from `src/statistics`, and exercise every behavior above, including: identity-based multi-rep pairing on a both-reps-discordant scenario, leftover reporting, all the fail-loud validation messages, null CI on zero-pair metrics, determinism under reordering, and fail-closed unknown handling in the headroom gate.
