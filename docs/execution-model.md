# Execution model — the unified picture

**Track:** architecture · **Role:** the picture (execution substrate). How work runs, what a driver vs a worker does, who gets which tools, and how a worker is spawned. Grounded to `file:line`; on conflict the code wins (fix this the same turn). Companion to [glossary.md](./glossary.md) (the terms) and [architecture.md](./architecture.md) (the spine).

## 1. The unified thing — one port, four backends, two engines

Before, each bench hand-rolled its own pseudo-box client. Now there is **one execution port** (`Executor`), **one built-in** (`createExecutor`, backend chosen by *data*), and **one adapter** (`inlineSandboxClient`) to feed the round-synchronous engine. Two engines, one substrate.

```
              WHAT RUNS THE WORK = the Executor port (open, BYO-first)
              ──────────────────────────────────────────────────────────
              execute() · deliver?() · teardown() · resultArtifact()
              every executor normalizes usage → the conserved budget pool
                              (supervise/types.ts:69)

   createExecutor({ backend })  ── the ONE built-in: backend = DATA, not an import
   ┌──────────┬──────────┬──────────┬────────────┐         ┌──────────────────┐
   │ 'router' │ 'bridge' │  'cli'   │ 'sandbox'  │         │  BYO  Executor   │
   │ HTTP     │ cli-     │ claude-p │ a real box │         │ (mastra / agno / │
   │ chat     │ bridge   │ codex    │ runLoop in │         │  your own HTTP)  │
   │ no box   │ HTTP     │ opencode │  a leaf    │         │ implements the   │
   └────┬─────┴────┬─────┴────┬─────┴─────┬──────┘         │ port directly    │
        └──────────┴──────────┴───────────┴──── all are Executors ──┴─────────┘
                              │                       (supervise/runtime.ts)
   ┌──────────────────────────┴──────────────────────────┐
   │                                                      │
 inlineSandboxClient(exec)                       (the sandbox executor already IS
 wraps a NON-box executor as a SandboxClient      a SandboxClient: real box, sessions,
 so runLoop can drive it (inline-sandbox-client)  fs artifacts, fork/CRIU)
   │                                                      │
   ▼                                                      ▼
┌─────────────────────────────┐            ┌─────────────────────────────────┐
│ ENGINE A: runLoop           │            │ ENGINE B: Scope / Supervisor    │
│ round-synchronous           │            │ reactive keystone (canonical)   │
│ driver.plan → decide        │            │ Agent.act spawns into a Scope   │
│ (most benches drive this)   │            │ conserved budget ⇒ equal-k      │
│ run-loop.ts                 │            │ supervise/{scope,supervisor}.ts │
└─────────────────────────────┘            └─────────────────────────────────┘
                └────────── same Executor port underneath ──────────┘
```

## 2. Driver vs worker — judgment vs labor

```
                    ┌───────────────────────────────────────────┐
                    │  DRIVER  (the lead / "operator")           │
                    │  an Agent.act running in a Scope           │
                    │                                            │
                    │  each round it decides the TOPOLOGY MOVE ─────┐ this IS
                    │   refine │ fanout │ select │ stop          │ │ "topology grown
                    │  then drives workers via the toolbox:      │ │  by LLM decision"
                    │   spawn_agent · await_event · steer_agent │ │ (driver.ts:52)
                    └───────────────┬────────────────────────────┘ │
       spawn_agent(profile,task) ──┤  reserves budget (fails       │
       steer_agent(id,msg) ────────┤  CLOSED if the pool is dry)   │
       await_event ──────────────────┘                               │
                    ┌───────────────┼───────────────┐               │
                    ▼               ▼                ▼               │
             ┌───────────┐   ┌───────────┐   ┌───────────┐          │
             │ WORKER 1  │   │ WORKER 2  │   │ ANALYST   │ ◄────────┘ (a worker
             │ does the  │   │ (fanout)  │   │ reads the │            variant)
             │ TASK over │   │ does the  │   │ worker's  │
             │ the shared│   │ task too  │   │ TRACE →   │
             │ ARTIFACT  │   │           │   │ a steer   │
             └───────────┘   └───────────┘   └───────────┘
   Driver  = judgment: what runs next, who to spawn, when to stop, who wins.
   Worker  = labor: bring the shared artifact to its required final state.
   Analyst = a worker variant that reads ONLY the trace → a correction
             (never the judge's verdict — the selector≠judge firewall).
```

## 3. Who gets which tools / MCPs

```
  ROLE      │ in-box TOOLS                    │ operator MCP toolbox  │ can it spawn?
  ──────────┼─────────────────────────────────┼───────────────────────┼──────────────
  DRIVER    │ artifact tools  +  OPERATOR     │ ✅ yes (Scope-as-MCP, │ YES — that is
  /operator │ toolbox (spawn/steer/await…)    │   when it runs in a   │ its whole job
            │                                 │   sandbox)            │
  ──────────┼─────────────────────────────────┼───────────────────────┼──────────────
  WORKER    │ artifact tools ONLY             │ ❌ none               │ NO — a leaf;
  /default  │ (bash/read/edit/… the surface   │                       │ it does the
            │  supplies)                      │                       │ task
  ──────────┼─────────────────────────────────┼───────────────────────┼──────────────
  ANALYST   │ read_trace ONLY                 │ ❌ none               │ NO (a driver
  /trace    │ (firewall: trace in, correction │                       │ may define_
            │  out, NEVER the verdict)        │                       │ analyst kinds)
```

**The rule in one line:** the driver carries the coordination MCP because spawning/steering *is* its job; the worker gets only the artifact's tools because its job is to do the task, not manage others; the analyst is locked to `read_trace` so the selector cannot peek at the judge. (`bench/src/profiles.ts`: `driver/operator`, `worker/default`, `analyst/trace`.)

## 4. How a worker is spawned (the mechanics)

```
  driver calls  spawn_agent(profile, task, budget)        (mcp/tools/coordination.ts)
        │
        ▼
  scope.spawn(spec, budget)                                (supervise/scope.ts:130)
        │
        ├─ 1. pool.reserve(budget)  ──►  FAILS CLOSED if the pool is dry      ┐ equal-k
        │      (atomic; total ≡ free + reserved + committed)                  │ by
        │                                                                     │ construction
        ├─ 2. registry.resolve(spec)   precedence:                            │ — the anti-
        │        BYO spec.executor → harness===null (router) →                │ confound
        │        registered 'sandbox' factory                                 │ invariant
        │                                   │                                 ┘
        │                                   ▼
        │                            createExecutor picks the backend body
        │                            (router / bridge / cli / sandbox)
        │                                   │
        ├─ 3. runChild(executor)  ──►  execute(task) … meters UsageEvents
        │                                   │
        └─ 4. settle  ──►  pool.reconcile(ticket, actualSpend)
                                            │
                                            ▼
                              await_event wakes the driver with this child's result
```

**Net:** the "unified thing" is the `Executor` port. Everything that runs work — a router call, a cli-bridge turn, a `claude -p` subprocess, a full sandbox rollout, or a BYO agent — is an `Executor`, chosen by data via `createExecutor`, metered by one budget pool. Drivers and workers are both `act`s over that port; the only structural difference is the driver carries the operator toolbox (so it can spawn/steer) and the worker does not.
