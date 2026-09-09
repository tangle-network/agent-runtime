# Execution model — the unified picture

> **In plain terms:** This doc explains how the package actually runs an agent's work — the difference between a "driver" (the agent that decides what to do next and hands out subtasks) and a "worker" (the agent that carries out one subtask), which tools each one gets, and the steps that start a new worker. It's for developers reading or building on the package who want the mental model before they open the source. The one thing to remember: everything that runs work — a plain API call, a command-line coding agent, a full sandbox, or your own custom agent — plugs into the same small interface, so you learn one shape and it covers every case.

**Track:** architecture · **Role:** the picture (how execution works). How work runs, what a driver vs a worker does, who gets which tools, and how a worker is spawned. Grounded to `file:line`; on conflict the code wins (fix this the same turn). Companion to [glossary.md](./glossary.md) (the terms) and [architecture.md](./architecture.md) (the overall design).

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
   │ chat     │ bridge   │ codex    │ runAgentRounds in │         │  your own HTTP)  │
   │ no box   │ HTTP     │ opencode │  a leaf    │         │ implements the   │
   └────┬─────┴────┬─────┴────┬─────┴─────┬──────┘         │ port directly    │
        └──────────┴──────────┴───────────┴──── all are Executors ──┴─────────┘
                              │                       (supervise/runtime.ts)
   ┌──────────────────────────┴──────────────────────────┐
   │                                                      │
 inlineSandboxClient(exec)                       (the sandbox executor already IS
 wraps a NON-box executor as a SandboxClient      a SandboxClient: real box, sessions,
 so runAgentRounds can drive it (inline-sandbox-client)  fs artifacts, fork/CRIU)
   │                                                      │
   ▼                                                      ▼
┌─────────────────────────────┐            ┌─────────────────────────────────┐
│ ENGINE A: runAgentRounds           │            │ ENGINE B: Scope / Supervisor    │
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
                    │   spawn_worker · await_event · steer_agent │ │ (driver.ts:52)
                    └───────────────┬────────────────────────────┘ │
       spawn_worker(profile,task) ──┤  reserves budget (fails       │
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
  driver calls  spawn_worker(profile, task, budget)        (mcp/tools/coordination.ts)
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

## Isolated checks of untrusted run trees

Use `runIsolatedCheck` from `@tangle-network/agent-runtime/kernel` to execute checks supplied by an untrusted run tree.
The checker requires Linux, `/usr/bin/bwrap`, and permission to create user, mount, network, and process namespaces.
Unsupported hosts return a refusal; the checker never executes the command directly on the host.

Provide the trusted workspace root, the tree path, and an executable with its argument array.
The checker copies the tree without following symbolic links and mounts that writable copy at the tree's canonical host path.
Writes disappear after execution.
The namespace exposes trusted system toolchains, private process and device filesystems, and temporary storage.
Workspace parents contain no host files; sibling trees and external symbolic-link targets remain inaccessible.
The checker rejects toolchain mounts that overlap the workspace or tree, including canonical paths through symbolic links.
Keep the input tree and system toolchains stable during preparation; this API does not synchronize concurrent host writers.

The command receives only an explicit executable search path, home directory, and locale.
Timeouts, cancellation, and output overflow kill the Bubblewrap process group; namespace teardown also terminates descendants.
Command time and captured output have limits.
Copy preparation, disk consumption, and memory consumption do not have quotas.
Use a separately resource-limited host when those resources require protection.

Run `bash scripts/verify-isolated-checker-linux.sh` for the real Linux boundary tests.
The script copies source into disposable Docker containers and never mounts the host workspace.
It tests successful isolation with namespace privileges and refusal without those privileges.
