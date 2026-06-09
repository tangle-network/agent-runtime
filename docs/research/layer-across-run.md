> **Track:** Architecture (research) · **Role:** layer stress-test · **Status:** THE unmeasured thesis — n=0, highest priority

# Layer: across-run learning (the flywheel)

**The claim under test:** run N+1 is measurably better than run N because the system
*learned* from run N — the corpus of trace-derived findings primes future runs. This is
the canon's success criterion verbatim (architecture §0.5.4: "the across-run curve is
RSI, and it is THE success criterion (Gate B)"; learning-flywheel §1).

## Status: the embarrassing asymmetry

Within-run mechanics have ~6 adequately-powered measurements (mostly null/negative).
Across-run learning has **zero**. The machinery is wired (`observe()` → `Corpus` →
`renderCorpusToInstructions` → next-run priming; demonstrated live in `fleet.mts`,
"carrying 2 prior learnings"), but the *benefit* has never been measured. The ledger has
called the primed-vs-cold A/B "the cheap test that makes it pay rent" since 2026-06-08.

## The experiment (designed, runnable now)

**Primed-vs-cold at equal budget.** Two arms over the same task stream (EOPS split, or
ideally a *sequence* so learning can accumulate):
- **cold**: every run starts fresh (the canonical loop as measured).
- **primed**: before each run, `corpus.query(task tags)` → top-k high-confidence facts
  injected into the worker/analyst context; after each run, `observe()` appends.

Score both with the same deployable verifier; the metric is the **slope** (does primed's
advantage *grow* over the stream — the flywheel signature) and the endpoint lift. Frozen
holdout: a final disjoint slice where primed keeps its corpus but cold stays cold.

Falsifiers to design against (the stress test):
1. **Context pollution** — injected facts displace task-relevant context and *hurt*
   (the FinSearch lesson: workers got advice and ignored it; fleet.mts observed the
   same). Mitigate: cap k, relevance-rank, measure a k=0/2/5 dose curve.
2. **Stale facts** — the gym DB resets per task; "learnings" about *instances* are
   noise, only *procedural* learnings transfer ("verify before mutate", "SLA must be
   relinked after priority change"). The corpus schema already separates `area`/`claim`;
   the A/B should tag procedural-vs-instance and report both.
3. **Judge leakage** — corpus facts must remain trace-derived (`derived_from_judge:
   false` is enforced structurally in `observe()`); a primed win that came from leaked
   verdicts would be Goodhart, not learning.
4. **Worker disregard** — measured before (advice ignored). Track *uptake*: did the
   worker's tool sequence change in the direction of the injected fact?

## Why this layer dominates the portfolio

- It is the **stated product** ("the moat is the cross-benchmark learning flywheel",
  architecture §8) and the only layer whose success directly justifies the corpus, the
  judge discipline, and the RSI framing.
- The within-run results make it *more* urgent, not less: if adaptive compute inside a
  run is mostly worthless, the entire bet collapses onto memory across runs.
- It is the natural junction with **Tangle Intelligence** (see
  `layer-intelligence-serving.md`): a positive primed-vs-cold result is simultaneously
  the proof that a hosted corpus/findings service has product value — the same
  experiment, two strategic answers.

## Expansion beyond the first A/B

- **Retrieval-steered analyst**: the analyst's context includes findings from *past
  similar failures* (corpus query keyed on the current trace), not just the current
  trace — the cross-run version of `observe()`.
- **Cross-benchmark transfer** (the full Gate B): learn on EOPS-itsm, measure lift on
  csm/hr — does *procedural* knowledge transfer across domains? This is the actual moat
  claim and it has a concrete falsifier (instance-knowledge won't transfer; procedural
  might).
- **Corpus curation as the optimization target**: once priming shows any lift, *what to
  keep* (confidence thresholds, decay, dedup) becomes the GEPA-optimizable surface —
  optimizing memory instead of prompts. Note this is exactly where the prompt-GEPA
  machinery transfers after its within-run null.
