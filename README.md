# @tangle-network/agent-runtime

The shared task-lifecycle skeleton for agents. It runs an agent (a chat turn, a one-shot task, or a multi-attempt loop), captures every run as a trace, and feeds those traces into eval-gated self-improvement.

It owns the lifecycle, the loop kernel, and the **optimization suite** — `Environment` + `Strategy` +
`runBenchmark` + `runStrategyEvolution`, the published surface for measuring and evolving how an agent
spends compute against a deployable check. It delegates domain behavior (models, tools, knowledge) to
adapters, scoring statistics and the ship gate to [`@tangle-network/agent-eval`](https://www.npmjs.com/package/@tangle-network/agent-eval), and sandboxed long-running execution to [`@tangle-network/sandbox`](https://www.npmjs.com/package/@tangle-network/sandbox).

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
| Compare optimization strategies on YOUR domain (5 hooks) | `runBenchmark` + `defineStrategy` | `/loops` |
| Let the system author + evolve its own strategies, gated | `runStrategyEvolution` · `authorStrategy` · `promotionGate` | `/loops` |
| Run a multi-attempt loop with a custom driver | `runLoop` + `createDriver` | `/loops` |
| Delegate a disciplined loop by mode (code, research, ...) | `runDelegatedLoop` or `agent-runtime-loop` | root |
| Build code reliably (reviewed, gated) | `createDefaultCoderDelegate` | `/mcp` |
| Grow a knowledge base with only grounded facts | `createKbGate` | `/mcp` |
| Improve a prompt safely (identity-gated) | `selfImprove` | `@tangle-network/agent-eval/contract` |
| Ship loop traces to a GenAI viewer | `buildLoopOtelSpans` plus `createOtelExporter` | root |
| Expose delegation as MCP tools to a sandbox agent | `createMcpServer` or `agent-runtime-mcp` | `/mcp` |
| Mutate surfaces from trace findings | `runAnalystLoop` | `/analyst-loop` |
| Persist a run plus its cost ledger | `startRuntimeRun` | root |

## The optimization suite

The canonical surface. A domain is an `Environment` (five hooks: `open`/`tools`/`call`/`score`/`close`);
a **strategy** is how a compute budget is spent to beat the domain's own deployable check. Two
built-ins (`sample` = best-of-N, `refine` = critique-and-continue) plus `defineStrategy` to compose
your own from two steps — and `authorStrategy`, where the system writes new strategies from its own
per-task losses:

```ts
import { defineStrategy, runBenchmark, sample, refine } from '@tangle-network/agent-runtime/loops'

const doubleCheck = defineStrategy('double-check', async ({ shot, critique }) => {
  const first = await shot()
  const steer = first ? await critique(first.messages) : null
  const second = steer ? await shot({ messages: first?.messages, steer }) : null
  const score = Math.max(first?.score ?? 0, second?.score ?? 0)
  return { score, resolved: score >= 1, completions: 2, progression: [first?.score ?? 0, score], shots: 2 }
})

const report = await runBenchmark({ environment, tasks, worker, strategies: [sample, refine, doubleCheck], budget: 3 })
report.perTask // the losses table an author/optimizer consumes
report.pareto  // the (score, $) frontier
```

The measurement invariants are structural, not advisory: every strategy spends through a conserved
budget pool (equal compute by construction), the deliverable score is **harness-verified** from the
shots actually brokered (a body cannot fabricate a win), and the critic is firewalled from the check
(selector ≠ judge). `runStrategyEvolution` runs the multi-generation search — populations of authored
candidates, cost-aware champion selection, a phase ledger with resume, and ONE promotion decision via
`promotionGate` (seeded paired bootstrap) on a holdout slice the search never touched.
`createVerifierEnvironment` adapts answer-shaped domains (one `check` function); `createMcpEnvironment`
adapts any MCP server. The consumer surface — loops as a service with a CLI, detached runner, and MCP
server — lives in the [`loops`](https://github.com/drewstone/loops) repo; the experiment harness and
evidence ledger live in [`bench/HARNESS.md`](./bench/HARNESS.md).

## The loop kernel

`runLoop` is a topology-agnostic kernel. Each iteration spawns a sandbox on an `AgentRunSpec`, decodes the output, validates it, and asks a driver what to do next. The driver owns topology. The validator owns scoring. The kernel owns iteration accounting, concurrency, cost and token aggregation, and trace emission.

```ts
import { runLoop, createDriver } from '@tangle-network/agent-runtime/loops'

const result = await runLoop({
  driver: createDriver({ planner }),           // the planner emits one TopologyMove per round
  agentRuns: [claudeSpec, codexSpec, glmSpec], // heterogeneous: one harness per branch
  output,                                       // events to typed Output
  validator,                                    // Output to { valid, score }
  task,
  ctx: { sandboxClient: sandbox },
})
result.winner // highest-scoring valid attempt
```

`createDriver` lets a planner author the topology at runtime: one `TopologyMove` per round
(`refine`, `fanout`, `select`, or `stop`); a malformed move throws `PlannerError`, so the loop never
runs a topology nobody chose. Topology is orthogonal to harness: the planner never names a backend,
and the kernel's `agentRuns` decide which harness runs each branch. For fixed shapes, write a small
inline `Driver` (see `examples/coder-loop`) or use the `personify` combinators (`fanout`, `loopUntil`,
`panel`, `pipeline`) over the recursive `Scope`/`Supervisor` core — the newer canonical path for
recursive work.

## Self-improvement

The same machinery, run at the optimization timescale.

The one entry point is agent-eval's **`selfImprove`** (`@tangle-network/agent-eval/contract`). It runs a closed loop over any text/config surface, identity-gated by construction: it evaluates, proposes candidates (default `gepaDriver`), and a held-out gate ships a winner only if it beats the baseline. `result.winner.surface` is the baseline unless `result.gateDecision === 'ship'`, so registering a surface for optimization can never regress it.

```ts
import { selfImprove } from '@tangle-network/agent-eval/contract'

const result = await selfImprove({
  baselineSurface: CURRENT_SYSTEM_PROMPT,
  agent: (surface, scenario, ctx) => runYourThing(surface, scenario),
  scenarios,
  judge,
  budget: { holdoutScenarios, generations: 3 },
  llm: { baseUrl, apiKey, model: 'claude-sonnet-4-6' },
})
// result.winner.surface is the safe one — the baseline unless gateDecision === 'ship'
```

agent-runtime contributes the runtime-specific pieces: the **CODE-surface `improvementDriver`**
(`/improvement`) — a git-worktree mutator you pass to `selfImprove` as `driver` to optimize code
instead of a string — and **`runStrategyEvolution`** (`/loops`), the multi-generation search over
STRATEGY space: the system reads its own per-task losses, authors candidate strategies as code,
plays them against the incumbent at equal budget, and a seeded statistical gate decides promotion
on a never-touched holdout slice.

`runAnalystLoop` (`/analyst-loop`) mines real run traces into findings; `createAnalystDriverHook` feeds those findings to a dynamic-driver planner via `PlannerContext.analyses`, with a firewall (`assertTraceDerivedFindings`) that rejects any finding derived from a judge verdict. Production intake — turning real run traces into the corpus `selfImprove` optimizes against — is agent-eval's `analyzeRuns` / `partitionRunsByAuthoringModel` (`/contract`).

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

Delegation state is in-memory by default — a server restart drops pending delegations and history. Set `AGENT_RUNTIME_DELEGATION_STATE_FILE=/path/state.json` on the bin (or construct via `DelegationTaskQueue.restore({ store: new FileDelegationStore({ filePath }) })`) to persist records across restarts: `delegation_status`/`delegation_history` keep answering for prior runs, idempotency keys dedupe resubmissions, and in-flight records either resume through the `resumeDelegate` seam (when submitted with a `detachedSessionRef`) or settle as failed with an explicit driver-restart error. A corrupt state file refuses to load (`DelegationStateCorruptError`); `AGENT_RUNTIME_DELEGATION_STATE_RECOVER=1` archives it and starts empty. `AGENT_RUNTIME_DELEGATION_RETAIN_TERMINAL=<n>` caps retained terminal records.

## The experiment harness (bench/)

`bench/` is the internal harness; [`bench/HARNESS.md`](./bench/HARNESS.md) is its map — read that
first. The canonical path is the optimization suite (`runBenchmark`/`flywheel-evolve` over real
domains: the EnterpriseOps gym, commit0, answer-shaped math); the older selection-gate paths
(`runExperiment`, corpus-replay) remain for the legacy evidence. The live evidence ledger is
`.evolve/current.json` — results never live in this README.

One entrypoint, `runExperiment(adapter, { sandboxClient, agentRun, arms, ... })`: N instances times a set of arms, each arm a topology driven through `runLoop`, judged by the adapter, written to a durable canonical corpus. An arm is one steer function `f(rootPrompt, history) => nextPrompt`: `random` ignores history (the compute control), `refine` carries the prior answer plus a directive, `diverse` rotates a strategy lens. The cost dial is the backend type (`hermes` for a direct router call, `opencode` or `claude-code` or `codex` for agent CLIs). The deep statistics (paired bootstrap with Benjamini-Hochberg correction, selector replay) come from `corpus-report.mts` and `corpus-replay.mts` over the written corpus, computed once. See `bench/HARNESS.md` and `docs/learning-flywheel.md`.

## Defaults

| Knob | Default | Override |
|---|---|---|
| Backend model | `gpt-4o-mini` (via `createOpenAICompatibleBackend`) | `model` option or `MODEL_NAME` env |
| Backend provider | `openai-compat` when `TANGLE_API_KEY`, else `openai` if `OPENAI_API_KEY` | `MODEL_PROVIDER` env |
| Router base URL | `https://router.tangle.tools/v1` | `TANGLE_ROUTER_BASE_URL` env |
| Sandbox base URL | `https://sandbox.tangle.tools` | `SANDBOX_API_URL` env |
| Loop iteration cap | 10 (`runLoop`) | `runLoop({ maxIterations })` |
| Driver | none, required by `runLoop` | `createDriver` or an inline `Driver` |
| Strategy budget (suite) | 3 rollouts/shots per strategy per task | `runBenchmark({ budget })` |
| Winner selection (coder delegate) | `highest-score` | `winnerSelection` option |
| KB gate min passage | 12 chars | `createKbGate({ minPassageChars })` |
| `selfImprove` gate | held-out gate (default) | pass `gate: defaultProductionGate` for red-team hardening |
| OTEL export | off | set `OTEL_EXPORTER_OTLP_ENDPOINT` |
| Loop-runner mode failure | recorded as `{ ok: false }` | `runDelegatedLoop` never crashes on a thrown engine |

## Composition with the stack

```
agent-runtime   handleChatTurn, runLoop + drivers, runProgram, runDelegatedLoop, createMcpServer,
                improvementDriver, createKbGate, buildLoopOtelSpans, defineAgent

agent-eval      selfImprove (the optimization entry point), runEvalCampaign,
                runImprovementLoop (gepaDriver), heldOutGate, runAgentMatrix, analyzeRuns.
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
| `.../loops` | **the optimization suite** (`Environment`, `defineStrategy`, `runBenchmark`, `runStrategyEvolution`, `authorStrategy`, `promotionGate`) + the `runLoop` kernel, `createDriver`, `loopDispatch` |
| `.../profiles` | `coderProfile`, `researcherProfile` presets |
| `.../mcp` | `createMcpServer`, `createDefaultCoderDelegate`, `createKbGate`, the `agent-runtime-mcp` bin |
| `.../improvement` | `improvementDriver` (code/worktree `CandidateGenerator`), `agenticGenerator`, `reflectiveGenerator` — the code-surface driver you pass to agent-eval's `selfImprove` |
| `.../analyst-loop` | `runAnalystLoop`, the analyst registry driver |
| `.../platform` | cross-site SSO and the integrations hub |
| `.../runtime` | the recursive core by its own name (same module as `/loops`) |
| `.../topology` | the live agent-tree viewer (folds spawn/settle events into a renderable tree) |
| `.../workflow` · `.../audit` | workflow orchestration helpers · audit utilities |

Bins: `agent-runtime-mcp` (delegation MCP server), `agent-runtime-loop` (schedulable delegated loop-runner).

## Teaching an agent to build on this

Two agent-consumable skills live in the [`loops`](https://github.com/drewstone/loops) repo:
**`skills/loop-builder`** (domain → `Environment` → loop → gate → operator surface, with the
measured foot-gun list) and **`skills/loop-author`** (authoring a strategy body from losses;
read the contract with `loops contract`). The runnable on-ramp is [`examples/`](./examples/README.md)
— a learning progression from the production chat turn through the strategy suite to the recursive
supervisor. For the broader pipeline (trace sink, analyst loop, scorecard, CI), see the
`agent-eval-adoption` and `agent-stack-adoption` skills.

## Stability, tests, docs

Every public export is annotated `@stable` or `@experimental`. `@stable` exports do not change shape inside a minor version; `@experimental` ones may, and require a deliberate consumer bump.

```bash
pnpm test       # kernel, drivers, MCP, delegate hardening, kb-gate, loop-runner, backends
pnpm typecheck
pnpm build
```

Deeper docs: [`docs/architecture.md`](./docs/architecture.md) (the canonical spine), [`docs/learning-flywheel.md`](./docs/learning-flywheel.md) (the self-improvement thesis and the open gate), [`docs/concepts.md`](./docs/concepts.md) (mental model), [`docs/agent-bus-protocol.md`](./docs/agent-bus-protocol.md) (cross-gateway header contract), [`docs/conversation-economics.md`](./docs/conversation-economics.md) (who pays), [`docs/durability-adapters.md`](./docs/durability-adapters.md) (SQL-backed `ConversationJournal`).
