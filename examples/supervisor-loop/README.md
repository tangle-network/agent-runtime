# supervisor-loop — one agent drives N worker agents to completion

The "an LLM agent spawns and drives N workers" path, made runnable. A SUPERVISOR agent
(the real `driverAgent` brain) reasons a loop over the coordination verbs —
`spawn_agent` → `await_event` → `observe_agent` / `steer_agent` → `stop` — against a live
`Scope`, on **one conserved budget pool**. Each worker is a leaf from
`createExecutor({ backend })`; the supervisor settles on the best **delivered** worker (a
real check passed, never the model's say-so).

The same supervisor code runs over the worker backends. Each runner calls the one-call
`supervise(profile, task, { backend, deliverable, brain | router })`; the only thing that
changes between them is **two seams**: the worker-leaf `backend` and the driver-LLM `brain`.
That is the whole point — `sandbox` (a box) and `bridge` (local cli-bridge) run the
**identical** supervisor with zero code change; only the worker-leaf seam differs.

The plain router-brain + router-tools-worker case (real inference both ends, off-box) is the
canonical one-call entry — see [`../supervise/`](../supervise/). The runners here add the
load-bearing per-backend seams on top of it.

## Files

- **`shared.ts`** — the demo fixtures the runners reuse: `demoGoal` + the deployable `demoCheck`
  (the completion oracle), and `scriptedSupervisorChat` (a fixed `spawn → await → stop` brain so
  the box/bridge wiring runs offline with no inference).
- **`run-sandbox.ts`** — `supervise()` with `backend: 'sandbox'`. Each worker is a coding harness in a real box.
- **`run-bridge.ts`** — `supervise()` with `backend: 'bridge'`. Each worker is a real harness CLI (claude-code / codex / opencode / kimi / gemini) fronted by the OpenAI-compatible bridge in `~/code/cli-bridge`. **The local path.**
- **`run-supervisor-mcp.ts`** — the real MCP path (below): a harness agent IS the supervisor and calls `spawn_agent` natively over the coordination MCP.

## Supervisor + coordinator MCP, workers on sandbox OR cli-bridge — swap `WORKER_BACKEND`, same code

`run-supervisor-mcp.ts` is the **real MCP path**: a coding-harness agent (opencode via the
cli-bridge) *is* the supervisor. Inside its `act(task, scope)` it stands up the coordination MCP
(`serveCoordinationMcp`) over the **live `Scope`** and hands the harness the URL; the harness then
calls the **real `spawn_agent` tool natively** through its own tool-loop — a box driving boxes, not
a scripted driver. Each spawned worker is a leaf built by `workerFromBackend(backend, deliverable)`,
gated on a **deployable check** (the worker's output must contain `ANSWER=42` — the completion
oracle reads the worker's real output, no LLM judge).

**The worker backend is the ONLY knob.** The worker executor is literally

```ts
createExecutor({ backend: process.env.WORKER_BACKEND ?? 'bridge', ...seam })
```

so flipping `WORKER_BACKEND=sandbox` routes the **same** supervisor + **same** coordination MCP +
**same** `spawn_agent` flow + **same** deployable check through a cloud box instead of the local
cli-bridge — with **zero other changes**. One example, one code path.

```bash
cd ~/code/cli-bridge && pnpm start          # → http://127.0.0.1:3344
pnpm build                                   # examples resolve the package from dist/

# cli-bridge workers (the proven local path):
WORKER_BACKEND=bridge WORKER_MODEL=opencode/zai-coding-plan/glm-5.1 \
  pnpm dlx tsx examples/supervisor-loop/run-supervisor-mcp.ts

# the SAME code, sandbox workers (needs a real SandboxClient — key + base URL):
WORKER_BACKEND=sandbox SANDBOX_BASE_URL=https://... TANGLE_API_KEY=sk-... \
  pnpm dlx tsx examples/supervisor-loop/run-supervisor-mcp.ts
```

This is distinct from the `run-bridge.ts` / `run-sandbox.ts` runners below, which drive a
**scripted/router `ToolLoopChat` brain** through `supervise()`. `run-supervisor-mcp.ts` has no
driver brain at all — the harness itself reasons the spawn → await → stop loop via the MCP.

## Run matrix

From the agent-runtime repo root. `pnpm build` once first so `@tangle-network/agent-runtime`
resolves from `dist/`.

| Backend | Command | Needs |
|---|---|---|
| **`router-tools`** | `TANGLE_API_KEY=sk-... pnpm tsx examples/supervise/supervise.ts` | `TANGLE_API_KEY`; optional `TANGLE_ROUTER_URL`, `MODEL` — the one-call entry (router brain + router-tools workers) |
| **`sandbox`** | `TANGLE_API_KEY=sk-... SANDBOX_BASE_URL=https://... pnpm tsx examples/supervisor-loop/run-sandbox.ts` | a real `SandboxClient` (key + base URL); optional `LOOP_HARNESS` (default `opencode`); driver defaults to router-brain, `DRIVER=scripted` for no driver inference |
| **`bridge`** (local) | `WORKER_MODEL=opencode/anthropic/claude-sonnet-4-5 pnpm tsx examples/supervisor-loop/run-bridge.ts` | a running `~/code/cli-bridge` (base `http://127.0.0.1:3344`, no `/v1`, bearer optional/default `local`); `WORKER_MODEL` = `<harness>/<model>`. Override `BRIDGE_URL` / `BRIDGE_BEARER` if you started it with auth. Set `TANGLE_API_KEY` + `DRIVER_MODEL` for a real driver brain (else scripted) |

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
differs. For a fully offline, no-creds **wiring** check (no harness needed), two unit tests
cover the spawn → await → checked-settle loop and the `supervise()`-on-scripted-brain path:

```bash
pnpm test tests/loops/coordination-driver.test.ts tests/supervisor-loop-example.test.ts
```

## Offline driver vs real driver

The supervisor drives through an injected `ToolLoopChat` brain (one driver-LLM turn).
`supervise(..., { router })` (or `examples/supervise/supervise.ts`) uses **`routerBrain(cfg)`**
so the supervisor's turns are real router tool-calls and the brain decides the loop itself.
`run-sandbox.ts`/`run-bridge.ts` default to a **scripted** brain (`scriptedSupervisorChat`, a
fixed `spawn → await → stop` plan) so the box/bridge wiring is the only moving part — the same
offline seam the unit tests use — and opt into `routerBrain` when a key is present. Same brain,
different seam.

## One-call boilerplate: `createInMemoryRunContext`

A supervised run needs three stores threaded into `SupervisorOpts`: a spawn journal, a result
blob store, and an executor registry — and the blob store passed to `driverAgent`
**must be the same instance** the run uses. `createInMemoryRunContext()` (exported from
`@tangle-network/agent-runtime` and `/loops`) bundles all three:

```ts
const run = createInMemoryRunContext()                 // { journal, blobs, executors }
const root = driverAgent({ blobs: run.blobs, /* ... */ })
await createSupervisor().run(root, task, { budget, runId, ...run })
```

Pass `{ withDriver: true }` to wrap the registry with `withDriverExecutor` for the recursive
agents-drive-agents path (a `role: 'driver'` child runs in a nested scope on the same pool).
