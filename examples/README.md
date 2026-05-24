# agent-runtime examples

Each example is a single runnable `.ts` file plus a short README. Most are
synthetic — no credentials required. `openai-stream-backend` needs an
`OPENAI_API_KEY`; `mcp-delegation` needs `pnpm build` to have run so the
local MCP bin exists.

| Example | What it covers |
|---|---|
| [`basic-task/`](./basic-task/) | The smallest `runAgentTask` invocation — adapter contract + lifecycle |
| [`with-knowledge-readiness/`](./with-knowledge-readiness/) | `requiredKnowledge` + `AgentKnowledgeProvider` + `decideKnowledgeReadiness` |
| [`sanitized-telemetry/`](./sanitized-telemetry/) | `createRuntimeEventCollector` + redaction policy (`runAgentTask`) |
| [`sanitized-telemetry-streaming/`](./sanitized-telemetry-streaming/) | `createRuntimeStreamEventCollector` + redaction policy (`runAgentTaskStream`) |
| [`sse-stream/`](./sse-stream/) | Server-Sent Events helpers for browser routes |
| [`sandbox-stream-backend/`](./sandbox-stream-backend/) | `runAgentTaskStream` with `createSandboxPromptBackend` (synthetic sandbox client) |
| [`openai-stream-backend/`](./openai-stream-backend/) | `runAgentTaskStream` with `createOpenAICompatibleBackend` (real endpoint required) |
| [`runtime-run/`](./runtime-run/) | `startRuntimeRun` + cost ledger + persistence adapter |
| [`agent-into-reviewer/`](./agent-into-reviewer/) | Pipe one runtime's stream into a reviewer agent (the "2-runtime" pattern) |
| [`chat-handler/`](./chat-handler/) | `handleChatTurn` — the centerpiece production chat handler |
| [`coder-loop/`](./coder-loop/) | `coderProfile` + `runLoop` + `FanoutVote` — minimum end-to-end coder loop |
| [`researcher-loop/`](./researcher-loop/) | `researcherProfile` + `runLoop` + `FanoutVote` (peer dep: `@tangle-network/agent-knowledge`) |
| [`mcp-delegation/`](./mcp-delegation/) | Mount `agent-runtime-mcp` in a product's `AgentProfile` + stdio `tools/list` smoke |
| [`fleet-delegation/`](./fleet-delegation/) | `TANGLE_FLEET_ID` env flip + `createFleetWorkspaceExecutor` — sibling vs fleet topology |

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
pnpm tsx examples/runtime-run/runtime-run.ts
pnpm tsx examples/agent-into-reviewer/agent-into-reviewer.ts
pnpm tsx examples/chat-handler/chat-handler.ts
pnpm tsx examples/coder-loop/coder-loop.ts
pnpm tsx examples/researcher-loop/researcher-loop.ts
pnpm tsx examples/fleet-delegation/fleet-delegation.ts

# requires `pnpm build` first (uses dist/mcp/bin.js)
pnpm tsx examples/mcp-delegation/mcp-delegation.ts

# requires creds
OPENAI_API_KEY=... pnpm tsx examples/openai-stream-backend/openai-stream-backend.ts
```

## Trace derivation

The driven-loop kernel emits `loop.*` trace events as it runs. Combined with
the per-event sandbox stream and the kernel's cost ledger, these feed the
production observability pipeline:

```
runLoop iteration N
  ↓ driver.plan returns task(s)
  ↓ for each task: sandbox.create(agentRun.profile) OR fleet.dispatchPrompt(...)
  ↓ box.streamPrompt(taskToPrompt(task))
     emits SandboxEvent stream
       ├─ llm_call { model, tokensIn, tokensOut, costUsd }
       ├─ tool_call { toolName, args }
       ├─ tool_result { result }
       └─ result { finalText }
  ↓ output.parse(events) → typed Output
  ↓ validator.validate(output) → verdict
  ↓ kernel auto-emits loop.iteration.ended event into ctx.traceEmitter
     → flows into RuntimeRunHandle telemetry
       → flows into .production-data/traces/events.ndjson (when ingestion mount is wired)
         → analyst loop reads + finds patterns
           → production-loop CI mutates agent surface
             → re-eval + ship if gate passes
```
