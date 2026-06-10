# Architecture — The Spine

> **One recursive agent tree. Every node makes a multi-objective decision. Two timescales — and the across-run policy curve is the product.**
>
> Canonical as of **2026-06-05**. This doc is the single spine that unifies
> `docs/learning-flywheel.md` (the theory + the moat) and
> `@tangle-network/agent-eval` `docs/design/self-improvement-engine.md` (the
> optimization-time engine). Where this conflicts with an older doc, **this
> wins**; the older docs are being consolidated into this spine (§12). If you are
> an agent in another repo building a new benchmark: **read §1, §6, §9 — you only
> write an adapter, never a new loop.**
>
> **Status (verified against `origin/main`, 2026-06-10).** The *product core* is real:
> the recursive agent tree (`src/runtime/supervise/` — `Agent.act` in a `Scope`,
> `scope.spawn`, settle, journal→replay/resume), the sandbox seam (`SandboxClient` +
> the sandbox `Executor`, injectable/swappable), the trace observer (`observe()`,
> `src/runtime/observe.ts`), the corpus + external judge, and the lifecycle hook stream
> (`runtime-hooks`). The driver-as-code that reimplemented what the harness + the
> `Scope` + data-checks already do (the in-process operator tool-loop, the
> `create*Driver` factory zoo, the fixed analyst-kinds registry) is deleted;
> `runLoop`/`createDriver` remain **one execution backend**, not the center. The
> **canonical optimization surface is the published loops suite** —
> `@tangle-network/agent-runtime/loops` (a build alias; the source lives in
> `src/runtime/`, there is no `src/loops/` directory): `Environment`/`Strategy`/
> `defineStrategy`/`ShotPersona` (`strategy.ts`), `runBenchmark` (`run-benchmark.ts`),
> `createVerifierEnvironment`/`createMcpEnvironment`, `harvestCorpus`,
> `authorStrategy` (`strategy-author.ts`), `auditIntent`, and `promotionGate`
> (`promotion-gate.ts`). The coherence analysis is in
> [architecture-interpretations.md](./architecture-interpretations.md); the
> dependency-ordered build + cleanup is in [roadmap-rsi.md](./roadmap-rsi.md); the
> empirics are §11; the live evidence map + portfolio is
> [docs/research/optimization-space.md](./research/optimization-space.md). Doc map:
> [docs/README.md](./README.md).

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

## 0.5 What we are building, and what "better" means (the four claims)

Four claims define the system. The sections below are mechanism in service of these;
if a section drifts from one of these, the claim wins and the section is wrong.

1. **The atom is a decision, not a spawn.** At every level an agent faces the same
   question: given the solution so far, the feedback so far, and the budget left, what
   is the best next move — *keep working · branch · split · get a second opinion · run
   a check · stop*? Spawning a child is **one** of those moves, never the primitive.
   The recursion is decisions all the way down (§1).
2. **"Best" is a vector, not a scalar.** A good result is correct AND fast AND secure
   AND cheap. Success is **multi-objective**; we do not collapse it to one number until
   forced to. Today every judge returns a single `score` — that is the **gap to close**,
   not the design (§6, §5).
3. **Each objective carries its own checker — that is what makes this trainable.**
   *Fastest* is graded by a clock, *most secure* by a scanner, *correct* by the tests.
   The objective **is** a deployable verifier (§1's *verifier*, distinct from the oracle
   and the write-only judge). So the loop has honest, cheap signal at every step, on real
   work, **without an answer key** — that is the gift the multi-objective framing buys,
   and the reason depth/continuation has something sound to steer on.
4. **The improvement that counts is the policy getting better across runs.** Two things
   improve on two clocks (§2). *Within* a run the **solution** climbs (the artifact gets
   better round over round). *Across* runs the **decision policy** climbs — it remembers
   which decisions, on which kinds of problems, produced good multi-objective outcomes,
   and chooses better next time. **That across-run curve is RSI, and it is THE success
   criterion** (Gate B — defined in [learning-flywheel.md](./learning-flywheel.md), §2
   here). A single within-run result beating a blind baseline at equal compute (Gate A)
   is **one narrow diagnostic**, not the goal — do not read it as the verdict on the
   product.

---

## 1. The atom — one agent, one decision, recursively

> Drawn, with `file:line` anchors, in the picture book: [architecture-visual.md](./architecture-visual.md).

There is exactly one primitive: an **agent** = an `AgentProfile` (who/what it is) +
a **harness** (how it runs — a coding harness in a sandbox: claude-code / codex /
opencode), executing inside a **`Scope`**. `driver`, `worker`, `selector`,
`coordinator` are **roles** — a profile + which tools it holds — never separate types.

The harness already owns the loop, tool-calling, sub-agent spawning, and the native
idioms (*parallelize*, *ultrathink*, *dynamic-workflow*). **We do not write an
execution loop or a topology DSL.** An agent does one thing the runtime cares about:
at each step it **makes a decision** — keep working · branch · split · get a second
opinion · run a check · stop — and acts on it (§0.5.1). The decision that *grows the
tree* is `spawn`, carried over **MCP**: it creates a **child agent** (its own profile
+ harness, its own `Scope`). The child runs its own agentic process; the parent
**observes / steers / resumes** it through the same MCP, in **natural language**.
Spawn is one move among several, so topology is not an opcode set — it **emerges** from
the decisions:

```
a loop          = an agent that steers ONE child across turns
best-of-N       = spawn N children, pick the best         (the SELECTOR role)
coordinator     = spawn N, steer, select
driver-of-driver = a child whose profile is itself a coordinator — free, by recursion
```

`Scope.spawn` is the recursive boundary; the journal makes the tree replayable and
resumable. **This recursive execution tree IS the product.** The three things we own
are small: (1) the **MCP** the agents share (`spawn · observe · steer · stop` +
`define_check · run_check`); (2) the **profiles** (markdown — the only customization;
"Drew" is one); (3) the **orchestrator** (`src/runtime/supervise/` — `Scope` + the
conserved budget pool that makes equal-compute true for the experiment). `runLoop` /
`toolLoop` are **one execution backend each, not the center** — they, MCP delegation,
and `Scope.spawn` all *produce* the same lifecycle stream (§1b).

**Checks are data, not code.** A trace-**analyst** (a lens over a trace), a **judge**
(scores an output), and a **verifier** (a deployable check — runs tests/SQL/a command)
are one shape: `{ kind, spec }`. We *seed* the benchmark's verifier + base lenses; the
agent driver **creates and updates** the check it needs on the fly via `define_check`,
and runs it with `run_check`. There is no fixed analyst registry.

The **judge is not in the tree.** It is external, write-only, and scores only the
chosen final output for evaluation — never an input to a steer or a selection.
**Three checkers, kept distinct:** an **oracle** (the answer key) is banned from
selection *and* steering; a **verifier** (a sound deployable checker) is *allowed* in
both — it is what depth/continuation needs; the **write-only judge** (offline corpus
scorer) is banned from steering only. (Enforced: the trace-derived-findings firewall —
an analyst may not cite the score/verdict metric; `assertTraceDerivedFindings`.)

## 1b. The lifecycle stream — the one observability + extension surface

Every execution backend emits one **agent-centric event stream** (`src/runtime-hooks.ts`,
merged #162/#163): targets `agent.{run, turn, tool_call, spawn, child, plan, decision}`
× phases `{before, after, error, event}`. `runLoop`, `toolLoop`, **and the `Scope`
spawn/settle boundary** are **producers** — `Scope.spawn` emits `agent.spawn` (child id,
label, runtime, budget, depth) and the settle cursor emits `agent.child` (status, score,
reason, spend), threaded in through `SupervisorOpts.hooks`. Developers attach via
`defineRuntimeHooks` / `composeRuntimeHooks` at the **execution/spawn boundary** — never
on the `AgentProfile`, never coupled to one backend. This single stream is the
opencode-style extension surface *and* what the **topology visualization** consumes:
`src/topology/` folds the stream into the live recursive agent tree — each node's status,
steps, child count, and deployable score — and renders it (`createTopologyView().hooks`
attaches; `.render()` draws the tree). The journal stays the durable record; the hook
stream is its live projection (both agree).

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

**Which curve is success (read this before you read the gate numbers in §11).** The
inference-time column makes the **solution** climb within a run; the optimization-time
column makes the **decision policy** climb across runs — and *that across-run slope is
the success criterion*. Concretely (**Gate B**, defined in
[learning-flywheel.md](./learning-flywheel.md)): across repeated runs on a persistent,
checkable task family, the deployed policy's verifier-graded multi-objective score
improves run-over-run at matched per-run compute, the only changed variable is that the
policy learned from the accumulated corpus, it survives a frozen-policy control, and it
is significant at adequate n under a deployable checker. The within-run question — *does
a trace-fed driver beat a blind same-compute baseline under a non-oracle selector at
equal compute* (**Gate A**) — is a **separate, narrower diagnostic** that only decides
whether the within-run adaptive layer is worth building; a failed Gate A deletes
within-run steering, never the corpus+policy product. The §11 equal-k selection numbers
are Gate-A diagnostics — they are **not** a verdict on Gate B, which the harness has not
yet run.

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
not hand-written. Optimize against the **multi-objective vector** (§0.5.2) — *correct,
fast, secure, cheap* — Pareto, **not** a pre-collapsed scalar; each component is graded
by its own deployable checker (tests · clock · scanner · cost meter), with the external
write-only judge as the fixed anchor on the *correctness* axis so the recursion can't
Goodhart. **Status:** the loop today carries a single `score` per attempt (§6's
`adapter.judge`) — collapsing the vector at the boundary is the open gap to close before
the optimizer can trade objectives honestly. **Measured (2026-06-09):** prompt search
over the analyst is flat — a 3-generation GEPA run over the `observe()` analyst prompt
ended in an exact frozen-holdout tie with the default prompt (§11). The analyst-prompt
coordinate is retired; the live outer-loop lever is **program/strategy space**
(`defineStrategy` + `authorStrategy`), per
[docs/research/optimization-space.md](./research/optimization-space.md).

---

## 6. Benchmark = adapter (the cohesion law)

> **The loop, driver, analysts, corpus, GEPA, selector, and SOTA-comparison are
> shared and benchmark-agnostic. A benchmark contributes ONLY an adapter. No
> benchmark forks its own loop.**

An adapter supplies exactly:
- **task loader** (`loadTasks`),
- **worker profile** (the agent + sandbox backend that does the task),
- **judge** (deterministic, or verified-stable LLM; external/write-only). Today it
  returns a single `{resolved, score}` on the *correctness* axis. The target contract is
  a **verdict vector** — one component per objective the task exposes (correctness via
  tests, latency via a clock, safety via a scanner, cost via the meter), each its own
  deployable checker (§0.5.2-3). Where a bench only has correctness, the vector is
  length-1; that is a property of the bench, not a reason to bake the scalar into the
  spine.
- **SOTA reference** (the number/method we must beat).

Everything else is the shared spine. This is the rule that kills *"built once,
used never"*: SWE-bench, FinSearchComp, Terminal-Bench, CAD-bench, … all run the
same atom. If you find yourself writing a new `*-loop.ts`, stop — you want an
adapter + the shared loop.

**Corollary — `bench/` holds ZERO drivers and ZERO abstractions.** The driver, the
surface an agent runs over, the worker-leaf, and the MCP all live in the library
(`src/`). `bench/` is a thin experiment consumer: adapters + "launch the one driver at
a profile" + score via the corpus/gate. A "blind control" is not a bench driver — it is
the one agent with a `blind` decider; the equal-compute guard is experiment infra. If
`bench/` grows a driver or a surface abstraction, that is the smell that the library is
being squatted on (it was, in `bench/src/agentic.ts` — deleted 2026-06-05).

---

## 7. The corpus + external judge (the substrate)

- **Corpus:** every run, every benchmark, writes full `RunRecord`s
  (`state · steer · trace · output · verdict · cost`) to one durable, queryable
  store. This is the only improvement signal; boolean scorecards delete the fuel.
- **Three distinct checkers — keep them separate (this distinction is load-bearing):**
  - **ORACLE** (the answer key / gold label / "any-pass"): knows the answer.
    **Banned from BOTH selection AND steering** — using it is the cheat the gate guards against.
    It is an eval-only upper bound (`oracle@k`), never available in deployment.
  - **VERIFIER** (a sound *deployable* checker — unit tests, SQL/state verifiers, `adapter.judge`
    when deployable): checks an answer without knowing it a priori. **ALLOWED in both selection and
    in-loop steering/continuation** — this is exactly what depth/continuation needs (a worker checks
    its own work and continues). selector ≠ oracle does NOT forbid the verifier.
  - **WRITE-ONLY JUDGE** (the offline corpus scorer): the anchor against Goodhart.
    **Banned from steering only** (the trace-derived-findings firewall) — it scores the corpus, it
    never feeds a steer or a selection.
- **Selector (distinct):** the deployable, learnable component that picks among candidates at
  inference (vote / verifier-rerank). Today we still *fake* it with the oracle ("any-pass"), which
  isn't available in deployment (§11) — replacing that fake with a real verifier-based selector is
  the open work, not a reason to ban verifiers from the loop.

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
   (no oracle). Measure vs `random@k` **and SOTA** on a **stateful, deployable-checker
   bench** (EnterpriseOps-Gym / commit0 / swe-bench) — a domain that can exhibit depth.
   FinSearchComp is a **negative control only** (its LLM judge is non-deployable and its
   one-shot artifact structurally cannot exhibit continuation — the rung-0 "steering loses"
   result is bench-specific, not domain-general). **Status: cleared** — depth-steered
   continuation beats blind breadth on EOPS at equal compute, significant (§11).
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

**Gate A — POSITIVE, domain-bounded (EnterpriseOps-Gym itsm, 2026-06-09).** On the
canonical loop — the `Scope`/`Supervisor` substrate + the `observe()` analyst +
`defineStrategy` (`src/runtime/strategy.ts`), **not** the `runLoop`/`PlannerContext`
path — depth-steered continuation beats breadth (blind best-of-K) at equal compute
under keep-best checkpoint scoring: **+16.4pp, CI [+5.3, +29.8], 6 wins / 0 losses,
n=16**, deepseek-v4-pro; replicated **+8.3pp** on a disjoint task slice. Both arms
must be scored with the same selection policy (keep-best) — scoring the depth arm on
final state only silently biases against it.

**The domain-boundary law (supersedes any "steering loses everywhere" reading of the
rung-0 block above):** within-run steering is **negative on stateless retrieval**
(FinSearchComp rung-0), **null-to-negative on stateless codegen** (HumanEval steer
gate null at equal k, 2026-06-08; exec-grounded self-repair −17.1pp, CI [−26.8, −7.3]),
and **positive on stateful agentic domains** with a correctable middle band, scored
keep-best (EOPS). The boundary variable is state + the inability to cheaply resample.

**GEPA over the analyst prompt — NULL (2026-06-09).** A 3-generation prompt search +
frozen holdout tied the default `observe()` analyst exactly; the search winner's
+12.6pp was holdout-overfit. The analyst-prompt coordinate is measured flat; the live
lever is program/strategy space (`defineStrategy`/`authorStrategy`). The full evidence
map + ranked portfolio: [docs/research/optimization-space.md](./research/optimization-space.md).

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

The audit found the atom is **forked, not shared**: `runLoop`+`createDriver` is used in
**one** file (`finsearch-loop.ts`); `run.ts`, `terminal-compare.ts`, `improve-prompt.ts`, and **seven
`solveRefine*` workers each hand-roll the identical `for(round 1..k){ shot → judge → decide →
carry-forward }`** — ~700 LOC of copy-pasted loop + ~180 LOC of copy-pasted pools.

1. ✅ **`runRefineLoop<Artifact, Ctx>`** (the loop atom): one execution-agnostic loop —
   `{rounds, setup, prompt, runShot, judge?, decide?, teardown}`, the worker an opaque `runShot`.
   **All six refine workers** (research / sandbox-research / SWE-refine / cad / blender / build123d)
   run it — **zero hand-rolled `for(round)` loops**. Both carry-forward channels (execution `Ctx`
   + prompt) are first-class.
2. ✅ **`runPool<T, R>`** (the pool atom): one generic bounded-concurrency pool. **All five batch
   runners** (`batch-blind` / `batch-oracle` / `batch-compare` / `finsearch-loop` / `terminal-compare`)
   use it — **zero hand-rolled `Promise.all` drains**.
3. ✅ **`directives.ts`** (the steer surface): every refine directive + authoring system prompt lives
   here; **zero worker-owned prompt text**. Task framing lives in the benchmark adapters.
4. ✅ **Delete `analyze-paired.mts`** — dead, superseded by `corpus-report.mts` (durable corpus + BH-FDR).
5. **CANONICAL LAW (everyone follows):** a worker is an opaque **substrate plug** (`runShot`); the
   **loop** (`runRefineLoop`), the **pool** (`runPool`), the **steer** (`directives.ts`), and the
   **corpus** are first-class and shared; **a new benchmark is just an adapter** (loader + worker
   profile + judge + SOTA). Do not fork a `*-loop.ts` or a `Promise.all` drain — extend the atom.
6. ⏳ **Open follow-ups:** the analyst→driver channel exists (`PlannerContext.analyses` +
   the `analyze` hook, `src/runtime/driver.ts:80`) — built and tested, **not yet fed live by
   any bench**; a `/run-benchmark-loop` skill encoding the adapter recipe.
