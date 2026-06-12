# The run archive — every experiment's full artifact, indexed

One row per run. Artifacts are **self-describing JSON** (a `models` + config block, per-task
cells with score/usd/ms/tokens, gate verdicts with CIs) — portable: copy a file anywhere and
it carries its own provenance; no code from this repo is needed to analyze it. Conclusions
live in the [findings gist](https://gist.github.com/drewstone/5d85cece6e2ecee4b12774b76ddd7e02)
and `.evolve/current.json`; THIS index maps claims back to raw data. New runs: set
`OUT=bench/runs/<date>/<name>.json` — never `/tmp`.

## 2026-06-10 — the evolution + grid line

| artifact | run | verdict |
|---|---|---|
| `fw-clean.json` | the first trusted flywheel (post-#217/#219), n=12+8 | HOLD; authored `critique-refine` tied refine at 47% of sample's cost (cost-frontier datapoint #1) |
| `fw-evolve.json` | first multi-gen evolution (GENS=2 POP=2) | HOLD identical-champion; cost-frontier #2 (`pair-review`) |
| `fw-powered2.json` | powered run (n=24, budget 4, band) | HOLD; tool-introspection era begins |
| `fw-powered3.json` | the discriminating run (listTools) | NOT PROMOTED; first train displacements; reproducer's first firing (REPRODUCIBLE, −0.9pp) |
| `grid-math.json` / `grid-math2.json` | κ grid on saturated math | machinery validation; first PROMOTED verdicts (vacuous score leg — saturation lesson) |
| `grid-aime.json` | first hard-band grid | **steer+compress PROMOTED** (σ×κ interaction #1) |

## 2026-06-11 — the cost arc + steering hypercube + matrix + OG line

| artifact | run | verdict |
|---|---|---|
| `fw-cost.json` | cost objective #1 | HOLD via funnel misalignment (→ the funnel-alignment law, #254) |
| `fw-cost2.json` | cost #2, aligned funnel | HOLD, real: candidates 4–8pp behind at 40–55% cost |
| `fw-cost3.json` | cost #3, deeper search (GENS=3 POP=4) | NOT PROMOTED + **reproducer caught overfit** (21.8pp gap) — the arc-closing verdict |
| `grid-aime2.json` | honest-billing AIME re-run | **steer+compress PROMOTED again** (σ×κ ×2); Δlatency CIs |
| `steering-modes.json` | the hypercube (5 arms) | refine wins; structural captures ⅔ free; contrastive negative; belief = broken channel |
| `steering-belief2.json` | belief re-run on `consult()` | competitive (−6.3pp CI[−18.8,0.0], cheaper-leaning) — E8's first honest measurement |
| `matrix-*.json` (8 files) | the model × cell matrix | sign-flip-with-model-strength headline; κ-scales-with-price; kimi excluded (channel) |
| `corpus-ab-relevance.json` + `eops-corpus-ab-*.jsonl` | **the OG line**: relevance-primed A/B + the accumulated corpus | +4.2pp n.s., slope shrinking, holdout inert → E3 |
| `e3-memory-ab.json` | E3 run 1 (n=16, frozen 1-row store) | certified = first GROWING slope of any memory arm (−4.7→+6.3) at −13% cost; 1-row store → unattributable, → decisive run |
| `e3-memory-ab-decisive.json` + `e3-certified-store/` | **E3 decisive** (n=24, in-stream admission every 8) | both admissions REJECTED (53.5/40.6 vs incumbent 65.3/68.8) → store frozen → the lift present is SELECTION not accumulation: certified best arm on score (66.4%) AND cost (−12.3%); holdout cert-vs-prose +31.7pp CI[+13.3,+48.3] (n=6); cert-vs-cold +23.3pp n.s.; prose negative again. The flywheel can't turn on a score-superiority bar — admission is the binding constraint (3rd occurrence of the pattern) |
