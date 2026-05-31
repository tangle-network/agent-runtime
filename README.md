# @tangle-network/agent-runtime

The task-lifecycle substrate for domain agents. It owns the **chat-turn engine**, the **driven-loop kernel** (refine / fanout-vote / agent-authored *dynamic* topologies), **delegated loops** (build-in-a-loop, valid-only research, review, audit, self-improve), **identity-gated prompt optimization**, **OpenTelemetry GenAI tracing**, knowledge readiness, sanitized telemetry, and the declarative `defineAgent` manifest — and delegates domain behavior (models, tools, KB) to adapters. Long-running execution durability lives in [`@tangle-network/sandbox`](https://www.npmjs.com/package/@tangle-network/sandbox); evals + gates in [`@tangle-network/agent-eval`](https://www.npmjs.com/package/@tangle-network/agent-eval).

```bash
pnpm add @tangle-network/agent-runtime @tangle-network/agent-eval @tangle-network/sandbox
```

---

## Contents

- [Getting started](#getting-started) — the 20-line production chat turn
- [Which entry point do I reach for?](#which-entry-point-do-i-reach-for)
- [Capabilities](#capabilities)
  - [1. Chat turns — `handleChatTurn`](#1-chat-turns--handlechatturn)
  - [2. Driven loops + topology drivers](#2-driven-loops--topology-drivers)
  - [3. Agent-authored topology — `createDynamicDriver`](#3-agent-authored-topology--createdynamicdriver)
  - [4. Delegated loop-runner — `runDelegatedLoop`](#4-delegated-loop-runner--rundelegatedloop)
  - [5. Reliable build-in-a-loop — the coder delegate](#5-reliable-build-in-a-loop--the-coder-delegate)
  - [6. Valid-only research — `createKbGate`](#6-valid-only-research--createkbgate)
  - [7. Identity-gated prompt optimization — `optimizePrompt`](#7-identity-gated-prompt-optimization--optimizeprompt)
  - [8. OpenTelemetry GenAI topology tracing](#8-opentelemetry-genai-topology-tracing)
  - [9. MCP delegation server — `agent-runtime-mcp`](#9-mcp-delegation-server--agent-runtime-mcp)
- [Defaults](#defaults)
- [Composition with the stack](#composition-with-the-stack)
- [Subpath exports](#subpath-exports)
- [Adoption skill](#adoption-skill)
- [Stability · Tests · Docs](#stability--tests--docs)

---

## Getting started

Every product agent is a `handleChatTurn` call inside a route. This is what gtm / creative / legal / tax all run in production:

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

That's the centerpiece. Everything below is *"when one chat turn isn't enough"* — multi-shot loops, delegation, optimization, and the telemetry that makes them auditable.

---

## Which entry point do I reach for?

| You want to… | Reach for | Subpath |
|---|---|---|
| Run a production chat turn (90% of products) | `handleChatTurn` | root |
| Declare an agent (profile + surfaces + adapters) | `defineAgent` | `/agent` |
| One-shot task with verification + eval | `runAgentTask` | root |
| Multi-shot loop (refine / fanout-vote) | `runLoop` + a driver | `/loops` |
| Let the **agent choose** the loop shape per round | `createDynamicDriver` + `createSandboxPlanner` | `/loops` |
| Delegate a disciplined loop by mode (code/research/…) | `runDelegatedLoop` / `agent-runtime-loop` | root |
| Build code reliably (reviewed, gated) | `createDefaultCoderDelegate` | `/mcp` |
| Grow a KB with only grounded facts | `createKbGate` | `/mcp` |
| Improve a prompt safely (identity-gated) | `optimizePrompt` | `/improvement` |
| Ship loop traces to a GenAI viewer | `buildLoopOtelSpans` + `createOtelExporter` | root |
| Expose delegation as MCP tools to a sandbox agent | `createMcpServer` / `agent-runtime-mcp` | `/mcp` |
| Mutate surfaces from trace findings | `runAnalystLoop` | `/analyst-loop` |
| Persist a run + cost ledger | `startRuntimeRun` | root |

---

## Capabilities

### 1. Chat turns — `handleChatTurn`

The production turn envelope: frames a producer with the `session.run.*` NDJSON protocol, the persist → post-process → trace-flush hook order, and a stable execution id for client-retry replay. See [Getting started](#getting-started) and [`examples/chat-handler/`](./examples/chat-handler/).

### 2. Driven loops + topology drivers

`runLoop` is a topology-agnostic kernel: each iteration spawns a sandbox on an `AgentRunSpec`, decodes the output, validates it, and asks a **driver** what to do next. The driver owns topology; the validator owns scoring; the kernel owns iteration accounting, concurrency, cost/token aggregation, and trace emission.

```ts
import { runLoop, createFanoutVoteDriver } from '@tangle-network/agent-runtime/loops'

const result = await runLoop({
  driver: createFanoutVoteDriver({ n: 3 }),       // 3 parallel attempts, pick the best valid one
  agentRuns: [claudeSpec, codexSpec, glmSpec],    // heterogeneous: one harness per branch
  output,                                          // events → typed Output
  validator,                                       // Output → { valid, score }
  task,
  ctx: { sandboxClient: sandbox },
})
result.winner // highest-scoring valid attempt
```

Shipped drivers (`/loops/drivers`): **`createRefineDriver`** (single task, iterate until valid) and **`createFanoutVoteDriver`** (N parallel, vote). See [`examples/coder-loop/`](./examples/coder-loop/) and [`examples/researcher-loop/`](./examples/researcher-loop/).

### 3. Agent-authored topology — `createDynamicDriver`

The third driver lets the **agent author the loop topology at runtime** — refine, fan out, or stop, decided per round by an injected planner. Topology is orthogonal to harness: the planner never names a backend; the kernel's `agentRuns` round-robin decides which harness runs each branch.

```ts
import { runLoop, createDynamicDriver, createSandboxPlanner } from '@tangle-network/agent-runtime/loops'

const planner = createSandboxPlanner({
  client: sandbox,
  profile: { name: 'planner', metadata: { backendType: 'claude-code' } }, // cheap model is fine
  decodeTask: (raw) => raw as Task,
})

const result = await runLoop({
  driver: createDynamicDriver({ planner, maxIterations: 8 }),
  agentRuns: [claudeSpec, codexSpec],   // the planner can fan a single round across both
  output, validator, task,
  ctx: { sandboxClient: sandbox },
})
```

The planner emits one `TopologyMove` per round (`refine` | `fanout` | `stop`) with a rationale; a malformed move throws `PlannerError` (the loop never runs a topology nobody chose).

### 4. Delegated loop-runner — `runDelegatedLoop`

One configured entrypoint a worker agent (or a scheduled routine) calls to run a disciplined loop in a chosen **mode**, over the hardened engines below. Fail-loud on an unwired mode; a thrown engine is captured as `{ ok: false }` so unattended runs *record* rather than crash.

```ts
import {
  runDelegatedLoop, coderLoopRunner, researchLoopRunner, type DelegatedLoopRegistry,
} from '@tangle-network/agent-runtime'

const registry: DelegatedLoopRegistry = {
  code: coderLoopRunner({
    sandboxClient,
    args: { goal: 'fix the flaky retry test', repoRoot: '/repo' },
    reviewer,                       // optional adversarial gate
    winnerSelection: 'smallest-diff',
  }),
  research: researchLoopRunner({ research, gate: { selfArtifactKinds: ['spec'] }, maxRounds: 3 }),
}

const result = await runDelegatedLoop('code', registry)
// → { mode: 'code', ok: true, output: CoderOutput, durationMs }
```

Modes: `code` · `review` · `research` · `audit` · `self-improve` · `dynamic` — each with a default factory (`coderLoopRunner`, `reviewLoopRunner`, `researchLoopRunner`, `dynamicLoopRunner`, `selfImproveLoopRunner`, `auditLoopRunner`).

**Schedulable**: the `agent-runtime-loop` bin runs it from a cron/routine. The config module wires the registry (with full env/creds access):

```bash
agent-runtime-loop --mode research --config ./loops.config.js
# exits 0 (ok) · 1 (recorded failure) · 2 (usage/config error); prints the result as JSON
```

```ts
// loops.config.js — default-exports a DelegatedLoopRegistry (or a factory)
import { researchLoopRunner } from '@tangle-network/agent-runtime'
export default { research: researchLoopRunner({ research: myResearchEngine, maxRounds: 3 }) }
```

### 5. Reliable build-in-a-loop — the coder delegate

`createDefaultCoderDelegate` drives a coder loop with **default-on safety gates** so it never ships junk:

- **no-op rejection** — an empty patch can't "pass" trivially,
- **secret-path floor** — always-on, independent of `forbiddenPaths` (`.env`, keys, wallets, …),
- optional **`reviewer`** gate — a candidate must pass tests/typecheck **and** be approved to win,
- **`winnerSelection`** — `highest-score` (default) · `smallest-diff` · `highest-readiness` · `first-approved`.

```ts
import { createDefaultCoderDelegate } from '@tangle-network/agent-runtime/mcp'

const coder = createDefaultCoderDelegate({
  sandboxClient,
  fanoutHarnesses: ['claude-code', 'codex'],
  reviewer: async (output, task) => ({ approved: output.testResult.passed, recommendation: 'ship', readiness: 0.9 }),
  winnerSelection: 'highest-readiness',
})
const out = await coder({ goal: 'add a retry with backoff', repoRoot: '/repo', variants: 2 }, ctx)
```

See [`examples/coder-loop/`](./examples/coder-loop/) and [`examples/agent-into-reviewer/`](./examples/agent-into-reviewer/).

### 6. Valid-only research — `createKbGate`

A fail-closed gate so a knowledge base grows with **only grounded facts**. The always-on floor: a fact's `verbatimPassage` must literally appear in its `sourceText` (anti-hallucination), the asserted value must be in the passage, and citations can't point at self-generated artifacts (laundering). Plug in your own judges; verdict-only (remediation is yours).

```ts
import { createKbGate } from '@tangle-network/agent-runtime/mcp'

const gate = createKbGate({ selfArtifactKinds: ['spec', 'cad_params'] })
const verdict = await gate({
  claim: 'revenue was $1.2B in 2025',
  value: 1_200_000_000,
  verbatimPassage: 'total revenue was $1,200,000,000 for the fiscal year',
  sourceText: rawSource,
})
if (verdict.accepted) writeToKb(fact)
else console.warn('vetoed by', verdict.vetoedBy, verdict.reason)
```

`researchLoopRunner` (mode `research`) wraps this with a correct-on-veto remediation loop: research → gate → re-research the vetoed gaps up to `maxRounds`, then **return** the unverified ones (escalate, never silently drop).

### 7. Identity-gated prompt optimization — `optimizePrompt`

Optimize any text prompt over agent-eval's `runImprovementLoop`, **identity-gated by construction**: it runs evals, proposes candidates (default `gepaDriver`), and the held-out gate compares candidate vs baseline. `result.prompt` is the **baseline unless the gate decided `ship`** — so registering a prompt for optimization can never regress it.

```ts
import { optimizePrompt } from '@tangle-network/agent-runtime/improvement'

const { prompt, improved, delta } = await optimizePrompt({
  baselinePrompt: CURRENT_SYSTEM_PROMPT,
  runWithPrompt: (candidate, scenario, ctx) => runYourThing(candidate, scenario),
  scenarios, holdoutScenarios, judges, runDir,
  reflection: { llm, model: 'claude-sonnet-4-6' },
})
// assign `prompt` unconditionally — it's the safe one
```

See [`examples/self-improving-loop/`](./examples/self-improving-loop/).

### 8. OpenTelemetry GenAI topology tracing

`runLoop` emits a structured event stream; `buildLoopOtelSpans` turns it into a **nested, real-duration span tree** that any GenAI trace viewer (Phoenix, Langfuse, Grafana Tempo, Tangle Intelligence) renders natively. Attributes follow the current GenAI semantic conventions (`gen_ai.operation.name`, `gen_ai.agent.name`, `gen_ai.usage.input_tokens/output_tokens`) plus a `tangle.loop.*` extension for the topology (move kind/rationale, edge lineage, verdict, placement, cost).

```ts
import { buildLoopOtelSpans, createOtelExporter } from '@tangle-network/agent-runtime'

const exporter = createOtelExporter() // reads OTEL_EXPORTER_OTLP_ENDPOINT
for (const span of buildLoopOtelSpans(loopEvents, traceId)) exporter?.exportSpan(span)
await exporter?.flush()
```

The shape: `loop → loop.round (move + rationale) → loop.iteration (agent, usage, verdict, cost, parent edge)`. See [`examples/with-intelligence-export/`](./examples/with-intelligence-export/).

### 9. MCP delegation server — `agent-runtime-mcp`

Expose the five delegation tools (`delegate_code`, `delegate_research`, `delegate_feedback`, `delegation_status`, `delegation_history`) to a sandbox coding-harness agent — mount the canonical server, don't fork delegation logic.

```ts
import { createMcpServer, createDefaultCoderDelegate } from '@tangle-network/agent-runtime/mcp'

const server = createMcpServer({
  coderDelegate: createDefaultCoderDelegate({ sandboxClient }),
  researcherDelegate, // wire your KB-backed researcher
})
```

Or mount the `agent-runtime-mcp` stdio bin on a production `AgentProfile.mcp`. See [`examples/mcp-delegation/`](./examples/mcp-delegation/) and [`examples/fleet-delegation/`](./examples/fleet-delegation/).

---

## Defaults

When nothing is specified:

| Knob | Default | Override |
|---|---|---|
| Backend model | `gpt-4o-mini` (via `createOpenAICompatibleBackend`) | `model` option / `MODEL_NAME` env |
| Backend provider | `openai-compat` when `TANGLE_API_KEY`, else `openai` if `OPENAI_API_KEY` | `MODEL_PROVIDER` env |
| Router base URL | `https://router.tangle.tools/v1` | `TANGLE_ROUTER_BASE_URL` env |
| Sandbox base URL | `https://sandbox.tangle.tools` | `SANDBOX_API_URL` env |
| Loop iteration cap | 10 (`runLoop`); dynamic driver 8 | `runLoop({ maxIterations })` |
| Driver | none — required by `runLoop` | `createRefineDriver` / `createFanoutVoteDriver` / `createDynamicDriver` |
| Winner selection (coder delegate) | `highest-score` | `winnerSelection` option |
| KB gate min passage | 12 chars | `createKbGate({ minPassageChars })` |
| `optimizePrompt` gate | `heldOutGate` | `defaultProductionGate` for red-team hardening |
| OTEL export | off | set `OTEL_EXPORTER_OTLP_ENDPOINT` |
| Loop-runner mode failure | recorded as `{ ok: false }` | `runDelegatedLoop` never crashes on a thrown engine |

---

## Composition with the stack

```
agent-runtime  ──  handleChatTurn · runLoop + drivers · runDelegatedLoop · createMcpServer
                   optimizePrompt · createKbGate · buildLoopOtelSpans · defineAgent

agent-eval     ──  runEvalCampaign · runImprovementLoop (gepaDriver) · heldOutGate · runAgentMatrix
                   (consumes runtime traces, scores, gates promotion)

agent-knowledge ─  proposeKnowledgeWrites / applyKnowledgeWriteBlocks
                   (analyst-loop produces these; runtime + createKbGate consume them)

sandbox        ──  AgentProfile · Sandbox.create · streamPrompt · exportTraceBundle
                   (the harness execution surface every loop runs on)
```

---

## Subpath exports

| Import | Owns |
|---|---|
| `@tangle-network/agent-runtime` | chat turns, delegated loop-runner, OTEL export, errors, model resolution |
| `…/agent` | `defineAgent` + surfaces / outcome adapters |
| `…/loops` | `runLoop` kernel + `refine` / `fanout-vote` / **`dynamic`** drivers + `loopDispatch` |
| `…/profiles` | `coderProfile`, `researcherProfile` presets |
| `…/mcp` | `createMcpServer`, `createDefaultCoderDelegate`, **`createKbGate`**, `agent-runtime-mcp` bin |
| `…/improvement` | **`optimizePrompt`** (text) + `improvementDriver` (code/worktree) |
| `…/analyst-loop` | `runAnalystLoop` — analyst registry driver |
| `…/platform` | cross-site SSO + integrations hub |

Bins: `agent-runtime-mcp` (delegation MCP server) · `agent-runtime-loop` (schedulable delegated loop-runner).

---

## Adoption skill

This package ships a **self-contained adoption skill** at [`skills/agent-runtime-adoption/SKILL.md`](./skills/agent-runtime-adoption/SKILL.md) — driven loops, topology drivers, the `loopDispatch` campaign bridge, MCP delegation, and identity-gated `optimizePrompt`. It needs only this package + `@tangle-network/agent-eval`, so external consumers need nothing private. For the full self-improving pipeline (trace sink → analyst loop → scorecard → production loop → CI), see the `agent-eval-adoption` / `agent-stack-adoption` skills.

---

## Stability · Tests · Docs

Every public export is annotated `@stable` or `@experimental`. `@stable` exports don't change shape inside a minor; `@experimental` ones may and require a deliberate consumer bump.

```bash
pnpm test       # full suite across the kernel, drivers, MCP, delegate hardening, kb-gate, loop-runner, backends
pnpm typecheck
pnpm build
```

Deeper docs: [`docs/concepts.md`](./docs/concepts.md) (mental model) · [`docs/agent-bus-protocol.md`](./docs/agent-bus-protocol.md) (cross-gateway header contract) · [`docs/conversation-economics.md`](./docs/conversation-economics.md) (who pays — `authSource`) · [`docs/durability-adapters.md`](./docs/durability-adapters.md) (SQL-backed `ConversationJournal`).
