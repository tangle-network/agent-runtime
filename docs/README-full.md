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
| `createMcpServer` (`/mcp`) + `agent-runtime-mcp` bin | Stdio MCP server with the 5 delegation tools (`delegate_code`, `delegate_research`, `delegate_feedback`, `delegation_status`, `delegation_history`) |
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

## Delegation tools (MCP)

`@tangle-network/agent-runtime/mcp` ships a stdio MCP server that exposes
five delegation tools to a sandbox coding-harness agent (claude-code,
codex, opencode, ...). The product agent itself runs inside a sandbox
during a chat; when it needs a long-running coder or researcher loop, it
calls one of these tools instead of doing the work in-line.

| Tool | Kind | Use |
|---|---|---|
| `delegate_code` | async | Code-modification task — returns a `taskId`; poll `delegation_status` for the patch |
| `delegate_research` | async | Source-grounded research task — returns a `taskId`; poll for items + citations |
| `delegate_feedback` | sync | Append an agent/user/judge rating against a delegation, artifact, or outcome |
| `delegation_status` | sync | Snapshot of a delegation's state machine (`pending` → `running` → `completed` \| `failed` \| `cancelled`) |
| `delegation_history` | sync | Newest-first read of past delegations + attached feedback |

Mount the server from a Node entry point:

```ts
import { Sandbox } from '@tangle-network/sandbox'
import {
  createMcpServer,
  createDefaultCoderDelegate,
} from '@tangle-network/agent-runtime/mcp'

const sandboxClient = new Sandbox({ apiKey: process.env.TANGLE_API_KEY! })
const server = createMcpServer({
  coderDelegate: createDefaultCoderDelegate({ sandboxClient }),
  // researcherDelegate: wire your own — see below.
})
await server.serve() // reads JSON-RPC from stdin, writes responses to stdout
```

Or run the ready-made bin:

```bash
TANGLE_API_KEY=sk_sandbox_... agent-runtime-mcp
```

### Surfacing the tools through `createOpenAICompatibleBackend`

Sandbox callers discover MCP tools through the runtime mount. Callers that
route through the OpenAI-compat backend (tcloud, OpenRouter, cli-bridge,
OpenAI direct) must hand the model an explicit `tools[]` array — the
backend does not auto-discover. `mcpToolsForRuntimeMcp()` returns the
canonical projection so the model can call any of the 5 delegation tools
through the OpenAI-compat path:

```ts
import {
  createOpenAICompatibleBackend,
  mcpToolsForRuntimeMcp,
} from '@tangle-network/agent-runtime'

const backend = createOpenAICompatibleBackend({
  apiKey,
  baseUrl,
  model,
  tools: mcpToolsForRuntimeMcp(),
})
```

Use `mcpToolsForRuntimeMcpSubset(['delegate_research', 'delegation_status'])`
when you want a curated subset (e.g. read-only research without the coder
queue).

The bin auto-wires the coder delegate and, when
`@tangle-network/agent-knowledge` is installed as a peer, the researcher
delegate. Environment knobs:

- `TANGLE_API_KEY` — required (unless both `MCP_DISABLE_*` are set)
- `SANDBOX_BASE_URL` — sandbox-SDK base URL override
- `TANGLE_FLEET_ID` — switches placement from sibling-sandbox to fleet-workspace (see [Placement modes](#placement-modes))
- `TANGLE_FLEET_EXCLUDE_MACHINES` — comma-separated machine ids to skip during fleet-mode round-robin (typically the coordinator)
- `MCP_MAX_CONCURRENT_SANDBOXES` — kernel `maxConcurrency` cap (default 4)
- `MCP_CODER_FANOUT_HARNESSES` — comma-separated harness ids for `variants > 1`
- `MCP_DISABLE_CODER` / `MCP_DISABLE_RESEARCHER` — omit the matching tool

### Placement modes

Where worker iterations land — sibling sandboxes vs the caller's fleet
workspace — is controlled by `TANGLE_FLEET_ID`.

**Sibling-sandbox mode (default).** No `TANGLE_FLEET_ID` set. Every
`delegate_code` / `delegate_research` call invokes `sandboxClient.create(...)`
and runs the worker in a fresh sandbox. The worker's diff lives in the
worker's filesystem; the caller pulls it back via the structured tool
result. Use this when the MCP server runs as a standalone CLI mounted
outside a fleet (developer workflows, single-process integrations).

**Fleet-workspace mode.** `TANGLE_FLEET_ID` set by the parent sandbox when
it launches the MCP server. Each delegation dispatches onto an existing
machine in that fleet via `fleet.sandbox(machineId).streamPrompt(...)`.
The fleet's shared-workspace policy means worker machines mount the same
filesystem as the caller — diffs land in-place, no cross-sandbox copy
step. The bin logs `fleet-aware delegation: fleetId=...` to stderr on
startup so the operator can confirm the placement.

Pass `TANGLE_FLEET_ID` from a parent sandbox's `AgentProfile.mcpServers`
config:

```ts
import { defineAgentProfile } from '@tangle-network/sandbox'

const parentProfile = defineAgentProfile({
  name: 'tax-orchestrator',
  mcp: {
    'agent-runtime': {
      transport: 'stdio',
      command: 'agent-runtime-mcp',
      env: {
        TANGLE_API_KEY: '${TANGLE_API_KEY}',
        TANGLE_FLEET_ID: '${TANGLE_FLEET_ID}',          // injected by orchestrator
        TANGLE_FLEET_EXCLUDE_MACHINES: 'coordinator',    // skip the machine running this MCP server
      },
    },
  },
})
```

For non-bin entry points, wire an executor directly:

```ts
import { Sandbox } from '@tangle-network/sandbox'
import {
  createMcpServer,
  createDefaultCoderDelegate,
  createFleetWorkspaceExecutor,
  createSiblingSandboxExecutor,
  detectExecutor,
} from '@tangle-network/agent-runtime/mcp'

const sandboxClient = new Sandbox({ apiKey: process.env.TANGLE_API_KEY! })

// Either pick automatically from env:
const executor = await detectExecutor({ sandboxClient })

// Or pin it explicitly:
const fleet = await sandboxClient.fleets.get(process.env.TANGLE_FLEET_ID!)
const fleetExecutor = createFleetWorkspaceExecutor({
  fleet,
  excludeMachineIds: ['coordinator'],
})

const server = createMcpServer({
  coderDelegate: createDefaultCoderDelegate({ executor: fleetExecutor }),
})
```

The kernel emits a `loop.iteration.dispatch` trace event for every
iteration: `{ placement: 'sibling', sandboxId }` in sibling mode,
`{ placement: 'fleet', fleetId, machineId, sandboxId }` in fleet mode.
Analyst loops use this to correlate worker activity with the caller's
machine.

### Async semantics

Coder + researcher delegations are **fire-and-poll**. The handler returns
a `taskId` immediately; the agent calls `delegation_status(taskId)` until
the state is terminal. Identical inputs return the same `taskId` —
duplicate-call safety is built in via canonical-form hashing.

```
agent → delegate_code(goal, repoRoot)        → { taskId, estimatedDurationMs }
agent → delegation_status(taskId)            → { status: 'running', progress: { ... } }
... (minutes pass)
agent → delegation_status(taskId)            → { status: 'completed', result: { profile: 'coder', output: <CoderOutput> } }
agent → delegate_feedback(refersTo, rating)  → { recorded: true, id }
```

Task state lives in-memory inside the server process. A restart drops
pending delegations — Phase 2 will move state into sqlite.

### Wiring a researcher delegate

`agent-runtime` cannot depend on `@tangle-network/agent-knowledge` (it
would induce a dependency cycle). Wire the researcher delegate from your
own integration code:

```ts
import { runLoop } from '@tangle-network/agent-runtime/loops'
import { researcherProfile, multiHarnessResearcherFanout } from '@tangle-network/agent-knowledge/profiles'
import { createMcpServer, type ResearcherDelegate } from '@tangle-network/agent-runtime/mcp'

const researcherDelegate: ResearcherDelegate = async (args, ctx) => {
  const task = {
    question: args.question,
    knowledgeNamespace: args.namespace,
    scope: args.scope,
    sources: args.sources,
    /* ...map config.recencyWindow ISO strings to Date objects */
  }
  if ((args.variants ?? 1) <= 1) {
    const preset = researcherProfile({ task })
    const result = await runLoop({
      driver: { /* single-shot */ async plan(t, h) { return h.length === 0 ? [t] : [] }, decide(h) { return h.length > 0 ? 'pick-winner' : 'fail' } },
      agentRun: preset.agentRunSpec, output: preset.output, validator: preset.validator,
      task, ctx: { sandboxClient, signal: ctx.signal }, maxIterations: 1,
    })
    return result.winner!.output
  }
  const fanout = multiHarnessResearcherFanout({ task })
  const result = await runLoop({
    driver: fanout.driver,
    agentRuns: fanout.agentRuns.slice(0, args.variants),
    output: fanout.output, validator: fanout.validator,
    task, ctx: { sandboxClient, signal: ctx.signal },
    maxIterations: args.variants ?? 1,
  })
  return result.winner!.output
}

createMcpServer({ researcherDelegate })
```

## OpenAI-compat backend — tools + fail-loud errors

`createOpenAICompatibleBackend` forwards an OpenAI Chat Completions
`tools[]` array on every request when configured. Streamed tool calls
(both OpenAI delta shape and the Anthropic `tool_use` shape proxied by
the router) are assembled across SSE chunks and emitted as a single
`tool_call` RuntimeStreamEvent per call. The backend does NOT execute
tools — surfacing the call is the contract; dispatch is the caller's
problem.

```ts
import {
  createOpenAICompatibleBackend,
  runAgentTaskStream,
  type OpenAIChatTool,
} from '@tangle-network/agent-runtime'

const delegateResearch: OpenAIChatTool = {
  type: 'function',
  function: {
    name: 'delegate_research',
    description: 'Spin up a researcher loop and return a taskId.',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question'],
    },
  },
}

const backend = createOpenAICompatibleBackend({
  apiKey: process.env.TANGLE_API_KEY!,
  baseUrl: 'https://router.tangle.tools/v1',
  model: 'claude-sonnet-4-6',
  tools: [delegateResearch /* + delegate_code, delegate_feedback, etc. */],
  toolChoice: 'auto', // or 'none' | 'required' | { type: 'function', function: { name } }
})

for await (const event of runAgentTaskStream({ task, backend, input })) {
  if (event.type === 'tool_call') {
    // Dispatch through your MCP / sandbox runtime. `args` is JSON-parsed
    // when the model produced a valid object, raw string otherwise.
    const result = await dispatch(event.toolName, event.args)
    // Feed `result` back on a follow-up turn via `input.messages`.
  }
}
```

Callers integrating with `agent-runtime/mcp` typically project the MCP
server's `tools/list` response into this shape once at config time and
pass the array as `tools`. The runtime intentionally does NOT depend on
`@modelcontextprotocol/sdk` — keeping the backend transport thin lets
domain repos own MCP plumbing.

### Transport errors fail loud

Non-success HTTP responses (4xx/5xx after retry exhaustion) and
connection failures throw `BackendTransportError` from inside the
`stream()` generator. `runAgentTaskStream` catches the throw and emits:

- `backend_error` event with `error: { kind: 'transport', message, status, body }`
- terminal `final` event with `status: 'failed'` carrying the same `error` detail

Consumers building a `RunRecord` MUST map `final.error` onto
`RunRecord.error`. Treating an empty `finalText` as "agent produced
nothing" hides credit exhaustion (HTTP 402), auth failure (401),
model-not-found (404), and upstream outages (5xx).

```ts
for await (const event of runAgentTaskStream({ task, backend, input })) {
  run.observe(event)
  if (event.type === 'final') {
    run.complete({
      status: event.status === 'completed' ? 'completed' : 'failed',
      resultSummary: event.text ?? '',
      error: event.error
        ? `${event.error.kind} ${event.error.status ?? ''}: ${event.error.message}`
        : undefined,
    })
  }
}
```

The body is captured truncated to 2 KiB. By default the sanitized
telemetry envelope surfaces `error.kind` + `error.status` but redacts
`error.body` (it can echo user-visible text from a provider's error
page). Opt in with `RuntimeTelemetryOptions.includeControlPayloads`.

## Error taxonomy

| Error | When |
|---|---|
| `ValidationError` | Caller passed invalid arguments |
| `ConfigError` | Required env / config missing |
| `NotFoundError` | A named resource does not exist |
| `BackendTransportError` | Backend HTTP / IPC call returned non-success — carries `status` + truncated `body` |
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
- [`coder-loop/`](./examples/coder-loop/) — `coderProfile` + `runLoop` + `FanoutVote` (driven-loop kernel)
- [`researcher-loop/`](./examples/researcher-loop/) — `researcherProfile` + `runLoop` + `FanoutVote` (peer dep: `@tangle-network/agent-knowledge`)
- [`mcp-delegation/`](./examples/mcp-delegation/) — mount `agent-runtime-mcp` in a product `AgentProfile` + stdio `tools/list` smoke
- [`fleet-delegation/`](./examples/fleet-delegation/) — `TANGLE_FLEET_ID` env flip + `createFleetWorkspaceExecutor` topology

## Tests

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
