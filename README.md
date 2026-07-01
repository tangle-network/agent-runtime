# @tangle-network/agent-runtime

The engine Tangle's AI agents run on. It runs an agent — a **chat turn**, a **one-shot task**, or a **team of agents** working toward a goal — records every run, and uses those records to **measure and improve** agents against real pass/fail checks.

One loop, used three ways. Domain behavior (models, tools, knowledge) plugs in as adapters; the scoring statistics and the ship decision come from [`@tangle-network/agent-eval`](https://www.npmjs.com/package/@tangle-network/agent-eval); sandboxed execution from [`@tangle-network/sandbox`](https://www.npmjs.com/package/@tangle-network/sandbox).

```bash
pnpm add @tangle-network/agent-runtime @tangle-network/agent-eval @tangle-network/sandbox
```

## What you do with it

| You want to… | Call |
|---|---|
| Run a **chat turn** — what every product agent does in production | `handleChatTurn(...)` |
| Have one agent **supervise a team of agents** toward a goal | `supervise(profile, task, opts)` |
| **Improve** an agent and prove the gain on fresh tasks | `improve(profile, findings, opts)` |

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

`improve` optimizes one part of an agent (its prompt, skills, or code) and **only ships a change if it beats the current agent on tasks it never practiced on** — so registering an agent for self-improvement can never make it worse.

```ts
import { improve } from '@tangle-network/agent-runtime'

const { profile, shipped, lift } = await improve(baseProfile, findings, {
  surface: 'prompt',        // what to optimize: prompt | skills | code
  gate: 'holdout',          // certified on a held-back exam, never the practice set
  scenarios, judge, agent,  // how to measure a candidate
})
```

## How it works (the short version)

- **One agent, run two ways.** The same agent runs at "do the task" speed and at "get better at the task" speed. "Driver", "worker", and "coordinator" aren't separate types — they're roles one agent plays.
- **Everything is measured.** Every run is a trace: tokens, dollars, time, and a pass/fail score from a real check. "Better" is a number with a denominator, not a vibe — and "equally good but cheaper" is a result you can prove.
- **Improvement is gated.** A change ships only after it beats the current agent on fresh tasks no tuning step ever saw, with a statistical test — not a single lucky run.
- **The grader is honest.** Whatever gives feedback never sees the answer key, and scores are recomputed from the attempts actually run — an agent can't fabricate its own win.

## Examples

Runnable, grouped by what they show — copy the one nearest your task:

| Do this | Example |
|---|---|
| Run a product chat turn | [`chat-handler`](./examples/chat-handler) |
| Drive a team of agents to a goal | [`supervise`](./examples/supervise) · [`recursive-supervisor`](./examples/recursive-supervisor) |
| Benchmark strategies on your own domain | [`coding-benchmark`](./examples/coding-benchmark) |
| Benchmark **harnesses × models** over a real task suite (the real WebCode dataset) | [`webcode-matrix`](./examples/webcode-matrix) |
| Render a **multi-profile leaderboard** — ranked board + score matrix + SVG/HTML charts, any domain | `leaderboard(records)` → `renderLeaderboardMarkdown` / `Svg` / `Html` |
| Trace + bill + effort-gate the WebCode benchmark (the Intelligence SDK) | [`intelligence-webcode`](./examples/intelligence-webcode) |
| Self-improve an agent, gated on a held-out set | [`improve`](./examples/improve) · [`self-improving-coder`](./examples/self-improving-coder) |
| Study coordination vs raw compute | [`ablation-suite`](./examples/ablation-suite) |

All 28 live in [`examples/`](./examples).

## Where to go next

- New here? [`docs/concepts.md`](./docs/concepts.md) — the mental model in plain terms.
- [`docs/canonical-api.md`](./docs/canonical-api.md) — find the primitive: "I want to ___ → use ___".
- [`docs/architecture.md`](./docs/architecture.md) — the design, end to end.
- [`bench/HARNESS.md`](./bench/HARNESS.md) — the experiment harness and how to run a benchmark.
