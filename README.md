# @tangle-network/agent-runtime

A TypeScript runtime for running AI agents — as a **chat turn**, a **one-shot task**, or a **team of agents** working toward a goal — that records every run and uses those records to **measure and improve** agents against real pass/fail checks. It is the engine Tangle's own production agents run on.

Domain behavior (models, tools, knowledge) plugs in as adapters; the scoring statistics and the ship decision come from [`@tangle-network/agent-eval`](https://www.npmjs.com/package/@tangle-network/agent-eval); sandboxed execution from [`@tangle-network/sandbox`](https://www.npmjs.com/package/@tangle-network/sandbox).

```bash
pnpm add @tangle-network/agent-runtime @tangle-network/agent-eval @tangle-network/sandbox
```

## Contents

- [Quickstart](#quickstart-offline-no-api-keys)
- [What you do with it](#what-you-do-with-it)
- [Run a chat turn](#run-a-chat-turn)
- [Supervise a team of agents](#supervise-a-team-of-agents)
- [Improve an agent](#improve-an-agent)
- [Improve a knowledge base](#improve-a-knowledge-base)
- [Run on PrimeIntellect](#run-on-primeintellect)
- [How it works](#how-it-works-the-short-version)
- [Primitives](#primitives)
- [Examples](#examples)
- [Where to go next](#where-to-go-next)

## Quickstart (offline, no API keys)

The core move everything else builds on: a driver runs a worker, reads the worker's real output, and writes the next prompt from it until a check passes. This is the full working loop from [`examples/quickstart/quickstart.ts`](./examples/quickstart/quickstart.ts) (the worker is a scripted stand-in so it runs with zero credentials; swap it for a real sandbox, CLI-harness, or router backend without changing the driver):

```ts
import { inProcessSandboxClient, runLoop } from '@tangle-network/agent-runtime/loops'

const result = await runLoop<Task, Note, 'refine' | 'pick-winner' | 'fail'>({
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
  agentRun: { profile: { name: 'note-writer' } as AgentProfile, taskToPrompt: (t) => t.prompt },
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

The fully annotated version of this loop, with every seam explained, is [`examples/driver-loop`](./examples/driver-loop).

## What you do with it

| You want to… | Call |
|---|---|
| Run a **chat turn** for a production product agent | `handleChatTurn(...)` |
| Have one agent **supervise a team of agents** toward a goal | `supervise(profile, task, opts)` |
| **Improve** an agent and prove the gain on fresh tasks | `improve(profile, findings, opts)` |
| Produce a measured knowledge-base candidate with agents and checks | `runKnowledgeImprovementJob(...)` |
| Evaluate or train the same agent on **PrimeIntellect** | `createPrimeIntellectPackage(...)` |

### Run a chat turn

A product agent is one `handleChatTurn` call inside a route. You give it how to produce the response and how to persist it; it streams, traces, and persists.

```ts
import { handleChatTurn } from '@tangle-network/agent-runtime'

const result = handleChatTurn({
  identity: { tenantId, sessionId: threadId, userId, turnIndex: 0 },
  hooks: {
    produce: () => ({ stream: box.streamPrompt(userMessage), finalText: () => box.lastResponse() }),
    persistAssistantMessage: async ({ identity, finalText }) => db.insertMessage(identity, finalText),
  },
  waitUntil,
})
return new Response(result.body, { headers: { 'content-type': result.contentType } })
```

### Supervise a team of agents

One supervisor spawns and steers workers toward a goal. Where the workers run (an in-process loop, or a sandboxed coding harness) is one data value; the budget, journaling, and stopping are handled for you.

```ts
import { supervise } from '@tangle-network/agent-runtime/loops'

const result = await supervise(
  { name: 'supervisor', harness: null, systemPrompt: 'Delegate to workers; do not solve the task yourself.' },
  'Implement the feature and make the tests pass.',
  { budget, router, backend }, // backend = where workers run: router-tools | sandbox+harness | bridge
)
```

### Improve an agent

`improve` optimizes one part of an agent and returns a detached winner plus a decision. The decision is `ship` only when the candidate beats the current agent on tasks it never practiced on.
It accepts prompt, skill document, curated memory, tool, MCP, hook, subagent, whole-profile, and code surfaces through one call.
Prompt, skill-document, and memory optimization have built-in generators; structured profile surfaces take an explicit generator, and code runs from isolated incumbent and candidate checkouts.
Workflow and rollout-policy files use the code surface so the measured winner is an exact patch that can be sealed and executed; JSON parameter sweeps use agent-eval's `parameterSweepProposer` instead of a runtime-specific optimizer.

```ts
import { improve } from '@tangle-network/agent-runtime'

const { candidate, decision, lift } = await improve(baseProfile, findings, {
  surface: 'prompt',
  gate: 'holdout',
  scenarios,
  judge,
  agent,
})

if (decision === 'ship') console.log({ candidate, lift })
```

When the host runs complete profiles rather than mutable fields, use `profileDispatch(profile, scenario, ctx)` in place of `agent`.
It is agent-eval's `ProfileDispatchFn`: Runtime gives it a frozen baseline or candidate profile and the same cost, trace, and cancellation context used for every measured cell.
`profileDispatch` is unavailable for `surface: 'code'`, because code candidates require isolated worktrees.

Skill and curated-memory candidates are exact profile changes, not free-floating text.
Name one inline skill through `skills.resourceName`; curated memory uses `profile.resources.instructions`.
Both require `profile.resources.failOnError: true` so an unsupported resource cannot silently disappear.

```ts
const skillResult = await improve(baseProfile, findings, {
  surface: 'skills',
  skills: { resourceName: 'incident-response' },
  scenarios, judge, agent,
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
  improvement: { surface: 'prompt', scenarios, judge, agent },
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

### Improve a knowledge base

`runKnowledgeImprovementJob` is the runtime-owned front door for KB, wiki, memory-backed, and RAG improvement jobs. It creates a candidate copy, runs supervised agents against it, checks readiness through `@tangle-network/agent-knowledge`, and returns frozen baseline and candidate snapshots with spend and timing. It never changes the live knowledge base. Use `improve(..., { surface: 'memory' })` for the agent's curated lesson document; use this job for source, retrieval, and knowledge-store changes.

```ts
import { runKnowledgeImprovementJob } from '@tangle-network/agent-runtime/knowledge'

const result = await runKnowledgeImprovementJob({
  root: './kb',
  goal: 'Improve support refund-policy knowledge',
  readinessSpecs,
  budget: { maxIterations: 8, maxTokens: 120_000, maxUsd: 10 },
  backend,
})

console.log(result.knowledge?.reference.candidateHash, result.measurement.supervisedSpent)
```

Use it when the product needs one knob for "make this knowledge base better" instead of wiring `improveKnowledgeBase`, a runtime supervisor, candidate workspaces, and readiness checks by hand.
Measure the returned bundle pair, record the review, then activate through `executeAgentImprovementActivation`; activation is the only write path.

### Run on PrimeIntellect

`@tangle-network/agent-runtime/primeintellect` packages typed train and eval tasks as a Verifiers v1 environment.
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
  name: 'support-agent-v1',
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

await writePrimeIntellectPackage(bundle, './prime/support-agent-v1')
```

The runner reads the episode and uses the normal runtime APIs:
Here, `runProductAgent` is the application's existing entry point, not another loop supplied by this adapter.

```ts
import {
  createPrimeIntellectBackend,
  runPrimeIntellectProgram,
} from '@tangle-network/agent-runtime/primeintellect'

await runPrimeIntellectProgram(async (episode) => {
  const backend = createPrimeIntellectBackend(episode)
  return runProductAgent({ task: episode.task, backend })
})
```

Prime writes complete `traces.jsonl` rows.
Use `importPrimeIntellectTraces(...)` to convert them to agent-eval `RunRecord`s for the existing reports and release checks.

## How it works (the short version)

- **One agent, run two ways.** The same agent runs at "do the task" speed and at "get better at the task" speed. "Driver", "worker", and "coordinator" are roles one agent plays, not separate types.
- **Everything is measured.** Every run is a trace: tokens, dollars, time, and a pass/fail score from a real check. "Better" is a number with a denominator, not a vibe, and "equally good but cheaper" is a result you can prove.
- **Improvement is gated.** A change ships only after it beats the current agent on fresh tasks no tuning step ever saw, with a statistical test, not a single lucky run.
- **The grader is honest.** Whatever gives feedback never sees the answer key, and scores are recomputed from the attempts actually run. An agent cannot fabricate its own win.

## Primitives

The general-purpose pieces, by import path. Every export with its one-line summary lives in the generated [`docs/api/primitive-catalog.md`](./docs/api/primitive-catalog.md) — check it before building anything new.

| Primitive | What it does | Import |
|---|---|---|
| Chat-turn runtime | Stream, trace, and persist one production chat turn (`handleChatTurn`); normalize any backend's stream into one event shape (`streamAgentTurn`) | root · `/loops` |
| Supervision | One agent spawns, budgets, and steers workers toward a goal (`supervise`, `delegate`), on an in-process loop or a sandboxed coding harness | `/loops` · `/mcp` |
| Loop kernel + combinators | Write a driver (`plan`/`decide`) and run it (`runLoop`), or compose fixed shapes: refine (`loopUntil`), best-of-N (`fanout`), chain (`pipeline`), multi-judge (`panel`) | `/loops` |
| Improvement driver | Optimize one part of an agent and ship only if it wins on tasks it never practiced on (`improve`); production proposal/review/activation flow | root · `/intelligence` |
| Benchmarks + leaderboards | Compare strategies with significance stats (`runBenchmark`), stand up a harness×model leaderboard (`defineLeaderboard`, `leaderboard`) | `/loops` |
| Knowledge improvement | Produce a measured candidate copy of a KB/wiki/RAG corpus without touching the live one (`runKnowledgeImprovementJob`) | `/knowledge` |
| MCP tool servers | Give an agent a `delegate` tool or live worker-coordination tools over MCP | `/mcp` |
| Conversations + durability | Multi-turn two-agent sessions with SQL-backed resume (D1/pg/sqlite/libSQL adapters) | `/conversation` |
| Training/eval adapter | Package the same runtime program as a PrimeIntellect Verifiers environment; import its traces back | `/primeintellect` |

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
- [`docs/design.md`](./docs/design.md), the design philosophy and the internal research docs behind it — background reading, not required to use the package.
- [`bench/HARNESS.md`](./bench/HARNESS.md), the experiment harness and how to run a benchmark.

**Contributing:** `pnpm i && pnpm build && pnpm test` gets you running; the full local gate is the [`package.json`](./package.json) scripts (`lint`, `typecheck`, `docs:check`).
