> **Track:** Architecture (research) · **Role:** strategy map · **Status:** open — taxonomy + stress-tests, 2026-06-09

# The optimization space — axes, not a ladder

A stress-test of the question "does GEPA / steerers / HALO contextualize everything we
could be working on?" Answer: **no.** Those are all points in ONE region of a larger
space, and the region we have been grinding (within-run mechanics) is the one where the
evidence keeps coming back null-or-marginal, while the region the canon names as the
actual success criterion (the across-run flywheel, Gate B) has **n=0 measurements**.

This doc holds the taxonomy and the canon-compatibility audit. One stress-test doc per
layer lives beside it (`layer-*.md`).

## Why axes, not layers

The original framing ("6 layers") conflated independent dimensions. The clean model: an
optimization effort is a **point in a 6-axis space**, and any "ladder" (the canon's
L0→L1→L2 rungs) is one *path* through it — not the space itself.

| Axis | Values | Where this repo is today |
|---|---|---|
| **Timescale** | within-run · across-run · meta (optimizer-of-optimizer) | almost all effort within-run; across-run n=0 |
| **Target** | prompt (content) · topology/strategy (structure) · knowledge/corpus (memory) · policy (routing, ask-vs-act, budget) · tasks (curriculum) | prompt = measured (tie); topology = open; the rest untouched |
| **Objective** | single score · multi-objective vector (correct·fast·secure·cheap) | every gate so far single-objective — **in tension with the canon** (see audit) |
| **Validity scope** | one domain · cross-domain · live product | n=1 domain (EOPS-itsm) for the headline result |
| **Serving architecture** | in-process (observe()/Corpus) · platform-served (Tangle Intelligence) | all in-process; Intelligence is export-only today |
| **Authorship** | human-built · agent-authored | human; `defineStrategy` makes agent-authored feasible |

Reconciliation with the canon's ladder: the rungs (L0 worker → L1 controller → L2
meta-optimizer) are the **timescale × target** diagonal. The axes add what the ladder
hides: objective shape, validity scope, serving topology, authorship. Both frames are
compatible; the ladder answers "is level n real?" (lift on level n−1), the axes answer
"where is the unexplored headroom?".

## The map with evidence status (2026-06-09)

| Region | Evidence | Verdict |
|---|---|---|
| within-run steering, stateless retrieval (FinSearchComp) | n=40, BH-corrected | **NEGATIVE** (steering −10/−15pp; compute +22.5pp) |
| within-run steering, stateless codegen (HumanEval) | n=82 ×2, paired-bootstrap | **NULL** (audit −1.2 n.s.) / **NEGATIVE** (exec-grounded repair −17.1 SIGNIF) |
| within-run depth+keep-best, stateful agentic (EOPS) | n=16 + holdout replication | **POSITIVE** (+16.4pp CI[+5.3,+29.8]; +8.3pp on disjoint slice) |
| analyst-prompt GEPA | search n=12 + frozen holdout n=6 | **NULL** (holdout exact tie vs default) |
| within-run topology (adaptiveRefine, mix/widen) | unmeasured | open — the one within-run lever left |
| across-run corpus flywheel (primed-vs-cold) | **n=0** | the canon's stated success criterion, never measured |
| multi-objective vector | **n=0** (machinery exists: `paretoFrontier`) | canon-required, unwired |
| cross-domain (csm/hr/email/… gym splits) | **n=0** | nearly free to run |
| live-product transfer | **n=0** | the product-value claim's own falsifier |
| tool/harness augmentation | SimpleQA: you.com lifts cheap models +70pp to parity | the **largest single effect measured anywhere in this program** |
| agent-authored strategies | feasible since `defineStrategy`; unmeasured | the skillification goal |

Reading of the map: the program has **over-sampled one cell** (within-run × prompt/strategy ×
single-objective × itsm × in-process × human) and the cells the canon itself designates as
the product (across-run, multi-objective, product-scope) are empty.

## Canon-compatibility audit

Checked against `architecture.md`, `learning-flywheel.md`, `eval-substrate.md`,
`roadmap-rsi.md`, `architecture-interpretations.md`, `.evolve/current.json`.

**Compatible / direct alignment:**
- Across-run = success (architecture §0.5.4: "That across-run curve is RSI, and it is THE
  success criterion (Gate B)"; roadmap: Gate B "not yet instrumented"). The axes frame
  *restates* the canon's own acknowledged gap.
- "Topology over prompt as the next within-run lever" — consistent with roadmap Phase 3
  (grow the ISA) being gated on findings reaching the planner.
- Platform-served intelligence is a **deployment-topology choice**, not an architecture
  violation — the kernel owns Scope/MCP/profiles; analysis attaches via hooks
  (architecture §1b). See `layer-intelligence-serving.md` for the one hard constraint
  (the judge firewall).

**Corrections the canon forces on the new framing:**
- "Within-run steering is mostly null" is **too gentle**: the adequately-powered rung-0
  result is *negative on every slice* (learning-flywheel §Honest status). The accurate
  law: **negative on stateless retrieval, null-to-negative on stateless codegen, positive
  on stateful agentic with keep-best checkpointing.** The boundary variable is state +
  a correctable middle band + the inability to cheaply resample.
- The canon already predicted the self-refine failure (architecture §10: "intrinsic
  self-refine degrades… the driver must re-investigate, not self-critique"). Our
  HumanEval repair −17.1pp is a *confirmation*, not news.

**Tensions / staleness to resolve (documentation debt, not design conflict):**
- `learning-flywheel.md` rung-0 verdict ("steering loses") is FinSearchComp-scoped and
  now needs the domain boundary added (EOPS depth win, canonical loop, +16.4pp).
- Every gate run to date is single-objective, while architecture §0.5.2–0.5.3 mandates a
  multi-objective vector with per-objective deployable checkers. This is the **largest
  internal inconsistency between practice and canon** — see `layer-economics.md`.
- `.evolve/current.json` predates the canonical-loop result and the GEPA verdict; needs a
  state refresh (tracked separately from this doc set).

## The portfolio (what to multi-pursue)

Ranked by (decision-relevance × cheapness × independence):

1. **Across-run corpus A/B** (`layer-across-run.md`) — primed-vs-cold at equal budget.
   The thesis test; doubles as the Tangle-Intelligence-value proof.
2. **Cross-domain replication** (`layer-domain-generality.md`) — depth-vs-breadth on a
   second gym split (csm or hr). Validates or bounds the headline result.
3. **Multi-objective wiring** (`layer-economics.md`) — report the (correct, cost, wall)
   vector per strategy; lift-per-dollar. Mostly harvest, machinery exists.
4. **Topology evolution** (`layer-within-run.md`) — adaptiveRefine/mix vs refine vs
   sample, n≥24 + holdout, the fitness fn already built.
5. **Strategy-author skill** (`layer-agent-authored.md`) — an agent reads the losses and
   emits a `defineStrategy`; gate scores it. Small build; IS the skillification goal.

Explicitly **not** in the portfolio: more analyst-prompt GEPA (holdout-tied, flat
landscape), HALO plumbing (rich-analyst bet weakened by the prompt null), in-box sandbox
arms (platform-gated, #984).
