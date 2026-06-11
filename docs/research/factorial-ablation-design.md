> **Track:** Experiments (research) · **Role:** the paper's experimental design — optimization
> coordinates as independent, toggleable factors · **Status:** factor model defined; grid runner
> built (`bench/src/ablation-grid.mts`); several cells already measured (see the evidence map)

# Factorial ablation — which optimization knob contributes what?

The paper-shaped question is not "does the pipeline improve the agent" but **which optimization
mechanism contributes what, alone and in combination, at matched compute**. Each mechanism is an
independent factor with an OFF state, an ON state, and a scale; a run of the experiment is a cell
of the factorial grid; every cell is gated against the all-OFF baseline with paired statistics on
identical tasks.

## The factors

| Factor | OFF | ON | Scale | Gate |
|---|---|---|---|---|
| **σ — steering** (within-run) | `sample` (blind best-of-k) | `refine` (critique-steered continuation) | budget k | superiority |
| **α — self-improvement** (strategy authoring) | the fixed strategy field | `runStrategyEvolution` (population authoring, champion advances) | generations × population | superiority |
| **γ — prompt optimization** (quality) | the original prompt | a GEPA/`selfImprove` winner, **supplied as an artifact** | optimizer generations | superiority |
| **κ — prompt compression** (cost) | the cell's prompt as-is | a compression operator applied to the cell's prompt | ratio (ddmin / 50% / 25%) | **non-inferiority** (score holds, spend drops) |

Design rules that keep the factors honest:

- **γ runs once, outside the grid.** Prompt optimization is expensive; its winner enters cells as
  an input artifact (a file). This also keeps the factor clean: the grid measures *having* an
  optimized prompt, not the optimizer's run-to-run variance.
- **κ composes after γ.** Compression applies to whatever prompt the cell carries — original or
  optimized — so the γ×κ interaction (compress the champion) is a first-class cell, and the
  two-stage pipeline (optimize for quality, then minimize for cost) is just the (γ=on, κ=on) cell.
- **Equal compute is structural** (the conserved pool) and **verified** from recorded per-cell
  `{usd, tokens}` — with uncapped turns, parity is checked, never assumed.
- **One holdout discipline for the whole grid**: train slices for any search (α), a disjoint
  never-touched slice for every gate decision; the κ gate is non-inferiority (its win condition is
  cost, not score).

## Naming note (for the paper)

The κ task is **prompt minimization**: find a minimal prompt preserving task performance. The
method family is **prompt compression** (LLMLingua/LLMLingua-2, selective-context). The
every-Nth-character baseline is **delta debugging** (ddmin) applied to prompts — the canonical
minimal-preserving-input algorithm — which makes it the principled floor, not a strawman: a
learned compressor that cannot beat character-level deletion is not earning its complexity.

## The grid (the runnable subset)

With γ as an input artifact, a full sweep is 2(σ) × 2(α) × 2(γ) × 2(κ) = 16 cells; the
informative core is 8 (α=on subsumes σ as a searched dimension). `bench/src/ablation-grid.mts`
runs any requested subset by name:

```
CELLS=base,steer,evolve,gepa,compress,gepa+compress,steer+compress,evolve+gepa \
  N=24 HOLDOUT=12 BUDGET=4 tsx src/ablation-grid.mts
```

- `base`         σ0 α0 γ0 κ0 — sample on the original prompt (the control every gate pairs against)
- `steer`        σ1 — refine on the original prompt
- `evolve`       α1 — the evolution engine over the fixed field
- `gepa`         γ1 — sample on the optimized-prompt artifact (`PROMPT_ARTIFACT=path`)
- `compress`     κ1 — sample on the compressed original
- `gepa+compress`, `steer+compress`, `evolve+gepa`, … — the interaction cells

## The evidence map (cells already measured, pre-grid)

| Cell contrast | Result | Where |
|---|---|---|
| σ main effect (steer vs base) | **+16.4pp CI[+5.3,+29.8]** on stateful EOPS; NEGATIVE/null on stateless retrieval/codegen — a measured σ×domain-state interaction | canonical-loop result; the domain-boundary law |
| γ main effect (analyst prompt) | **null** — frozen-holdout exact tie at our budgets | the GEPA powered run |
| α main effect (EOPS, budget 3–4) | two HOLDs (underpowered + design flaw), one powered run in flight | the flywheel/evolution runs |
| κ main effect | gate built (#243/#244); first sweep queued | `prompt-compression-gate.mts` |
| α×tools interaction | the autopsy-reopened question (introspection fixed the harness) | the discriminating run |

The grid does not re-litigate settled cells; it fills the empty ones (κ, γ×κ, σ×κ) and makes every
future claim a named cell instead of an ad-hoc run.

## Threats to validity (carried into the paper)

- **Power**: ±9pp run-to-run noise at n=12 tasks (measured); cells need n≥24 train / ≥12 paired
  holdout, and the band screen (headroom-only holdout) where saturation dilutes contrasts.
- **Caching**: κ claims must be settled in real spend, never token counts — prompt caching can
  invert a token-count "win".
- **Adaptive reuse**: α cells author from train losses only; every gate slice is fresh. The
  leakage-bounded channel (`lossesDetail: 'binary'`) is the dose-control arm (E1-coarse).
- **One-domain exposure**: EOPS-itsm is the workhorse; cross-domain cells (commit0, verifier-math)
  are the same grid at a different `ENV` — the transfer claim needs at least two.


## The formal object (added 2026-06-11)

A configuration is a point in a finite product lattice
`c = (σ, α, γ, κ, m, d, b) ∈ Σ × A × Γ × K × M × D × B`; the response is vector-valued
`J(c) = (score, cost, latency)`, estimated per cell from paired task-level deltas. The
"hypercube" is the binary on/off projection of (σ, α, γ, κ) — our cell-naming scheme.
In design-of-experiments language this is a fractional factorial; the estimands are main
effects and two-way interactions as paired contrasts, each with its own promotion rule.

**The steering subspace is a true {0,1}⁴**: who steers (LLM/deterministic) × what
information (single trajectory/population) × what is steered (content/budget) × what form
(advice/verdict). Measured corners (AIME n=16, 2026-06-11): `refine` = (LLM, single,
content, advice) 50.0%; `structural` flips axis 1 → 43.8% (the deterministic floor
captures ~⅔ of the lift; the LLM critic's marginal value is unproven at this n);
`contrastive` flips axis 2 → 25.0% (significantly negative — context dilution);
`belief` flips axes 3+4 → 12.5% — **autopsied: the channel was broken, not the idea**
(the findings pipeline strips the verdict format; the controller never received a
decision; corner UNMEASURED — see adaptive-computation-program.md E8). Twelve corners remain
unexplored and enumerable (e.g. deterministic+budget = rule-based early stopping). Note
the exploration shape: a Hamming ball of radius 1–2 around the incumbent — and the
measured σ×κ interaction (neither factor promotes alone; the combination promoted, ×2)
is the standing exhibit for factorial over one-factor-at-a-time designs.

## Measured cells update (2026-06-11)

- σ×κ (`steer+compress`): **PROMOTED non-inferior-and-cheaper ×2** (incl. on honest
  critic billing; savings CI[+0.0006,+0.0061]; the compression call broke even after 1
  task; Δlatency +38.8s CI[19.4,56.7] = steering's real price).
- σ on stateless hard math: +18.7pp (50.0 vs 31.3) — refines the domain-boundary law
  (carried messages behave like state on competition math).
- Funnel-alignment law (from the cost run): the search-side champion tie-band must be no
  stricter than the gate's tolerance, or promotable candidates die in search.
- The model×cell matrix (8 workers × 4 cells, identical tasks) is the M-axis sweep.
