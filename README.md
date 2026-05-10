# agent-runtime

Reusable runtime lifecycle for domain-specific agents. Standardizes the
task lifecycle (knowledge readiness → questions/acquisition → control loop
→ eval) and delegates domain behavior to an adapter. Owns no domain
policy, models, tools, connectors, or UI.

## Contents

- [Overview](#overview)
- [Install](#install)
- [Getting started](#getting-started)
- [When to use which entry point](#when-to-use-which-entry-point)
- [Backends for `runAgentTaskStream`](#backends-for-runagenttaskstream)
- [Lifecycle events](#lifecycle-events)
- [Knowledge providers](#knowledge-providers)
- [Sanitized telemetry](#sanitized-telemetry)
- [Package boundaries](#package-boundaries)
- [Examples](#examples)

## Overview

```txt
TaskSpec
  → Knowledge readiness
  → Question / acquisition decision
  → Agent control loop (observe / validate / decide / act)
  → Eval / verification
  → Run evidence
```

For product agents that own a streaming model backend:

```txt
TaskSpec
  → Knowledge readiness
  → Session create/resume
  → Backend stream
  → Sanitized RuntimeStreamEvent / SSE
```

## Install

```bash
pnpm add @tangle-network/agent-runtime @tangle-network/agent-eval
```

## Getting started

The smallest possible task — a domain adapter responding to one task with
no streaming:

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
      return { kind: 'finish', reason: 'review complete' }
    },
    async act() { return undefined },
  },
})

console.log(result.status, result.runRecords)
```

Full runnable: [`examples/basic-task/`](./examples/basic-task/).

## When to use which entry point

| You want… | Use |
|---|---|
| Single-shot task with eval/verification | `runAgentTask` |
| Streaming product loop with session resume | `runAgentTaskStream` + a backend factory |
| Just SSE serialization for an existing readiness report | `readinessServerSentEvent` |
| Just sanitized telemetry over an existing run | `createRuntimeEventCollector` (+ `summarizeAgentTaskRun`) for `runAgentTask`, or `createRuntimeStreamEventCollector` for `runAgentTaskStream` |
| Stable readiness branching (`ready` / `blocked` / `caveat`) in a route | `decideKnowledgeReadiness` |

## Backends for `runAgentTaskStream`

Four SDK-agnostic factories ship in core:

| Factory | When |
|---|---|
| `createOpenAICompatibleBackend` | TCloud / OpenAI-compatible chat APIs |
| `createCliBridgeBackend` | HTTP CLI bridge streams |
| `createSandboxPromptBackend` | Sandbox / sidecar `streamPrompt` clients |
| `createIterableBackend` | Custom coding harnesses, browser agents |

Adapters are intentionally thin. Product repos still own client
construction, auth, concrete tool permissions, and UI behavior. See
[`examples/sandbox-stream-backend/`](./examples/sandbox-stream-backend/) and
[`examples/openai-stream-backend/`](./examples/openai-stream-backend/) for
runnable wirings.

## Lifecycle events

`runAgentTask` and `runAgentTaskStream` emit typed lifecycle events
through `onEvent`:

```ts
await runAgentTask({
  task, adapter,
  onEvent(event) {
    console.log(event.type)
  },
})
```

Events cover readiness, question answering, acquisition, control-loop
steps, and task completion. Every transition is observable without
coupling domain adapters to logging, streaming, or telemetry concerns.

This package does **not** stream model tokens for you. Domain adapters
and product routes still own model calls, tool execution, and token
streaming. agent-runtime emits lifecycle events around those actions.

## Knowledge providers

Optional. A knowledge provider implements:

- `buildReadiness` — score readiness against the task's required knowledge
- `answerQuestions` — handle outstanding user questions
- `executeAcquisitionPlans` — fetch missing evidence
- `refreshReadiness` — rerun scoring after acquisition

Lets a task collect missing context before the control loop starts, then
rerun readiness against new evidence. If readiness fails, `runAgentTask`
stops before domain actions; adapters can override `onKnowledgeBlocked`
to emit a domain action (asking a user, querying a connector, etc.).

For control policies or route handlers that need a stable readiness
branch, use `decideKnowledgeReadiness(report)` — it returns `ready`,
`blocked`, or `caveat` plus gap IDs and the recommended action.

## Sanitized telemetry

For logs, reports, UI telemetry — never serialize raw events directly.
Use the built-in sanitized collector:

```ts
import {
  createRuntimeEventCollector,
  summarizeAgentTaskRun,
} from '@tangle-network/agent-runtime'

const telemetry = createRuntimeEventCollector()
const result = await runAgentTask({ task, adapter, onEvent: telemetry.onEvent })

console.log(telemetry.events)
console.log(summarizeAgentTaskRun(result))
```

By default, the collector redacts task inputs, user answers, credential
questions, control payloads, evidence IDs, task metadata, and eval
details. Private diagnostics opt-in via `RuntimeTelemetryOptions` flags
(`includeInputs`, `includeUserAnswers`, `includeControlPayloads`,
`includeEvidenceIds`, `includeRequirementDescriptions`,
`includeMetadata`, `includeEvalDetails`).

For `runAgentTaskStream`, use the sibling
`createRuntimeStreamEventCollector`:

```ts
import {
  createRuntimeStreamEventCollector,
  runAgentTaskStream,
} from '@tangle-network/agent-runtime'

const telemetry = createRuntimeStreamEventCollector()
for await (const event of runAgentTaskStream({ task, backend })) {
  telemetry.onEvent(event)
}

console.log(telemetry.events)
console.log(telemetry.summary())
```

Same `RuntimeTelemetryOptions` flags apply. Streaming and non-streaming
events have different field shapes (timestamps, sessions, text/tool
deltas), which is why the factories are siblings rather than overloads —
a single dispatcher would silently misroute events whose `type` literals
overlap (`task_start`, `readiness_end`, etc.).

### `task.intent` is sanitized telemetry by default

`task.intent` flows through sanitized telemetry on every event. **Never
set it to user input** — use a fixed string describing the operation
kind (e.g. `"Run a chat turn"`, `"Score a tax return"`). If you need to
log user-visible intent, route it through `inputs` (which are redacted
by default) instead.

For SSE-over-HTTP, use the helpers:

```ts
import { readinessServerSentEvent } from '@tangle-network/agent-runtime'
writer.write(encoder.encode(readinessServerSentEvent(readinessReport)))
```

## Package boundaries

| Package | Owns |
|---|---|
| `agent-runtime` | Reusable lifecycle and adapter contracts |
| `agent-eval` | Control loops, readiness scoring, traces, evals, failure classes, optimization, release evidence |
| `agent-knowledge` | Evidence, claims, wiki pages, retrieval, knowledge bundle builders |
| Domain packages | Domain tools, policies, credentials, UI text, rubrics |

The API uses `runAgentTask`, not `runVerticalAgentTask`. `domain` is
metadata on the task, because the runtime should be reusable across many
kinds of agents without baking taxonomy into type names.

## Examples

Runnable in [`examples/`](./examples/):

- [`basic-task/`](./examples/basic-task/) — the smallest `runAgentTask`
- [`with-knowledge-readiness/`](./examples/with-knowledge-readiness/) — readiness gating + custom `onKnowledgeBlocked`
- [`sanitized-telemetry/`](./examples/sanitized-telemetry/) — `createRuntimeEventCollector` + redaction policy
- [`sanitized-telemetry-streaming/`](./examples/sanitized-telemetry-streaming/) — `createRuntimeStreamEventCollector` + redaction policy for `runAgentTaskStream`
- [`sse-stream/`](./examples/sse-stream/) — Server-Sent Events for browser clients
- [`sandbox-stream-backend/`](./examples/sandbox-stream-backend/) — `runAgentTaskStream` with `createSandboxPromptBackend` (synthetic sandbox client; real one in `agent-builder`)
- [`openai-stream-backend/`](./examples/openai-stream-backend/) — `runAgentTaskStream` with `createOpenAICompatibleBackend`
