# @tangle-network/agent-runtime

Production runtime substrate for domain agents. Owns the task lifecycle
(knowledge readiness, control loop, session resume, sanitized telemetry,
canonical `RuntimeRunRow` persistence + cost ledger) so domain repos stop
inventing their own.

```bash
pnpm add @tangle-network/agent-runtime @tangle-network/agent-eval
```

## What you get

| Entry point | When to reach for it |
|---|---|
| `runAgentTask` | Single-shot adapter-driven task with eval/verification |
| `runAgentTaskStream` | Streaming product loop with session resume + backends |
| `startRuntimeRun` | Canonical production-run row + cost ledger |
| `createTraceBridge` | Map `RuntimeStreamEvent` → `agent-eval` `TraceEvent` |
| `decideKnowledgeReadiness` | `ready` / `blocked` / `caveat` branch for routes / UI |
| `createOpenAICompatibleBackend` | OpenAI-compatible streaming backend (TCloud / cli-bridge) |
| `createSandboxPromptBackend` | Sandbox / sidecar `streamPrompt` clients |
| `createRuntimeStreamEventCollector` | Default-redacted sanitized telemetry over a stream |

Every public export is annotated `@stable` or `@experimental`. `@stable`
exports do not change shape inside a minor; `@experimental` exports may
change inside a minor and require a deliberate consumer bump.

## Quickstart

```ts
import { runAgentTask } from '@tangle-network/agent-runtime'

const result = await runAgentTask({
  task: {
    id: 'review-2026-return',
    intent: 'Review the return for missing evidence',
    domain: 'tax',
  },
  adapter: {
    async observe() { return { /* domain state */ } },
    async validate({ state }) { return [/* eval results */] },
    async decide({ state }) {
      return { type: 'stop', pass: true, score: 1, reason: 'review complete' }
    },
    async act() { return undefined },
  },
})

console.log(result.status, result.runRecords)
```

## Canonical production-run lifecycle

`startRuntimeRun` records what the agent did on behalf of a customer,
what it cost, and how it ended. Replaces bespoke `agentRuns`-row helpers
across consumer repos with a single contract.

```ts
import { startRuntimeRun, runAgentTaskStream } from '@tangle-network/agent-runtime'

const run = startRuntimeRun({
  workspaceId: 'ws-1',
  sessionId: threadId,
  agentId: 'legal-chat-runtime',
  taskSpec,
  scenarioId: `legal-chat:${threadId}`,
  adapter: { upsert: (row) => db.insert(agentRuns).values(row) },
})

for await (const event of runAgentTaskStream({ task: taskSpec, backend, input })) {
  run.observe(event) // llm_call events update the cost ledger
  if (event.type === 'final') {
    run.complete({
      status: event.status === 'completed' ? 'completed' : 'failed',
      resultSummary: event.text ?? '',
      error: event.status === 'failed' ? event.reason : undefined,
    })
  }
}

await run.persist({ runtimeEvents: telemetry.events })
console.log(run.cost()) // { tokensIn, tokensOut, costUsd, wallMs, llmCalls }
```

Full runnable: [`examples/runtime-run/`](./examples/runtime-run/).

## agent-eval trace bridge

If you persist traces in agent-eval's `TraceStore`, the bridge maps
runtime stream events to `TraceEvent` so consumer repos don't hand-roll
the adapter:

```ts
import { createTraceBridge } from '@tangle-network/agent-runtime'

const bridge = createTraceBridge({ runId, spanId })
for await (const event of runAgentTaskStream({ task, backend, input })) {
  const trace = bridge.toTraceEvent(event)
  if (trace) await traceStore.appendEvent(trace)
}
```

## Error taxonomy

Every public function throws one of:

| Error | When |
|---|---|
| `ValidationError` | Caller passed invalid arguments |
| `ConfigError` | Required env / config missing |
| `NotFoundError` | A named resource does not exist |
| `BackendTransportError` | Backend HTTP / IPC call returned non-success |
| `SessionMismatchError` | Resume requested against a different backend |
| `RuntimeRunStateError` | `RuntimeRunHandle` lifecycle methods called out of order |

All extend `AgentEvalError` (re-exported from `@tangle-network/agent-eval`)
and carry a stable `code` so cross-package handlers can pattern-match
without importing the runtime.

## Sanitized telemetry

`task.intent` flows through sanitized telemetry on every event. **Never
set it to user input** — use a fixed string describing the operation
kind (e.g. `"Run a chat turn"`, `"Score a tax return"`). Route user-
visible content through `task.inputs` (redacted by default).

```ts
import { createRuntimeStreamEventCollector, runAgentTaskStream } from '@tangle-network/agent-runtime'

const telemetry = createRuntimeStreamEventCollector()
for await (const event of runAgentTaskStream({ task, backend })) {
  telemetry.onEvent(event)
}
console.log(telemetry.events, telemetry.summary())
```

By default the collector redacts task inputs, user answers, credential
questions, control payloads, evidence IDs, task metadata, and eval
details. Private diagnostics opt-in via `RuntimeTelemetryOptions`.

## Package boundaries

| Package | Owns |
|---|---|
| `agent-runtime` | Lifecycle, adapters, backends, `RuntimeRunHandle`, trace bridge |
| `agent-runtime/platform` | Server-side clients for the Tangle platform: cross-site SSO (`PlatformAuthClient`) and integrations hub (`PlatformHubClient`) |
| `agent-eval` | Control loops, readiness scoring, traces, evals, failure classes, release evidence |
| `agent-knowledge` | Evidence, claims, wiki pages, retrieval, knowledge bundle builders |
| Domain packages | Domain tools, policies, credentials, UI text, rubrics |

### `agent-runtime/platform` — Login with Tangle + integrations hub

```ts
import {
  PlatformAuthClient,
  PlatformHubClient,
} from '@tangle-network/agent-runtime/platform'

// Login with Tangle (cross-site SSO bridge).
const auth = new PlatformAuthClient({
  baseUrl: process.env.TANGLE_PLATFORM_URL!, // https://id.tangle.tools
  appId: 'gtm-agent',                        // must be registered in TRUSTED_APPS
})
const url = auth.authorizeUrl({ state: csrfToken, redirectUri: callbackUrl })
// …user redirected to `url`, returns to callbackUrl with ?code=…
const { apiKey, user } = await auth.exchange(code)

// Integrations hub (uses the user's apiKey from cross-site exchange).
const hub = new PlatformHubClient({
  baseUrl: process.env.TANGLE_PLATFORM_URL!,
  bearer: apiKey,
})
const connections = await hub.listConnections()
const { authorizationUrl } = await hub.startAuth({
  providerId: 'google',
  connectorId: 'gmail',
  returnUrl: 'https://gtm.tangle.tools/integrations',
})
```

The API uses `runAgentTask`, not `runVerticalAgentTask`. `domain` is
metadata on the task because the runtime is reusable across many kinds of
agents without baking taxonomy into type names.

## Examples

Runnable in [`examples/`](./examples/):

- [`basic-task/`](./examples/basic-task/) — smallest `runAgentTask`
- [`with-knowledge-readiness/`](./examples/with-knowledge-readiness/) — readiness gating + `onKnowledgeBlocked`
- [`sanitized-telemetry/`](./examples/sanitized-telemetry/) — `createRuntimeEventCollector` + redaction
- [`sanitized-telemetry-streaming/`](./examples/sanitized-telemetry-streaming/) — streaming collector + redaction
- [`sse-stream/`](./examples/sse-stream/) — Server-Sent Events for browser clients
- [`sandbox-stream-backend/`](./examples/sandbox-stream-backend/) — `createSandboxPromptBackend`
- [`openai-stream-backend/`](./examples/openai-stream-backend/) — `createOpenAICompatibleBackend`
- [`runtime-run/`](./examples/runtime-run/) — `startRuntimeRun` + cost ledger + persistence adapter
