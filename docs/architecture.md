# Architecture — The Spine

> **One recursive agent-loop. Two timescales. Many benchmarks.**
>
> Canonical as of **2026-06-03**. This doc is the single spine that unifies
> `docs/learning-flywheel.md` (the theory + the moat) and
> `@tangle-network/agent-eval` `docs/design/self-improvement-engine.md` (the
> optimization-time engine). Where this conflicts with an older doc, **this
> wins**; the older docs are being consolidated into this spine (§12). If you are
> an agent in another repo building a new benchmark: **read §1, §6, §9 — you only
> write an adapter, never a new loop.**
>
> **Status — built vs designed (verified against `origin/main`).** The *scaffold*
> is real: the recursive atom (`createDynamicDriver` + `runLoop`), the shared
> `runRefineLoop`, GEPA over static directives, the corpus + external judge. The
> *load-bearing intelligence* is **designed, not wired**: `PlannerContext`
> (`src/loops/drivers/dynamic.ts:51-60`) has no `analyses` channel, so the driver
> decides from a verdict score, not a diagnosis; `TopologyMove` (`dynamic.ts:43-48`)
> is a flat 3-opcode enum (`refine|fanout|stop`) — `select`/`seq` are not
> emittable; `runAnalystLoop` has zero consumers under `src/loops/drivers/`; the
> selector is currently faked with the judge (oracle). The coherence analysis
> ("does this even make sense?") is in
> [architecture-interpretations.md](./architecture-interpretations.md); the
> dependency-ordered build + cleanup sequence is in [roadmap-rsi.md](./roadmap-rsi.md);
> the empirics are §11. Doc map: [docs/README.md](./README.md).

---

## 0. Why this doc exists (the moment, captured)

Two things forced this doc:

1. **The vision was real but smeared.** The architecture below was already
   designed — most completely in agent-eval's `self-improvement-engine.md`
   ("`propose()` … recursively agentic", "a loop whose step contains a loop", the
   LLM↔sandbox cost dial) and theorized in `learning-flywheel.md` (the
   `(π,τ,J,D,O)` recursion, the cross-run flywheel). But it was spread across
   ~6 documents at two different timescales with the term **"driver↔worker loop"
   overloaded**, so agents (and the lead) lost the thread.
2. **The benchmark never ran the real thing.** The FinSearchComp experiment drove
   the inner `runLoop` with a **dumb static `TopologyPlanner`** (inject the prior
   answer + a fixed "verify and revise" directive) and **never invoked ANALYZE →
   PROPOSE** — the trace-analysts and the recursively-agentic driver. All the
   intelligence lived in the *optimization* layer, pointed at surface-improvement
   PRs, and was never wired to the *inference-time* loop on a benchmark.

**Decisions locked this session** (the moment):
- The atom is **one recursive `Agent` node** (not two types).
- **Selector ≠ Judge** — selection is a first-class, deployable, learnable role;
  the judge is external, write-only, eval-only.
- **Scaffold-to-SOTA first**, then GEPA the prompts, then the learned controller.
- The **moat is cross-benchmark transfer + recursive self-improvement**, anchored
  by the external judge — the scaffold itself is table-stakes.
- **Heavy/experimental driver work runs in a sandbox/worktree** so the repo stays
  clean ("auto-research").

---

## 1. The atom — one recursive node

There is exactly one primitive. `driver`, `worker`, `selector`, `coordinator`
are **roles** of it, not separate types.

```ts
type Agent = {
  // f(trace): assemble what THIS node conditions on — the variable we kept
  // botching (we conditioned on the rejected answer instead of the evidence).
  context: (history: Trace[], analyses: Finding[]) => Prompt
  // execute the task (worker) OR compose/steer children (driver). The recursion.
  act: (p: Prompt) => Output | Program
  // told ↔ leads-with-tools. One LLM call, or a full sandbox agent.
  mode: 'llm-call' | 'sandbox-agent'
}

// A driver's `act` returns a Program: a tiny instruction set over child Agents.
type Program =
  | { op: 'sample';  agent: Agent }                 // run a worker once
  | { op: 'steer';   agent: Agent; from: Trace[] }  // next shot, conditioned on prior work
  | { op: 'fork';    agent: Agent; n: number }      // k independent attempts (parallel)
  | { op: 'select';  agents: Agent[] }              // pick among candidates (the SELECTOR role)
  | { op: 'seq';     steps: Program[] }             // compose in order
  | { op: 'stop' }
```

Everything composes from this:

```
loop (today's driver↔worker)   = seq[ sample, steer, steer, … ]
best-of-N + verify (← SOTA)    = seq[ fork(n), select ]
coordinator                    = seq[ fork(n), steer*, select ]
nested (a driver of drivers)   = sample(agent whose act → a Program)   // free, by recursion
```

The **judge is not in the graph.** It is external, write-only, and scores only
the chosen final output for evaluation — never an input to `context`/`steer`/
`select`. (Enforced: `ProposeContext.judgeScores?: never`; `assertNoJudgeVerdict`;
findings carry `derived_from_judge` provenance — see agent-eval `analyst/steer-firewall.ts`.)

---

## 2. Two timescales, one machinery (the unification)

The same `Agent` loop runs at two timescales. This is the unification the old
docs lacked — they described the optimization timescale and we accidentally ran a
crippled version of the inference timescale.

| | **Inference-time** (per task) | **Optimization-time** (across scenarios) |
|---|---|---|
| Goal | get *this* answer right now | improve a *surface* (prompt/code) to ship |
| Steer output | ephemeral next-shot context | a persisted candidate surface |
| Anchored by | the judge scores the answer | `heldOutGate` on a holdout set → PR |
| `act → Program` is | a steer over the worker's next shot | a candidate generator (worktree) |
| Where it lives today | `runLoop` + `TopologyPlanner` (we ran this **dumb**) | `runOptimization`/`runImprovementLoop` + `propose()` (**this is built**) |

Both are *"a loop whose step contains a loop"* — `driver↔worker + analyze +
propose`. The recursive `Agent` makes them the **same node** at different
settings: `act→Program` is an ephemeral inference-steer **or** a persisted
surface candidate. **The gap we must close: run the ANALYZE→PROPOSE intelligence
at inference-time, on benchmarks** — not only at optimization-time.

---

## 3. The configurable driver (the cost dial)

`mode` + the prompt give a continuous dial, already realized as
agent-eval/agent-runtime *generators* ("the same operation at two settings of the
cost dial, not two separate drivers"):

| Setting | What the driver does | Sandbox? | Existing impl |
|---|---|---|---|
| **told / `llm-call`** | one call: `context(trace+findings) → directive` | no | `reflectiveGenerator` |
| **leads / `sandbox-agent`** | a harness in a worktree that can use tools, **call or author trace-analysts**, **re-run analysis over the logs**, even **change code**, then emit the steer/surface ("auto-research") | **yes** | `agenticGenerator` |
| text-only baseline | mutate the surface text into N variants | no | `evolutionaryDriver` |

The sandbox-agent driver **runs in a sandbox/worktree** so the repo never accretes
its scratch work. Its prompt can be prescriptive ("use this directive") or
open ("here is how to call/create trace-analysts; run them over these logs; do
whatever you need; produce the next steer"). **Breadth/depth knobs:**
`populationSize` (= `fork`) and `maxImprovementShots` (= loop depth).

---

## 4. Trace-analysts are the reviewers (`f(trace)`)

Analysts review **what the worker DID** (its trace: searches, sources, tool
calls, code) and emit structured `findings` → a research report. The driver
**consumes** the findings (or, in sandbox mode, runs/authors the analysts
itself). This is the external, specific feedback the self-correction literature
says is the *necessary* ingredient (§10).

**The firewall (observations, never verdicts):** a steer may report what the
agent *did* (cite a span/event/artifact); it may **not** carry the judge's
verdict. Provenance — not evidence presence — is the discriminator
(`derived_from_judge` + `assertNoJudgeVerdict`). Same detector may inform both a
judge and a steer only behind this firewall.

---

## 5. GEPA at every level

The optimizer `O` improves any `Agent`'s `context`+prompt and the `Program` shape,
from the shared corpus, **held-out gated** (train ∩ holdout = ∅, enforced in
`runImprovementLoop`). This is the **outer flywheel**: the controller is learned,
not hand-written. Optimize for **correctness AND clean/fast trace** (Pareto), with
the external judge as the fixed anchor so the recursion can't Goodhart.

---

## 6. Benchmark = adapter (the cohesion law)

> **The loop, driver, analysts, corpus, GEPA, selector, and SOTA-comparison are
> shared and benchmark-agnostic. A benchmark contributes ONLY an adapter. No
> benchmark forks its own loop.**

An adapter supplies exactly:
- **task loader** (`loadTasks`),
- **worker profile** (the agent + sandbox backend that does the task),
- **judge** (deterministic, or verified-stable LLM; external/write-only),
- **SOTA reference** (the number/method we must beat).

Everything else is the shared spine. This is the rule that kills *"built once,
used never"*: SWE-bench, FinSearchComp, Terminal-Bench, CAD-bench, … all run the
same atom. If you find yourself writing a new `*-loop.ts`, stop — you want an
adapter + the shared loop.

---

## 7. The corpus + external judge (the substrate)

- **Corpus:** every run, every benchmark, writes full `RunRecord`s
  (`state · steer · trace · output · verdict · cost`) to one durable, queryable
  store. This is the only improvement signal; boolean scorecards delete the fuel.
- **External write-only judge:** the anchor against Goodhart. It is *never* an
  input to steering/selection.
- **Selector (distinct):** the deployable, learnable component that picks among
  candidates at inference (vote / verifier-rerank). We currently fake this with
  the judge ("any-pass") — an oracle that isn't available in deployment (§11).

---

## 8. The moat (honest)

The inference-program scaffold (compound AI systems / DSPy-style) is becoming
**table stakes** — others will have it. The defensible bet is the **cross-
benchmark learning flywheel + recursive self-improvement**, anchored by the
external write-only judge, where a controller **learns the program and transfers
across benchmarks**. Infra is the cost of entry; transfer is the company.

---

## 9. Build order (rung discipline — do not skip)

1. **Atom instance, inference-time.** Driver (`llm-call`, fed by a trace-analyst
   report) steers a worker over k shots; a **selector** picks the answer
   (no oracle). Measure vs `random@k` **and SOTA** on FinSearchComp.
2. **Escalate the driver to `sandbox-agent` (auto-research)** — only if rung 1
   beats compute-matched random.
3. **GEPA** the driver/analyst `context`+prompts, held-out gated.
4. **Composition lift** — `fork`/coordinator/nested (driver-of-drivers).
5. **Cross-benchmark transfer** — one learned controller, many benchmarks. The moat.

Each rung must beat compute-matched random before the next is funded.

---

## 10. What the literature says (grounding, captured 2026-06-03)

- **Intrinsic self-refine DEGRADES** on hard tasks — Huang 2023 (ICLR'24, GSM8K
  −2pp / HotpotQA −2.5pp under self-correction), Kamoi 2024 (TACL: *no* fair-
  setting self-correction gains on general tasks), Stechly 2024 (collapse without
  a sound external verifier). **This predicted our negative result.**
- **Parallel sampling + a sound selector WINS** — Brown 2024 (*Large Language
  Monkeys*: coverage scales log-linearly, converts to accuracy with a sound
  selector); Wang 2022 (self-consistency); Lightman 2023 (verifier-rerank).
- **Parallel > sequential on HARD problems** — Snell 2024 (compute-optimal
  test-time scaling); revision only helps when the model is already close.
- **For QA, the refinement that works is external re-search-to-verify** —
  CRITIC / FLARE: re-ground specific claims in fresh retrieval. ⇒ the driver must
  **re-investigate**, not self-critique.

Net: a strong inference program = **fork (diverse parallel) + grounded steer
(analyst report, re-search, negative constraints) + selector-select**, with
sequential steer used sparingly.

---

## 11. Empirical status (the moment, captured)

**FinSearchComp rung-0** (n=40, 20 T2 + 20 T3, gpt-5, verified-deterministic
judge, 0 infra-excluded):

- blind 37.5% → **random@3 60.0%** → refineHand@3 50.0% → refineGepa@3 45.0%.
- more-compute (random − blind) = **+22.5pp** [CI +7.5,+40.0], p=0.008 — robust.
- steering (refineX − random) **negative** on every slice; refineGepa −15pp
  [−27.5,−2.5] p=0.032 but **does not survive BH** across the 2 arms (q≈0.064).

**Caveats that change the meaning:**
- This tested the **dumb static planner** (§0.2), NOT the trace-fed intelligent
  driver. The honest statement is *"answer-anchored intrinsic refine loses, as
  the literature predicts"* — **the real driver is UNTESTED.**
- `random@3 = 60%` is **pass@3 with the judge selecting** = an **oracle upper
  bound**. The deployable number (vote/verifier-select, no oracle) is unmeasured
  and lower. The +22.5pp is partly oracle-inflated.

So rung-0 is **not** "steering is futile" — it is "the toy loses, and we have not
yet run the machine we built."

**The SOTA bar (where we actually stand — captured 2026-06-03):**
- **FinSearchComp** (primary): frontier **Grok-4(web) 68.9%** (T1 87.3 / T2 68.1 / T3 51.2),
  **GPT-5-Thinking(web) 63.9%**, Gemini-2.5-Pro 42.6%; human expert ~75%. Our gated-refine 60% is
  the **oracle pass@3** (judge-selected) — ≈ Gemini-tier and **~9pp under frontier**; the deployable
  (no-oracle) number is lower. Real headroom remains; **we are not at SOTA.**
- **SWE-bench Verified** is a **judge fixture only** here (oracle headroom ≈ 0) — not a loop SOTA target.
- **Honesty law:** our loop is **not a new method class** — sequential-refine = Reflexion / CRITIC /
  FLARE; fanout-vote = self-consistency / best-of-N-with-verifier. We benchmark *against* those and
  claim no novelty for the scaffold; the moat is transfer (§8).

---

## 12. Consolidation map + deep-clean (grounded by the cohesion audit, 2026-06-03)

| Doc | Role going forward |
|---|---|
| **`docs/architecture.md` (this)** | **canonical spine** — the atom, timescales, cohesion law, moat, build order |
| `docs/learning-flywheel.md` | theory/moat/discipline + the `(π,τ,J,D,O)` recursion → folds into §1, §5, §7, §8; reduce to a deep-dive or a pointer |
| agent-eval `self-improvement-engine.md` | the **optimization-timescale engine** (Phases 1–5, `propose()`, the generator cost dial) — §2/§3 point here as the implementation; keep, reconcile vocabulary to this spine |
| agent-eval `loop-taxonomy.md`, `self-improvement-{roadmap,protocol}.md`, `product-self-improvement-loop.md`, `primitives-integration-spec` | **retire/merge** into this spine + the engine doc — they carry the duplicate "Driver exists at two layers (trips people up)" confusion that this spine resolves |

**Vocabulary law (ends the overload):** "driver" and "worker" are **roles of one
`Agent`**; "driver↔worker loop" must always be qualified by **timescale**
(inference vs optimization). A benchmark is an **adapter**. The thing that picks
the answer is the **selector** (not the judge).

### Deep-clean (the cohesion debt, ranked)

The audit found the atom is **forked, not shared**: `runLoop`+`createDynamicDriver` is used in
**one** file (`finsearch-loop.ts`); `run.ts`, `terminal-compare.ts`, `gepa-refine.ts`, and **seven
`solveRefine*` workers each hand-roll the identical `for(round 1..k){ shot → judge → decide →
carry-forward }`** — ~700 LOC of copy-pasted loop + ~180 LOC of copy-pasted pools.

1. **Lift `runRefineLoop<Artifact>`** (the abstraction lift): one execution-agnostic loop —
   `{rounds, judge, decide, steer}` + an opaque `runShot` — owns iteration + carry-forward +
   corpus capture + infra-retry. Each worker collapses to a `solveShot` domain hook + config;
   the `batch-*` pools unify into one `runPool`. Then wire the analyst report into the driver's
   `context` — closing the blind-driver gap. ~500 LOC deleted; every benchmark on one atom.
2. **Delete `analyze-paired.mts`** — dead, superseded by `corpus-report.mts` (durable corpus + BH-FDR). ✅ done (this PR).
3. **One `/run-benchmark-loop` skill** — the "implement a `BenchmarkAdapter`, run the shared loop"
   recipe, so agents (here and in other repos) stop forking a new `*-loop.ts`.
4. **CAD workers** (`worker-cad/blender/build123d`) migrate onto `runRefineLoop` too — but
   **coordinate with the in-flight CAD branch** before landing, to avoid clobbering concurrent edits.
