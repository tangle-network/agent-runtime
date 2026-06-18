# supervisor-loop — one agent drives N worker agents to completion

The "an LLM agent spawns and drives N workers" path, made runnable. A SUPERVISOR agent
(the real `coordinationDriverAgent` brain) reasons a loop over the coordination verbs —
`spawn_worker` → `await_event` → `observe_worker` / `steer_worker` → `stop` — against a live
`Scope`, on **one conserved budget pool**. Each worker is a leaf from
`createExecutor({ backend })`; the supervisor settles on the best **delivered** worker (a
real check passed, never the model's say-so).

The same supervisor code runs over three worker backends. The only thing that changes between
runners is **two seams**: the worker-leaf `backend` and the driver-LLM `chat`. That is the
whole point — `sandbox` (a box) and `bridge` (local cli-bridge) run the **identical**
supervisor with zero code change; only the worker-leaf seam differs.

## Files

- **`loop.ts`** — the shared, commented loop. `runSupervisorLoop({ task, backend, chat, ... })`
  builds the `coordinationDriverAgent`, resolves each spawned worker to
  `createExecutor({ backend })` gated on the deployable check, and runs it under
  `createSupervisor()`. The `backend` field is the swap seam; the `chat` field is the
  driver-LLM seam (`routerDriverChat` for a real brain, `scriptedSupervisorChat` offline).
  Also exports the shared `demoTask` + `scriptedSupervisorChat` the runners reuse.
- **`run-router.ts`** — backend `router-tools` + `routerDriverChat`. Real inference both ends, off-box.
- **`run-sandbox.ts`** — backend `sandbox`. Each worker is a coding harness in a real box.
- **`run-bridge.ts`** — backend `bridge`. Each worker is a real harness CLI (claude-code / codex / opencode / kimi / gemini) fronted by the OpenAI-compatible bridge in `~/code/cli-bridge`. **The local path.**

## Run matrix

From the agent-runtime repo root. `pnpm build` once first so `@tangle-network/agent-runtime`
resolves from `dist/`.

| Backend | Command | Needs |
|---|---|---|
| **`router-tools`** | `TANGLE_API_KEY=sk-... pnpm tsx examples/supervisor-loop/run-router.ts` | `TANGLE_API_KEY`; optional `ROUTER_BASE_URL` (default `https://router.tangle.tools/v1`), `LOOP_MODEL` |
| **`sandbox`** | `TANGLE_API_KEY=sk-... SANDBOX_BASE_URL=https://... pnpm tsx examples/supervisor-loop/run-sandbox.ts` | a real `SandboxClient` (key + base URL); optional `LOOP_HARNESS` (default `opencode`); driver defaults to router-brain, `DRIVER=scripted` for no driver inference |
| **`bridge`** (local) | `WORKER_MODEL=opencode/anthropic/claude-sonnet-4-5 pnpm tsx examples/supervisor-loop/run-bridge.ts` | a running `~/code/cli-bridge` (base `http://127.0.0.1:3344`, no `/v1`, bearer optional/default `local`); `WORKER_MODEL` = `<harness>/<model>`. Override `BRIDGE_URL` / `BRIDGE_BEARER` if you started it with auth. Set `TANGLE_API_KEY` for a real driver brain (else scripted) |

## Test locally — the cli-bridge backend

`~/code/cli-bridge` is the local path: it fronts real harness CLIs behind one
OpenAI-compatible HTTP surface, so the `bridge` backend runs real local agents with no cloud
box. Start it, then point a worker at it:

```bash
cd ~/code/cli-bridge && pnpm install && pnpm install:harness -- opencode && pnpm start
# → http://127.0.0.1:3344

WORKER_MODEL=opencode/anthropic/claude-sonnet-4-5 pnpm tsx examples/supervisor-loop/run-bridge.ts
```

The workflow is: **prove the supervisor topology against local harness CLIs (`bridge`), then
point it at a real box (`sandbox`) with zero code change** — only the worker-leaf seam
differs. For a fully offline, no-creds **wiring** check (no harness needed), the
coordination-driver unit tests cover the spawn → await → checked-settle loop:

```bash
pnpm test tests/loops/coordination-driver.test.ts
```

## Offline driver vs real driver

`coordinationDriverAgent` drives through an injected `DriverChat` (one driver-LLM turn).
`run-router.ts` injects **`routerDriverChat(cfg)`** so the supervisor's turns are real router
tool-calls and the brain decides the loop itself. `run-sandbox.ts`/`run-bridge.ts` default to
a **scripted** `DriverChat` (`scriptedSupervisorChat`, a fixed `spawn → await → stop` plan) so
the box/bridge wiring is the only moving part — the same offline seam the driver's own unit
tests use — and opt into `routerDriverChat` when a key is present. Same brain, different seam.

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
