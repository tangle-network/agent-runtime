# @tangle-network/agent-runtime

The engine Tangle's AI agents run on. It runs an agent as a **chat turn**, a **one-shot task**, or a **team of agents** working toward a goal, records every run, and uses those records to **measure and improve** agents against real pass/fail checks.

One loop, used four common ways. Domain behavior (models, tools, knowledge) plugs in as adapters; the scoring statistics and the ship decision come from [`@tangle-network/agent-eval`](https://www.npmjs.com/package/@tangle-network/agent-eval); sandboxed execution from [`@tangle-network/sandbox`](https://www.npmjs.com/package/@tangle-network/sandbox).

```bash
pnpm add @tangle-network/agent-runtime @tangle-network/agent-eval @tangle-network/sandbox
```

## Contents

- [What you do with it](#what-you-do-with-it)
- [Run a chat turn](#run-a-chat-turn)
- [Supervise a team of agents](#supervise-a-team-of-agents)
- [Improve an agent](#improve-an-agent)
- [Improve a knowledge base](#improve-a-knowledge-base)
- [How it works](#how-it-works-the-short-version)
- [Examples](#examples)
- [Where to go next](#where-to-go-next)

**See it run in 30 seconds** (offline, no keys): the one move everything else builds on, a driver reading a worker's output and composing the next step from it:

```bash
pnpm tsx examples/driver-loop/driver-loop.ts
```

## What you do with it

| You want to… | Call |
|---|---|
| Run a **chat turn** for a production product agent | `handleChatTurn(...)` |
| Have one agent **supervise a team of agents** toward a goal | `supervise(profile, task, opts)` |
| **Improve** an agent and prove the gain on fresh tasks | `improve(profile, findings, opts)` |
| **Improve** a knowledge base with agents, checks, and safe promotion | `runKnowledgeImprovementJob(...)` |

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

`improve` optimizes one part of an agent and **only ships a change if it beats the current agent on tasks it never practiced on**.
It accepts prompt, skill document, curated memory, tool, MCP, hook, subagent, whole-profile, and code surfaces through one call.
Prompt, skill-document, and memory optimization have built-in generators; structured profile surfaces take an explicit generator, and code runs from isolated incumbent and candidate checkouts.
Workflow and rollout-policy files use the code surface so the measured winner is an exact patch that can be sealed and executed; JSON parameter sweeps use agent-eval's `parameterSweepProposer` instead of a runtime-specific optimizer.

```ts
import { improve } from '@tangle-network/agent-runtime'

const { profile, shipped, lift } = await improve(baseProfile, findings, {
  surface: 'prompt',        // or skills/memory/tools/mcp/hooks/subagents/agent-profile/code
  gate: 'holdout',          // certified on a held-back exam, never the practice set
  scenarios, judge, agent,  // how to measure a candidate
})
```

Curated memory is an external lesson document, not a knowledge store. Supply its current text and persist only the promoted winner:

```ts
await improve(baseProfile, findings, {
  surface: 'memory',
  memory: { document: currentLessons, writeBack: saveLessons },
  scenarios, judge, agent,
})
```

### Improve a knowledge base

`runKnowledgeImprovementJob` is the runtime-owned front door for KB, wiki, memory-backed, and RAG improvement jobs. It creates a candidate copy, runs supervised agents against it, checks readiness through `@tangle-network/agent-knowledge`, measures spend and timing, and promotes only when the candidate passes. Use `improve(..., { surface: 'memory' })` for the agent's curated lesson document; use this job for source, retrieval, and knowledge-store changes.

```ts
import { runKnowledgeImprovementJob } from '@tangle-network/agent-runtime/knowledge'

const result = await runKnowledgeImprovementJob({
  root: './kb',
  goal: 'Improve support refund-policy knowledge',
  readinessSpecs,
  budget: { maxIterations: 8, maxTokens: 120_000, maxUsd: 10 },
  backend,
})

console.log(result.promoted, result.measurement.supervisedSpent)
```

Use it when the product needs one knob for "make this knowledge base better" instead of wiring `improveKnowledgeBase`, a runtime supervisor, candidate workspaces, readiness checks, and promotion tracking by hand.

## How it works (the short version)

- **One agent, run two ways.** The same agent runs at "do the task" speed and at "get better at the task" speed. "Driver", "worker", and "coordinator" are roles one agent plays, not separate types.
- **Everything is measured.** Every run is a trace: tokens, dollars, time, and a pass/fail score from a real check. "Better" is a number with a denominator, not a vibe, and "equally good but cheaper" is a result you can prove.
- **Improvement is gated.** A change ships only after it beats the current agent on fresh tasks no tuning step ever saw, with a statistical test, not a single lucky run.
- **The grader is honest.** Whatever gives feedback never sees the answer key, and scores are recomputed from the attempts actually run. An agent cannot fabricate its own win.

## Examples

Runnable, grouped by what they show. Copy the one nearest your task:

| Do this | Example |
|---|---|
| Run a product chat turn | [`chat-handler`](./examples/chat-handler) |
| Drive a team of agents to a goal | [`supervise`](./examples/supervise) · [`recursive-supervisor`](./examples/recursive-supervisor) |
| Benchmark strategies on your own domain | [`coding-benchmark`](./examples/coding-benchmark) |
| Benchmark **harnesses × models** over a real task suite (the real WebCode dataset) | [`webcode-matrix`](./examples/webcode-matrix) |
| Render a **multi-profile leaderboard** with ranked board, score matrix, and SVG/HTML charts | `leaderboard(records)` → `renderLeaderboardMarkdown` / `Svg` / `Html` |
| Trace + bill + effort-gate the WebCode benchmark (the Intelligence SDK) | [`intelligence-webcode`](./examples/intelligence-webcode) |
| Self-improve an agent, gated on a held-out set | [`improve`](./examples/improve) · [`self-improving-coder`](./examples/self-improving-coder) |
| Improve a KB, wiki, or RAG corpus with runtime agents | [`docs/canonical-api.md`](./docs/canonical-api.md) |
| Study coordination vs raw compute | [`ablation-suite`](./examples/ablation-suite) |

All 29 live in [`examples/`](./examples).

## Where to go next

- New here? [`docs/concepts.md`](./docs/concepts.md), the mental model in plain terms.
- [`docs/canonical-api.md`](./docs/canonical-api.md), find the primitive: "I want to ___ → use ___".
- [`docs/api/primitive-catalog.md`](./docs/api/primitive-catalog.md), every export in one generated, never-stale list with its import path. Check it before building anything new.
- Import subpaths: the root export is the product surface (`handleChatTurn`, `improve`); deeper capabilities ship as subpaths: `/loops` (multi-agent + the loop kernel), `/knowledge` (KB improvement), `/mcp` (tool servers), `/intelligence` (observability drop-in), `/lifecycle`, `/agent`, `/profiles`, `/platform`, `/analyst-loop`, `/environment-provider`.
- [`docs/architecture.md`](./docs/architecture.md), the design, end to end.
- [`bench/HARNESS.md`](./bench/HARNESS.md), the experiment harness and how to run a benchmark.

**Contributing:** `pnpm i && pnpm test` gets you running; the full local gate is the [`package.json`](./package.json) scripts (`lint`, `typecheck`, `docs:check`).
