# @tangle-network/agent-runtime

Production runtime substrate for domain agents. Owns the task lifecycle
(knowledge readiness, control loop, session resume, sanitized telemetry,
canonical `RuntimeRunRow` persistence + cost ledger), the chat-turn
engine (NDJSON envelope + product hooks), the chat-model catalog +
admission, and the declarative `defineAgent` manifest — so domain
repos stop inventing their own. Long-running execution durability
(reconnect, replay, dedup) lives in `@tangle-network/sandbox`.

```bash
pnpm add @tangle-network/agent-runtime @tangle-network/agent-eval
```

## What you get

| Entry point | When to reach for it |
|---|---|
| `runAgentTask` | Single-shot adapter-driven task with eval/verification |
| `runAgentTaskStream` | Streaming product loop with session resume + backends |
| `handleChatTurn` | Framework-neutral chat-turn orchestrator (NDJSON + `session.run.*` envelope + product hooks) |
| `deriveExecutionId` | Stable substrate executionId for `X-Execution-ID` cross-process reconnect |
| `startRuntimeRun` | Canonical production-run row + cost ledger |
| `defineAgent` | Declarative per-vertical agent manifest — surfaces, knowledge, rubric, run fn |
| `resolveChatModel` / `validateChatModelId` / `getModels` | Router catalog fetch + fail-closed admission + precedence resolver |
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

## Chat turns

`handleChatTurn` wraps a product `produce()` hook with the `session.run.*`
lifecycle envelope, drains the producer stream through the NDJSON line
protocol, and calls the persist / post-process hooks after drain.
Framework-neutral: takes already-resolved values, never a `Request` or
`Context`.

```ts
import { handleChatTurn } from '@tangle-network/agent-runtime'

const result = handleChatTurn({
  identity: { tenantId: workspaceId, sessionId: threadId, userId, turnIndex },
  hooks: {
    produce: () => ({
      stream: box.streamPrompt(prompt, sandboxOptions),
      finalText: () => assembled,
    }),
    persistAssistantMessage: async ({ identity, finalText }) => db.insert(messages).values(...),
    onTurnComplete: async ({ identity, finalText }) => extractProposals(finalText),
    traceFlush: () => traceSink.flush(),
  },
  waitUntil: ctx.waitUntil,
})
return new Response(result.body, { headers: { 'content-type': result.contentType } })
```

## Execution continuity

Long-running execution durability — reconnect, replay, dedup — lives in
the substrate. `@tangle-network/sandbox`'s `box.streamPrompt`
auto-reconnects in-call (extracts `executionId` from the response and
replays via the runtime endpoint on drop). Cross-process reconnect —
worker dies, a fresh worker resumes the same execution — requires
either bypassing the SDK and POSTing directly with `X-Execution-ID`
(see `tax-agent/sessions.ts`) or a future SDK release that surfaces the
field on `PromptOptions`.

`deriveExecutionId` is the convention helper for the stable id the
product persists alongside its session row:

```ts
import { deriveExecutionId } from '@tangle-network/agent-runtime'

const executionId = deriveExecutionId({ projectId, sessionId, turnIndex })
// pass as `X-Execution-ID` header when calling the orchestrator directly
```

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
    /* product-specific run — typically wraps handleChatTurn or runAgentTaskStream */
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

## Error taxonomy

| Error | When |
|---|---|
| `ValidationError` | Caller passed invalid arguments |
| `ConfigError` | Required env / config missing |
| `NotFoundError` | A named resource does not exist |
| `BackendTransportError` | Backend HTTP / IPC call returned non-success |
| `SessionMismatchError` | Resume requested against a different backend |
| `RuntimeRunStateError` | `RuntimeRunHandle` lifecycle methods called out of order |

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
| `agent-runtime` | Task lifecycle, adapters, backends, chat-turn engine, execution-handle contract, model resolution, trace bridge, `defineAgent`. **Does not** own long-running execution state — that lives in `@tangle-network/sandbox` + orchestrator. |
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
- [`agent-into-reviewer/`](./examples/agent-into-reviewer/) — pipe one runtime's stream into a reviewer agent
- [`chat-handler/`](./examples/chat-handler/) — `handleChatTurn` (the centerpiece production pattern)
- [`production-trace-sink/`](./examples/production-trace-sink/) — `createProductionTraceSink` data capture

## Tests

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
