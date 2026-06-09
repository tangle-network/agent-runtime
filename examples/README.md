# agent-runtime examples

Ordered as a learning progression — each example introduces one concept on top of the previous one. The first example is what every production agent does. The later ones are when one-shot chat isn't enough.

Every example imports from `@tangle-network/agent-runtime` (the same surface consumers use), not from relative paths.

## Start here

| # | Example | One sentence |
|---|---|---|
| 1 | [`chat-handler/`](./chat-handler/) | `handleChatTurn` — the production chat turn lifecycle every product runs |
| 2 | [`knowledge-gating/`](./knowledge-gating/) | Same chat handler + `requiredKnowledge` + `decideKnowledgeReadiness` gating |
| 3 | [`sanitized-telemetry-streaming/`](./sanitized-telemetry-streaming/) | Same chat handler + redaction-by-default telemetry collector |
| 4 | [`runtime-run/`](./runtime-run/) | Same chat handler + `startRuntimeRun` + cost ledger persistence |

After reading these four you've seen every production-essential primitive.

## Delegation + tools

| # | Example | One sentence |
|---|---|---|
| 5 | [`mcp-delegation/`](./mcp-delegation/) | Mount `agent-runtime-mcp` in an `AgentProfile` so the harness exposes the 5 delegation tools (`delegate_code`, `delegate_research`, `delegate_feedback`, `delegation_status`, `delegation_history`) |

## Multi-agent fanout (advanced)

| # | Example | One sentence |
|---|---|---|
| 6 | [`coder-loop/`](./coder-loop/) | `coderProfile` + `runLoop` + `createFanoutVoteDriver` — N parallel coder iterations, kernel picks the winner |
| 7 | [`researcher-loop/`](./researcher-loop/) | `researcherProfile` + `runLoop` (requires `@tangle-network/agent-knowledge`) |
| 8 | [`fleet-delegation/`](./fleet-delegation/) | `TANGLE_FLEET_ID` flips delegation from sibling-sandbox to fleet-workspace topology |

## Lower-level building blocks

These were standalone examples in an earlier release. The patterns are now folded into the four "Start here" examples above. Kept on disk one minor release for migration.

- [`basic-task/`](./basic-task/) — `runAgentTask` (one-shot, no chat envelope)
- [`sandbox-stream-backend/`](./sandbox-stream-backend/) — `createSandboxPromptBackend`
- [`openai-stream-backend/`](./openai-stream-backend/) — `createOpenAICompatibleBackend`
- [`sse-stream/`](./sse-stream/) — SSE helpers for browser routes
- [`sanitized-telemetry/`](./sanitized-telemetry/) — non-streaming counterpart to `sanitized-telemetry-streaming`
- [`pipe-into-reviewer/`](./pipe-into-reviewer/) — pipe one runtime's stream into a reviewer agent (advanced 2-runtime topology)
- [`intelligence-export/`](./intelligence-export/) — ship loop traces to Tangle Intelligence (`createOtelExporter` + raw OTLP) for failure-correlation + quality insights

## Conventions

- Examples are synthetic unless noted. `openai-stream-backend` needs `OPENAI_API_KEY`. `mcp-delegation` needs `pnpm build` first so the local MCP bin exists.
- Where domain types are needed (`SandboxBox`, evidence stores), the example defines them inline — comments call out which parts are *yours* to provide vs *the runtime's* contract.
- No example creates its own throwaway `package.json` — they run from this repo's tsx so changes to the runtime are picked up immediately.

## Run

From the agent-runtime repo root, in the suggested learning order:

```bash
# Start here
pnpm tsx examples/chat-handler/chat-handler.ts
pnpm tsx examples/knowledge-gating/knowledge-gating.ts
pnpm tsx examples/sanitized-telemetry-streaming/sanitized-telemetry-streaming.ts
pnpm tsx examples/runtime-run/runtime-run.ts

# Delegation
pnpm build  # mcp-delegation needs dist/mcp/bin.js
pnpm tsx examples/mcp-delegation/mcp-delegation.ts

# Multi-agent fanout
pnpm tsx examples/coder-loop/coder-loop.ts
pnpm tsx examples/researcher-loop/researcher-loop.ts
pnpm tsx examples/fleet-delegation/fleet-delegation.ts
```

## Trace derivation

The driven-loop kernel emits `loop.*` trace events as it runs. Combined with the per-event sandbox stream and the kernel's cost ledger, these feed the production observability pipeline:

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

With `OTEL_EXPORTER_OTLP_ENDPOINT` set, every span in the chain (kernel iterations, judge calls, analyst runs, mutator calls) auto-exports to the user's observability stack — see [`Phase 10` of the agent-stack-adoption skill](https://github.com/drewstone/dotfiles/blob/main/claude/skills/agent-stack-adoption/SKILL.md#phase-10--full-distributed-tracing--otel-export).
