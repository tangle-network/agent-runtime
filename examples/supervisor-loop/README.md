# supervisor-loop — one agent drives N worker agents to completion

The "an LLM agent spawns and drives N workers" path, made runnable. A SUPERVISOR agent
(the real `coordinationDriverAgent` brain) reasons a loop over the coordination verbs —
`spawn_worker` → `await_event` → `observe_worker` / `steer_worker` → `stop` — against a live
`Scope`, on **one conserved budget pool**. Each worker is a leaf from
`createExecutor({ backend })`; the supervisor settles on the best **delivered** worker (a
real check passed, never the model's say-so).

The same supervisor code runs over four worker backends. The only thing that changes between
runners is **two seams**: the worker-leaf `backend` and the driver-LLM `chat`. That is the
whole point — prove the topology locally at $0, then point it at real infra with zero edits.

## Files

- **`loop.ts`** — the shared, commented loop. `runSupervisorLoop({ task, backend, chat, ... })`
  builds the `coordinationDriverAgent`, resolves each spawned worker to
  `createExecutor({ backend })` gated on the deployable check, and runs it under
  `createSupervisor()`. The `backend` field is the swap seam; the `chat` field is the
  driver-LLM seam (scripted offline, `routerDriverChat` in production).
- **`run-local.ts`** — backend `cli`, scripted driver. **$0, no creds, no infra.** The headline.
- **`run-router.ts`** — backend `router-tools` + `routerDriverChat`. Real inference both ends, off-box.
- **`run-sandbox.ts`** — backend `sandbox`. Each worker is a coding harness in a real box.
- **`run-bridge.ts`** — backend `bridge`. Each worker is a real harness CLI (claude-code / codex / opencode / kimi / gemini) fronted by the OpenAI-compatible bridge in `~/code/cli-bridge`.

## Run matrix

From the agent-runtime repo root. `pnpm build` once first so `@tangle-network/agent-runtime`
resolves from `dist/`.

| Backend | Command | Needs |
|---|---|---|
| **`cli`** (local) | `pnpm tsx examples/supervisor-loop/run-local.ts` | nothing — $0, no creds, no infra |
| **`router-tools`** | `TANGLE_API_KEY=sk-... pnpm tsx examples/supervisor-loop/run-router.ts` | `TANGLE_API_KEY`; optional `ROUTER_BASE_URL` (default `https://router.tangle.tools/v1`), `LOOP_MODEL` |
| **`sandbox`** | `TANGLE_API_KEY=sk-... SANDBOX_BASE_URL=https://... pnpm tsx examples/supervisor-loop/run-sandbox.ts` | a real `SandboxClient` (key + base URL); optional `LOOP_HARNESS` (default `opencode`) |
| **`bridge`** | `WORKER_MODEL=opencode/anthropic/claude-sonnet-4-5 pnpm tsx examples/supervisor-loop/run-bridge.ts` | a running `~/code/cli-bridge` (defaults to `http://127.0.0.1:3344`, no bearer); `WORKER_MODEL` = `<harness>/<model>`. Override `BRIDGE_URL` (base, no `/v1`) / `BRIDGE_BEARER` if you started it with auth |

## Test locally with zero code changes

`run-local.ts` is the no-creds path on purpose. It drives the **identical**
`coordinationDriverAgent` + `runSupervisorLoop` as the other three runners — only the worker
backend (`createExecutor`'s `backend` field) and the driver-LLM seam differ.

```bash
pnpm tsx examples/supervisor-loop/run-local.ts
```

So the workflow is: **prove the supervisor topology locally at $0, then point it at a real
backend.** `run-sandbox.ts` and `run-bridge.ts` both print this reminder if their creds are
absent — when you don't have a box or a bridge handy, run `run-local.ts` and you are
exercising the same spawn → await → checked-settle loop, just with a local subprocess worker.

## Offline driver vs real driver

`coordinationDriverAgent` drives through an injected `DriverChat` (one driver-LLM turn). The
local/sandbox/bridge runners inject a **scripted** `DriverChat` (a fixed `spawn → await →
stop` plan) so the brain runs with no inference — the same offline seam the driver's own unit
tests use. `run-router.ts` injects **`routerDriverChat(cfg)`** so the supervisor's turns are
real router tool-calls and the brain decides the loop itself. Same brain, different seam.

## One-call boilerplate: `createInMemoryRunContext`

A supervised run needs three stores threaded into `SupervisorOpts`: a spawn journal, a result
blob store, and an executor registry — and the blob store passed to `coordinationDriverAgent`
**must be the same instance** the run uses. `createInMemoryRunContext()` (exported from
`@tangle-network/agent-runtime` and `/loops`) bundles all three:

```ts
const run = createInMemoryRunContext()                 // { journal, blobs, executors }
const root = coordinationDriverAgent({ blobs: run.blobs, /* ... */ })
await createSupervisor().run(root, task, { budget, runId, ...run })
```

Pass `{ withDriver: true }` to wrap the registry with `withDriverExecutor` for the recursive
agents-drive-agents path (a `role: 'driver'` child runs in a nested scope on the same pool).
