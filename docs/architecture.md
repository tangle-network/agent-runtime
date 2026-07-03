# Architecture — The Spine

> **In plain terms:** This is the internal design document for agent-runtime — how the system works under the hood, written for developers who will build on or extend the package and want the big picture before reading code. The single most important idea: the whole system is made of one repeating building block — an agent that looks at its progress and the budget left, then picks the best next move (keep working, try several approaches at once, get a second opinion, run a check, or stop). That same block nests inside itself to form a tree, and the system is designed to get measurably better at those decisions the more it runs. Everything below explains that one block and how it improves.

> **One agent pattern, repeated into a tree. Every node makes a decision that balances several goals at once. Two timescales run in parallel, and the slow one — the system getting better from run to run — is the real product.**
>
> This doc is the single spine that unifies
> `docs/learning-flywheel.md` (the theory + the moat) and
> `@tangle-network/agent-eval` `docs/design/self-improvement-engine.md` (the
> optimization-time engine). Where this conflicts with another doc, **this
> wins**. If you are an agent in another repo building a new benchmark: **read
> §1, §6, §9 — you only write an adapter, never a new loop.**
>
> **Live status and every measured number live in `.evolve/current.json` and the
> memory ledger — this doc is timeless mechanism.** The coherence stress-test + the
> Gate-A definition: [architecture-interpretations.md](./architecture-interpretations.md);
> the dependency-ordered build plan: [roadmap-rsi.md](./roadmap-rsi.md); the evidence
> map + portfolio: [docs/research/optimization-space.md](./research/optimization-space.md).
> Doc map: [docs/README.md](./README.md).

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

The same `Agent` loop runs at two timescales.

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

**Which curve is success.** The inference-time column makes the **solution** climb
within a run; the optimization-time column makes the **decision policy** climb across
runs — and *that across-run slope is the success criterion* (**Gate B**, defined in
[learning-flywheel.md](./learning-flywheel.md)). The within-run question — *does a
trace-fed driver beat a blind same-compute baseline under a non-oracle selector at equal
compute* (**Gate A**, defined in
[architecture-interpretations.md §5](./architecture-interpretations.md)) — is a separate,
narrower diagnostic; a failed Gate A deletes within-run steering, never the corpus+policy
product. Live results for both gates: `.evolve/current.json` + the memory ledger.

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
verdict. Provenance — not evidence presence — is the discriminator. Drawn, with
the enforcing code, in §13.3 (`assertTraceDerivedFindings`).

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
the optimizer can trade objectives honestly. The analyst-prompt coordinate measured
flat; the live outer-loop lever is **program/strategy space** (`defineStrategy` +
`authorStrategy`) — see
[docs/research/optimization-space.md](./research/optimization-space.md) and the ledger.

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
  inference (vote / verifier-rerank). A verifier-grounded selector (`verifierGroundedSelect` in
  `bench/src/selector.ts`) is built and measured — see `docs/architecture-interpretations.md` §2
  for its current evidence status. The law stands regardless: the selector is never the judge.

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
   result is bench-specific, not domain-general). Status: see the ledger
   (`.evolve/current.json`).
2. **Escalate the driver to `sandbox-agent` (auto-research)** — only if rung 1
   beats compute-matched random.
3. **GEPA** the driver/analyst `context`+prompts, held-out gated.
4. **Composition lift** — `fork`/coordinator/nested (driver-of-drivers).
5. **Cross-benchmark transfer** — one learned controller, many benchmarks. The moat.

Each rung must beat compute-matched random before the next is funded.

---

## 10. What the literature says (grounding)

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

## 11. Empirical status — lives in the ledger

Every measured number — the FinSearchComp rung-0 arms, the Gate-A
clear-then-retraction under the POWER-16 rule, the GEPA-over-analyst-prompt null,
the selector results, and the SOTA comparison tables — lives in
`.evolve/current.json` (the live science state) and the memory ledger. This doc
keeps only the two distilled findings that are mechanism, not state:

**The domain-boundary law:** within-run steering is **negative on stateless
retrieval** (FinSearchComp rung-0), **null-to-negative on stateless codegen**
(HumanEval steer gate null at equal k; exec-grounded self-repair −17.1pp,
CI [−26.8, −7.3]), and **positive on stateful agentic domains** with a correctable
middle band, scored keep-best (EOPS). The boundary variable is state + the
inability to cheaply resample.

**Honesty law:** our loop is **not a new method class** — sequential-refine =
Reflexion / CRITIC / FLARE; fanout-vote = self-consistency /
best-of-N-with-verifier. We benchmark *against* those and claim no novelty for
the scaffold; the moat is transfer (§8).

---

## 13. The system, drawn

> The picture book for the spine above. Every node is an **`AgentProfile`**; the shape
> is recursive; trace analysis flows **up** the tree after every rollout;
> self-improvement is the tree **rewriting profiles**. Every diagram is grounded in
> `src/runtime/` with `file:line` anchors, and each claim is tagged **REAL** (built +
> tested) or **designed, not built**. If a diagram disagrees with the code, the
> **code wins** — fix the diagram in the same change.

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

The ask/answer edges of the question/command hierarchy are **built** — `ask_parent` up
and `answer_question` down (`src/mcp/tools/coordination.ts:159-160`), priority-queued on
the event bus; salience filtering and the cross-box durable mailbox are not. See **§13.6**.

### 13.2 The tree — drivers of drivers, one recursive atom

```
            ┌──────────────────────────────────────────────┐
            │  SUPERVISOR   = an AgentProfile               │   depth 0
            │  • can work a task itself                     │
            │  • breaks the task down (its own prompt)      │
            │  • AUTHORS the AgentProfile of each child     │
            │    it spawns (prompt / tools / mcp / skills)  │
            └───────────────┬──────────────────────────────┘
                            │ spawn(child = a profile it wrote)
        ┌───────────────────┼────────────────────────┐
        ▼                   ▼                         ▼
  ┌───────────┐      ┌────────────────┐        ┌───────────┐
  │ DRIVER    │      │ SUB-SUPERVISOR │        │ WORKER    │   depth 1
  │ = profile │      │ = profile      │        │ = profile │
  │ works a   │      │ spawns anything│        │ works a   │
  │ task AND  │      │ (recurses —    │        │ task      │
  │ drives    │      │  same atom)    │        │ (a LEAF)  │
  │ workers   │      └──────┬─────────┘        └───────────┘
  └────┬──────┘             ▼
       ▼            (driver | sub-supervisor | worker)*        depth 2 …
   ┌───────┐
   │WORKER*│        Three roles, ONE atom: an Agent node that
   └───────┘        `act(task, scope)`s — it may settle a result
                    (leaf) OR spawn children (driver/supervisor).

   budget: ONE conserved pool reserved across the whole tree
           → equal-compute holds at EVERY depth (`supervise/budget.ts`)
```

- **REAL** — one recursive `Agent` node, not two types: `Agent.act(task, scope)` in
  `src/runtime/supervise/types.ts:49`. The roles are the *same* atom; a node is a
  "driver" only because its tools spawn children. A child whose `act` calls
  `scope.spawn` is a driver too, with its **own sub-scope** (depth+1, bounded by
  `maxDepth` + the *same* pool) — recursion isn't a feature, it's the absence of a
  base case (`supervise/supervisor.ts`, `supervise/scope.ts`).
- **REAL** — the **leaf** at the bottom is where a real coding harness runs, opaque and
  self-parallelizing internally; the `runLoop` kernel (`src/runtime/run-loop.ts`) is
  composed as one leaf execution backend. Everything above it is the same `act`/`Scope`
  atom, observable as one lifecycle stream (`scope.spawn`/settle →
  `agent.spawn`/`agent.child`).
- **REAL** — every node materializes in its backend (sandbox / cli-bridge / router /
  worktree-cli) via the one backend-as-data factory `createExecutor({ backend })`
  (`src/runtime/supervise/runtime.ts:1517`). The profile says what it is; the executor
  says where it runs.
- **REAL** — the supervisor **authoring** child profiles is the AgentProfile law (§1,
  and `canonical-api.md` §1.5): a supervisor's intelligence is *writing full
  AgentProfiles for its children*. The coordination toolbox `spawn_agent` carries the
  child profile (`src/mcp/tools/coordination.ts`).
- The in-process driver brain is `driverAgent`
  (`supervise/coordination-driver.ts`) running the owned tool-loop executor
  `routerToolsInlineExecutor` (`supervise/runtime.ts`). A driver/supervisor's brain is
  driven from its `AgentProfile` (tools = the coordination verbs); inferring the brain
  entirely from the profile so a driver is *just* a profile with zero special cases is
  not yet wired end-to-end.

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

### 13.5 Analysts are just Agents → ensembles come for free (§4, drawn)

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

**When to build it (discipline):** the *concept* is free (it falls out of the atom), but
standing up the 50–100-question machinery speculatively is mechanism-ahead-of-gate —
build the comprehensive analyst as the gate experiment (the strongest test of "can *any*
diagnosis help"), not as a standing feature.

### 13.6 The command hierarchy — partially built

A leaf *raises* a question; each parent is a *handler* that either **discharges** it
(answers from its own tools/knowledge/directive) or **re-raises** it one level up; the
human is the **top handler**. Local autonomy + global override — a command hierarchy,
not agent-to-agent messaging.

**Built** (`src/mcp/tools/coordination.ts`, `src/runtime/supervise/event-bus.ts`,
`src/runtime/supervise/inbox.ts`):
- `ask_parent` up + `answer_question` down (`src/mcp/tools/coordination.ts:159-160`) —
  a blocking question rides the ONE typed pipe, **priority-queued** ahead of queued
  settles/findings (the event bus); the answer routes down to the child's inbox.
- `steer_worker` — the down-leg for any live worker (instruction / correction /
  continuation); queued messages flush at step boundaries AND before the worker may
  settle; a forceful `steer_worker({interrupt:true})` aborts the in-flight turn (the
  inbox).
- `notify` up — every settle/decision is teed upward on the lifecycle hook stream.

**Not built:** the **salience tag** on decisions (so the top doesn't drown), the
cross-box durable mailbox (§13.9), budget-pause-while-awaiting.

**Command is one level deep.** An ancestor overrides its **direct report**, which
reconciles and re-steers its own children. No skip-level reach-around → no two agents
steering the same child → the hierarchy stays coherent + auditable. Corrections
**compose down** the chain exactly as questions **compose up** it — escalation falls
out of the recursion, so there is no "driver-of-driver" special case.

**Two disciplines:**
1. **Budget pauses while awaiting a human** — a blocked node isn't computing; treat
   "awaiting answer" like `budgetExempt` so it doesn't burn its deadline/`maxTokens` against
   the conserved pool.
2. **A human answer is an oracle injection** — so this channel is **off / held-constant in
   gated experiments** (it would confound equal-k and the no-oracle selector rule). It is a
   *production* feature, not a gate-eval one.

### 13.7 The up-flow — trace analysis after every rollout, flowing up like a tree

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

### 13.8 Where self-improvement comes from — the tree rewriting profiles

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

- **The self-improvement comes from the analyst findings that flow up** (§13.7): they are
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

### 13.9 Durability — by design, not yet end-to-end

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

### 13.10 The one-line model

**A recursive tree of AgentProfiles, materialized in their backends, where every rollout's
trace-analysis flows up one typed pipe, and that analysis is what rewrites the profiles — as
an in-flight steer, as injected skills, and as a re-authored genome — durably.** Every
clause of that sentence is one primitive with one name (§13 names them).
