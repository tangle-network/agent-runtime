# @tangle-network/agent-runtime

The shared task-lifecycle skeleton for agents. It runs an agent (a chat turn, a one-shot task, or a multi-attempt loop), captures every run as a trace, and feeds those traces into eval-gated self-improvement.

It owns the lifecycle and the loop kernel. It delegates domain behavior (models, tools, knowledge) to adapters, scoring and the ship gate to [`@tangle-network/agent-eval`](https://www.npmjs.com/package/@tangle-network/agent-eval), and sandboxed long-running execution to [`@tangle-network/sandbox`](https://www.npmjs.com/package/@tangle-network/sandbox).

```bash
pnpm add @tangle-network/agent-runtime @tangle-network/agent-eval @tangle-network/sandbox
```

## The model

One recursive `Agent` atom, run at two timescales, over many tasks. `docs/architecture.md` is the canonical spine. The short version:

1. **One atom.** `driver`, `worker`, `selector`, and `coordinator` are not separate types. They are what a single `Agent` returns from `act`. The recursion bottoms out at execution.
2. **Two timescales, one machinery.** The same loop runs at inference time (steer a worker over k attempts) and at optimization time (search the steer or the prompt with GEPA, gated on a held-out split).
3. **A benchmark is an adapter.** A new task is a loader plus a worker plus a judge. The loop, the drivers, the corpus, and the selector are the shared spine, written once.
4. **The selector is not the judge.** At inference time the selector picks which answer to return without seeing the judge's verdict. The judge is write-only. A steer may read the trace but never the verdict (the firewall that keeps the loop from gaming its own score).

## Getting started

Every product agent is a `handleChatTurn` call inside a route. This is what the gtm, creative, legal, and tax products run in production:

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

That is the common case. Everything below is for when one chat turn is not enough: multi-attempt loops, delegation, optimization, and the telemetry that makes them auditable.

## Which entry point do I reach for?

| You want to | Reach for | Subpath |
|---|---|---|
| Run a production chat turn (most products) | `handleChatTurn` | root |
| Declare an agent (profile, surfaces, adapters) | `defineAgent` | `/agent` |
| Run a one-shot task with verification and eval | `runAgentTask` | root |
| Run a multi-attempt loop (refine or fanout-vote) | `runLoop` plus a driver | `/loops` |
| Let the agent choose the loop shape per round | `createDynamicDriver` plus `createSandboxPlanner` | `/loops` |
| Delegate a disciplined loop by mode (code, research, ...) | `runDelegatedLoop` or `agent-runtime-loop` | root |
| Build code reliably (reviewed, gated) | `createDefaultCoderDelegate` | `/mcp` |
| Grow a knowledge base with only grounded facts | `createKbGate` | `/mcp` |
| Improve a prompt safely (identity-gated) | `optimizePrompt` | `/improvement` |
| Ship loop traces to a GenAI viewer | `buildLoopOtelSpans` plus `createOtelExporter` | root |
| Expose delegation as MCP tools to a sandbox agent | `createMcpServer` or `agent-runtime-mcp` | `/mcp` |
| Mutate surfaces from trace findings | `runAnalystLoop` | `/analyst-loop` |
| Persist a run plus its cost ledger | `startRuntimeRun` | root |

## The loop kernel

`runLoop` is a topology-agnostic kernel. Each iteration spawns a sandbox on an `AgentRunSpec`, decodes the output, validates it, and asks a driver what to do next. The driver owns topology. The validator owns scoring. The kernel owns iteration accounting, concurrency, cost and token aggregation, and trace emission.

```ts
import { runLoop, createFanoutVoteDriver } from '@tangle-network/agent-runtime/loops'

const result = await runLoop({
  driver: createFanoutVoteDriver({ n: 3 }),    // 3 parallel attempts, pick the best valid one
  agentRuns: [claudeSpec, codexSpec, glmSpec], // heterogeneous: one harness per branch
  output,                                       // events to typed Output
  validator,                                    // Output to { valid, score }
  task,
  ctx: { sandboxClient: sandbox },
})
result.winner // highest-scoring valid attempt
```

Shipped drivers (`/loops/drivers`): `createRefineDriver` (single task, iterate until valid), `createFanoutVoteDriver` (N parallel, vote), and `createDynamicDriver` (the agent authors the topology at runtime). The dynamic driver emits one `TopologyMove` per round (`refine`, `fanout`, or `stop`) from an injected planner; a malformed move throws `PlannerError`, so the loop never runs a topology nobody chose. Topology is orthogonal to harness: the planner never names a backend, and the kernel's `agentRuns` decide which harness runs each branch.

`runProgram` (also in `/loops`) is the recursive op-set (`sample`, `steer`, `fork`, `parallel`, `select`, `seq`, `stop`) plus a tree executor, for programs that compose sub-loops.

## Self-improvement

The same machinery, run at the optimization timescale.

`optimizePrompt` (`/improvement`) optimizes any text prompt over agent-eval's `runImprovementLoop`, identity-gated by construction. It runs evals, proposes candidates (default `gepaDriver`), and a held-out gate compares candidate against baseline. `result.prompt` is the baseline unless the gate decided `ship`, so registering a prompt for optimization can never regress it.

```ts
import { optimizePrompt } from '@tangle-network/agent-runtime/improvement'

const { prompt, improved, delta } = await optimizePrompt({
  baselinePrompt: CURRENT_SYSTEM_PROMPT,
  runWithPrompt: (candidate, scenario, ctx) => runYourThing(candidate, scenario),
  scenarios, holdoutScenarios, judges, runDir,
  reflection: { llm, model: 'claude-sonnet-4-6' },
})
// assign `prompt` unconditionally; it is the safe one
```

`runAnalystLoop` (`/analyst-loop`) mines real run traces into findings; `createAnalystDriverHook` feeds those findings to a dynamic-driver planner via `PlannerContext.analyses`, with a firewall (`assertTraceDerivedFindings`) that rejects any finding derived from a judge verdict. `reportOptimizationRun` (`/improvement`) ships an optimization run's proposal and verdict to Tangle Intelligence over the eval-run wire.

## Delegated loops

`runDelegatedLoop` is one entrypoint a worker agent or a scheduled routine calls to run a disciplined loop in a chosen mode, over the hardened engines below. It fails loud on an unwired mode; a thrown engine is captured as `{ ok: false }`, so unattended runs record rather than crash.

```ts
import { runDelegatedLoop, coderLoopRunner, researchLoopRunner, type DelegatedLoopRegistry } from '@tangle-network/agent-runtime'

const registry: DelegatedLoopRegistry = {
  code: coderLoopRunner({ sandboxClient, args: { goal: 'fix the flaky retry test', repoRoot: '/repo' }, reviewer, winnerSelection: 'smallest-diff' }),
  research: researchLoopRunner({ research, gate: { selfArtifactKinds: ['spec'] }, maxRounds: 3 }),
}
const result = await runDelegatedLoop('code', registry)
```

Modes: `code`, `review`, `research`, `audit`, `self-improve`, `dynamic`. The `agent-runtime-loop` bin runs the registry from a cron or routine and exits 0 (ok), 1 (recorded failure), or 2 (usage or config error).

The coder delegate (`createDefaultCoderDelegate`, `/mcp`) has default-on safety gates: no-op rejection (an empty patch cannot pass trivially), an always-on secret-path floor (`.env`, keys, wallets), an optional `reviewer` gate, and a `winnerSelection` policy (`highest-score`, `smallest-diff`, `highest-readiness`, `first-approved`).

The knowledge-base gate (`createKbGate`, `/mcp`) is fail-closed: a fact's `verbatimPassage` must appear in its `sourceText`, the asserted value must be in the passage, and citations cannot point at self-generated artifacts. `researchLoopRunner` wraps it with a correct-on-veto loop that re-researches the vetoed gaps up to `maxRounds`, then returns the unverified ones rather than dropping them.

## Tracing

`runLoop` emits a structured event stream. `buildLoopOtelSpans` turns it into a nested, real-duration span tree that any GenAI trace viewer (Phoenix, Langfuse, Grafana Tempo, Tangle Intelligence) renders natively. Attributes follow the current GenAI semantic conventions (`gen_ai.operation.name`, `gen_ai.agent.name`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`) plus a `tangle.loop.*` extension for the topology (move kind and rationale, edge lineage, verdict, placement, cost).

```ts
import { buildLoopOtelSpans, createOtelExporter } from '@tangle-network/agent-runtime'

const exporter = createOtelExporter() // reads OTEL_EXPORTER_OTLP_ENDPOINT
for (const span of buildLoopOtelSpans(loopEvents, traceId)) exporter?.exportSpan(span)
await exporter?.flush()
```

The shape: `loop` to `loop.round` (move plus rationale) to `loop.iteration` (agent, usage, verdict, cost, parent edge).

## MCP delegation server

Expose the delegation tools (`delegate_code`, `delegate_research`, `delegate_feedback`, `delegation_status`, `delegation_history`) to a sandbox coding agent. Mount the canonical server instead of forking delegation logic.

```ts
import { createMcpServer, createDefaultCoderDelegate } from '@tangle-network/agent-runtime/mcp'

const server = createMcpServer({ coderDelegate: createDefaultCoderDelegate({ sandboxClient }), researcherDelegate })
```

Or mount the `agent-runtime-mcp` stdio bin on a production `AgentProfile.mcp`.

## The experiment harness (bench/)

`bench/` is the internal harness that asks the binding empirical question: does any non-blind topology beat blind compute at equal k, under a deployable (non-oracle) selector, on a real benchmark? It runs through the same kernel, not a reimplementation.

One entrypoint, `runExperiment(adapter, { sandboxClient, agentRun, arms, ... })`: N instances times a set of arms, each arm a topology driven through `runLoop`, judged by the adapter, written to a durable canonical corpus. An arm is one steer function `f(rootPrompt, history) => nextPrompt`: `random` ignores history (the compute control), `refine` carries the prior answer plus a directive, `diverse` rotates a strategy lens. The cost dial is the backend type (`hermes` for a direct router call, `opencode` or `claude-code` or `codex` for agent CLIs). The deep statistics (paired bootstrap with Benjamini-Hochberg correction, selector replay) come from `corpus-report.mts` and `corpus-replay.mts` over the written corpus, computed once. See `bench/HARNESS.md` and `docs/learning-flywheel.md`.

## Defaults

| Knob | Default | Override |
|---|---|---|
| Backend model | `gpt-4o-mini` (via `createOpenAICompatibleBackend`) | `model` option or `MODEL_NAME` env |
| Backend provider | `openai-compat` when `TANGLE_API_KEY`, else `openai` if `OPENAI_API_KEY` | `MODEL_PROVIDER` env |
| Router base URL | `https://router.tangle.tools/v1` | `TANGLE_ROUTER_BASE_URL` env |
| Sandbox base URL | `https://sandbox.tangle.tools` | `SANDBOX_API_URL` env |
| Loop iteration cap | 10 (`runLoop`), 8 (dynamic driver) | `runLoop({ maxIterations })` |
| Driver | none, required by `runLoop` | `createRefineDriver`, `createFanoutVoteDriver`, `createDynamicDriver` |
| Winner selection (coder delegate) | `highest-score` | `winnerSelection` option |
| KB gate min passage | 12 chars | `createKbGate({ minPassageChars })` |
| `optimizePrompt` gate | `heldOutGate` | `defaultProductionGate` for red-team hardening |
| OTEL export | off | set `OTEL_EXPORTER_OTLP_ENDPOINT` |
| Loop-runner mode failure | recorded as `{ ok: false }` | `runDelegatedLoop` never crashes on a thrown engine |

## Composition with the stack

```
agent-runtime   handleChatTurn, runLoop + drivers, runProgram, runDelegatedLoop, createMcpServer,
                optimizePrompt, createKbGate, buildLoopOtelSpans, defineAgent

agent-eval      runEvalCampaign, runImprovementLoop (gepaDriver), heldOutGate, runAgentMatrix.
                Consumes runtime traces, scores, gates promotion. agent-runtime depends on it,
                never the reverse.

agent-knowledge proposeKnowledgeWrites, applyKnowledgeWriteBlocks. The analyst loop produces
                these; the runtime and createKbGate consume them.

sandbox         AgentProfile, Sandbox.create, streamPrompt, exportTraceBundle. The harness
                execution surface every loop runs on.
```

## Subpath exports

| Import | Owns |
|---|---|
| `@tangle-network/agent-runtime` | chat turns, delegated loop-runner, OTEL export, errors, model resolution |
| `.../agent` | `defineAgent` plus surface and outcome adapters |
| `.../loops` | the `runLoop` kernel, the `refine` / `fanout-vote` / `dynamic` drivers, `runProgram`, `loopDispatch` |
| `.../profiles` | `coderProfile`, `researcherProfile` presets |
| `.../mcp` | `createMcpServer`, `createDefaultCoderDelegate`, `createKbGate`, the `agent-runtime-mcp` bin |
| `.../improvement` | `optimizePrompt` (text), `improvementDriver` (code/worktree), `reportOptimizationRun` |
| `.../analyst-loop` | `runAnalystLoop`, the analyst registry driver |
| `.../platform` | cross-site SSO and the integrations hub |

Bins: `agent-runtime-mcp` (delegation MCP server), `agent-runtime-loop` (schedulable delegated loop-runner).

## Adoption skill

This package ships a self-contained adoption skill at [`skills/agent-runtime-adoption/SKILL.md`](./skills/agent-runtime-adoption/SKILL.md): driven loops, topology drivers, the `loopDispatch` campaign bridge, MCP delegation, and identity-gated `optimizePrompt`. It needs only this package plus `@tangle-network/agent-eval`. For the full self-improving pipeline (trace sink, analyst loop, scorecard, production loop, CI), see the `agent-eval-adoption` and `agent-stack-adoption` skills.

## Stability, tests, docs

Every public export is annotated `@stable` or `@experimental`. `@stable` exports do not change shape inside a minor version; `@experimental` ones may, and require a deliberate consumer bump.

```bash
pnpm test       # kernel, drivers, MCP, delegate hardening, kb-gate, loop-runner, backends
pnpm typecheck
pnpm build
```

Deeper docs: [`docs/architecture.md`](./docs/architecture.md) (the canonical spine), [`docs/learning-flywheel.md`](./docs/learning-flywheel.md) (the self-improvement thesis and the open gate), [`docs/concepts.md`](./docs/concepts.md) (mental model), [`docs/agent-bus-protocol.md`](./docs/agent-bus-protocol.md) (cross-gateway header contract), [`docs/conversation-economics.md`](./docs/conversation-economics.md) (who pays), [`docs/durability-adapters.md`](./docs/durability-adapters.md) (SQL-backed `ConversationJournal`).
