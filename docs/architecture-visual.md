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

The live RSI mechanism (`src/runtime/dynamic.ts` + `src/analyst-loop/`). Each round: **diagnose →
decide → act → settle**, with one firewall that keeps it honest.

```
        ┌──────────────────────────────────────────────────────────────────────────┐
        │                            one driver round                               │
        │                                                                            │
   plan(task, history):                                                              │
        │                                                                            │
        │   ① complete?(trace) → CompletionVerdict {done, determinism}               │  the DEPLOYABLE
        │        deterministic = trust ground truth                                  │  non-oracle STOP
        │        probabilistic = clears confidence policy → stop BEFORE planning     │  (dynamic.ts:118)
        │                                                                            │
        │   ② analyze(trace) → AnalystFinding[]            ◀── reads the TRACE       │
        │        assertTraceDerivedFindings(findings)          NOT the score         │  selector ≠ judge
        │        (dynamic.ts:311,344)                     ════════════════════       │  FIREWALL
        │                                                                            │
        │   ③ planner(ctx{task, history, analyses}) → move:                          │  move = f(trace, findings)
        │        refine (1 task)   fanout (N tasks)   select (i)   stop               │  NOT f(score)
        │                                                                            │
        └───────────────┬─────────────────────────────────────────────────────────────┘
                        ▼
        kernel: spawn batch → stream → output.parse → validator.validate → verdict
                        │
                        └──▶ decide(history) → terminal? → winner = argmax(valid score)
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
                                  status: measured to LOSE at equal compute (rung-0, FinSearchComp).

   SLOW  (across runs)            τ always enters as  δ ⊕ τ            ← the learning flywheel
                                  δ = directive GEPA-distilled from past failures.
                                  status: UNTESTED at the gate (diverse@k vs blind@k at equal compute).
```

The binding empirical question (`.evolve/current.json`, gen 6): **does any non-blind topology beat
blind compute at EQUAL k, under a deployable non-oracle selector, on a domain with a correctable
middle band?** Within-run steer is falsified (rung-0); parallel-diverse strategies are the open test.

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

## 7. The minimal-core delta — what's still redundant

There are **three encodings of "pick the next move"** still co-existing — the sprawl to collapse:

| Encoding | Where | Status |
|---|---|---|
| `Agent.act(task, scope)` | `supervise/` | **the keystone atom** — the move language to keep |
| `Driver.plan/decide` + `TopologyPlanner`/`TopologyMove` | `run-loop.ts`, `dynamic.ts` | load-bearing for the `runLoop` path (carries the analyst wire); the runLoop-era move language |
| `Program` op-set + `runProgram`/`runAgent` | `program.ts` | **consumed only by its own tests** — but `bench/` ties its `parallel` to the open diverse@k gate |

The smallest best-in-class core is reached when **`act`-over-`Scope` is the only move language**:
`fanout` = N × `scope.spawn`, `refine` = `scope.send`, `stop` = return, `parallel sub-loops` = spawn N
sub-driver Agents. The op-set's *ideas* (a clean composable move DSL; loop-layer parallelism) map onto
Scope verbs and are preserved here even as the encoding is deleted.

**Open question gating the cut:** is `runProgram`'s `parallel` the production home for diverse@k, or is
it redundant with `scope.spawn`? Resolve by audit before deleting — do not remove the mechanism the
unrun gate may need. The collapse lands on that answer, not ahead of it.
