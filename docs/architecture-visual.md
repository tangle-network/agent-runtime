> **Track:** Architecture · **Role:** the visual mental-model (companion to `architecture.md`) · **Status:** grounded in `src/runtime/` @ gen-6 — file:line anchors, kept current with the code

# The system, drawn — `act`, `Scope`, and the recursion

The canonical spine is [`architecture.md`](./architecture.md); this is its **picture book**. Every
diagram is grounded in the code with `file:line` anchors. If a diagram disagrees with the code, the
**code wins** — fix the diagram in the same change.

---

## 1. The atom — `act` over a `Scope`

The whole system is **one type** (`src/runtime/supervise/types.ts:48`):

```ts
interface Agent<Task, Out> {
  readonly name: string
  act(task: Task, scope: Scope<Out>): Promise<Out>
}
```

A **leaf** is an `act` that returns without touching `scope`. A **driver** is an `act` that spawns
children and reacts to them. Same type — the role is behavior, not a class.

The `Scope` it runs inside is **5 verbs** (`types.ts:270`) — a budget-conserving reactive nursery:

```
  scope ─────────────────────────────────────────────────────────────────────────────────────
   │
   ├─ spawn(agent, task, {budget,label}) → {ok,handle} | {ok:false, 'budget-exhausted'|'depth-exceeded'}
   │     reserves budget ATOMICALLY from a conserved pool, fail-closed   ⟸ THE equal-compute invariant
   │
   ├─ next() → Promise<Settled | null>            the WAKE cursor: resolves as each child settles, in seq order
   │     Settled = {done: out, verdict, spent} | {down: reason, infra}      (types.ts:242)
   │
   ├─ send(nodeId, msg) → bool                     STEER a running child (next-instruction / interrupt)
   │     in-process = direct call · across a sandbox = the SAME verb as an MCP tool
   │
   ├─ view  → TreeView                             the live tree (in-memory, O(live)) — what the topology viewer renders
   └─ budget → {tokensLeft, usdLeft, deadlineMs, reservedTokens}
```

Two facts make this the whole game:
- `spawn` **reserves** from a shared pool and refunds the unspent remainder on settle, so
  `Σk(treatment) ≡ Σk(blind)` by construction — no arm can buy more compute (`supervise/budget.ts`).
- `next()` is the *only* way to observe a child, so a driver reacts to **settlements**, never reaches
  inside a child.

Three more edges are **designed, not built** — the question/command hierarchy (`ask` up, `notify` up,
`override` down) that lets a deep agent surface a question and a higher agent countermand a decision.
See **§8** below.

---

## 2. The recursion — drivers of drivers, same atom all the way down

A spawned child is an `Agent`. If its `act` calls `scope.spawn`, it's a driver too, with its **own
sub-scope** (depth+1, bounded by `maxDepth` + the *same* pool). Recursion isn't a feature — it's the
absence of a base case (`supervise/supervisor.ts`, `supervise/scope.ts`).

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

The leaf at the bottom is where a real coding harness runs (`sandboxExecutor` composes `runLoop` as
one leaf). Everything above it is the same `act`/`Scope` atom. The whole tree is observable as one
lifecycle stream (`scope.spawn`/settle → `agent.spawn`/`agent.child`), rendered by
[`src/topology/`](../src/topology/tree.ts).

---

## 3. The within-run self-improvement loop

The live RSI mechanism is the **agent-driver**: a parent `AgentProfile` driving its children via
`createCoordinationTools` (`src/mcp/tools/coordination.ts`) over the `Scope`/`Supervisor`
(`src/runtime/supervise/`) — the kernel-side `driver.ts` planner that used to carry this was
**deleted** (commit `2101f2d`). Each round: **diagnose → decide → act → settle**, with one firewall
that keeps it honest.

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
        │        (coordination.ts:124 / personify/analyst.ts:46)                     │  FIREWALL
        │                                                                            │
        │   ③ next move from {trace, findings} via the MCP:                          │  move = f(trace, findings)
        │        steer_worker (1 child)   spawn_worker (N)   select   stop            │  NOT f(score)
        │                                                                            │
        └───────────────┬─────────────────────────────────────────────────────────────┘
                        ▼
        Scope: spawn child agent(s) → run → settle → verdict on the artifact
                        │
                        └──▶ await_next → terminal? → winner = argmax(valid score)
```

The firewall is the load-bearing line: the **analyst reads the trace and may not cite the score**, so
the thing that *steers* (diagnosis) is independent of the thing that *selects* (verdict). Selector ≠
judge, enforced in code.

---

## 4. The evolution of a prompt — the whole thesis in one picture

A prompt is not static input; it's a value that **mutates through the graph** within a run and
**across runs**.

```
        ┌────────────────────── CROSS-RUN FLYWHEEL (slow loop · bench/) ───────────────────────┐
        │   failures corpus ──GEPA-over-failures──▶ learned directive δ ──▶ prepended next run   │
        │   (#145 GEPA-from-failures · #147 DIVERSE_BASE composes δ)                              │
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
   round 1    planner(τ₀, findings) ─▶ move ─▶ prompt transforms:
                  refine   →  τ₁ = steer(τ₀, "fix X — per finding")            prompt MUTATES   (send / re-spawn)
                  fanout   →  [τ₁ᵃ, τ₁ᵇ, τ₁ᶜ]  diverse re-framings             prompt BRANCHES
                  complete →  stop                                            prompt SATISFIED  (deployable)
                                                   │
   …                                               ▼
   round n                          select(argmax valid score) ─▶ winner τ*
                                                   │
                                                   └────────────▶ feeds the failures corpus ──▶ δ′ (next run smarter)
```

---

## 5. The two timescales — one shape, two loops

```
   FAST  (within a run)          τ₀ → diagnose → τ₁ → … → τ*           ← the driver round (§3)
                                  status: domain-bounded — see `.evolve/current.json` for the live ledger.

   SLOW  (across runs)            τ always enters as  δ ⊕ τ            ← the learning flywheel
                                  δ = directive GEPA-distilled from past failures.
                                  status: UNTESTED at the gate (diverse@k vs blind@k at equal compute).
```

The binding empirical question: **does any non-blind topology beat blind compute at EQUAL k, under
a deployable non-oracle selector, on a domain with a correctable middle band?** The live answer —
which domains cleared it, which coordinates measured flat — lives in `.evolve/current.json` and the
memory ledger; this doc stays evidence-free by design.

---

## 6. Analysts are just Agents → ensembles come for free

An analyst is **not a new type** — it is `Agent<unknown, AnalystFinding[]>` the driver spawns over a
child's trace (`src/runtime/personify/analyst.ts:15`; `createScopeAnalyst` at `:97`; the firewall is
applied by `createScopeAnalyst`, not the analyst itself). The lens menu
(`src/mcp/tools/checks.ts:93` — `defaultChecks`: failure-mode, correctness, safety, cost, tool-use)
is data, not code; the driver picks lenses via `list_analysts`/`run_analyst`.

Because an analyst is an Agent, the richer ideas are **already expressible with the existing atom —
no new primitive**:

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

- A **sandbox-audit analyst** = that Agent with `harness: sandbox`; its `act` body authors and runs
  the comprehensive audit. No subsystem — a profile + the existing spawn.
- An **ensemble** = fanout of analyst-Agents; **"competing"** = folding/scoring their findings by the
  lift they produce. Ensembles-of-ensembles = a driver-analyst that itself spawns sub-analysts.

**When to build it (discipline):** the *concept* is free (it falls out of the atom), so it is not
overkill. But standing up the 50–100-question machinery speculatively **is** mechanism-ahead-of-gate.
The cheap, decisive version is the gate-relevant one: a maximally comprehensive analyst is the
**strongest possible test of "can *any* diagnosis help"** — if even it can't beat blind at equal
compute, the within-run-steer family is dead for real; if it can, that's the signal. Build it as the
gate experiment, not as a standing feature.

---

## 7. The minimal-core delta — the collapse, and what's load-bearing

There were **three encodings of "pick the next move."** Two are now deleted — the `Program` op-set (#168) and the `Driver`/`TopologyMove` planner (commit `2101f2d`):

| Encoding | Where | Status |
|---|---|---|
| `Agent.act(task, scope)` | `supervise/` | **the keystone atom** — the tree's move language |
| `Driver.plan/decide` + `TopologyPlanner`/`TopologyMove` | ~~`driver.ts`~~ | **DELETED** (`src/runtime/driver.ts` nuked, commit `2101f2d`) — the `runLoop` kernel (`run-loop.ts`) survives as a *leaf backend*; the analyst→steer wire moved onto the agent-driver (`createCoordinationTools` over the `Scope`/`Supervisor`) |
| `Program` op-set + `runProgram`/`runAgent` | ~~`program.ts`~~ | **DELETED (#168)** — consumed only by its own tests; the diverse@k gate runs on `fanout` (`keystone-gate.ts`), never `runProgram`, so it was a redundant third encoding, not the gate mechanism |

The op-set's *ideas* survive, mapped onto the atom: `fanout` = N × `scope.spawn`, `refine`/`steer` =
`scope.send`, `parallel sub-loops` = spawn N driver-Agents, `select` = `defaultSelectWinner`, `stop` =
`act` returns. The "pick the next move" decision now lives on **one keystone** — `Agent.act` in a
`Scope` (`supervise/`), with the `runLoop` kernel (`run-loop.ts`) surviving as a leaf execution
backend underneath it — with no redundant planner encoding.

---

## 8. The command hierarchy — `ask` / `notify` / `override` (DESIGNED)

> **Status: designed, not built.** Implementation is gated on the verifier-grounded gate result + the
> PI/chat repo defining the human-handler contract. This section nails the *interface* so both repos
> build to the same seam.

The escalation model is **not** agent-to-agent messaging (don't reach for A2A / a bus) — it's a
**resumable effect with handlers** (à la LangGraph `interrupt()` / algebraic-effect handlers / OTP
supervisor-escalation). A leaf *raises* a question; each parent is a *handler* that either **discharges**
it (answers from its own tools/knowledge/directive) or **re-raises** it one level up; the human (the PI
agent) is the **top handler**. It turns the tree from "escalate-on-stuck" into a real **command
hierarchy: local autonomy + global override.**

Three edges complete the atom — two already exist:

| Edge | Direction | Blocking? | Notes |
|---|---|---|---|
| `ask(question)` | **up** | yes | child can't proceed without the answer; **terminates** at the first handler who answers. The one genuinely-new edge (or a 3rd `Settled` kind `{question}` — see below). |
| `notify(decision)` | **up** | **no** | every steering decision is teed upward, **salience-filtered**, so an ancestor with higher-order knowledge can countermand it. **This is the lifecycle hook stream** (`agent.decision`/`agent.answer`) — already shipped. |
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

**The non-negotiable: optimistic + asynchronous, never synchronous approval.** If D1 had to *wait* for
the root's blessing (and the root for its parent), every local decision serializes through the root and
drowns the top. So D1 answers W now, tees the decision up, and an ancestor's override is a **later,
higher-authority `send` that supersedes** — a compensating correction, not a pre-approval gate. (W is
re-steerable mid-flight; that's what `send` is for.)

**Command is one level deep.** The root overrides **D1** (its direct report); **D1** reconciles and
re-steers **W**. No skip-level reach-around → no two agents steering the same child → the hierarchy
stays coherent + auditable, and D1 can reconcile the override against state the root can't see.
Corrections **compose down** the chain exactly as questions **compose up** it — and escalation falls out
of the recursion (a driver `ask`s on *its* scope), so there is no "driver-of-driver" special case.

**Block vs. settle-and-resume** (the real engineering fork, because human latency is minutes–hours):
- live-block (`await scope.ask`): child stays alive, blocked — fine for in-process/cheap leaves.
- settle-as-question + resume: child returns `{kind:'question'}` (frees its sandbox box), the parent
  handles it, the answer **resumes the child from its checkpoint** — reuses the shipped
  `sandbox-lineage` session-continuity. The `Executor` picks the mode, the same way it abstracts run
  modes — which is why this is a small feature, not a subsystem.

**What's new vs. already there:** new = the `ask` edge (+ a `question` settlement kind), a **salience tag**
on decisions (so the top doesn't drown), and **path-routed `send`** (so an override reaches a deep
node — node ids are already the path). Reused = `send` (answer/override), the hook stream (notify), the
lineage (resume), the recursion (escalation), the MCP-steer pattern (the cross-sandbox wire — **MCP
elicitation** is the standard for it), and the topology viewer (a node "awaiting answer" is just a
visible state). The **answer-or-escalate policy lives in the agent's `act`/directive, not the kernel.**

**Two disciplines:**
1. **Budget pauses while awaiting a human** — a blocked node isn't computing; treat "awaiting answer"
   like `budgetExempt` so it doesn't burn its deadline/`maxTokens` against the conserved pool.
2. **A human answer is an oracle injection** — so this channel is **off / held-constant in gated
   experiments** (it would confound equal-k and the no-oracle selector rule). It is a *production*
   feature, not a gate-eval one.
