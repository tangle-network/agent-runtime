> **Track:** Architecture (research) · **Role:** layer stress-test · **Status:** mostly settled — boundary law established, one lever open

# Layer: within-run optimization

**The claim under test:** spending a run's compute *adaptively* (steer, refine, branch)
beats spending it *blindly* (best-of-N resampling) at equal budget.

## Evidence (all paired, equal-compute, deployable checkers)

| domain | setup | steering vs compute | verdict |
|---|---|---|---|
| FinSearchComp (stateless retrieval) | n=40, BH | refineHand −10pp, refineGepa −15pp; compute +22.5pp (p=.008) | **negative** |
| HumanEval (stateless codegen) | n=82, LLM-audit steer | −1.2pp CI[−8.5,+6.1] | null |
| HumanEval (stateless codegen) | n=82, exec-grounded self-repair (`run_tests` tool) | **−17.1pp** CI[−26.8,−7.3] | **significantly negative** |
| EOPS-itsm (stateful agentic), flat hand-rolled loop | n=24 | −9.9pp → autopsy: scoring asymmetry | artifact (see below) |
| EOPS-itsm, **canonical loop** (Supervisor + observe()) | n=16 | **+16.4pp** CI[+5.3,+29.8], 6W/0L | **significantly positive** |
| EOPS-itsm, disjoint holdout slice | n=6 | +8.3pp (both analyst prompts) | replicates |
| analyst-prompt GEPA | search n=12, frozen holdout n=6 | holdout: winner +8.3 = baseline +8.3 | **null** (prompt not binding) |

## The boundary law (the durable output of this layer)

Steering pays **iff** the task is *stateful* (the artifact accumulates, so an observed
correction is worth more than a fresh sample), has a *correctable middle band* (partial
credit a steer can move), and resampling is *expensive or impossible* (you can't restart
a 6-step ticket migration). On stateless generation, fresh samples explore for free and
any anchored continuation loses — exactly the canon's prediction (architecture §10).

Two engineering laws fell out, both load-bearing:
1. **Keep-best checkpointing is mandatory.** Steering *reaches* better states then
   *undoes* them (measured degradation +6–8pp). Score/keep the best-verifying
   checkpoint, never the final state. The flat-loop "depth loses −9.9pp" result was
   entirely this scoring asymmetry (autopsy `.evolve/autopsies/2026-06-08-…`).
2. **Architecture is a variable, not plumbing.** The same model/domain/n flipped from
   "depth loses" (flat loop, hand-rolled steerer) to "+16.4pp significant" (Supervisor +
   real `observe()` analyst). Measure on the canonical stack only.

## Stress test (strongest objections)

- *"+16.4pp is one domain, one model, n=16."* True. The holdout replication (+8.3pp,
  disjoint tasks) helps but cross-domain (layer-domain-generality) is the real answer.
- *"The analyst adds nothing — GEPA tied."* The correct reading is narrower: the
  analyst-prompt *text* is not binding at this budget. The analyst *mechanism* is in
  every positive cell, and removing it (generic nudge, flat loop) degraded results. The
  untested attribution experiment: canonical depth WITHOUT any analyst (pure
  continuation) vs with — isolates the analyst's marginal value.
- *"Maybe more shots, not steering, explains depth's win."* No — equal completions by
  construction (conserved budget pool), and breadth had ≥ compute in the wins.

## What's left in this layer (and what to stop)

**Open lever — topology/strategy:** `adaptiveRefine` (branch-when-stuck), refine/sample
mixes, widen gates. Now cheap to test (`defineStrategy` + `runBenchmark` + holdout).
The one within-run experiment still worth funding: **strategy tournament at n≥24 +
frozen holdout.**

**Stop:** analyst-prompt GEPA at small n (flat landscape, holdout-tied); steering
experiments on stateless domains (three independent negatives); rich-analyst plumbing
(HALO OTLP emitter) until a topology win re-motivates it.
