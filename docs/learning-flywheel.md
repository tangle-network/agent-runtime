# Continual Domain Learning and Meta-Learning

> **In plain terms:** This is a design-rationale doc — it explains *why* this project is built
> to get better the more it runs, not how to use the package day to day. It's for a developer
> who wants the big-picture research bet before reading the code. The one idea to take home:
> every test run saves a full record of what the agent did and how well it scored, and a
> learning component studies *all* of those saved records to steer future runs better — so the
> real asset is the growing library of run records plus the component trained on it, never any
> single test result.

> **Start with [`architecture.md`](./architecture.md)** — it's the main map of how the system
> fits together: one recursive `Agent` building block, two speeds of improvement (fast within a
> single run, slow across many runs), evals plugged in as adapters, and the rule that the
> component choosing the best answer is never the one scoring it. This doc is the deeper dive
> into the theory and the long-term competitive edge — the `(π,τ,J,D,O)` recursion and the
> hard-won discipline behind it. Where the two disagree, `architecture.md` wins.

> The core thesis of this project. There are **two loops, and the product is the outer one.**
>
> - **Inner loop (within-run):** a controller steers a worker over k attempts on a single
>   task — refine/fanout/stop. Useful, but NOT the product, and not where the moonshot lives.
> - **Outer loop:** domain work generates `(state, trace, steer, outcome, cost)` records.
>   A domain learner uses those records to improve specialists, working evaluations, and its own experimental decisions.
>   A meta-agent can learn how to construct and improve those domain learning processes.
>
> Sustained improvement within one domain is valuable in its own right.
> A specialist need not transfer to another domain.
> The transferable knowledge can be the procedure that trains specialists and improves their evaluations.
> Failed experiments can inform that procedure when their evidence survives and affects later decisions.

> **Across-run policy improvement (Gate B).** One test of the domain learner asks whether, across repeated runs on a
> persistent, checkable, long-horizon task family, the deployed controller's verifier-graded
> **multi-objective** score improves **run-over-run** (run N+1 starts above run N at **matched
> per-run compute**), the only changed variable is that the controller learned from the accumulated
> corpus, the gain survives a **frozen-controller control** (re-running an earlier controller shows
> no slope), it is significant at adequate n (paired-bootstrap + BH), and it is graded by a
> **deployable checker** — never the answer oracle or the write-only judge. *Multi-objective* is
> load-bearing: success is a vector (correct · fast · secure · cheap), with evidence scoped to each objective.
> Tests, clocks, scanners, and cost meters provide partial measurements; record each check's coverage and unverified assumptions.
> This tests one learning claim; evaluation quality, learning-process quality, and process transfer require separate comparisons.
> The
> within-run "trace+findings-fed controller beats the blind same-compute baseline under a non-oracle
> selector at **equal compute**" question is a separate, narrower diagnostic — **Gate A**, the
> comparison for within-run steering, scoped by [architecture.md §9](./architecture.md#9-build-order-and-experiment-scope).
> Compare actual resource use in both tests, including learning and evaluation-development costs over the declared horizon.
> The budget may fund one deep trajectory, several shallow attempts, or a mixture.

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

Retained information has value only when its use improves later work.
The [recorded accretion experiment](./research/leapfrog-program.md) compared specific forms of prior-run context and checked program reuse.
Its negative context result does not reject all facts, retrieval policies, or combinations of memory and planning changes.
Measure the exact information retrieved, its use, and subsequent task outcomes before selecting a retention policy.

## The lifting generalization: recursive self-improvement

The object being improved can be a complete domain learning process.
It can produce specialized AgentProfiles, improved working evaluations, and the next experimental policy.
The process can learn within one domain before, or without, being reused elsewhere.
When it is reused, measure whether it constructs a useful learner in the new domain rather than expecting the old specialist to generalize.
Working evaluations may evolve, while independent assessment tests whether those changes better detect meaningful success and failure.

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
1. **Independent assessment.** Each improvement claim needs assessment outside the adaptive decisions being tested.
   Working evaluations can guide learning and can change; they cannot establish their own improvement merely by making success easier.
2. **Retained evidence and lineage.** Record which exact prior results and candidate states informed later work.
   Storage can remain domain-specific while experiments share evidence contracts.
3. **Evidence per learning level.** Judge a candidate learner by the subsequent specialists, evaluations, or learning processes it produces.
   Use repeated outcomes over the declared horizon; an exploratory step need not improve immediately.
   Construction and comparison follow [architecture.md §9](./architecture.md#9-build-order-and-experiment-scope).

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

**Candidate input must name its source.**
Every finding used to generate a candidate is a `ProposalFinding`.
`proposal_origin: 'production'` means the finding came from observed production behavior.
`proposal_origin: 'search'` means it came from development work during candidate search.
Runtime validates caller-supplied findings and never guesses their origin.
Runtime labels only the production analysis it runs itself.
Final evaluation results have no allowed proposal origin and never feed candidate generation.

`derived_from_judge` remains descriptive metadata.
Search-time judge feedback is valid when it is explicitly marked `proposal_origin: 'search'`.
The final judge result is still isolated from search.
A separate final-test partition is required because source labels alone cannot prevent overfitting.

## Architecture layers (ranked by leverage)

1. **Eval + corpus substrate (the GATE).** Cheap, reliable, **trace-rich** evaluation; the
   `RunRecord` corpus written by *every* run; deterministic judges where possible; an
   **offline replay + reward-model layer** so the controller space can be searched WITHOUT a
   live rollout per candidate (agent-eval `./rl`: `buildRlDataset`, off-policy estimation,
   reward modeling). *This is the bottleneck. Without it, nothing above is reachable —
   GEPA can search any space only if you can afford the metric evals.*
2. **Controller-as-signature-program.** steer/topology/stop as jointly-optimizable
   signatures; worker as opaque tool. The compiled-program controller lives
   as a `defineStrategy`/`authorStrategy` program (`src/runtime/strategy.ts`) driven over
   the `Scope`/`Supervisor`.
3. **Trace-aware, multi-objective optimizer.** GEPA/MIPRO reflecting on **traces** (not
   pass/fail), optimizing for **correctness AND clean/fast trace** (Pareto). `meta-harness`
   is the code-level search engine that sits HERE — it evolves controller *code* on a Pareto
   frontier, and it only works once layer 1 makes the metric cheap + discriminating.
   **Measured (2026-06-09): the analyst-prompt coordinate is flat** — a 3-generation GEPA
   run over the `observe()` analyst prompt tied the default exactly on a frozen holdout.
   The searchable space that remains live at this layer is the **strategy program itself**
   (`defineStrategy` + `authorStrategy`), not the analyst prompt.
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
  is not a causal result. Steering must always be measured against its **`random@k` compute
  control** as a sibling benchmark arm, so the isolated effect is `refine@k − random@k` at equal
  k. The steer itself is concrete: an analyst-derived per-shot string carried shot-to-shot
  (`buildSteerContext` builds it; the strategy loop threads it as `pendingSteer`), never a
  free-floating prompt edit. Verify the judge is deterministic (re-judge test). Exclude
  infra-errored cells; retry transient drops. (See the false "+20pp = steering proven" — it was
  compute + infra + an untested judge.)
- **Pre-register the primary metric; correct the family; spend the holdout once.** The ablation
  grid (steering arms × directives × benchmarks, plus compute controls) tests *many* contrasts —
  each independent "CI excludes 0" inflates the family-wise false-positive rate (garden of forking
  paths). The PRIMARY hypothesis (`steering = refineX − random > 0`) is pre-registered; every
  reported contrast is **Benjamini-Hochberg corrected within its family** (`corpus-report.mts`),
  and a result counts only if it clears the family FDR — never on its own CI. Separate a reusable
  **exploration** set (rank candidates freely, BH-corrected) from a **frozen confirmation holdout**
  spent once per *locked* candidate; this is what `compareOptimizationMethods` enforces by keeping
  the final-test partition out of the optimization method (memorization read as generalization is the default failure otherwise).
- **"Validates the concept" ≠ "validates the product."** A hand-rolled refine loop proves
  refinement helps, NOT that `runAgentRounds`/the controller does. Route through the real kernel.
- **Eval economics is the moonshot bottleneck, not controller cleverness.** Build the offline
  corpus/replay so search is affordable. Don't build the optimizer cathedral over a metric
  you can only sample a few hundred times with overlapping CIs.
- **Choose a decisive test before escalating cost.**
  Follow [architecture.md §9](./architecture.md#9-build-order-and-experiment-scope) for complete mechanisms, combinations, resource accounting, and rejection conditions.

## Honest status (updated 2026-06-10)

- **Stateful agentic (EnterpriseOps-Gym itsm, 2026-06-09): Gate A POSITIVE.** On the
  canonical loop — `Scope`/`Supervisor` + the `observe()` analyst + `defineStrategy`
  (`src/runtime/strategy.ts`), not the `runAgentRounds` path — depth-steered continuation beats
  breadth (blind best-of-K) at equal compute under keep-best checkpoint scoring:
  **+16.4pp CI [+5.3, +29.8]**, 6 wins / 0 losses, n=16, deepseek-v4-pro; replicated
  **+8.3pp** on a disjoint task slice.
- **Stateless codegen (HumanEval, 2026-06-08): null-to-negative.** observe→steer does not
  beat blind resampling at equal k (n=82, paired bootstrap; compute alone +12.2pp
  significant); exec-grounded self-repair is significantly **negative** (−17.1pp,
  CI [−26.8, −7.3]).
- **The domain-boundary law (supersedes any "steering loses everywhere" reading of the
  rung-0 entry below):** within-run steering is negative on stateless retrieval
  (FinSearchComp), null-to-negative on stateless codegen (HumanEval), **positive on
  stateful agentic domains** with a correctable middle band, scored keep-best (EOPS).
  The boundary variable is state + the inability to cheaply resample.
- **Analyst-prompt GEPA (2026-06-09): NULL.** A 3-generation prompt search + frozen
  holdout tied the default `observe()` analyst exactly (the search winner's +12.6pp was
  holdout-overfit). The analyst-prompt coordinate is flat; the live outer-loop lever is
  program/strategy space (`defineStrategy` + `authorStrategy`).
- **Corpus read-side priming (naive): NEGATIVE** (−11.6pp, worsening slope) — see the
  read-side note under "The flywheel" and
  [leapfrog-program.md §S3](./research/leapfrog-program.md).
- Evidence map + ranked portfolio:
  [docs/research/optimization-space.md](./research/optimization-space.md).

### Earlier entries (2026-06-03)

- **Coding (SWE-bench):** refine ≈ blind (net 1 rescue / 1 break, n=23). Directional, NOT
  proven — high blind baseline (~74%, likely *contamination* on popular repos) leaves ~no
  correctable middle band, and there was no `random@k` control. SWE-bench is a weak instrument
  here.
- **Research (FinSearchComp): rung-0 settled, and the answer is NO.** The first
  adequately-powered, confound-controlled, judge-verified 3-way through the real `runAgentRounds`
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

    > `random@k` / `refineHand@k` / `refineGepa@k` are **condition labels for strategy runs**
    > recorded in the corpus (the controller column), not importable symbols — `refineGepa@k`
    > names "the refine strategy steered by a GEPA-authored prompt, k attempts."
  - Subtype splits (n=20 each) are underpowered — even more-compute is not significant on T3
    alone (CI [−5, +35]). T2 mirrors the aggregate (more-compute +30pp sig; steering ≤0).
- **Terminal-Bench:** adapter+judge + blind-vs-refine wired (reuses tb's open-source opencode
  agent + verifier). Bench-orchestrated (tb owns containers) — the exception that does NOT
  route through `runAgentRounds`.
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

- Kernel + controller seam: `src/runtime/` — the `runAgentRounds` kernel (`run-loop.ts`, one
  leaf execution backend) and the canonical agent-driver:
  `createCoordinationTools` (`src/mcp/tools/coordination.ts`) over the `Scope`/`Supervisor`
  substrate (`src/runtime/supervise/`), with `runAgentic`/`defineStrategy`/`runPersonified`.
- **The published optimization suite**: `@tangle-network/agent-runtime/kernel` (source:
  `src/runtime/`):
  `Environment`/`Strategy`/`defineStrategy`/`ShotSpec.profile` (`strategy.ts`), `runBenchmark`
  (`run-benchmark.ts`), `createVerifierEnvironment`/`createMcpEnvironment`,
  `harvestCorpus`, `authorStrategy` (`strategy-author.ts`), `auditIntent`, and
  `promotionGate` (`promotion-gate.ts` — the seeded paired-bootstrap holdout gate over
  agent-eval's `heldoutSignificance`: evidence floor 6 paired tasks, the CI lower bound
  must clear the threshold).
- Benchmarks + workers + experiments: `bench/` (`benchmarks/*`, `worker-*`,
  `terminal-compare.ts`, `corpus-report.mts`). The gen0 → `authorStrategy` → gen1 →
  rotating-disjoint-holdout runner (the minimal single-objective Gate-B form) over
  `authorStrategy` (`src/runtime/strategy-author.ts`) + the seeded `promotionGate` is open work.
- Substrate optimizer/corpus primitives: `@tangle-network/agent-eval` (`OptimizationMethod`,
  `compareOptimizationMethods`, `gepaOptimizationMethod`, `skillOptOptimizationMethod`,
  `heldoutSignificance`, `RunRecord`/trace-store, `./rl`).
