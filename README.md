# @tangle-network/agent-runtime

Production runtime substrate for domain agents. Owns the chat-turn engine, task lifecycle, knowledge readiness, sanitized telemetry, OTEL export, model admission, and the declarative `defineAgent` manifest. Long-running execution durability lives in `@tangle-network/sandbox`.

```bash
pnpm add @tangle-network/agent-runtime @tangle-network/agent-eval @tangle-network/sandbox
```

## Hello world

Every product agent is a `handleChatTurn` call inside a route. This 20-line snippet is what gtm / creative / legal / tax all run:

```ts
import { handleChatTurn } from '@tangle-network/agent-runtime'

export async function POST({ request, env, ctx }: { request: Request; env: Env; ctx: ExecutionContext }) {
  const { workspaceId, threadId, userMessage } = await request.json()
  const box = await ensureWorkspaceSandbox(workspaceId)

  const result = handleChatTurn({
    identity: { tenantId: workspaceId, sessionId: threadId, userId: 'demo', turnIndex: 0 },
    hooks: {
      produce: () => ({
        stream: box.streamPrompt(userMessage),
        finalText: () => box.lastResponse(),
      }),
      persistAssistantMessage: async ({ identity, finalText }) => env.db.insertMessage(identity, finalText),
      traceFlush: () => env.traceSink.flush(),
    },
    waitUntil: ctx.waitUntil.bind(ctx),
  })
  return new Response(result.body, { headers: { 'content-type': result.contentType } })
}
```

That's the centerpiece. Everything else is "when chat alone isn't enough."

## Which entry point do I reach for?

```
Production chat turn (90% of products)     → handleChatTurn
Declarative agent manifest                 → defineAgent (/agent)
Cross-process reconnect (X-Execution-ID)   → deriveExecutionId
One-shot task with verification + eval     → runAgentTask
Streaming task without chat-turn envelope  → runAgentTaskStream
Multi-iteration parallel fanout (coders /
  researchers proposing N variants)        → runLoop + a Driver (/loops)
Tool/MCP delegation server (stdio)         → createMcpServer (/mcp)
Analyst surface mutations                  → runAnalystLoop (/analyst-loop)
Production-run persistence + cost ledger   → startRuntimeRun
Cross-site SSO / integrations hub          → PlatformAuthClient (/platform)
```

## Defaults

When nothing is specified:

| Knob | Default | Override |
|---|---|---|
| Backend model | `gpt-4o-mini` (when via `createOpenAICompatibleBackend`) | `model` option, or `MODEL_NAME` env |
| Backend provider | `openai-compat` when `TANGLE_API_KEY` present, else `openai` if `OPENAI_API_KEY` | `MODEL_PROVIDER` env |
| Router base URL | `https://router.tangle.tools/v1` | `TANGLE_ROUTER_BASE_URL` env |
| Sandbox base URL | `https://sandbox.tangle.tools` | `SANDBOX_API_URL` env |
| Loop iteration cap | 8 | `runLoop({ maxIterations })` |
| Driver | none — required to pass `Refine` or `FanoutVote` | `createRefineDriver()` or `createFanoutVoteDriver({ n })` |
| Validator | none — required if using `runLoop` | profile preset (e.g., `coderProfile().validator`) or your own |
| OTEL export | off | set `OTEL_EXPORTER_OTLP_ENDPOINT` |
| Trace propagation through MCP subprocess | off until product wires it | `env.TRACE_ID` + `env.PARENT_SPAN_ID` at MCP launch |

## Composition with the rest of the stack

```
agent-runtime  ────  handleChatTurn (chat turn lifecycle)
                     defineAgent    (declarative manifest)
                     runLoop        (multi-shot kernel)
                     createMcpServer (delegation tools server)
                     OTEL export    (trace pipeline)

agent-eval     ────  runEvalCampaign / runProductionLoop / runAgentMatrix
                     (consumes agent-runtime traces, scores, gates promotion)

agent-knowledge ───  proposeKnowledgeWrites / applyKnowledgeWriteBlocks
                     (analyst-loop produces these; runtime consumes them)

sandbox        ────  AgentProfile (substrate type), Sandbox.create, exportTraceBundle
                     (provides the harness execution surface)
```

Self-improving products consume all four. See [`agent-stack-adoption` skill](https://github.com/drewstone/dotfiles/blob/main/claude/skills/agent-stack-adoption/SKILL.md) for the end-to-end 10-phase adoption runbook.

## Examples

Ordered as a learning progression — each example introduces one concept.

**Start here:**
- [`chat-handler/`](./examples/chat-handler/) — `handleChatTurn`, the production centerpiece

**Add observability + readiness:**
- [`with-knowledge-readiness/`](./examples/with-knowledge-readiness/) — `requiredKnowledge` + `decideKnowledgeReadiness`
- [`sanitized-telemetry-streaming/`](./examples/sanitized-telemetry-streaming/) — `createRuntimeStreamEventCollector` + redaction
- [`runtime-run/`](./examples/runtime-run/) — `startRuntimeRun` + cost ledger persistence

**Add delegation:**
- [`mcp-delegation/`](./examples/mcp-delegation/) — mount `agent-runtime-mcp` in an `AgentProfile`

**Multi-agent fanout (advanced):**
- [`coder-loop/`](./examples/coder-loop/) — `coderProfile` + `runLoop` + `FanoutVote`
- [`researcher-loop/`](./examples/researcher-loop/) — `researcherProfile` + `runLoop` (peer dep: `@tangle-network/agent-knowledge`)
- [`fleet-delegation/`](./examples/fleet-delegation/) — `TANGLE_FLEET_ID` + `createFleetWorkspaceExecutor`

## Stability

Every public export is annotated `@stable` or `@experimental`. `@stable` exports do not change shape inside a minor. `@experimental` exports may change inside a minor and require a deliberate consumer bump.

## Package boundaries

| Package | Owns |
|---|---|
| `agent-runtime` | Task lifecycle, adapters, backends, chat-turn engine, model resolution, trace bridge, `defineAgent` |
| `agent-runtime/platform` | Cross-site SSO + integrations hub |
| `agent-runtime/agent` | `defineAgent` + surfaces / outcome adapters |
| `agent-runtime/analyst-loop` | `runAnalystLoop` — analyst registry driver |
| `agent-runtime/loops` | `runLoop` kernel + `Refine` / `FanoutVote` drivers |
| `agent-runtime/profiles` | `coderProfile`, `researcherProfile` presets |
| `agent-runtime/mcp` | `createMcpServer` + `agent-runtime-mcp` bin (5 delegation tools) |
| `agent-eval` | Evals, judges, scorecards, RL bridge, release evidence, matrix |
| `agent-knowledge` | Evidence, claims, wiki pages, retrieval |
| `sandbox` | `AgentProfile`, `Sandbox.create`, `streamPrompt`, `exportTraceBundle` |

See [`docs/concepts.md`](./docs/concepts.md) for the deeper mental model.

## Tests

```bash
pnpm test       # 283+ tests across the kernel + drivers + MCP + backends + analyst-loop
pnpm typecheck
pnpm build
```
