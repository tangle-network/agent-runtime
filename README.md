# @tangle-network/agent-runtime

Production runtime substrate for domain agents. Owns the task lifecycle
(knowledge readiness, control loop, session resume, sanitized telemetry,
durable runs across worker / DO crashes, canonical `RuntimeRunRow`
persistence + cost ledger), the chat-model catalog + admission, and the
declarative `defineAgent` manifest — so domain repos stop inventing their
own.

```bash
pnpm add @tangle-network/agent-runtime @tangle-network/agent-eval
```

## What you get

| Entry point | When to reach for it |
|---|---|
| `runAgentTask` | Single-shot adapter-driven task with eval/verification |
| `runAgentTaskStream` | Streaming product loop with session resume + backends |
| `runDurableTurn` | Checkpoint+replay chat turn — survives a worker crash *after* completion |
| `runSupervisedTurn` | Always-attached durable turn — re-attaches an in-flight sandbox run *during* a crash |
| `SessionSupervisorDO` | Cloudflare Durable Object host for `runSupervisedTurn` (with alarm-driven orphan re-attach) |
| `DurableChatTurnEngine` | Framework-neutral chat-turn orchestrator (durable turn + NDJSON + session lifecycle + product hooks) |
| `startRuntimeRun` | Canonical production-run row + cost ledger |
| `runDurable` + `*DurableRunStore` | General durable-step substrate (in-memory / file-system / D1) |
| `defineAgent` | Declarative per-vertical agent manifest — surfaces, knowledge, rubric, run fn |
| `resolveChatModel` / `validateChatModelId` / `getModels` | Router catalog fetch + fail-closed admission + precedence resolver |
| `createTraceBridge` | Map `RuntimeStreamEvent` → `agent-eval` `TraceEvent` |
| `decideKnowledgeReadiness` | `ready` / `blocked` / `caveat` branch for routes / UI |
| `createOpenAICompatibleBackend` | OpenAI-compatible streaming backend (TCloud / cli-bridge) |
| `createSandboxPromptBackend` | Sandbox / sidecar `streamPrompt` clients |
| `createRuntimeStreamEventCollector` | Default-redacted sanitized telemetry over a stream |
| `PlatformAuthClient` + `PlatformHubClient` (`/platform`) | Cross-site SSO + integrations hub |

Every public export is annotated `@stable` or `@experimental`. `@stable`
exports do not change shape inside a minor; `@experimental` exports may
change inside a minor and require a deliberate consumer bump.

## Quickstart

```ts
import { runAgentTask } from '@tangle-network/agent-runtime'

const result = await runAgentTask({
  task: { id: 'review-2026-return', intent: 'Review the return', domain: 'tax' },
  adapter: {
    async observe() { return { /* domain state */ } },
    async validate({ state }) { return [/* eval results */] },
    async decide({ state }) { return { type: 'stop', pass: true, score: 1, reason: 'done' } },
    async act() { return undefined },
  },
})
console.log(result.status, result.runRecords)
```

## Durable chat turns

A 15-minute agentic turn must survive a Cloudflare worker isolate dying.
`runDurableTurn` replays a *completed* turn from cache (worker died after
the turn finished). `runSupervisedTurn` closes the harder gap — a turn
interrupted *mid-stream* — by relocating the durability boundary off the
ephemeral worker:

- The supervisor drains every event into the substrate's own ordered log
  (`appendStreamEvent`, idempotent on `eventId`).
- It persists the substrate `RunHandle` the instant the sandbox yields it.
- A fresh supervisor reads the log for its cursor and resumes via
  `adapter.attach(handle, cursor)` — no event lost, none delivered twice.

The reconnect glue is one typed contract — `SandboxReconnectAdapter` —
implemented once per substrate, not per product.

```ts
import { runSupervisedTurn, InMemoryDurableRunStore } from '@tangle-network/agent-runtime'

const store = new InMemoryDurableRunStore()
const supervised = runSupervisedTurn({
  store, runId: `chat:${threadId}:${turnIndex}`, manifest, workerId,
  adapter: mySandboxAdapter,
})
for await (const event of supervised.stream) sendToClient(event)
// supervised.mode() === 'fresh' | 'resumed' | 'replayed'
```

Full runnable: [`examples/durable-supervisor/`](./examples/durable-supervisor/).

### Cloudflare Durable Object host

`SessionSupervisorDO` hosts the supervisor on a real DO — `fetch` streams the
turn, `alarm()` re-attaches a run a dropped response stream abandoned.

```ts
import { createSessionSupervisorDO } from '@tangle-network/agent-runtime'

export const SessionSupervisor = createSessionSupervisorDO({
  resolveRun(request, env, state)   { /* return RunSupervisorOptions */ },
  resolveOrphan(runId, env, state)  { /* same, for the alarm path */ },
  encodeEvent(event) { return `data: ${JSON.stringify(event)}\n\n` },
})
```

```toml
# wrangler.toml
[[durable_objects.bindings]]
name = "SESSION_SUPERVISOR"
class_name = "SessionSupervisor"
[[migrations]]
tag = "v1"
new_classes = ["SessionSupervisor"]
```

CF types are structural (`DurableObjectStateLike`) — no
`@cloudflare/workers-types` runtime dep.

## Chat-model resolution

One primitive every chat handler needs and was hand-rolling per repo:
router catalog fetch, malformed-id guard, fail-closed catalog admission,
precedence resolver. Policy-free — the caller passes its own precedence
order and known-good allowlist.

```ts
import {
  resolveChatModel, resolveRouterBaseUrl, validateChatModelId, getModels,
} from '@tangle-network/agent-runtime'

const routerBaseUrl = resolveRouterBaseUrl(env)
const { model, source } = resolveChatModel(
  [
    { source: 'request',   model: requestBody.model },
    { source: 'workspace', model: workspace.pinnedModel },
    { source: 'env',       model: env.TCLOUD_CHAT_MODEL },
  ],
  { source: 'default', model: 'claude-sonnet-4-6' },
)
const validation = await validateChatModelId(model, {
  routerBaseUrl,
  allowlist: ['claude-sonnet-4-6'],
})
if (!validation.succeeded) throw new ConfigError(validation.error)
```

Full runnable: [`examples/model-resolution/`](./examples/model-resolution/).

## Define an agent — declarative manifest

`defineAgent` is the per-vertical layer that pairs a runtime adapter with
the surfaces / knowledge / rubric / outcome contract `agent-eval`'s analyst
loop drives improvement against.

```ts
import { defineAgent } from '@tangle-network/agent-runtime/agent'

export const myAgent = defineAgent({
  id: 'legal-agent',
  surfaces: { /* prompt, tools, skills — the levers an analyst can edit */ },
  knowledge: { /* requirements + provider */ },
  rubric: { /* dimensions + weights */ },
  run: async (ctx) => {
    /* product-specific run — typically wraps runSupervisedTurn or runAgentTaskStream */
  },
})
```

## Canonical production-run lifecycle

`startRuntimeRun` records what the agent did for a customer, what it
cost, and how it ended. Replaces bespoke `agentRuns` helpers across
consumer repos.

```ts
import { startRuntimeRun, runAgentTaskStream } from '@tangle-network/agent-runtime'

const run = startRuntimeRun({
  workspaceId: 'ws-1', sessionId: threadId, agentId: 'legal-chat-runtime',
  taskSpec, scenarioId: `legal-chat:${threadId}`,
  adapter: { upsert: (row) => db.insert(agentRuns).values(row) },
})
for await (const event of runAgentTaskStream({ task: taskSpec, backend, input })) {
  run.observe(event)
  if (event.type === 'final') {
    run.complete({ status: event.status === 'completed' ? 'completed' : 'failed', resultSummary: event.text ?? '' })
  }
}
await run.persist({ runtimeEvents: telemetry.events })
```

Full runnable: [`examples/runtime-run/`](./examples/runtime-run/).

## agent-eval trace bridge

If you persist traces in agent-eval's `TraceStore`, the bridge maps
runtime stream events to `TraceEvent` so consumer repos don't hand-roll
the adapter.

```ts
import { createTraceBridge } from '@tangle-network/agent-runtime'

const bridge = createTraceBridge({ runId, spanId })
for await (const event of runAgentTaskStream({ task, backend, input })) {
  const trace = bridge.toTraceEvent(event)
  if (trace) await traceStore.appendEvent(trace)
}
```

## Error taxonomy

| Error | When |
|---|---|
| `ValidationError` | Caller passed invalid arguments |
| `ConfigError` | Required env / config missing |
| `NotFoundError` | A named resource does not exist |
| `BackendTransportError` | Backend HTTP / IPC call returned non-success |
| `SessionMismatchError` | Resume requested against a different backend |
| `RuntimeRunStateError` | `RuntimeRunHandle` lifecycle methods called out of order |
| `DurableRunLeaseHeldError` | Another worker holds a live lease on the run |
| `DurableRunInputMismatchError` | A `runId` exists with a different manifest hash |
| `DurableRunDivergenceError` | A step's intent changed across replays |

All extend `AgentEvalError` (re-exported from `@tangle-network/agent-eval`)
and carry a stable `code` so cross-package handlers pattern-match
without importing the runtime.

## Sanitized telemetry

`task.intent` flows through sanitized telemetry on every event. **Never
set it to user input** — use a fixed string describing the operation
kind (e.g. `"Run a chat turn"`, `"Score a tax return"`). Route
user-visible content through `task.inputs` (redacted by default).

```ts
import { createRuntimeStreamEventCollector, runAgentTaskStream } from '@tangle-network/agent-runtime'

const telemetry = createRuntimeStreamEventCollector()
for await (const event of runAgentTaskStream({ task, backend })) telemetry.onEvent(event)
console.log(telemetry.events, telemetry.summary())
```

## Package boundaries

| Package | Owns |
|---|---|
| `agent-runtime` | Lifecycle, adapters, backends, durable substrate, supervisor + DO, model resolution, trace bridge, `defineAgent` |
| `agent-runtime/platform` | Cross-site SSO (`PlatformAuthClient`) + integrations hub (`PlatformHubClient`) |
| `agent-runtime/agent` | `defineAgent` + surfaces / outcome adapters |
| `agent-runtime/analyst-loop` | `runAnalystLoop` — analyst registry driver |
| `agent-eval` | Control loops, readiness scoring, traces, evals, judges, RL, release evidence |
| `agent-knowledge` | Evidence, claims, wiki pages, retrieval |
| Domain packages | Domain tools, policies, credentials, UI text, rubrics |

See [`docs/concepts.md`](./docs/concepts.md) for the mental model.

## Examples

Runnable in [`examples/`](./examples/). Every example imports from
`@tangle-network/agent-runtime` (the same surface consumers use):

- [`basic-task/`](./examples/basic-task/) — smallest `runAgentTask`
- [`with-knowledge-readiness/`](./examples/with-knowledge-readiness/) — readiness gating
- [`sanitized-telemetry/`](./examples/sanitized-telemetry/) + [`-streaming/`](./examples/sanitized-telemetry-streaming/) — redaction
- [`sse-stream/`](./examples/sse-stream/) — SSE helpers for browser clients
- [`sandbox-stream-backend/`](./examples/sandbox-stream-backend/) — `createSandboxPromptBackend`
- [`openai-stream-backend/`](./examples/openai-stream-backend/) — `createOpenAICompatibleBackend`
- [`runtime-run/`](./examples/runtime-run/) — production-run row + cost ledger
- [`model-resolution/`](./examples/model-resolution/) — router catalog + fail-closed admission
- [`durable-supervisor/`](./examples/durable-supervisor/) — cross-worker resume keystone
- [`agent-into-reviewer/`](./examples/agent-into-reviewer/) — pipe one runtime's stream into a reviewer agent
- [`chat-handler/`](./examples/chat-handler/) — `DurableChatTurnEngine.runTurn` (the centerpiece production pattern)
- [`production-trace-sink/`](./examples/production-trace-sink/) — `createProductionTraceSink` data capture

## Tests

```bash
pnpm test          # full Node suite (251 tests)
pnpm test:workers  # real workerd DO integration test
pnpm typecheck
pnpm lint
pnpm build
```
