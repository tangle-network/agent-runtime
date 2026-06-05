# The driver — one surface, decided 2026-06-05

> Companion to [architecture.md](./architecture.md). Supersedes the `create*Driver` factory zoo and the
> `TopologyMove` DSL. Where this and older driver docs differ, this wins.

## The decision (plain)

**A driver is `harness + profile + MCP`, not code.** The driver is an agent — `f(trace, worker
outputs, budget) → thoughts + actions` — and the thing that runs `f` is a **coding harness in a
sandbox** (claude-code / codex / opencode), which already owns the loop, tool-calling, sub-agent
spawning, and native idioms (*parallelize*, *ultrathink*, *use a dynamic workflow*). We do **not**
write the driver's loop or a move-DSL. We write three things only:

1. **The steering MCP** (`src/mcp/tools/operator-toolbox.ts`): the verbs the driver uses to lead the
   workers it drives — `spawn_worker · await_next · observe_worker · steer_worker · run_analyst ·
   stop` (+ `check_done` to close the deployable-satisfiability gap). This is the one piece the
   harness does NOT have natively: cross-sandbox observation + steering of *other* agents (the Agent
   Bus). The driver **steers in natural language** using the worker harness's native capabilities —
   the verbs carry the instruction; they do not encode a topology.
2. **Profiles** (markdown/config): *what* the driver is (the lead-steerer persona — "Drew" is one).
   The profile is the **only** customizable thing.
3. **The orchestrator** (`src/loops/supervise/` — Supervisor + Scope): launches worker sandboxes
   (`spawn_worker` → `scope.spawn` → a sandbox `LeafExecutor`), routes the MCP to live workers, and
   owns the conserved budget pool (equal-compute by construction). A worker profile can itself be a
   driver → drivers-of-drivers for free.

There is **no `createDriver` function in the product.** A driver is launched, not constructed:
`launchDriverSandbox(profile)` = a harness in a box with the MCP mounted, pointed at the orchestrator.

## Product vs experiment (the thing that was conflated)

- **Product:** profile + steering MCP + a sandbox-harness driver + worker sandboxes. The harness owns
  the loop; we own the MCP, the profiles, the orchestrator.
- **Experiment:** equal-compute / corpus / the gate (Gate A) — real *measurement* infra, kept
  **separate** from the product path. A thin in-process decider-loop is allowed here for cheap
  code-rule experiments, but it is experiment code, never the product.

The in-process LLM tool-loop (`createOperatorDriverAgent`) was a **measurement shim** to get a number
without standing up the sandbox deployment; it calcified into a fake product with a factory zoo around
it. That is the slop this doc removes.

## The one seam (so code-rules, in-process LLM, and a sandbox harness all unify)

```
type Decider<Out>  = (s: Situation<Out>) => Action | Promise<Action>
//   Situation = { task, turn, workers: SettledWorker[], findings?, budgetRemaining }
//   Action    = spawn | await | observe | steer | analyze | check_done | stop   (the MCP verbs)
```

The driver loop asks a **decider** "what next?" and dispatches the `Action` to the MCP. The decider is
the only variable, across the whole dumb→smart dial:

- **dumb end (code rule, ~3 lines):** `blind` = spawn 1, stop. `refine` = continue the same artifact
  until the verifier passes. `fanout` = spawn N, pick best. `widen` = on a promising settle, spawn one
  more. These are **deciders, not factories** — `blind/refine/fanout/widen` collapse into one
  registry of functions.
- **smart end (the product):** a **sandbox coding harness** — it *is* the decider, looping natively
  and calling the MCP verbs, steering in native language. The profile is its config.

The operator loop is blind to which decider it got — that invisibility is the unification, and it kills
both the `create*Driver` zoo and the parallel `TopologyMove` DSL.

## What gets deleted (slop) vs kept

| delete (driver-as-code) | keep |
| --- | --- |
| `mcp/tools/operator-driver.ts` (the in-process loop) → a thin experiment shim over the seam | `mcp/tools/operator-toolbox.ts` (the steering MCP — the product) |
| `loops/drivers/{refine,fanout-vote}.ts` (factory types) → deciders | `loops/drivers/dynamic.ts` (KEPT — `runLoop`-as-leaf, the kernel bottom under the orchestrator) |
| `loops/drivers/planners.ts` (preset registry) → a decider registry | `loops/supervise/*` (orchestrator: Supervisor/Scope/budget pool) |
| `loops/drivers/{llm-meta,progressive-widening}.ts` (dead pair — **deleted**) | `mcp/tools/analyst-kinds.ts` (the trace lenses `run_analyst` uses) |
| the `TopologyMove` DSL as the steering language | equal-compute / corpus / gate (experiment infra, separated) |

`runLoop` / `createDynamicDriver` are **folded UNDER** the orchestrator as the kernel-leaf executor
(they keep the per-round cost accounting + concurrency batching the agent loop can't host) — not folded
away. A full substrate merge of `runLoop` into the Supervisor is **rejected** for that reason.

## Build order (phased, test-gated)

1. **Decider seam + thin loop** (verifiable, no sandbox): extract `llmDecider(profile)`; one loop over
   the MCP verbs; `createOperatorDriverAgent` becomes a shim. Delete the dead bench pair. *(dead pair
   done.)*
2. **Dumb deciders + registry**: `blind/refine/fanout/widen` as decider functions; collapse
   `planners.ts`; add `check_done`. Migrate the 5 example/profile call sites.
3. **TopologyMove ↔ Action bridge**: route `createDynamicDriver` through the seam as the kernel-leaf.
4. **Retire the factory types**: delete `refine.ts` / `fanout-vote.ts`; drop their exports.
5. **The real deployment (product):** serve the operator toolbox over MCP bridged to a live `Scope`;
   a sandbox-harness driver leaf (a `LeafExecutor` running a harness with the MCP mounted); workers are
   sandbox harnesses; the driver steers in native language. The experiment then runs through the
   product, not the in-process shim. *(needs sandbox infra to verify end-to-end.)*

The first four phases are in-process and unit-verifiable; phase 5 is the deployment.
