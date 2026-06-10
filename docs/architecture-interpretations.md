# Architecture — Five Interpretations and the Coherence Verdict

Companion to [architecture.md](./architecture.md) (the spine) and [learning-flywheel.md](./learning-flywheel.md) (the moat thesis). Where `architecture.md` states *what the system is meant to be*, this doc stress-tests *whether it coheres* — by reading the same atom through five independent lenses, including an adversarial one, and recording where each framing holds and where it breaks. The five lenses converge on one diagnosis and one decision gate; that convergence is the point.

`Status` (re-verified against `origin/main`, 2026-06-10): two of this doc's load-bearing claims have since been measured or built. (1) The `analyses` channel the diagnosis hinges on now **exists** — `PlannerContext.analyses` (`src/runtime/driver.ts:80`), populated by the `analyze` hook on `createDriver` — **wired but not yet fed live by any bench**. (2) **Gate A (§5) has been run and cleared**, on the `Scope`/`Supervisor` + `observe()` substrate (EOPS itsm: depth +16.4pp CI [+5.3, +29.8], n=16 — details in §5), domain-bounded. The lens analysis below is kept as the stress-test it was; the per-claim corrections are inline. See the evidence anchors (§7) for file:line.

---

## 1. The honest one-liner

Strip the vocabulary and the built system is **best-of-N sampling + a selector + offline prompt-tuning (GEPA)**, with an *intrinsic self-refine* toggle bolted on — and **the refine toggle is the half that loses**. The "recursive adaptive driver" that would make it more than that is real in shape but not wired. The entire gap is one missing edge:

> The driver never reads the analyst's findings. It decides from an exit code, not a diagnosis.

Everything below is an elaboration of that sentence from a different angle.

*(Status: the edge now exists — `PlannerContext.analyses` + the `analyze` hook,
`src/runtime/driver.ts:80` — built and tested, not yet fed live by any bench. The
within-run question the gate poses has since been answered positively on the
`Scope`/`Supervisor` substrate — §5.)*

---

## 2. Master diagram — the atom, the two timescales, the missing wire

```
  OUTER LOOP  (slow, cross-task)  =  OPTIMISATION
  ┌────────────────────────────────────────────────────────────┐
  │  traces + corpus ─▶ runAnalystLoop / GEPA                    │
  │                         │                                    │
  │              proposeFromFindings                             │
  │                 ╱               ╲                            │
  │      knowledgeAdapter      improvementAdapter                │
  │       (wiki pages)          (prompt / tool / rubric)         │
  │        = CORPUS              = POLICY   ◀─ the ONLY RSI path  │
  │            │                     │                           │
  │   ┌────────┴─┐  held-out   ┌─────▼──────┐                    │
  │   │  JUDGE   │════delta═══▶│ gate: ship? │                   │
  │   │write-only│ (never read └─────┬──────┘                    │
  │   └──────────┘  by inner)        │ promote (OFFLINE only)    │
  └──────────────────────────────────┼──────────────────────────┘
                                      │  new policy
  INNER LOOP (fast, within-task) = INFERENCE
  ┌───────────────────────────────────▼──────────────────────────┐
  │  plan() ─▶ {refine | fanout | stop} ─▶ workers ─▶ selector     │
  │    ▲ reads history verdict.score ✓          │                 │
  │    │                                         └▶ TODAY = JUDGE  │
  │    ╳  analyses[] → plan(): WIRED (driver.ts:80), not fed live  │
  └───────────────────────────────────────────────────────────────┘
   The ╳ was the gap when the lenses ran: the driver decided from a
   return code. The channel now exists; no bench feeds it live yet.
```

Two structural facts as of the original audit, with their current status:

1. `PlannerContext` had no `analyses` channel. **Now it does** — `analyses?:
   ReadonlyArray<AnalystFinding>` (`src/runtime/driver.ts:80`), populated by the optional
   `analyze` hook on `createDriver`, so the planner can decide from the diagnosis, not the
   verdict score alone. Honest status: **wired but not yet fed live by any bench** — the
   diagram's ╳ marks the edge as built-not-exercised, no longer as missing.
2. The selector ranked with the **judge's score** — an oracle. The deployable, no-oracle
   selector has since been **built and measured**: a **verifier-grounded** selector is
   positive on a deployable-checker domain (HumanEval, n=50, k=4: verifier-pick captures
   the full oracle ceiling; verifier − self-consistency **+12.0pp CI [+4, +22]**,
   BH-significant; random@k − blind +18.0pp CI [+8, +30]), while answer-agreement
   selectors are negative (finsearch −8.2pp n=51; aec −9.4pp n=16). The selector needs a
   runnable checker, not answer-vote.

The discipline that the architecture leans on — *selector ≠ judge*, judge write-only — is exactly what keeps the outer loop from optimising toward its own grader. The temptation to wire the judge into ranking (it is the cheapest, strongest selector) is the thing the design must resist; the moat depends on resisting it.

---

## 3. Five interpretations

| Lens | One-liner | Does it add anything over the boring baseline? | Where it breaks |
|---|---|---|---|
| **Test-time-compute / search** | Driver = search controller, selector = ranking, judge = oracle reward | Only if a *learned* controller beats fixed best-of-N | Controller is open-loop; refine loses to flat sampling at matched budget |
| **Active learning / experimental design** | Driver = acquisition function picking the next most-informative source | **Yes — it makes the goal measurable**; the best frame for the research use case | Needs a *calibrated* gap signal; today "gap" is an LLM vibe |
| **Program synthesis** | Driver = JIT emitting a topology program; runLoop = interpreter | Only if the ISA grows `seq`/nesting and the emitter reads an IR | It's a **3-opcode flat enum**, not a DSL; GEPA tunes a prompt comment, not the emitter |
| **Two-timescale / RSI** | Inner answers; outer rewrites the answerer from traces + judge | Only with the missing wire **and** a cross-benchmark transfer test | RSI is the **shape, not the system**; no transfer test exists |
| **Skeptic / Occam** | self-refine (loses) steering best-of-N (wins) | No — vocabulary, not capability | Overclaims past "untested ≠ disproven" for a trace-fed driver |

### 3.1 Test-time-compute / search

A search over candidates: the driver chooses width/depth/stop, the selector ranks, the judge is the held-out oracle. This frame *predicts the empirics exactly* — parallel sampling with a sound selector wins (Brown 2024, Wang 2022, Lightman 2023); intrinsic sequential self-refine degrades on hard tasks (Huang 2023, Kamoi 2024, Stechly 2024).

```
        root task  (search node)
             │  driver = controller picks a move
   sample/fork (best-of-N, width N) ── the WIN today
      ╱        │        ╲
    c1        c2        c3      ← workers (rollouts)
   v=.4      v=.8      v=.6     ← selector value
      ╲        │        ╱
     argmax v ─▶ pick c2
             │  steer/seq (deepen one path) ── LOSES today
           c2'  v=.65   (refine can BREAK a good leaf)
             │  stop
   ════════ search boundary ════════
     JUDGE = held-out oracle (write-only; must NOT be the v above)
```

Breaks: the load-bearing asset is a **sound value function**, and there is no evidence `verdict.score` is calibrated to true reward. Until the no-oracle selector is measured, "best-of-N wins" is unverified *for this system*. The controller is open-loop (reads a thin history summary, no analyst signal), so "adaptive topology" is dominated by fixed best-of-N at matched budget.

### 3.2 Active learning / experimental design (the most useful frame for the research surface)

The knowledge-acquisition loop is an agent reducing coverage-uncertainty by choosing the next most-informative source. "Driver decides topology" becomes the precise, measurable "an acquisition function picks the next experiment."

```
   ┌──────────────────────────────────────────┐
   │  BELIEF STATE = corpus / LLM wiki          │
   └──────────────────────────────────────────┘
        │                              ▲ ingest+merge
        ▼                              │  (run experiment)
   ┌────────────────────┐        ┌───────────┐
   │ GAP ESTIMATOR       │        │  WORKER   │
   │ wiki critic:        │        │ read /    │
   │  orphan = low cov   │        │ clip /    │
   │  contra = high var  │        │ sweep /   │
   │  stale  = decay     │        │ scrape    │
   └────────────────────┘        └───────────┘
        │  gaps / uncertainty           ▲ chosen source
        ▼                               │
   ┌────────────────────────────┐       │
   │ ACQUISITION FN  (= driver)  │───────┘
   │ argmax expected info gain   │
   │ uses TRACE signal only —    │
   │ NOT the held-out judge      │
   └────────────────────────────┘
        │ stop when coverage ≥ target or ΔEIG < ε
        ▼
   ····· WRITE-ONLY JUDGE = held-out task (never steers) ·····
```

Holds: it converts the unfalsifiable "good topology" into a textbook objective (expected information gain) with a literature, a calibration test, and a principled stop rule. It retro-explains rung-0: a miscalibrated acquisition function underperforming random sampling is the canonical active-learning failure. It even maps onto shipped infra — `proposeSynthesisTargets` (variance / coverage / failure-cluster / difficulty-gap → priority) is a real, statistically-grounded acquisition function, pointed at the eval dataset; the corpus-axis version is a port, not a greenfield method.

Breaks: the load-bearing assumption — a **calibrated** gap signal — is absent. The wiki critic emits LLM-judged contradictions/staleness/orphans and a single self-reported `confidence` scalar. That is a vibe, not a posterior variance, and honouring *selector ≠ judge* gets *harder*: if "gap" is an LLM judgment, it can implicitly encode "what the judge will reward." The frame demands the gap signal be **structural** (graph topology, citation/embedding density, redundancy-discounted coverage), not opinion.

### 3.3 Program synthesis / interpreter

`runLoop` is a fetch-execute-halt trampoline; the planner is a JIT that emits one instruction per round. The vocabulary describes the real control flow — but as a *language* it is barely one: the implemented ISA is a 3-value flat union `{refine, fanout, stop}`, emitted one-at-a-time, with no `seq`, no nesting, no emittable `select`. The two ops that would make it non-vacuous (`select`, `seq`) are interpreter builtins the agent cannot author; GEPA rewrites a static directive string (a `#define`), not the emit function; and the emitter compiles from a return-code-plus-truncated-stdout summary, not an IR. Today: a JIT in shape, a switch statement in substance. *(Status: `select` is now emittable — `TopologyMove`, `src/runtime/driver.ts:52` — and the richer program space this lens asks for exists as `defineStrategy` (`src/runtime/strategy.ts`): a strategy is ordinary code, which supersedes growing the move enum.)*

### 3.4 Two-timescale / recursive self-improvement

Inner fast loop drives an answer now; outer slow loop (GEPA / `runImprovementLoop`) rewrites the driver's own policy from accumulated traces + judge scores, gated on a held-out delta. The recursion is real *in shape* — the optimiser is an atom editing an atom's policy — but **not closed**: `improvementAdapter` rewrites the *worker's* prompt, not the *driver's* planner policy; the rewritten policy never re-enters `plan()` online; and there is **zero cross-benchmark transfer test**. RSI is the shape, not the system. The frame's value is its sharp corpus-vs-policy split: **wiki growth is an input to inference; only prompt/tool/policy rewrites are RSI.** The research-acquisition loop is RSI only if findings about *which acquisition move paid off* rewrite the driver's acquisition policy — which needs the missing wire.

### 3.5 Skeptic / Occam (adversarial)

```
GRAND (as pitched):              ACTUALLY WIRED (Occam):
  task ─▶ recursive atom           task ─▶ planner LLM
     ▼  reads traces+findings,         ▼  sees only prior outputs
        decides topology  ▲                + JUDGE score
     ▼                    │(NOT          ▼
  workers ─▶ analyst ─────┘ WIRED)    refine/fanout/stop  ← self-refine
     ▼                                   ▼                  + a toggle
  selector (trace-only) ─▶ winner      workers ─▶ outputs
     ▲                                   ▼
  JUDGE write-only                     pick best ◀ uses JUDGE (oracle) ✗

COLLAPSES TO TWO BORING THINGS THAT ALREADY WORK:
   (a) best-of-N  ─▶  sound verifier  ─▶  pick        [WINS]
   (b) RAG / corpus-build  ─▶  retrieve+dedup+cite    [WINS]
```

The strongest good-faith case: what's wired is the losing half (self-refine) steering the winning half (best-of-N), with the winning half's critical component (a sound selector) faked by the judge. Renaming the stack a "recursive atom that decides topology" adds vocabulary, not capability. The one honest concession the skeptic owes: **"unbuilt and untested" ≠ "disproven."** A planner that reads real traces + analyst findings is a genuinely different object from intrinsic self-refine; rung-0 only falsified the static planner.

---

## 4. Does it cohere?

**As built: no.** All five lenses — including the adversary — land here independently. The system is intrinsic self-refine (the half the literature and rung-0 say loses) steering best-of-N (the half that wins), with the winning half's load-bearing component — a sound, non-oracle selector — substituted by the judge in every measurement so far. That is not a new method class; it is a `while` loop with one tunable branch in compiler vocabulary.

**As designed: conditionally yes — gated on exactly one measurement.** Five independent framings wrote the *same* gate (§5), which is why it is trusted rather than asserted. The strongest case *for* the grand version is the research-acquisition surface specifically, because acquisition is **non-myopic and stateful** — every ingest permanently changes the knowledge base for all future queries. Best-of-N has no concept of "this expansion improves the substrate." That is precisely the regime where a driver conditioning on coverage-gaps could beat blind sampling, and where the cross-query flywheel is real rather than aspirational.

---

## 5. Gate A — the decision gate for the recursive-driver layer

Build the adaptive driver **only if** this comes back positive:

> On a held-out benchmark, at **equal worker-compute budget** (`k` counts worker ROLLOUTS — each may be a full multi-turn/stateful trajectory, not a single shot), does a **trace + analyst-findings-fed** driver, scored by a **sound non-oracle selector**, beat **blind random@k** selected by that *same* selector — by a statistically significant margin (n large enough for p < 0.05) that **survives test-retest of the selector**?

Until `refine@k-with-findings > random@k at equal compute under a non-oracle selector`, the recursive-driver layer is unjustified overhead and only the minimal honest version (§6) should be built.

**Measured (2026-06-09): POSITIVE, domain-bounded.** On EnterpriseOps-Gym itsm,
depth-steered continuation (analyst-fed, `observe()`) beats blind breadth at equal
compute under keep-best checkpoint scoring: **+16.4pp CI [+5.3, +29.8], 6 wins / 0
losses, n=16**, deepseek-v4-pro; replicated **+8.3pp** on a disjoint task slice. The
gate cleared on the `Scope`/`Supervisor` + `defineStrategy` substrate
(`src/runtime/strategy.ts`), **not** on the `runLoop`/`PlannerContext` path this doc
instruments. The boundary: **negative on stateless retrieval** (FinSearchComp),
**null-to-negative on stateless codegen** (HumanEval steer null at equal k;
exec-grounded repair −17.1pp), **positive on stateful agentic domains** with a
correctable middle band scored keep-best (EOPS).

**Gate A ≠ project success.** Gate A is the inner GO/NO-GO for *one* component (the within-run driver). The product-success gate is **Gate B** — a positive cross-run score-vs-run slope under a frozen-controller control ([learning-flywheel.md](./learning-flywheel.md)), which is currently **UNMEASURED** (cf. the zero cross-benchmark-transfer admission, §6). A failed Gate A deletes within-run steering; it never bears on Gate B.

---

## 6. What this means for the research-acquisition surface

The **minimal honest version** survives every critique and yields the proven more-compute win immediately:

1. **Fan-out retriever** — N parallel collection branches over `{deep-read paper, transcribe clip, web-sweep, targeted image/data scrape}`. Plain best-of-N over actions.
2. **A deployable, non-oracle selector** scoring each ingest on *trace-observable structural* signal — citation coverage, contradiction-lint pass, staleness, novelty-vs-existing-wiki. This is the missing piece that makes best-of-N actually pay, and it is the same build as landing the *selector ≠ judge* firewall.
3. **The `llm-wiki` maintainer+critic** as the dedup / cite / lint sink (already exists as a skill).

Then run the §5 gate. If a findings-fed driver beats random@k at equal k under that sound selector, the adaptive driver earns its complexity and is built on top — and this surface becomes the first honest validation of the RSI thesis. If not, ship 1+2+3 — agentic RAG with a verifier — and delete the steering machinery with a clear conscience.

---

## 7. Evidence anchors

- `src/runtime/driver.ts` — `PlannerContext` (`:64`) with the `analyses` channel (`:80`)
  and the `analyze` hook on `createDriver`; `TopologyMove` (`:52`) — refine/fanout/stop
  plus an emittable `select`.
- `src/runtime/run-loop.ts` — `defaultSelectWinner` (`:983`) / `branchPoint` (`:797`);
  `RunLoopOptions.selectWinner` (`:104`) is the selector-injection seam.
- `src/runtime/strategy.ts` / `src/runtime/strategy-author.ts` — `defineStrategy` /
  `authorStrategy`: the program space where the Gate-A-positive strategies run.
- `src/analyst-loop/` — `runAnalystLoop`; the driver-side seam is the `analyze` hook.
- Prompt-space optimization lives in agent-eval (`selfImprove`); the analyst-prompt
  coordinate is measured flat (frozen-holdout tie, 2026-06-09).
- `bench/src/selector.ts` + `bench/src/corpus-replay.mts --selector` — the deployable
  selector and its offline replay harness.
- `bench/src/refine-loop.ts` — shared k-shot loop.
- `bench/src/finsearch-loop.ts` / `bench/src/run.ts` — where random@k / pass@k is
  computed; the original headline `random@3` was judge-selected (oracle upper bound).

**Literature.** Parallel sampling + sound selector wins: Brown 2024 (repeated sampling), Wang 2022 (self-consistency), Lightman 2023 (process reward). Intrinsic self-refine degrades on hard tasks: Huang 2023, Kamoi 2024, Stechly 2024. The loop is not a new method class — it is a known combination whose winning half is not yet honestly built.
