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

Three entry points, by what you're doing:

| You want to… | Call |
|---|---|
| Run one **product chat turn** (gtm/legal/tax/creative run this in prod) | `handleChatTurn(...)` |
| Have a **supervisor drive a team of agents** to a goal — any harness, any number of sandboxes | `supervise(profile, task, { budget, backend? })` |
| **Self-improve** an agent, certified on a held-out gate | `improve(profile, findings, { surface, gate, … })` |

### Run a chat turn

Every product agent is a `handleChatTurn` call inside a route — what the gtm, creative, legal, and tax products run in production:

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

That is the common case for a single product agent. The other two entry points are below.

### Run a supervisor (one call)

A supervisor authors and drives a team of workers to a goal. The brain is resolved from the profile's `harness`: `null` → an in-process router tool-loop; `'claude-code'`/`'opencode'`/`'codex'` → a sandboxed coding harness driving the coordination verbs. The scaffolding (blobs / per-worker budget / journal / executors / depth) is defaulted.

```ts
import { supervise } from '@tangle-network/agent-runtime/loops'

const result = await supervise(
  { name: 'supervisor', harness: null, systemPrompt: 'Delegate to workers; do not solve the task yourself.' },
  'Implement the feature and make CI green.',
  { budget, router, backend }, // `backend` = where the workers run (one data value: router-tools | sandbox+harness | bridge)
)
```

See `examples/supervise/` for the full one-call entry; `examples/supervisor-loop/` for the per-backend seams.

### Self-improve an agent

`improve` is the one pluggable RSI verb: it optimizes a `surface` of the profile (prompt / skills / code) with the generator defaulted from the surface (GEPA for prompts, skillOpt for skills, or bring your own), certified on a frozen holdout.

```ts
import { improve } from '@tangle-network/agent-runtime'

const { profile, shipped, lift } = await improve(baseProfile, findings, {
  surface: 'prompt',
  gate: 'holdout',         // certified on a held-out split, never the training set
  scenarios, judge, agent, // how to MEASURE the profile under a candidate surface
})
```

Everything below is the substrate these three sit on: multi-attempt loops, delegation, optimization, and the telemetry that makes them auditable.

### The system in plain language

The internal docs use the project's own vocabulary; this is the same thing without it, for a colleague meeting the project cold. Five sentences:

1. We have tasks with **automatic pass/fail checks** — tests you can run, answer keys you can verify mechanically.
2. An AI attempts each task a fixed number of times under different **retry policies**: "try 3 times, keep the best", "try, get feedback, try again", and so on.
3. We compare policies **fairly**: identical tasks, identical attempt budgets, paired statistics, judged on fresh tasks no tuning step ever saw.
4. The distinctive part: the AI also **writes new retry policies itself**, as short programs, and they enter the same tournament under the same rules as human-written ones.
5. Every dollar and second is metered, so "better" can also mean "**equally good but cheaper**" — and that claim is statistically testable, not vibes.

The load-bearing core is six pieces: task-with-check · retry policy · the tournament runner · the AI policy-writer · the statistical promotion gate · crash-resume. Everything else is a **fairness rule** or an **experiment on the menu** (a configuration, not a machine part).

| Project term | Plain English | Standard concept |
|---|---|---|
| `Environment` | a task domain: open it, act with tools, check the result | RL environment / gym |
| shot | one attempt | — |
| steering / `refine` | feedback injected between attempts | self-refinement |
| `authorStrategy` | the AI writes a new retry policy as a program | program synthesis |
| evolution / generations | write candidates → tournament → keep the champion | evolutionary search |
| harness-verified scoring | never trust a policy's self-reported score; recompute it from the attempts actually run | measurement hygiene |
| selector ≠ judge (the firewall) | the feedback-giver never sees the answer key or the score | no reward leakage |
| conserved budget pool | every policy gets exactly the same attempt budget; overspending is structurally impossible | compute-matched comparison |
| holdout / fresh slice | final judging happens on tasks no tuning step ever touched | train/test split |
| `promotionGate` | a seeded paired bootstrap must show the win is real before anything is "better" | inferential statistics |
| non-inferiority mode | prove "not worse on quality AND significantly cheaper" | clinical-trials statistics |
| reproducer certificate | a fresh AI re-builds the winner from a short description; a failed rebuild means the win was memorization, not method | description-length test |
| waterfall | a per-step timeline of the run: seconds, dollars, tokens per step | distributed tracing |

**Honest weaknesses:** mostly one domain family per claim so far (cross-domain replication is configuration, not new code); small holdouts (12–16 tasks) mean only effects ≳6pp are detectable; and the homegrown vocabulary is heavier than the machine it names — hence this section.

## Which entry point do I reach for?

| You want to | Reach for | Subpath |
|---|---|---|
| Run a production chat turn (most products) | `handleChatTurn` | root |
| Declare an agent (profile, surfaces, adapters) | `defineAgent` | `/agent` |
| Run a one-shot task with verification and eval | `runAgentTask` | root |
| Compare optimization strategies on YOUR domain (5 hooks) | `runBenchmark` + `defineStrategy` | `/loops` |
| Let the system author + evolve its own strategies, gated | `runStrategyEvolution` · `authorStrategy` · `promotionGate` | `/loops` |
| Run a multi-attempt loop with a custom driver | `runLoop` + an inline `Driver` | `/loops` |
| Drive one agent profile from another (the canonical driver) | `createCoordinationTools` over `Supervisor` (`/loops`) | `/mcp` |
| Delegate a disciplined loop by mode (code, research, ...) | `runDelegatedLoop` or `agent-runtime-loop` | root |
| Build code reliably (reviewed, gated) | `createDefaultCoderDelegate` | `/mcp` |
| Grow a knowledge base with only grounded facts | `createKbGate` | `/mcp` |
| Improve a prompt safely (identity-gated) | `selfImprove` | `@tangle-network/agent-eval/contract` |
| Ship loop traces to a GenAI viewer | `buildLoopOtelSpans` plus `createOtelExporter` | root |
| Expose delegation as MCP tools to a sandbox agent | `createMcpServer` or `agent-runtime-mcp` | `/mcp` |
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
import { runLoop, type Driver } from '@tangle-network/agent-runtime/loops'

const driver: Driver<Task, Output, 'pick-winner' | 'fail'> = {
  plan: async (task, history) => (history.length === 0 ? [task, task] : []), // fan out, then stop
  decide: (history) => (history.some((i) => i.verdict?.valid) ? 'pick-winner' : 'fail'),
}

const result = await runLoop({
  driver,                                       // the driver owns topology; the kernel owns accounting
  agentRuns: [claudeSpec, codexSpec, glmSpec], // heterogeneous: one harness per branch
  output,                                       // events to typed Output
  validator,                                    // Output to { valid, score }
  task,
  ctx: { sandboxClient: sandbox },
})
result.winner // highest-scoring valid attempt
```

A `Driver` is `plan` (emit the round's `Task[]` — `[]` ends the loop) plus `decide` (the terminal
`Decision` over the history). Topology is orthogonal to harness: the driver never names a backend,
and the kernel's `agentRuns` decide which harness runs each branch. See `examples/coder-loop` for a
fixed-shape inline `Driver`. For recursive work prefer the **agent-driver** — an `AgentProfile`
driving another via `createCoordinationTools` (`/mcp`) over the budget-conserving `Scope`/`Supervisor`
core (`/runtime`) — plus the `personify` combinators (`fanout`, `loopUntil`, `panel`, `pipeline`) and
`runPersonified` on that same core.

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
import { runDelegatedLoop, worktreeLoopRunner, researchLoopRunner, type DelegatedLoopRegistry } from '@tangle-network/agent-runtime'

const registry: DelegatedLoopRegistry = {
  code: worktreeLoopRunner({ repoRoot: '/repo', taskPrompt: 'fix the flaky retry test', harnesses, budget }),
  research: researchLoopRunner({ research, gate: { selfArtifactKinds: ['spec'] }, maxRounds: 3 }),
}
const result = await runDelegatedLoop('code', registry)
```

Modes: `code`, `review`, `research`, `audit`, `self-improve`, `dynamic`. The `agent-runtime-loop` bin runs the registry from a cron or routine and exits 0 (ok), 1 (recorded failure), or 2 (usage or config error).

`worktreeLoopRunner` (`code` mode, the generic recursive path) authors one `AgentProfile` per harness and runs them as a `worktreeFanout` (each leaf `gateOnDeliverable`), winner by the shared valid-only selector. The sandbox-session counterpart is `detachedSessionDelegate` (`/mcp`): it drives the in-box harness over a `SandboxClient` to a mechanically-validated patch, with default-on safety gates — no-op rejection, an always-on secret-path floor (`.env`, keys, wallets), an optional `reviewer` gate, and a `winnerSelection` policy. Its worker profile is a parameter the caller authors (`workerProfile`); omit it for a minimal model-only default.

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

Expose the delegation tools to a sandbox coding agent: the generic `delegate` verb (one intent → a supervisor that authors + drives its own worker, returns the delivered output with its real spend) plus the queue-bound `delegate_feedback`, `delegation_status`, `delegation_history` (and `delegate_ui_audit` when a UI-audit runner is wired). Mount the canonical server instead of forking delegation logic.

```ts
import { createMcpServer } from '@tangle-network/agent-runtime/mcp'

const server = createMcpServer({ delegateSupervisor: { router, backend, deliverable } })
```

Or mount the `agent-runtime-mcp` stdio bin on a production `AgentProfile.mcp` with `MCP_ENABLE_DELEGATE=1`.

Delegation state is in-memory by default — a server restart drops pending delegations and history. Set `AGENT_RUNTIME_DELEGATION_STATE_FILE=/path/state.json` on the bin (or construct via `DelegationTaskQueue.restore({ store: new FileDelegationStore({ filePath }) })`) to persist records across restarts: `delegation_status`/`delegation_history` keep answering for prior runs, idempotency keys dedupe resubmissions, and in-flight records either resume through the `resumeDelegate` seam (when submitted with a `detachedSessionRef`) or settle as failed with an explicit driver-restart error. A corrupt state file refuses to load (`DelegationStateCorruptError`); `AGENT_RUNTIME_DELEGATION_STATE_RECOVER=1` archives it and starts empty. `AGENT_RUNTIME_DELEGATION_RETAIN_TERMINAL=<n>` caps retained terminal records.

## The experiment harness (bench/)

`bench/` is the internal harness; [`bench/HARNESS.md`](./bench/HARNESS.md) is its map — read that
first. The canonical path is the optimization suite (`runBenchmark`/`runStrategyEvolution` over real
domains: the EnterpriseOps gym, commit0, answer-shaped math). The live evidence ledger is
`.evolve/current.json` — results never live in this README.

The recursive diverse-vs-blind gate runs through the keystone: `gate-cli.mts` →
`runGate` composes a `Persona` + the generic `fanout` combinator over the budget-conserving
`Supervisor`, with each child solved via the router and graded by the benchmark's own deployable
`adapter.judge` (selector ≠ oracle). Each rollout is written to a durable canonical corpus; the deep
statistics (paired bootstrap with Benjamini-Hochberg correction, selector replay) come from
`corpus-report.mts` and `corpus-replay.mts` over that corpus, computed once and offline. See
`bench/HARNESS.md` and `docs/learning-flywheel.md`.

## Defaults

| Knob | Default | Override |
|---|---|---|
| Backend model | `gpt-4o-mini` (via `createOpenAICompatibleBackend`) | `model` option or `MODEL_NAME` env |
| Backend provider | `openai-compat` when `TANGLE_API_KEY`, else `openai` if `OPENAI_API_KEY` | `MODEL_PROVIDER` env |
| Router base URL | `https://router.tangle.tools/v1` | `TANGLE_ROUTER_BASE_URL` env |
| Sandbox base URL | `https://sandbox.tangle.tools` | `SANDBOX_API_URL` env |
| Loop iteration cap | 10 (`runLoop`) | `runLoop({ maxIterations })` |
| Driver | none, required by `runLoop` | an inline `Driver` (`plan`/`decide`) |
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

Six subpaths — the public surface:

| Import | Owns |
|---|---|
| `@tangle-network/agent-runtime` | chat turns, delegated loop-runner, OTEL export, errors, model resolution |
| `.../agent` | `defineAgent` plus surface and outcome adapters |
| `.../loops` | **the optimization suite** (`Environment`, `defineStrategy`, `runBenchmark`, `runStrategyEvolution`, `authorStrategy`, `promotionGate`) + the recursive atom (`Supervisor`/`Scope`, `createExecutor`), the `runLoop` kernel, the `Driver` type, `loopDispatch` |
| `.../profiles` | `coderTaskToPrompt` (the coder task formatter), the `uiAuditorProfile` presets + the UI-audit workspace I/O helpers |
| `.../intelligence` | `withTangleIntelligence`, `createIntelligenceClient` — Observe + the provable-OFF billing boundary |
| `.../mcp` | `createMcpServer`, `createDefaultCoderDelegate`, `createKbGate`, the `agent-runtime-mcp` bin |

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

Deeper docs: [`docs/architecture.md`](./docs/architecture.md) (the canonical spine), [`docs/canonical-api.md`](./docs/canonical-api.md) (the anti-reinvention decision table), [`docs/learning-flywheel.md`](./docs/learning-flywheel.md) (the self-improvement thesis and the open gate), [`docs/concepts.md`](./docs/concepts.md) (mental model), [`docs/agent-bus-protocol.md`](./docs/agent-bus-protocol.md) (cross-gateway header contract), [`docs/durability-adapters.md`](./docs/durability-adapters.md) (SQL-backed `ConversationJournal`).
