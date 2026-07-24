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

- **Correctness**: derive discordant counts (baseline-pass/treatment-fail and the reverse) from `pass` and report exact McNemar (`pValue`) plus the paired risk difference under a `correctness` result section, with `nPairs`, `nUnpairedBaseline`, `nUnpairedTreatment` visible.
- **Efficiency**: for every metric name present, per-pair deltas (treatment − baseline) summarized with the paired bootstrap and Wilcoxon signed-rank, reported as `metricDeltas` (one entry per metric).
- A metric with zero complete pairs reports `null` for its bootstrap CI and Wilcoxon — the bootstrap's all-zero sentinel must never read as a measured tight null.
- Bootstrap must be seeded/deterministic so repeated runs agree.

## Deliverable 2 — capability-headroom gate (`src/capability-headroom.ts`)

### `capabilityHeadroom(rows, options)`

Given per-task baseline outcomes for the capability-absent arm, report which tasks have headroom (baseline fails → task can show the capability) with fail-closed semantics:

- Outcomes are per-rep and may be pass / fail / unknown; **unknown never counts as headroom** and never counts as a known rep.
- Reject an unrecognized baseline outcome value loudly (message names the bad value, e.g. `unrecognized baselineOutcome 'passed'`); reject an empty baseline (`no baseline rows`).
- Per-task output includes `nKnown`; a `summary` includes `tasksWithGap` and `repsUnknown` so thin evidence stays visible.
- Numeric guards validate loudly: minimum reps must be an integer ≥ 1 (message contains `integer ≥ 1`); where two of something are required the message says `need ≥ 2`.
- Result exposes `tasks` (per-task rows) and `summary`.

### `assertCapabilityHeadroom(rows, options)`

Throws an actionable error when the benchmark cannot see the capability it claims to measure (no headroom); otherwise returns the headroom report.

## Wiring

- Export both modules' public symbols from `src/index.ts`.
- Match repo conventions: strict TS, colocated `*.test.ts` allowed, biome-clean.

## Acceptance

- `pnpm typecheck` and `pnpm exec biome check` clean.
- Hidden acceptance tests import `{ pairArms, comparePairedArms, type PairedArmRow }` from `src/paired-arms` and `{ capabilityHeadroom, assertCapabilityHeadroom }` from `src/capability-headroom`, plus `mcnemar` from `src/statistics`, and exercise every behavior above, including: identity-based multi-rep pairing on a both-reps-discordant scenario, leftover reporting, all the fail-loud validation messages, null CI on zero-pair metrics, determinism under reordering, and fail-closed unknown handling in the headroom gate.
