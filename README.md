# agent-runtime

Reusable runtime lifecycle for domain-specific agents.

`agent-runtime` is the shared skeleton for domain agents, generated agents,
red-team harnesses, coding agents, and similar packages. It does not own domain
policy, tools, connectors, model routing, or UI. It standardizes the task
lifecycle and delegates domain behavior to an adapter.

```txt
TaskSpec
  -> Knowledge readiness
  -> Question / acquisition decision
  -> Agent control loop
  -> Eval / verification
  -> Run evidence
```

For product agents that already have a streaming backend, use the stream kernel:

```txt
TaskSpec
  -> Knowledge readiness
  -> Session create/resume
  -> Backend stream
  -> Sanitized RuntimeStreamEvent/SSE
```

## Install

```bash
pnpm add @tangle-network/agent-runtime @tangle-network/agent-eval
```

## Usage

```ts
import { runAgentTask } from '@tangle-network/agent-runtime'

const result = await runAgentTask({
  task: {
    id: 'tax-2026-return-review',
    intent: 'Review the return for missing evidence',
    domain: 'tax',
    requiredKnowledge: [{
      id: 'filing-status',
      description: 'Taxpayer filing status',
      requiredFor: ['return-review'],
      category: 'user_specific',
      acquisitionMode: 'ask_user',
      importance: 'blocking',
      freshness: 'static',
      sensitivity: 'private',
      confidenceNeeded: 1,
      currentConfidence: 0,
      evidenceIds: [],
      fallbackPolicy: 'ask',
    }],
  },
  adapter,
})
```

If knowledge readiness fails, `runAgentTask` stops before domain actions by
default. Adapters can override `onKnowledgeBlocked` to emit a domain action,
such as asking a user, querying a connector, or inspecting a repo.

`runAgentTask` also emits typed lifecycle events through `onEvent`:

```ts
await runAgentTask({
  task,
  adapter,
  knowledge,
  onEvent(event) {
    console.log(event.type)
  },
})
```

Events cover readiness, question answering, acquisition, control-loop steps,
and task completion. This keeps streaming UI, logs, and telemetry out of domain
adapters while making every runtime transition observable.

This package does not stream model tokens for you. Domain adapters and product
routes still own model calls, tool execution, and token streaming. `agent-runtime`
emits lifecycle events around those actions, and provides small helpers for
safe telemetry streams:

```ts
import { readinessServerSentEvent } from '@tangle-network/agent-runtime'

writer.write(encoder.encode(readinessServerSentEvent(readinessReport)))
```

Use these helpers when an app wants to expose readiness or runtime metadata over
Server-Sent Events without leaking raw task inputs, credentials, or evidence.

For main product loops, prefer `runAgentTaskStream` with an execution backend:

```ts
import {
  InMemoryRuntimeSessionStore,
  createSandboxPromptBackend,
  runAgentTaskStream,
  runtimeStreamServerSentEvent,
} from '@tangle-network/agent-runtime'

const backend = createSandboxPromptBackend({
  getBox: () => sandboxClient.get(sandboxId),
  streamPrompt: (box, message) => box.streamPrompt(message),
  getSessionId: (box) => box.id,
})

const sessions = new InMemoryRuntimeSessionStore()

for await (const event of runAgentTaskStream({
  task,
  backend,
  input: { message },
  sessionId,
  resume: Boolean(sessionId),
  sessionStore: sessions,
})) {
  writer.write(encoder.encode(runtimeStreamServerSentEvent(event)))
}
```

`runAgentTaskStream` is the product-facing kernel. It readiness-gates execution,
creates or resumes a backend session, normalizes text/tool/artifact/error/final
events, and lets callers persist resumable session history. The package ships
SDK-agnostic adapter factories for:

- `createOpenAICompatibleBackend` for TCloud/OpenAI-compatible chat APIs.
- `createCliBridgeBackend` for HTTP CLI bridge streams.
- `createSandboxPromptBackend` for sandbox/sidecar `streamPrompt` clients.
- `createIterableBackend` for custom coding harnesses or browser agents.

The adapters are intentionally thin. Product repos still own client
construction, auth, concrete tool permissions, and UI behavior.

For logs, reports, and UI telemetry, do not serialize raw events directly.
Use the built-in sanitized collector:

```ts
import { createRuntimeEventCollector, summarizeAgentTaskRun } from '@tangle-network/agent-runtime'

const telemetry = createRuntimeEventCollector()
const result = await runAgentTask({ task, adapter, onEvent: telemetry.onEvent })

console.log(telemetry.events)
console.log(summarizeAgentTaskRun(result))
```

Sanitized telemetry redacts task inputs, user answers, credential questions,
control payloads, and evidence IDs by default. Private diagnostics can opt into
specific fields with `includeInputs`, `includeUserAnswers`,
`includeControlPayloads`, `includeEvidenceIds`, and
`includeRequirementDescriptions`. Task metadata and eval details are also
redacted unless `includeMetadata` or `includeEvalDetails` is set.

For control policies or route handlers that need a stable readiness branch,
use `decideKnowledgeReadiness(report)`. It returns `ready`, `blocked`, or
`caveat` plus gap IDs and the recommended action.

Knowledge providers may implement:

- `buildReadiness`
- `answerQuestions`
- `executeAcquisitionPlans`
- `refreshReadiness`

That lets a task collect missing context before the control loop starts, then
rerun readiness scoring against the new evidence.

## Package Boundaries

- `agent-runtime` owns the reusable lifecycle and adapter contracts.
- `agent-eval` owns control loops, readiness scoring, traces, evals, failure
  classes, optimization, and release evidence.
- `agent-knowledge` owns evidence, claims, wiki pages, retrieval, and knowledge
  bundle builders.
- Domain packages own domain tools, policies, credentials, UI text, and rubrics.

The primary API intentionally uses `runAgentTask`, not `runVerticalAgentTask`.
`domain` is metadata on the task, because the runtime should be reusable across
many kinds of agents without baking taxonomy into type names.
