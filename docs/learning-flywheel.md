# The Continual Cross-Benchmark Learning Flywheel

> **Canonical entry point is now [`architecture.md`](./architecture.md)** — the single spine
> (recursive `Agent` atom · two timescales · benchmark-as-adapter · selector ≠ judge). Read it
> first. This doc is the *deep-dive on the theory and moat*: the `(π,τ,J,D,O)` recursion and the
> hard-won discipline. Where the two differ, the spine wins.

> The core thesis of this project. There are **two loops, and the product is the outer one.**
>
> - **Inner loop (within-run):** a controller steers a worker over k attempts on a single
>   task — refine/fanout/stop. Useful, but NOT the product, and not where the moonshot lives.
> - **Outer loop (the FLYWHEEL — the product):** every eval run, across every benchmark,
>   generates `(state, trace, steer, outcome, cost)` data that accumulates into a durable
>   corpus; the **controller** learns from *all of it*; that improves future runs across
>   *all* benchmarks; which generates more data.
>
> It is **NOT only within-run self-improvement.** Self-improvement is **cross-run and
> cross-benchmark**, compounding over time. A run that shows zero within-run effect still
> feeds the corpus; the learnable structure emerges in the aggregate. The asset is the
> corpus and the controller it trains — never any single result.

> **Success — the one definition (Gate B).** The flywheel works iff, across repeated runs on a
> persistent, checkable, long-horizon task family, the deployed controller's verifier-graded
> **multi-objective** score improves **run-over-run** (run N+1 starts above run N at **matched
> per-run compute**), the only changed variable is that the controller learned from the accumulated
> corpus, the gain survives a **frozen-controller control** (re-running an earlier controller shows
> no slope), it is significant at adequate n (paired-bootstrap + BH), and it is graded by a
> **deployable checker** — never the answer oracle or the write-only judge. *Multi-objective* is
> load-bearing: success is a vector (correct · fast · secure · cheap), and **each objective ships
> its own deployable checker** — tests, a clock, a scanner, a cost meter. That is what gives the
> flywheel honest, cheap, oracle-free signal on real work at every step (and what depth/continuation
> steers on). This OUTER-loop slope is THE success criterion. The
> within-run "trace+findings-fed controller beats the blind same-compute baseline under a non-oracle
> selector at **equal compute**" question is a separate, narrower diagnostic — **Gate A**, the
> GO/NO-GO for building the recursive-driver layer (see [roadmap-rsi.md](./roadmap-rsi.md)). A failed
> Gate A deletes within-run steering only; it never touches this corpus+controller product. Equal
> compute (Σ rollouts × turns per arm) is the anti-confound guard in both gates and is **silent on
> statefulness**: the budget may be spent as one deep trajectory, K shallow attempts, or any mix.

## The flywheel

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │                                                                        │
   ▼                                                                        │
 RUN evals across MANY benchmarks (coding, research, terminal, browser, …)  │
   │   each run = a driver/controller steering a worker over k attempts     │
   │                                                                        │
   ▼                                                                        │
 RECORD the full tuple per attempt → a durable, queryable CORPUS            │
   (state · prompt/steer · TRACE · output · judge verdict · cost/turns)     │
   │                                                                        │
   ▼                                                                        │
 LEARN the controller from the WHOLE corpus (offline, cross-benchmark)      │
   trace-aware, multi-objective GEPA/optimizer over the steer/topology      │
   signatures — optimize for SUCCESS and CLEAN/FAST trace                   │
   │                                                                        │
   ▼                                                                        │
 BETTER controller → ships into the next runs ───────────────────────────► ┘
```

The asset is the **corpus**, not any single result. A run that shows no within-run effect
still contributes data; the learnable structure emerges in the aggregate.

## The lifting generalization: recursive self-improvement

The flywheel is one instance of a more general object. Name the loop:

```
L = (π, τ, J, D, O)
    π  policy      — produces behavior
    τ  trace       — the behavior + its full execution record
    J  judge       — EXTERNAL, write-only score (the anchor)
    D  corpus      — accumulated (τ, score), shared memory
    O  optimizer   — D → π′  (a better policy)
```

**The lift:** `O` is itself a policy → `L` can take `L` as its `π`. The loop is
**self-similar across levels**, where level *n*'s policy is *"how to optimize level n−1"*:

```
L0 : improve the WORKER's behavior on a task        (π = worker)
L1 : improve the CONTROLLER / steer-function f      (π = L0's optimizer)   ← the flywheel
L2 : improve the OPTIMIZER that learns f            (π = L1's optimizer)   ← meta-harness/meta-GEPA
Ln : improve "how to improve" at level n−1          (same tuple, lifted)
```

**Recursive self-improvement = this loop closed on itself.** Every level is the *identical*
`(π, τ, J, D, O)` structure; only the object-of-optimization changes.

It is real (not vapor) only under three constraints:
1. **External anchor.** A fixed `J` at the base. Without it the recursion Goodharts — each
   level games the metric. The **write-only judge is the keystone of the entire stack**; that
   is *why* the integrity rule (judge never feeds steering/selection) is non-negotiable.
2. **Shared corpus `D`.** Improvements persist and are evidenced *across* levels — a level-1
   gain shows up in the corpus the level-0 runs produced.
3. **Rung-by-rung earning.** Level *n* is real iff it **measurably lifts level n−1 on `J`**.
   Recursion is real ∝ rungs earned; skip a rung and you stack noise on noise. (We are at L0
   with ~0 confirmed signal — so the stack is the north star, built strictly bottom-up.)

**This subsumes everything in this repo and this design:** the worker, the `f(trace)` steer,
the controller-as-signatures, GEPA, `meta-harness`, AND the **skill-governor** (which skill to
run next = an L1 policy; learning the governor from skill-run outcomes = L2) are all slices of
one structure — *a uniform recursive optimization stack over policies-with-traces, anchored by
external judges, backed by a shared corpus.* That is what "imagining bigger" resolves to.

**Benchmark BOTH — in fact, ALL levels.** Every level is an independent toggle, so you
*ablate* to measure each level's marginal lift on `J`:

```
   within-run refine {on,off}  ×  cross-run learned controller {on,off}  ×  meta {on,off}
```

The corpus + external judge make every level measurable in isolation and in combination —
which is how you *prove* a recursive system is real instead of asserting it.

## Vocabulary (one node type, recursive)

- **Worker** — does the task (opencode / a browser agent / a coding agent). A black-box
  multi-turn agent: one "attempt" is a full agentic rollout, not one LLM turn.
- **Controller (driver)** — shapes *how* the task gets done across attempts. Expressed as a
  program of **signatures** (DSPy/ax sense):
  - `steerPolicy : (trace, history) → steer`  ← the optimizable core (the "f")
  - `topologyPolicy : history → refine | fanout | stop`
  - `stopPolicy : history → continue | done`
  The worker is an **opaque tool** the controller calls. Driver and worker are the same node
  type in two modes (execute vs. author-sub-topology); the recursion bottoms out at execution.
- **Judge** — the benchmark's terminal scorer. **Write-only**: it scores the controller's
  final chosen output and is NEVER an input to steering/selection (else it's an oracle =
  cheating). Deterministic (SWE/terminal) or verified-stable LLM (research).

## The steer is `f(trace)` — a searchable space of signatures

`steer` is not a fixed string. It is `f(prior trace, prior answer, history) → context`, and
`f` is a **pluggable, benchmarkable knob** — the "variety of signatures":

| `f` | what the next attempt is told | carries failure info? |
|---|---|---|
| `∅` (random@k) | the bare task again (k independent tries) | no — compute control |
| fixed directive (hand / GEPA-learned) | a static instruction | no |
| `LLM(trace)` (analyst) | a targeted steer from the actual failure | **yes** ← where signal likely lives |
| compressed trace report | key metrics/errors, denoised | yes |
| **agentic driver** | a full agent investigates (subagents, code audit) → steer | yes (max power, max cost) |

The same `f(trace)` plugs into **two places**: (1) runtime — what the worker sees next; and
(2) **GEPA reflection input** — what the optimizer sees to rewrite the steer (canonical,
trace-aware GEPA). Benchmarking `f`s = finding the best trace representation.

**The firewall — observations, never verdicts.** `f(trace)` may read the trace, which means a
steer can legitimately report the same *property* the judge scores (e.g. realness): an analyst
that observes "the agent imported a stub" or "used a non-crypto PRNG where encryption was
required" is steering on **observable behavior**, which is fair game. What it may NOT do is
carry the judge's **verdict** — "this output is fake / will fail" — because that is `J` leaking
into the loop, and the optimizer then games realness exactly as it games pass-rate. The line is
*observation vs. verdict*, not *which property* — and the correct discriminator is **provenance,
not evidence presence**: an evidence-less trace-analyst bullet is an observation, while a judge
verdict that happens to cite an artifact is still a verdict. The substrate enforces this by
keying on origin, set at the source: `AnalystFinding.derived_from_judge` (tagged where a judge
score is lifted into a finding), `assertNoJudgeVerdict(findings)` (the steer gate — rejects
judge-derived findings), and `ProposeContext.judgeScores?: never` (a compile-time tripwire on the
direct channel). It is *necessary, not sufficient*: it stops provenance-tagged verdicts, so
provenance must be set at every judge→finding lift, and the dual-role consumer must call the gate
when it assembles findings for steering (the generic optimizer boundary is finding-type-agnostic,
so it cannot auto-enforce). And it is *not sufficient alone* for a second reason: if the
steer-detector and `J` measure a correlated property, optimizing the observable can still inflate
`J` on the **training** split — only a frozen holdout (below) catches that. Gaps 4 and 2 interlock.

## Architecture layers (ranked by leverage)

1. **Eval + corpus substrate (the GATE).** Cheap, reliable, **trace-rich** evaluation; the
   `RunRecord` corpus written by *every* run; deterministic judges where possible; an
   **offline replay + reward-model layer** so the controller space can be searched WITHOUT a
   live rollout per candidate (agent-eval `./rl`: `buildRlDataset`, off-policy estimation,
   reward modeling). *This is the bottleneck. Without it, nothing above is reachable —
   GEPA can search any space only if you can afford the metric evals.*
2. **Controller-as-signature-program.** steer/topology/stop as jointly-optimizable
   signatures; worker as opaque tool. (`createDynamicDriver(planner)` where `planner` is the
   compiled program.)
3. **Trace-aware, multi-objective optimizer.** GEPA/MIPRO reflecting on **traces** (not
   pass/fail), optimizing for **correctness AND clean/fast trace** (Pareto). `meta-harness`
   is the code-level search engine that sits HERE — it evolves controller *code* on a Pareto
   frontier, and it only works once layer 1 makes the metric cheap + discriminating.
4. **Cross-domain.** Optimize ONE controller across coding/research/terminal/browser. If the
   learned steering **transfers**, that's the moonshot. If not, you get N per-domain
   flywheels — still useful, but the "one controller, many benchmarks" claim *requires*
   transfer, and that is the open empirical risk.

## Discipline (hard-won; violate these and the flywheel learns noise)

- **The flywheel amplifies whatever you feed it.** Clean `(trace, reward)` tuples → real
  structure. Noise (unverified judge, infra-corrupted traces, confounded outcomes) → a bigger
  pile of noise with false confidence. **Clean data > more data.** Rigor is what makes the
  corpus *learnable*, not bureaucracy.
- **Confounds before causal claims.** A delta where treatment gets more compute than control
  is not a causal result. The **`random@k` compute control** is no longer a thing to *remember*:
  `runSteeringExperiment` (bench) makes it a **required field** — a steering experiment cannot be
  constructed or run without its compute-matched control, so isolating steering as
  `refine@k − random@k` is structural, and omitting the control is a type error. Verify the judge
  is deterministic (re-judge test). Exclude infra-errored cells; retry transient drops. (See the
  false "+20pp = steering proven" — it was compute + infra + an untested judge.)
- **Pre-register the primary metric; correct the family; spend the holdout once.** The ablation
  grid (steering arms × directives × benchmarks, plus compute controls) tests *many* contrasts —
  each independent "CI excludes 0" inflates the family-wise false-positive rate (garden of forking
  paths). The PRIMARY hypothesis (`steering = refineX − random > 0`) is pre-registered; every
  reported contrast is **Benjamini-Hochberg corrected within its family** (`corpus-report.mts`),
  and a result counts only if it clears the family FDR — never on its own CI. Separate a reusable
  **exploration** set (rank candidates freely, BH-corrected) from a **frozen confirmation holdout**
  spent once per *locked* candidate; this is what `runImprovementLoop` enforces by refusing
  train ∩ holdout overlap (memorization read as generalization is the default failure otherwise).
- **"Validates the concept" ≠ "validates the product."** A hand-rolled refine loop proves
  refinement helps, NOT that `runLoop`/the controller does. Route through the real kernel.
- **Eval economics is the moonshot bottleneck, not controller cleverness.** Build the offline
  corpus/replay so search is affordable. Don't build the optimizer cathedral over a metric
  you can only sample a few hundred times with overlapping CIs.
- **Prove signal per rung before escalating cost.** random → fixed → `LLM(trace)` →
  agentic-driver. Each rung must beat *compute-matched* random before the next is justified.
  Don't jump to the unbounded agentic driver to (expensively) re-derive that more-compute ≈ 0.

## Honest status (2026-06-03)

- **Coding (SWE-bench):** refine ≈ blind (net 1 rescue / 1 break, n=23). Directional, NOT
  proven — high blind baseline (~74%, likely *contamination* on popular repos) leaves ~no
  correctable middle band, and there was no `random@k` control. SWE-bench is a weak instrument
  here.
- **Research (FinSearchComp): rung-0 settled, and the answer is NO.** The first
  adequately-powered, confound-controlled, judge-verified 3-way through the real `runLoop`
  (n=40, 20 T2 + 20 T3, gpt-5 worker + verified-deterministic judge, 0 infra-excluded):
  - blind 37.5% → random@3 **60.0%** → refineHand@3 50.0% → refineGepa@3 45.0%.
  - **more-compute** (random − blind) = **+22.5pp**, 95% CI [+7.5, +40.0], p=0.008 (13/40
    discordant) — trying again robustly helps.
  - **steering** (refineX − random) is **negative on every slice, both directives**:
    refineHand −10.0pp (CI [−25, +5], p=0.25), refineGepa −15.0pp (CI [−27.5, −2.5], p=0.032).
    The GEPA harm is nominally significant but does **not** survive BH across the 2 steering
    arms (q≈0.064) — so the disciplined claim is *no benefit + a consistent negative trend*,
    NOT "significantly harms". Mechanism: the inner opencode agent already self-corrects in its
    own rollout; an external refine directive adds a chance to BREAK a correct answer, while
    `random@k` (independent retries, any-pass) captures the more-attempts benefit without that
    downside. The earlier "+7.1pp held-out" was n=8 noise; this supersedes it.
  - Subtype splits (n=20 each) are underpowered — even more-compute is not significant on T3
    alone (CI [−5, +35]). T2 mirrors the aggregate (more-compute +30pp sig; steering ≤0).
- **Terminal-Bench:** adapter+judge + blind-vs-refine wired (reuses tb's open-source opencode
  agent + verifier). Bench-orchestrated (tb owns containers) — the exception that does NOT
  route through `runLoop`.
- **Net:** the first clean rung-0 measurement **contradicts** the flywheel's core premise on
  this domain — a within-run steer does NOT beat compute-matched random; compute does. This is
  one benchmark, one worker, two directives (incl. a GEPA-learned one that also fails), so it
  bounds the *within-run inner loop*, not the cross-run outer flywheel. But it is a real,
  controlled NO where there was only confounded YES before — the instrument now works, and it
  says: do not escalate to costlier steers on this benchmark to re-derive that more-compute wins.

## Build sequence

1. **Corpus capture** (this is the foundation): every bench run persists full `RunRecord`s
   (prompt/steer · trace · output · verdict · cost) into one durable store — *stop the
   boolean-only scorecards that delete the fuel.*
2. **Rung-0/1 signal:** does `random@k` get beaten by *any* `f` (fixed, then `LLM(trace)`),
   confound-controlled, judge-verified, infra-reliable?
3. **Offline replay + reward model** over the corpus → controller search becomes affordable.
4. **Controller-as-signatures + trace-aware multi-objective GEPA / meta-harness** searches the
   `f`/topology space over the corpus; validate winners live.
5. **Cross-domain transfer** — one controller, many benchmarks. The moonshot.

## Where the pieces live

- Kernel + controller seam: `src/loops/` (`runLoop`, `createDynamicDriver`, `createSandboxPlanner`).
- Benchmarks + workers + experiments: `bench/` (`benchmarks/*`, `worker-*`, `finsearch-loop.ts`,
  `terminal-compare.ts`, `corpus-report.mts`).
- Substrate optimizer/corpus primitives: `@tangle-network/agent-eval` (`gepaDriver`,
  `heldOutGate`, `runImprovementLoop`, `RunRecord`/trace-store, `./rl`).
