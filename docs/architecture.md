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
> (`runtime-hooks`). The canonical "drive an agent" path is the **agent-driver**: an
> `AgentProfile` driving another `AgentProfile` via `createCoordinationTools`
> (`src/mcp/tools/coordination.ts`) over the `Scope`/`Supervisor`. The `runLoop` KERNEL
> (`src/runtime/run-loop.ts`) stays as **one execution backend**, not the center. The
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
   the inner `runLoop` with a **dumb static planner** (inject the prior
   answer + a fixed "verify and revise" directive) and **never invoked ANALYZE →
   PROPOSE** — the trace-analysts and the recursively-agentic driver. All the
   intelligence lived in the *optimization* layer, pointed at surface-improvement
   PRs, and was never wired to the *inference-time* loop on a benchmark. The
   agent-driver over the `Scope`/`Supervisor` is the path that wires that
   intelligence to the inference-time loop.

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

> Drawn, with `file:line` anchors, in the picture book: §13 below.

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
opencode-style extension surface *and* the live projection of the recursive agent tree —
each node's status, steps, child count, and deployable score. The journal stays the durable
record; the hook stream is its live projection (both agree).

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
| Where it lives today | the agent-driver over the `Scope`/`Supervisor` (`createCoordinationTools`) + `runAgentic`/`defineStrategy`; the `runLoop` kernel is one leaf backend | `runOptimization`/`runImprovementLoop` + `propose()` (**this is built**) |

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
| text-only baseline | mutate the surface text into N variants | no | a `defineStrategy` variant (`src/runtime/strategy.ts`) |

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

The optimizer `O` improves any `Agent`'s `context`+prompt and the program shape,
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
being squatted on.

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
   result is bench-specific, not domain-general). **Status: TIE at power (POWER-16,
   2026-06-13)** — the n=16 "+16.4pp cleared" signal collapsed to depth−breadth +4.7pp
   CI [−1.9, +11.4] at n=48; at most a small effect, not a cleared keystone (§11).
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

> `random@k` / `refineHand@k` / `refineGepa@k` are **condition labels for strategy runs**
> recorded in the corpus (the controller column), not importable symbols. `refineGepa@k`
> names "the refine strategy steered by a GEPA-authored prompt, k attempts."

**Caveats that change the meaning:**
- This tested the **dumb static planner** (§0.2), NOT the trace-fed intelligent
  driver. The honest statement is *"answer-anchored intrinsic refine loses, as
  the literature predicts"* — **the real driver is UNTESTED.**
- `random@3 = 60%` is **pass@3 with the judge selecting** = an **oracle upper
  bound**. The deployable number (vote/verifier-select, no oracle) is unmeasured
  and lower. The +22.5pp is partly oracle-inflated.

So rung-0 is **not** "steering is futile" — it is "the toy loses, and we have not
yet run the machine we built."

**Gate A — RETRACTED to a TIE at power (POWER-16, 2026-06-13).** The headline
+16.4pp depth>breadth result did **not** replicate when powered. On the canonical
loop — the `Scope`/`Supervisor` substrate + the `observe()` analyst + `defineStrategy`
(`src/runtime/strategy.ts`), **not** the `runLoop` path — the
original signal was depth-steered continuation beating breadth (blind best-of-K) at
equal compute under keep-best checkpoint scoring: **+16.4pp, CI [+5.3, +29.8], 6 wins
/ 0 losses, n=16**, deepseek-v4-pro (replicated +8.3pp on a disjoint slice). At n=48
(4 gym lanes, depth verified firing, both arms best-checkpoint) this collapsed to
**depth−breadth = +4.7pp, CI [−1.9, +11.4] — a TIE** (and +4.1pp, CI [−1.6, +10.2]
at n=72). The n=16 number was an underpowered overestimate (a 6/0 streak); depth>breadth
is at most a *small* effect (~5pp, would need n≈96–200 to confirm), not a cleared
keystone. Per the pre-registered POWER-16 rule the program pivoted **off** this anchor;
see `.evolve/current.json` (the live science ledger). Method note retained: both arms
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

## 12. Consolidation map — doc roles + the shared atoms

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

### Shared atoms (the cohesion law)

The atom is **shared, not forked**: the inner `for(round 1..k){ shot → judge → decide →
carry-forward }` lives in **one** loop atom, the bounded-concurrency drain in **one** pool
atom, and every steer directive in **one** surface — `runRefineLoop`, `runPool`,
`directives.ts`, and the corpus are the shared atoms a benchmark plugs into.

1. ✅ **`runRefineLoop<Artifact, Ctx>`** (the loop atom): one execution-agnostic loop —
   `{rounds, setup, prompt, runShot, judge?, decide?, teardown}`, the worker an opaque `runShot`.
   **All six refine workers** (research / sandbox-research / SWE-refine / cad / blender / build123d)
   run it — **zero hand-rolled `for(round)` loops**. Both carry-forward channels (execution context
   + prompt) are first-class.
2. ✅ **`runPool<T, R>`** (the pool atom): one generic bounded-concurrency pool. **The surviving batch
   runners** (`batch-blind` / `batch-oracle` / `batch-compare` / `terminal-compare`)
   use it — **zero hand-rolled `Promise.all` drains**.
3. ✅ **`directives.ts`** (the steer surface): every refine directive + authoring system prompt lives
   here; **zero worker-owned prompt text**. Task framing lives in the benchmark adapters.
4. ✅ **Delete `analyze-paired.mts`** — dead, superseded by `corpus-report.mts` (durable corpus + BH-FDR).
5. **CANONICAL LAW (everyone follows):** a worker is an opaque **substrate plug** (`runShot`); the
   **loop** (`runRefineLoop`), the **pool** (`runPool`), the **steer** (`directives.ts`), and the
   **corpus** are first-class and shared; **a new benchmark is just an adapter** (loader + worker
   profile + judge + SOTA). Do not fork a `*-loop.ts` or a `Promise.all` drain — extend the atom.
6. ⏳ **Open follow-ups:** the analyst→driver channel lives on the agent-driver — the
   parent `AgentProfile` reads `observe()` findings and steers its child via
   `createCoordinationTools` over the `Scope`/`Supervisor`; a `/run-benchmark-loop`
   skill encoding the adapter recipe.

---

## 13. The system, drawn

> The picture book for the spine above. Every diagram is grounded in `src/runtime/` with
> `file:line` anchors. If a diagram disagrees with the code, the **code wins** — fix the
> diagram in the same change.

### 13.1 The atom — `act` over a `Scope` (§1, drawn)

The whole system is **one type** (`src/runtime/supervise/types.ts:49`):

```ts
interface Agent<Task, Out> {
  readonly name: string
  act(task: Task, scope: Scope<Out>): Promise<Out>
}
```

A **leaf** is an `act` that returns without touching `scope`. A **driver** is an `act`
that spawns children and reacts to them. Same type — the role is behavior, not a class
(the full prose is §1).

The `Scope` it runs inside is **5 verbs** (`types.ts`) — a budget-conserving reactive
nursery:

```
  scope ─────────────────────────────────────────────────────────────────────────────────────
   │
   ├─ spawn(agent, task, {budget,label}) → {ok,handle} | {ok:false, 'budget-exhausted'|'depth-exceeded'}
   │     reserves budget ATOMICALLY from a conserved pool, fail-closed   ⟸ THE equal-compute invariant
   │
   ├─ next() → Promise<Settled | null>            the WAKE cursor: resolves as each child settles, in seq order
   │     Settled = {done: out, verdict, spent} | {down: reason, infra}
   │
   ├─ send(nodeId, msg) → bool                     STEER a running child (next-instruction / interrupt)
   │     in-process = direct call · across a sandbox = the SAME verb as an MCP tool
   │
   ├─ view  → TreeView                             the live tree (in-memory, O(live)) — what the topology viewer renders
   └─ budget → {tokensLeft, usdLeft, deadlineMs, reservedTokens}
```

Two facts make this the whole game:
- `spawn` **reserves** from a shared pool and refunds the unspent remainder on settle, so
  `Σk(treatment) ≡ Σk(blind)` by construction — no arm can buy more compute
  (`supervise/budget.ts`).
- `next()` is the *only* way to observe a child, so a driver reacts to **settlements**,
  never reaches inside a child.

Three more edges are **designed, not built** — the question/command hierarchy (`ask` up,
`notify` up, `override` down) that lets a deep agent surface a question and a higher agent
countermand a decision. See **§13.7**.

### 13.2 The recursion — drivers of drivers, same atom all the way down

A spawned child is an `Agent`. If its `act` calls `scope.spawn`, it's a driver too, with
its **own sub-scope** (depth+1, bounded by `maxDepth` + the *same* pool). Recursion isn't
a feature — it's the absence of a base case (`supervise/supervisor.ts`, `supervise/scope.ts`).

```
   Supervisor.run(rootAgent, task)
        │  act(task, scope₀)            depth 0   ── a DRIVER
        │
        ├─ spawn ─▶ planner   act(τ, scope₁)      depth 1   ── itself a DRIVER
        │              ├─ spawn ─▶ subtask  act(…) depth 2  ── a LEAF (returns directly)
        │              └─ spawn ─▶ subtask  act(…) depth 2  ── a LEAF
        │
        └─ spawn ─▶ coder     act(τ, —)            depth 1   ── a LEAF: a sandbox coding-harness,
                                                                opaque + self-parallelizing internally
   budget: ONE conserved pool reserved across the whole tree → equal-compute holds at EVERY depth
```

The leaf at the bottom is where a real coding harness runs — the `runLoop` kernel
(`run-loop.ts`) is composed as one leaf execution backend. Everything above it is the same
`act`/`Scope` atom. The whole tree is observable as one lifecycle stream
(`scope.spawn`/settle → `agent.spawn`/`agent.child`).

### 13.3 The within-run self-improvement loop (§1's agent-driver, drawn)

The live within-run RSI mechanism is the **agent-driver**: a parent `AgentProfile` driving
its children via `createCoordinationTools` (`src/mcp/tools/coordination.ts`) over the
`Scope`/`Supervisor` (`src/runtime/supervise/`). Each round: **diagnose → decide → act →
settle**, with one firewall that keeps it honest.

```
        ┌──────────────────────────────────────────────────────────────────────────┐
        │                       one agent-driver round                              │
        │                                                                            │
   parent AgentProfile, holding the coordination MCP:                                │
        │                                                                            │
        │   ① stop?(trace) → deployable, non-oracle STOP                             │  the DEPLOYABLE
        │        deterministic = trust ground truth                                  │  non-oracle STOP
        │        probabilistic = clears confidence policy → stop                     │  (coordination: stop)
        │                                                                            │
        │   ② run_analyst(trace) → AnalystFinding[]        ◀── reads the TRACE       │
        │        assertTraceDerivedFindings(findings)          NOT the score         │  selector ≠ judge
        │        (coordination.ts / personify/analyst.ts:46)                         │  FIREWALL
        │                                                                            │
        │   ③ next move from {trace, findings} via the MCP:                          │  move = f(trace, findings)
        │        steer_agent (1 child)   spawn_agent (N)   select   stop            │  NOT f(score)
        │                                                                            │
        └───────────────┬─────────────────────────────────────────────────────────────┘
                        ▼
        Scope: spawn child agent(s) → run → settle → verdict on the artifact
                        │
                        └──▶ await_event → terminal? → winner = argmax(valid score)
```

The firewall is the load-bearing line: the **analyst reads the trace and may not cite the
score**, so the thing that *steers* (diagnosis) is independent of the thing that *selects*
(verdict). Selector ≠ judge, enforced in code (`assertTraceDerivedFindings`,
`personify/analyst.ts:46`).

### 13.4 The evolution of a prompt — the whole thesis in one picture

A prompt is not static input; it's a value that **mutates through the graph** within a run
and **across runs**.

```
        ┌────────────────────── CROSS-RUN FLYWHEEL (slow loop · bench/) ───────────────────────┐
        │   failures corpus ──GEPA-over-failures──▶ learned directive δ ──▶ prepended next run   │
        └──────────────────────────────────────────────────┬─────────────────────────────────────┘
                                                            │ δ
   raw task  τ ───────────────⊕δ──────────────▶  τ₀ = δ ⊕ τ        ← prompt ENTERS already carrying learning
                                                   │
                                                   ▼   act(τ₀, scope)
   round 0    spawn(child, τ₀) ─▶ stream ─▶ parse ─▶ validate ─▶ verdict(score)
                                                   │                    └─ score: SELECT-only (never steers)
                                                   ▼
                                    analyst.read(TRACE) ─▶ findings        ⟵ firewall: no score
                                                   │
   round 1    diagnose(τ₀, findings) ─▶ move ─▶ prompt transforms:
                  refine   →  τ₁ = steer(τ₀, "fix X — per finding")            prompt MUTATES   (send / re-spawn)
                  fanout   →  [τ₁ᵃ, τ₁ᵇ, τ₁ᶜ]  diverse re-framings             prompt BRANCHES
                  complete →  stop                                            prompt SATISFIED  (deployable)
                                                   │
   …                                               ▼
   round n                          select(argmax valid score) ─▶ winner τ*
                                                   │
                                                   └────────────▶ feeds the failures corpus ──▶ δ′ (next run smarter)
```

The move language is `Agent.act(task, scope)` over a `Scope`: `fanout` = N × `scope.spawn`,
`refine`/`steer` = `scope.send`, `select` = `defaultSelectWinner`, `stop` = `act` returns.

### 13.5 The two timescales — one shape, two loops (§2, drawn)

```
   FAST  (within a run)          τ₀ → diagnose → τ₁ → … → τ*           ← the driver round (§13.3)
                                  status: domain-bounded — see `.evolve/current.json` for the live ledger.

   SLOW  (across runs)            τ always enters as  δ ⊕ τ            ← the learning flywheel
                                  δ = directive GEPA-distilled from past failures.
                                  status: UNTESTED at the gate (diverse@k vs blind@k at equal compute).
```

The binding empirical question: **does any non-blind topology beat blind compute at EQUAL
k, under a deployable non-oracle selector, on a domain with a correctable middle band?** The
live answer — which domains cleared it, which coordinates measured flat — lives in
`.evolve/current.json` and the memory ledger (§11 carries the captured numbers).

### 13.6 Analysts are just Agents → ensembles come for free (§4, drawn)

An analyst is **not a new type** — it is `Agent<unknown, AnalystFinding[]>` the driver
spawns over a child's trace (`src/runtime/personify/analyst.ts`; `createScopeAnalyst` at
`:96`; the firewall is applied by `createScopeAnalyst`, not the analyst itself). The lens
menu (`src/mcp/tools/checks.ts:93` — `defaultChecks`: failure-mode, correctness, safety,
cost, tool-use) is data, not code; the driver picks lenses via `list_analysts`/`run_analyst`.

Because an analyst is an Agent, the richer ideas are **already expressible with the existing
atom — no new primitive**:

```
   driver.scope
      ├─ spawn ─▶ analyst:failure-mode   (harness null  — inline lens)        ┐
      ├─ spawn ─▶ analyst:correctness    (harness null)                       │  an ENSEMBLE of analysts
      ├─ spawn ─▶ analyst:cost           (harness cli)                        │  is just FANOUT of
      └─ spawn ─▶ analyst:deep-audit     (harness SANDBOX — a Claude-Code     │  analyst-Agents
                  agent that authors + runs a dynamic workflow answering      │
                  50–100 audit questions over ALL traces)                     ┘
                          │
                  next() drains each → fold findings → "which analyst's diagnosis,
                  applied, most improved the next round?"  ← the analysts COMPETE, scored by lift
```

- A **sandbox-audit analyst** = that Agent with `harness: sandbox`; its `act` body authors
  and runs the comprehensive audit. No subsystem — a profile + the existing spawn.
- An **ensemble** = fanout of analyst-Agents; **"competing"** = folding/scoring their
  findings by the lift they produce. Ensembles-of-ensembles = a driver-analyst that itself
  spawns sub-analysts.

**When to build it (discipline):** the *concept* is free (it falls out of the atom), so it
is not overkill. But standing up the 50–100-question machinery speculatively **is**
mechanism-ahead-of-gate. The cheap, decisive version is the gate-relevant one: a maximally
comprehensive analyst is the **strongest possible test of "can *any* diagnosis help"** — if
even it can't beat blind at equal compute, the within-run-steer family is dead for real; if
it can, that's the signal. Build it as the gate experiment, not as a standing feature.

### 13.7 The command hierarchy — `ask` / `notify` / `override` (DESIGNED)

> **Status: designed, not built.** Implementation is gated on the verifier-grounded gate
> result + the PI/chat repo defining the human-handler contract. This section nails the
> *interface* so both repos build to the same seam.

The escalation model is **not** agent-to-agent messaging (don't reach for A2A / a bus) —
it's a **resumable effect with handlers** (à la LangGraph `interrupt()` / algebraic-effect
handlers / OTP supervisor-escalation). A leaf *raises* a question; each parent is a
*handler* that either **discharges** it (answers from its own tools/knowledge/directive) or
**re-raises** it one level up; the human (the PI agent) is the **top handler**. It turns the
tree from "escalate-on-stuck" into a real **command hierarchy: local autonomy + global
override.**

Three edges complete the atom — two already exist:

| Edge | Direction | Blocking? | Notes |
|---|---|---|---|
| `ask` | **up** | yes | child can't proceed without the answer; **terminates** at the first handler who answers. The one genuinely-new edge (or a 3rd `Settled` kind `{question}` — see below). |
| `notify` | **up** | **no** | every steering decision is teed upward, **salience-filtered**, so an ancestor with higher-order knowledge can countermand it. **This is the lifecycle hook stream** (`agent.decision`/`agent.answer`) — already shipped. |
| `override` | **down** | — | the ancestor's countermand. **This is `scope.send`** — already shipped; the same edge carries the answer *and* the override. |

```
   PI agent (human handler)            ◀── answer ── "use prod — this is an incident"
        │ override ▼        ▲ notify (non-blocking, salience-filtered)
   root supervisor   ── sees D1's answer; has higher-order context → overrides D1
        │ override ▼        ▲ notify
   driver D1         ── answers W IMMEDIATELY (no waiting), tees the decision up; later re-steers W
        │ send ▼            ▲ ask (BLOCKING — W needs the answer)
   worker W (leaf)   ── raises "prod or staging?" + WHY (its reasoning + D1's decision context)
```

**The non-negotiable: optimistic + asynchronous, never synchronous approval.** If D1 had to
*wait* for the root's blessing (and the root for its parent), every local decision
serializes through the root and drowns the top. So D1 answers W now, tees the decision up,
and an ancestor's override is a **later, higher-authority `send` that supersedes** — a
compensating correction, not a pre-approval gate. (W is re-steerable mid-flight; that's what
`send` is for.)

**Command is one level deep.** The root overrides **D1** (its direct report); **D1**
reconciles and re-steers **W**. No skip-level reach-around → no two agents steering the same
child → the hierarchy stays coherent + auditable, and D1 can reconcile the override against
state the root can't see. Corrections **compose down** the chain exactly as questions
**compose up** it — and escalation falls out of the recursion (a driver `ask`s on *its*
scope), so there is no "driver-of-driver" special case.

**Block vs. settle-and-resume** (the real engineering fork, because human latency is
minutes–hours):
- live-block (`await scope.ask`): child stays alive, blocked — fine for in-process/cheap leaves.
- settle-as-question + resume: child returns `{kind:'question'}` (frees its sandbox box),
  the parent handles it, the answer **resumes the child from its checkpoint** — reuses the
  shipped `sandbox-lineage` session-continuity. The `Executor` picks the mode, the same way
  it abstracts run modes — which is why this is a small feature, not a subsystem.

**What's new vs. already there:** new = the `ask` edge (+ a `question` settlement kind), a
**salience tag** on decisions (so the top doesn't drown), and **path-routed `send`** (so an
override reaches a deep node — node ids are already the path). Reused = `send`
(answer/override), the hook stream (notify), the lineage (resume), the recursion
(escalation), the MCP-steer pattern (the cross-sandbox wire — **MCP elicitation** is the
standard for it), and the topology viewer (a node "awaiting answer" is just a visible
state). The **answer-or-escalate policy lives in the agent's `act`/directive, not the
kernel.**

**Two disciplines:**
1. **Budget pauses while awaiting a human** — a blocked node isn't computing; treat
   "awaiting answer" like `budgetExempt` so it doesn't burn its deadline/`maxTokens` against
   the conserved pool.
2. **A human answer is an oracle injection** — so this channel is **off / held-constant in
   gated experiments** (it would confound equal-k and the no-oracle selector rule). It is a
   *production* feature, not a gate-eval one.

---

## 14. The tree, the up-flow, and where improvement comes from

> One picture of the whole system. Every node is an **`AgentProfile`**. The shape is
> recursive. Trace analysis flows **up** the tree after every rollout. Self-improvement is
> the tree **rewriting profiles**. Everything is one data structure, durable by design.
>
> Each claim is tagged **REAL** (built + tested, `file:line`) or **designed, not built**.

### 14.1 The tree — one recursive atom

```
            ┌──────────────────────────────────────────────┐
            │  SUPERVISOR   = an AgentProfile               │
            │  • can work a task itself                     │
            │  • breaks the task down (its own prompt)      │
            │  • AUTHORS the AgentProfile of each child     │
            │    it spawns (prompt / tools / mcp / skills)  │
            └───────────────┬──────────────────────────────┘
                            │ spawn(child = a profile it wrote)
        ┌───────────────────┼────────────────────────┐
        ▼                   ▼                         ▼
  ┌───────────┐      ┌────────────────┐        ┌───────────┐
  │ DRIVER    │      │ SUB-SUPERVISOR │        │ WORKER    │
  │ = profile │      │ = profile      │        │ = profile │
  │ works a   │      │ spawns anything│        │ works a   │
  │ task AND  │      │ (recurses —    │        │ task      │
  │ drives    │      │  same atom)    │        │           │
  │ workers   │      └──────┬─────────┘        └───────────┘
  └────┬──────┘             ▼
       ▼            (driver | sub-supervisor | worker)*
   ┌───────┐
   │WORKER*│        Three roles, ONE atom: an Agent node that
   └───────┘        `act(task, scope)`s — it may settle a result
                    (leaf) OR spawn children (driver/supervisor).
```

- **REAL** — one recursive `Agent` node, not two types: `Agent.act(task, scope)` in
  `supervise/types.ts:51`. The roles (worker/driver/supervisor) are the *same* atom; a node
  is a "driver" only because its tools spawn children.
- **REAL** — every node materializes in its backend (sandbox / cli-bridge / router /
  worktree-cli) via the one backend-as-data factory `createExecutor({ backend })`
  (`supervise/runtime.ts:1137`). The profile says what it is; the executor says where it runs.
- **REAL** — the supervisor **authoring** child profiles is the AgentProfile law (§1, and
  `canonical-api.md` §1.5): a supervisor's intelligence is *writing full AgentProfiles for
  its children*. The coordination toolbox `spawn_agent` carries the child profile
  (`mcp/tools/coordination.ts`).
- The in-process driver brain is `driverAgent`
  (`supervise/coordination-driver.ts`) running the owned tool-loop executor
  `routerToolsInlineExecutor` (`supervise/runtime.ts`). A driver/supervisor's brain is
  driven from its `AgentProfile` (tools = the coordination verbs); inferring the brain
  entirely from the profile so a driver is *just* a profile with zero special cases is not
  yet wired end-to-end.

### 14.2 The up-flow — trace analysis after every rollout, flowing up like a tree

```
   worker rollout settles ─[analyst]→ finding ─┐
   driver rollout settles ─[analyst]→ finding ─┤  ONE typed pipe (the event bus)
   loop / subloop settles ─[analyst]→ finding ─┘  kinds: settled | ask_parent | finding
                                                   priority-queued, stamped (seq/at)
                    │
                    ▼  flows UP to the parent (driver ← worker, supervisor ← driver, …)
            ┌───────────────┐
            │ parent pulls   │  await_event({kinds}) — the ONE wait verb
            │ or subscribes  │  (immediate push) — folds the child's analysis
            └───────────────┘  into its own next decision
```

- **REAL** — the single up pipe: `createEventBus` (`supervise/event-bus.ts`). Child→parent
  rides ONE channel — settled outputs, `ask_parent` questions, and trace-analyst `finding`s
  are all `CoordinationEvent` kinds; priority-queued (a blocking question jumps the queue),
  ties FIFO by `seq`.
- **REAL** — analysts auto-fire on settle: `analyzeOnSettle` runs trace analysts when a node
  settles `done` and **re-enters each result as a `finding` on the same bus**
  (`supervise/coordination-mcp.ts`). So "run an analyst after every rollout and send it up"
  is built — for workers, and because every node is the same atom, the mechanism is uniform
  across layers.
- **REAL** — the analysis itself is substrate- and harness-agnostic: `TraceSource` turns a
  rollout's tool calls into agent-eval `ToolSpan`s from EITHER an owned loop OR a sandbox
  box; online `watchTrace` and on-settle `analyzeTrace` both fold them
  (`supervise/trace-source.ts`, `supervise/trajectory-recorder.ts:27`).
- **GAP** — `analyzeOnSettle` firing at the *driver* and *loop* settle (not only worker
  settle) is not yet uniform. The atom supports it; the wiring should be made uniform so
  "ANY LAYER, ANY SUBLOOP" is literally one rule.

### 14.3 Where self-improvement comes from — the tree rewriting profiles

The AgentProfile changes at **three timescales** (the §2 two-timescale frame, expanded — the
within-run column splits into in-flight and across-round).

```
  ① IN-FLIGHT (within one node's loop, between shots)
     analyst finding ──▶ STEER the next shot's prompt
     → changes the NEXT message, not the stored profile
     REAL: grounded steer in the depth loop (strategy.ts), steer_agent down-leg

  ② ACROSS-ROUND (between rounds of a loop)
     harvest this run's traces ──▶ corpus ──▶ render as SKILLS ──▶ inject into next round's profile.systemPrompt
     → creates/grows the profile's SKILLS from its own experience
     REAL: harvestCorpus (harvest-corpus.ts), renderCorpusToInstructions (personify/corpus.ts)

  ③ ACROSS-GENERATION (the flywheel)
     holdout-gated ──▶ AUTHOR a new profile (the genome: prompt + skills + tools + …)
     → rewrites the whole AgentProfile; certified on a frozen holdout, never the training set
     REAL: the improvement loop (improvement/), gated by promotion/heldout gates
```

- **The self-improvement comes from the analyst findings that flow up** (§14.2): they are
  the signal that steers (①), mines skills (②), and drives the next-generation authoring
  (③). We both improve existing skills and create new ones, and we modify the AgentProfile
  both in-flight (as a steer) and after-flight (as injected skills, and as a re-authored
  genome).
- **REAL** — the firewall holds at every layer: the analyst is the *steerer*, never the
  *judge* — `assertTraceDerivedFindings` (`personify/analyst.ts:46`). Improvement reacts to
  behavior, not to the score it's optimizing.
- The three timescales are separate code paths today. A single `improve` verb
  with the three timescales as internal composition — so "are we improving skills in the
  loop?" has one place to look — is not yet wired.

### 14.4 Durability — by design, not yet end-to-end

```
  same box   : in-process queue   ── REAL (tested)
  cross box  : durable mailbox on the parent's box ── designed (the interface is ready)
```

- **REAL** — the event bus is transport-agnostic *on purpose*: same box → the in-process
  queue; cross box → the SAME publish/pull/subscribe surface backed by a durable mailbox on
  the parent's box (`supervise/event-bus.ts`). The data structure is already shaped for
  durability.
- **designed, not built** — the cross-box (distributed-sandbox) durable binding: in-process
  is real and tested, the cross-box transport is the thin unbuilt part, so the up-flow can
  survive across distributed boxes and restarts.

### 14.5 The one-line model

**A recursive tree of AgentProfiles, materialized in their backends, where every rollout's
trace-analysis flows up one typed pipe, and that analysis is what rewrites the profiles — as
an in-flight steer, as injected skills, and as a re-authored genome — durably.** Every
clause of that sentence is one primitive with one name (§13–§14 name them).
