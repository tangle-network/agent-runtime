# @tangle-network/agent-runtime

A TypeScript runtime for chat agents, one-shot tasks, and agent teams.
It records each run so you can measure changes against real pass/fail checks and improve the agent without changing your product integration.

Domain behavior (models, tools, knowledge) plugs in as adapters; the scoring statistics and the ship decision come from [`@tangle-network/agent-eval`](https://www.npmjs.com/package/@tangle-network/agent-eval); sandboxed execution from [`@tangle-network/sandbox`](https://www.npmjs.com/package/@tangle-network/sandbox).

```bash
pnpm add @tangle-network/agent-runtime @tangle-network/agent-eval @tangle-network/sandbox
```

## Contents

- [Quickstart](#quickstart-offline-no-api-keys)
- [What you do with it](#what-you-do-with-it)
- [Run a chat turn](#run-a-chat-turn)
- [Retain and reconnect a run](#retain-and-reconnect-a-run)
- [Supervise a team of agents](#supervise-a-team-of-agents)
- [Improve an agent](#improve-an-agent)
- [Improve a knowledge base](#improve-a-knowledge-base)
- [Run on PrimeIntellect](#run-on-primeintellect)
- [How it works](#how-it-works-the-short-version)
- [Primitives](#primitives)
- [Examples](#examples)
- [Where to go next](#where-to-go-next)

## Quickstart (offline, no API keys)

A driver runs a worker, reads its output, and writes the next prompt until a check passes.
This excerpt shows the driver from the runnable [`examples/quickstart/quickstart.ts`](./examples/quickstart/quickstart.ts).
That file defines the scripted `worker`, `output`, and `validator` used below so it runs without credentials.
Replace the scripted worker with a sandbox, CLI bridge, or router backend without changing the driver.

```ts
import type { AgentProfile } from '@tangle-network/agent-interface'
import { inProcessSandboxClient, runAgentRounds } from '@tangle-network/agent-runtime/kernel'

const noteWriterProfile = {
  name: 'note-writer',
  harness: 'cli-base',
  model: { provider: 'scripted', default: 'scripted/note-writer' },
} satisfies AgentProfile

const result = await runAgentRounds<Task, Note, 'refine' | 'pick-winner' | 'fail'>({
  task: { prompt: 'Write a one-line release note for one-click restore.' },
  driver: {
    name: 'refine',
    plan: async (task, history) => {
      const last = history[history.length - 1]
      if (!last) return [task] // shot 0: run the task as written
      if (last.verdict?.valid || history.length >= 3) return [] // done, or out of shots
      // The core move: read the last worker's real output, write the next prompt FROM it.
      return [{ prompt: `Rewrite "${last.output?.note}" to mention the rollback path.` }]
    },
    decide: (history) =>
      history.some((shot) => shot.verdict?.valid) ? 'pick-winner' : history.length < 3 ? 'refine' : 'fail',
  },
  agentRun: { profile: noteWriterProfile, taskToPrompt: (t) => t.prompt },
  output,    // parses the worker's event stream into { note }
  validator, // pass/fail check: does the note mention "rollback"?
  ctx: { sandboxClient: worker },
  maxIterations: 3,
})
```

Run it from a clone of this repo and you get exactly this:

```bash
$ pnpm i && pnpm build
$ pnpm tsx examples/quickstart/quickstart.ts
shot 0: reject — "Shipped one-click restore."
shot 1: PASS — "Shipped one-click restore with an instant rollback path."
decision: pick-winner — winner: shot 1
```

The annotated version is [`examples/driver-loop`](./examples/driver-loop).

## What you do with it

| You want to… | Call |
|---|---|
| Run a **chat turn** for a production product agent | `handleChatTurn(...)` |
| Have one agent **supervise a team of agents** toward a goal | `supervise(profile, task, opts)` |
| **Improve** an agent and prove the gain on fresh tasks | `improve(profile, opts)` |
| Produce a measured knowledge-base candidate with agents and checks | `runKnowledgeImprovementJob(...)` |
| Evaluate or train the same agent on **PrimeIntellect** | `createPrimeIntellectPackage(...)` |

### Run a chat turn

A product agent is one `handleChatTurn` call inside a route. You give it how to produce the response and how to persist it; it streams, traces, and persists.

```ts
import { deriveExecutionId, handleChatTurn } from '@tangle-network/agent-runtime/durable'

const turnIndex = 0
const executionId = deriveExecutionId({ projectId, sessionId: threadId, turnIndex })
const result = handleChatTurn({
  identity: { tenantId, sessionId: threadId, userId, turnIndex },
  hooks: {
    produce: () => ({
      stream: box.streamPrompt(userMessage, {
        sessionId: threadId,
        executionId,
        turnId: executionId,
        detach: true,
      }),
      finalText: () => box.lastResponse(),
    }),
    persistAssistantMessage: async ({ identity, finalText }) => db.insertMessage(identity, finalText),
  },
  waitUntil,
})
return new Response(result.body, { headers: { 'content-type': result.contentType } })
```

For a stream reconnect, call `streamPrompt` with the same `executionId` and the last event id the client received.
For a repeated initial dispatch, reuse both `sessionId` and `turnId`; `executionId` alone is not an idempotency key.

### Retain and reconnect a run

Use the retained-run API when the provider owns a job that must outlive one HTTP reader or application process.
The provider must advertise exact run identity, replay, result identity, and idempotent cancellation.

```ts
import {
  reconnectRetainedRun,
  recoverRetainedRun,
  startRetainedRun,
} from '@tangle-network/agent-runtime/kernel'

const run = await startRetainedRun({
  provider,
  environment: { idempotencyKey: 'workspace-42', profile },
  turn: { turnId: 'turn-7', prompt: 'Finish the migration and run its tests.' },
  identity: { sessionId: 'thread-42', executionId: 'execution-7' },
  onAdmission: async (admission) => {
    await journal.write(admission)
  },
})

for await (const event of run.events()) {
  await journal.write(event)
}

const recovered = await reconnectRetainedRun({
  provider: freshProvider,
  controlRef: (await journal.readDispatchedAdmission()).controlRef,
})
if (!recovered) throw new Error('the provider no longer retains this environment')

const snapshot = await recovered.status({ waitMs: 30_000 })
const result = await recovered.result()
```

The runtime awaits `onAdmission` after environment creation and again after dispatch.
The start promise resolves only after the dispatched admission, so the exact reference is durable before any caller observes success.
Persist each admission record inside the hook before it returns.
A hook rejection fails the start with `RetainedRunAdmissionError` and keeps the environment for recovery.
When you omit `identity`, the runtime mints deterministic coordinates from the two keys, so every process derives the same values.
After dispatch, the runtime verifies the provider honored the requested identity and fails with `RetainedRunDispatchBindingError` when it did not.
Persist each event cursor and sequence before advancing the visible transcript.
`reconnectRetainedRun` reconstructs a client from a dispatched admission's `controlRef` and rejects any provider, environment, session, execution, run, or digest mismatch.
After a crash that left only the `environment` admission, call `recoverRetainedRun` with its coordinates.
It reports `recovered` with a handle, `not_found` when the environment is gone, or `unverifiable` when the provider cannot self-identify the session.
Never destroy an environment on `unverifiable`; keep it, retry `reconnectRetainedRun` later, or inspect it with provider-native tools.
An unknown provider result remains unknown; the runtime never converts it into success or confirmed cancellation.

### Supervise a team of agents

One supervisor spawns and steers workers toward a goal. Where the workers run (an in-process loop, or a sandboxed coding harness) is one data value; the budget, journaling, and stopping are handled for you.

```ts
import { supervise } from '@tangle-network/agent-runtime/kernel'

const result = await supervise(
  {
    name: 'supervisor',
    harness: 'cli-base',
    model: { provider: 'tangle-router', default: process.env.TANGLE_MODEL! },
    prompt: {
      systemPrompt: 'Delegate to workers; do not solve the task yourself.',
    },
  },
  'Implement the feature and make the tests pass.',
  { budget, router, backend }, // backend = where workers run: router-tools | sandbox+harness | bridge
)
```

### Improve an agent

`improve` runs one complete `OptimizationMethod` against one profile field.
The method owns candidate generation and selection.
Runtime keeps the final test set out of the method, scores the baseline and selected candidate on it, and returns `ship` only when the paired confidence interval clears `minimumLift`.
The profile is never changed.

```ts
import { improve, officialGepa } from '@tangle-network/agent-runtime'
import { profileOptimizerModelCall } from '@tangle-network/agent-runtime/kernel'
import {
  type AgentProfile,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'

const executionRef = canonicalCandidateDigest({
  deployment: process.env.AGENT_DEPLOYMENT_SHA!,
  model: process.env.AGENT_MODEL!,
  tools: process.env.AGENT_TOOLSET_SHA!,
})

const optimizerProfile = {
  name: 'support-prompt-optimizer',
  harness: 'cli-base',
  model: {
    provider: 'tangle-router',
    default: process.env.OPTIMIZER_MODEL!,
    metadata: { maxTokens: 16_384 },
  },
} satisfies AgentProfile
const optimizerPricing = {
  inputUsdPerMillion: Number(process.env.OPTIMIZER_INPUT_USD_PER_MILLION),
  outputUsdPerMillion: Number(process.env.OPTIMIZER_OUTPUT_USD_PER_MILLION),
}
const optimizer = {
  model: optimizerProfile.model.default,
  call: profileOptimizerModelCall({
    profile: optimizerProfile,
    context: 'support-prompt optimizer',
    executor: {
      backend: 'router',
      routerBaseUrl: process.env.OPTIMIZER_BASE_URL!,
      routerKey: process.env.OPTIMIZER_API_KEY!,
    },
    pricing: optimizerPricing,
  }),
  callRef: canonicalCandidateDigest({
    profile: canonicalAgentProfileDigest(optimizerProfile),
    deployment: process.env.OPTIMIZER_DEPLOYMENT_SHA!,
  }),
  budget: {
    maxCostUsd: 10,
    maxRequests: 50,
    maxRequestBytes: 2_000_000,
    maxResponseBytes: 2_000_000,
    maxOutputTokensPerRequest: 16_384,
    pricing: optimizerPricing,
  },
}

const result = await improve(baseProfile, {
  surface: 'prompt',
  executionRef,
  method: officialGepa({
    objective: 'Improve the complete support-agent prompt.',
    recipe: {
      kind: 'engine',
      run: {
        engine: 'gepa',
        maxEvaluations: 40,
        maxProposerCostUsd: 10,
      },
    },
    optimizer,
    resume: 'if-compatible',
    trustResumeState: true,
    describeScenario: ({ input }) => ({ input }),
  }),
  findings,
  trainScenarios,
  selectionScenarios,
  testScenarios,
  judges: [judge],
  agent: (candidateProfile, scenario, ctx) =>
    runProfile(candidateProfile, scenario, ctx),
  runDir: '.runs/support-prompt',
  costCeiling: 25,
})

if (result.decision === 'ship') {
  console.log(result.candidate.profile, result.liftInterval)
}
```

`officialGepa(...)` delegates the complete search to GEPA's upstream Optimize Anything API through agent-eval.
Pass one explicit `engine`, `sequential`, `adaptive-sequential`, `best-of`, `vote`, or `omni` recipe.
Runtime derives the upstream resume identity from `executionRef`, the complete baseline profile, and the selected surface.
With `resume: 'if-compatible'`, agent-eval resumes only when the saved run identity matches the candidate, recipe, data, optimizer settings, runner, and derived execution identity.
Set `trustResumeState: true` only when that run directory is private to the current operator.
Use `resume: 'required'` to fail when no matching run exists.
`result.provenance` reports the upstream package, run ID, resume status, evaluation count, and artifact directory.
`result.candidatePopulation` verifies and joins callback observations with an optimizer's official candidate graph.
It returns every unique candidate as a complete profile with ordered Interface diffs, or as an explicit materialization refusal.
GEPA candidates retain exact parent indices and selection scores; callback-only proposals report lineage as unavailable.
Methods without either artifact return `status: 'unavailable'` instead of treating the winner as the full population.
There is no local fallback.
Install its optional Python process before using it:

```bash
python -m pip install "agent-eval-rpc==0.145.0"
python -m pip install "gepa[full]==0.1.4"
```

The published GEPA 0.1.4 wheel supports the direct `gepa` engine.
Sequential, adaptive, best-of, vote, Omni, AutoResearch, Meta Harness, and Best-of-N require the tested official source revision:

```bash
python -m pip install "gepa[full] @ git+https://github.com/gepa-ai/gepa.git@f919db0a622e2e9f9204779b81fe00cc1b2d808f"
```

Use `officialSkillOpt(...)` for Microsoft's SkillOpt:

```bash
python -m pip install "agent-eval-rpc==0.145.0"
python -m pip install "skillopt @ git+https://github.com/microsoft/SkillOpt.git@61735e3922efc2b90c6d6cab561e62e98452ca90"
```

SkillOpt 0.2.0's published wheel omits prompt files required by `ReflACTTrainer`, so the tested SkillOpt source revision remains necessary.
SkillOpt and GEPA's standard reflection engine require `optimizer: { model, call, callRef, budget }`.
Agent-based GEPA engines may own their model connection instead.
Runtime owns those model calls through one exact `AgentProfile`; Agent Eval enforces the nested budget and records their measured cost and execution evidence without receiving provider credentials.
`costCeiling` is the total limit for optimizer calls, candidate runs, judges, and final scoring.
Runtime returns `hold` when any part of that cost is unknown.
Runtime rejects a reported total above the limit.

SkillOpt accepts one text surface.
GEPA accepts text or named components.
Any complete method from `@tangle-network/agent-eval` uses the same call.
The `agent` callback receives the complete immutable candidate profile, not a raw prompt or component fragment.
Runtime uses that exact profile for every candidate run and returns the same measured profile in `result.candidate.profile`.
`executionRef` is a content digest of the agent callback, profile component mapping, model, tools, and closure settings.
Runtime combines it with the complete baseline profile and selected surface for saved work.
Changing any of them runs the affected work again.
For a skill, set `surface: 'skills'` and `skills.resourceName`.
For the complete profile, set `surface: 'agent-profile'`.
To optimize several named profile fields together, also provide `profileComponents.read` and `profileComponents.apply`.
Tools, MCP, hooks, subagents, curated instructions, and rollout policy are also exact profile coordinates.
Runtime does not choose an optimizer for them.

Without `describeScenario`, the external optimizer receives only each development case ID.
Without `describeArtifact`, evaluation feedback contains no artifact body.
When either descriptor is present, its result passes through `redact` together with findings, background text, profile name, and judge notes.
The built-in redactor removes common credentials and email addresses.
Supply a domain redactor for customer names, account IDs, or other private data the built-in rules cannot identify.
Runtime applies that hook first and then still applies its built-in scrubber.
Set `redact: false` only when every outbound value is public and already reviewed.

The selected profile surface is the optimizer's candidate and cannot be redacted without changing the measured candidate.
Runtime always rejects recognized credentials in those bytes.
It also rejects structurally sensitive fields such as MCP env, headers, URLs, metadata, and extensions.
For `tools`, `mcp`, `hooks`, `subagents`, and `agent-profile`, Runtime treats the entire selected coordinate as execution-capable.
Use `authorizeSensitiveCandidate` to inspect and accept each exact immutable profile containing public values or safe references.
The callback runs for the baseline and every distinct candidate before either reaches your agent.
Its `sensitivePaths` includes `$` when the whole coordinate requires review.

Code is the exception.
It uses Runtime's isolated git worktrees and coding-agent candidate execution:

```ts
const result = await improve({
  surface: 'code',
  code: { repoRoot, baseRef, profile, generator },
  scenarios,
  judge,
  agent,
  budget,
})
```

`improve` is the search call.
For production, `proposeAgentImprovement` adds trace analysis and reruns the exact frozen baseline and winner before creating a reviewable proposal.
Runtime rejects a candidate bundle that differs from the search winner.

```ts
import {
  createAgentImprovementActivation,
  executeAgentImprovementActivation,
  proposeAgentImprovement,
  reviewAgentImprovementProposal,
} from '@tangle-network/agent-runtime/intelligence'

const baseline = freezeBaseline(liveProfile)
const result = await proposeAgentImprovement({
  runId,
  profile: liveProfile,
  analysis,
  improvement: {
    surface: 'prompt',
    executionRef,
    method,
    trainScenarios,
    selectionScenarios,
    testScenarios,
    judges: [judge],
    agent,
  },
  buildExperiment: ({ improvement }) =>
    buildExperimentMaterial({
      baseline,
      candidate: compileCandidateBundle({ baseline, improvement: improvement.candidate }),
      benchmark: heldOutBenchmark,
      policy: comparisonPolicy,
    }),
  placeCell,
})

const review = reviewAgentImprovementProposal(result.proposal, {
  decision: 'approve',
  reviewedBy: user.id,
  reason: 'The measured gain is worth the cost.',
})
const activation = createAgentImprovementActivation(result.proposal, review, {
  intent: 'activate-candidate',
  targets: [{ surface: 'prompt', identity: profileId }],
  fundingOwner: tenantId,
  authorizedBy: user.id,
  expiresAt,
})
const outcome = await executeAgentImprovementActivation(
  { proposal: result.proposal, review, activation },
  { transition: commitProfileTransaction, reconcile: readCommittedResult },
)
```

`buildExperimentMaterial`, `placeCell`, and the transaction functions are application ports because storage and compute differ by product.
The builder returns only baseline, candidate, tasks, and policy; Runtime adds the search ancestry and seals the final experiment.
Runtime owns candidate identity, measurement, review binding, expiry, retry identity, and result validation; the application owns its atomic write.
Official optimizer proposals carry the observed package versions, optimizer model, evaluation and token usage, separate optimization and final-test costs, and resumed-run identity.
`createOptimizationActivationReceipt(result)` exposes the same detached record for callers that need to inspect an `improve()` result before building a proposal.

### Improve a knowledge base

`runKnowledgeImprovementJob` runs KB, wiki, memory-backed, and RAG improvement jobs.
It creates a candidate copy, runs agents against it, checks it through `@tangle-network/agent-knowledge`, and returns frozen baseline and candidate snapshots with spend and timing.
It never changes the live knowledge base.
Use `improve(profile, { surface: 'memory', ... })` for the agent's curated lesson document.
Use this job for source, retrieval, and knowledge-store changes.

```ts
import { runKnowledgeImprovementJob } from '@tangle-network/agent-runtime/knowledge'

const result = await runKnowledgeImprovementJob({
  root: './kb',
  goal: 'Improve support refund-policy knowledge',
  implementationRef: 'git:0123456789abcdef0123456789abcdef01234567',
  readinessSpecs,
  budget: { maxIterations: 8, maxTokens: 120_000, maxUsd: 10 },
  backend,
})

console.log(result.knowledge?.reference.candidateHash, result.measurement.supervisedSpent)
```

Use it when the product needs one knob for "make this knowledge base better" instead of wiring `improveKnowledgeBase`, a runtime supervisor, candidate workspaces, and readiness checks by hand.
Set `implementationRef` to the deployed `git:<40 hex>` revision or a `sha256:<64 hex>` digest covering every callback, model, index, and external setting that can change the result.
The same run ID resumes only when this identity still matches.
Measure the returned bundle pair, record the review, then activate through `executeAgentImprovementActivation`; activation is the only write path.

### Run on PrimeIntellect

`@tangle-network/agent-runtime/primeintellect` packages typed train and eval tasks as a PrimeIntellect Verifiers environment.
Prime launches your actual runtime program against an intercepted model endpoint, so `runPersonified`, `runAgentic`, product agents, tool calls, and multiple rounds stay intact.
Reference answers remain in Prime's task process and never enter the agent workspace.
The runner file must be one executable bundle containing the app and its runtime dependencies.

```ts
import { readFile } from 'node:fs/promises'
import {
  createPrimeIntellectPackage,
  writePrimeIntellectPackage,
} from '@tangle-network/agent-runtime/primeintellect'

const bundledRunner = await readFile('./dist/prime-runner.mjs', 'utf8')
const bundle = createPrimeIntellectPackage({
  name: 'support-agent',
  version: '1.0.0',
  tasks: [
    {
      id: 'train-refund-policy',
      split: 'train',
      prompt: 'Can a subscription renewal be refunded?',
      answer: 'No',
    },
    {
      id: 'eval-final-sale',
      split: 'eval',
      prompt: 'Can a final-sale order be refunded?',
      answer: 'No',
    },
  ],
  scoring: { kind: 'exact', normalization: 'trim-casefold' },
  runner: {
    image: 'node:22-bookworm-slim',
    files: { 'runner.mjs': bundledRunner },
    command: ['node', 'runner.mjs'],
  },
})

await writePrimeIntellectPackage(bundle, './prime/support-agent')
```

The runner reads the episode and uses the normal runtime APIs:
Here, `runProductAgent` is the application's existing entry point, not another loop supplied by this adapter.

```ts
import {
  primeIntellectExecutorConfig,
  runPrimeIntellectProgram,
} from '@tangle-network/agent-runtime/primeintellect'
import {
  collectAgentTurn,
  createExecutor,
  streamAgentTurn,
} from '@tangle-network/agent-runtime/kernel'

await runPrimeIntellectProgram(async (episode) => {
  const profile = makeProductProfile({ model: episode.model.name })
  return collectAgentTurn(
    streamAgentTurn(
      {
        kind: 'executor',
        profile,
        factory: createExecutor(primeIntellectExecutorConfig(episode)),
      },
      episode.task.prompt,
    ),
  )
})
```

Prime writes complete `traces.jsonl` rows.
Use `importPrimeIntellectTraces(...)` to convert them to agent-eval `RunRecord`s for the existing reports and release checks.

## How it works (the short version)

- **Roles are configuration.** Driver, worker, and coordinator describe what an agent does in a run. They are not separate agent types.
- **Runs are recorded.** A run can report tokens, dollars, time, outputs, and scores.
- **Candidates face fresh tasks.** The optimizer uses train and selection tasks. Promotion uses a separate final set.
- **Scores come from executed attempts.** Runtime recomputes results from the recorded cells and rejects incomplete cost or source evidence.

## Primitives

The general-purpose pieces, by import path. Every export with its one-line summary lives in the generated [`docs/api/primitive-catalog.md`](./docs/api/primitive-catalog.md): check it before building anything new.

| Primitive | What it does | Import |
|---|---|---|
| Chat-turn runtime | Stream and persist one production chat turn (`handleChatTurn`); derive its stable execution and turn identity (`deriveExecutionId`); normalize any backend's stream into one event shape (`streamAgentTurn`) | `/durable` · `/kernel` |
| Retained provider runs | Start one detached provider job with a durable admission hook, replay exact events, reconnect after restart, rebuild from pre-dispatch coordinates, continue its native context, and cancel idempotently (`startRetainedRun`, `reconnectRetainedRun`, `recoverRetainedRun`) | `/kernel` |
| Tool-call loop | Run one model turn, execute requested tools, feed results back, and stop on completion, repetition, time, or cost limits (`runToolLoop`, `streamToolLoop`) | `/tool-loop` |
| Supervision | One agent spawns, budgets, and steers workers toward a goal (`supervise`, `delegate`), on an in-process loop or a sandboxed coding harness | `/kernel` · `/mcp` |
| Loop kernel + combinators | Write a driver (`plan`/`decide`) and run it (`runAgentRounds`), or compose fixed shapes: refine (`loopUntil`), best-of-N (`fanout`), chain (`pipeline`), multi-judge (`panel`) | `/kernel` |
| Improvement driver | Optimize one part of an agent and ship only if it wins on tasks it never practiced on (`improve`); production proposal/review/activation flow | root · `/intelligence` |
| Benchmarks + leaderboards | Compare strategies with significance stats (`runBenchmark`), stand up a harness×model leaderboard (`defineLeaderboard`, `leaderboard`) | `/kernel` |
| Knowledge improvement | Produce a measured candidate copy of a KB/wiki/RAG corpus without touching the live one (`runKnowledgeImprovementJob`) | `/knowledge` |
| MCP tool servers | Give an agent a `delegate` tool or live worker-coordination tools over MCP | `/mcp` |
| Conversations + durability | Multi-turn two-agent sessions with SQL-backed resume (D1/pg/sqlite/libSQL adapters) | `/conversation` |
| Training/eval adapter | Package the same runtime program as a PrimeIntellect Verifiers environment; import its traces back | `/primeintellect` |

| Watching live runs | A terminal view of every supervisor run in a workspace — workers, spend, tokens, latency, plus steer and cancel (`agent-runtime-top`) | `/tui` |

Remaining subpaths: `/agent`, `/profiles`, `/platform`, `/analyst-loop`, `/environment-provider`, `/testing` (validated fixture records for consumer tests).

## Examples

Runnable, grouped by what they show. Copy the one nearest your task:

| Do this | Example |
|---|---|
| The smallest complete loop (start here) | [`quickstart`](./examples/quickstart) · [`driver-loop`](./examples/driver-loop) |
| Run a product chat turn | [`chat-handler`](./examples/chat-handler) |
| Drive a team of agents to a goal | [`supervise`](./examples/supervise) · [`recursive-supervisor`](./examples/recursive-supervisor) |
| Benchmark strategies on your own domain | [`coding-benchmark`](./examples/coding-benchmark) |
| Benchmark **harnesses × models** over a real task suite (the real WebCode dataset) | [`webcode-matrix`](./examples/webcode-matrix) |
| Render a **multi-profile leaderboard** with ranked board, score matrix, and SVG/HTML charts | `leaderboard(records)` → `renderLeaderboardMarkdown` / `Svg` / `Html` |
| Trace + bill + effort-gate the WebCode benchmark (the Intelligence SDK) | [`intelligence-webcode`](./examples/intelligence-webcode) |
| Self-improve an agent, gated on a held-out set | [`improve`](./examples/improve) · [`self-improving-coder`](./examples/self-improving-coder) |
| Improve a KB, wiki, or RAG corpus with runtime agents | [`docs/canonical-api.md`](./docs/canonical-api.md) |
| Evaluate or train a runtime program on PrimeIntellect | `@tangle-network/agent-runtime/primeintellect` |
| Study coordination vs raw compute | [`ablation-suite`](./examples/ablation-suite) |

All 29 live in [`examples/`](./examples).

## Where to go next

- New here? [`docs/concepts.md`](./docs/concepts.md), the mental model in plain terms.
- [`docs/canonical-api.md`](./docs/canonical-api.md), find the primitive: "I want to ___ → use ___".
- [`docs/api/primitive-catalog.md`](./docs/api/primitive-catalog.md), every export in one generated, never-stale list with its import path. Check it before building anything new.
- [`docs/STABILITY.md`](./docs/STABILITY.md), what `@stable` / `@experimental` promise you, and how a symbol graduates.
- [`docs/design.md`](./docs/design.md), the design philosophy and the internal research docs behind it: background reading, not required to use the package.
- [`bench/HARNESS.md`](./bench/HARNESS.md), the experiment harness and how to run a benchmark.

**Contributing:** `pnpm i && pnpm build && pnpm test` gets you running; the full local gate is the [`package.json`](./package.json) scripts (`lint`, `typecheck`, `docs:check`).
