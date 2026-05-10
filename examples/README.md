# agent-runtime examples

Each example is a single runnable `.ts` file plus a short README. The
synthetic ones (`basic-task`, `with-knowledge-readiness`, `sse-stream`,
`sandbox-stream-backend`, `sanitized-telemetry`, `sanitized-telemetry-streaming`)
need no credentials; `openai-stream-backend` needs an `OPENAI_API_KEY`.

| Example | What it covers |
|---|---|
| [`basic-task/`](./basic-task/) | The smallest `runAgentTask` invocation — adapter contract + lifecycle |
| [`with-knowledge-readiness/`](./with-knowledge-readiness/) | `requiredKnowledge` + `AgentKnowledgeProvider` + `decideKnowledgeReadiness` |
| [`sanitized-telemetry/`](./sanitized-telemetry/) | `createRuntimeEventCollector` + redaction policy (`runAgentTask`) |
| [`sanitized-telemetry-streaming/`](./sanitized-telemetry-streaming/) | `createRuntimeStreamEventCollector` + redaction policy (`runAgentTaskStream`) |
| [`sse-stream/`](./sse-stream/) | Server-Sent Events helpers for browser routes |
| [`sandbox-stream-backend/`](./sandbox-stream-backend/) | `runAgentTaskStream` with `createSandboxPromptBackend` (synthetic sandbox client) |
| [`openai-stream-backend/`](./openai-stream-backend/) | `runAgentTaskStream` with `createOpenAICompatibleBackend` (real endpoint required) |

## Conventions

- Every example imports from `@tangle-network/agent-runtime` (not from
  relative source paths) so consumers see the same import surface they'd
  use in their own product.
- Where domain types are needed (`SandboxBox`, evidence stores, etc.),
  the example defines them inline with comments calling out which parts
  are *yours* to provide vs *the runtime's* contract.
- No example creates its own throwaway `package.json` — they all run
  from this repo's tsx so changes to the runtime are picked up
  immediately.

## Run

From the agent-runtime repo root:

```bash
pnpm tsx examples/basic-task/basic-task.ts
pnpm tsx examples/with-knowledge-readiness/with-knowledge-readiness.ts
pnpm tsx examples/sanitized-telemetry/sanitized-telemetry.ts
pnpm tsx examples/sanitized-telemetry-streaming/sanitized-telemetry-streaming.ts
pnpm tsx examples/sse-stream/sse-stream.ts
pnpm tsx examples/sandbox-stream-backend/sandbox-stream-backend.ts

# requires creds
OPENAI_API_KEY=... pnpm tsx examples/openai-stream-backend/openai-stream-backend.ts
```
