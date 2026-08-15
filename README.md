# @tangle-network/agent-runtime

A TypeScript runtime for chat agents, one-shot tasks, and agent teams.
It records each run so you can measure changes against real pass/fail checks and improve the agent without changing your product integration.

Domain behavior (models, tools, knowledge) plugs in as adapters; the scoring statistics and the ship decision come from [`@tangle-network/agent-eval`](https://www.npmjs.com/package/@tangle-network/agent-eval); sandboxed execution from [`@tangle-network/sandbox`](https://www.npmjs.com/package/@tangle-network/sandbox).

```bash
pnpm add @tangle-network/agent-runtime @tangle-network/agent-eval @tangle-network/sandbox
```

New here? Read [`docs/concepts.md`](./docs/concepts.md) for the mental model in plain terms, then pick a front door below.

## Quickstart (offline, no API keys)

One agent attempt, run by a loop you control.
This is [`examples/quickstart/minimal.ts`](./examples/quickstart/minimal.ts) in full: it compiles and runs as pasted, with no credentials.

```ts
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  inProcessSandboxClient,
  runAgentRounds,
  type TerminalDecision,
} from '@tangle-network/agent-runtime/kernel'
import type { SandboxEvent } from '@tangle-network/sandbox'

const profile = {
  name: 'note-writer',
  harness: 'cli-base',
  model: { provider: 'scripted', default: 'scripted/note-writer' },
} satisfies AgentProfile

// A scripted worker. Swap in a sandbox, CLI-harness, or router backend later.
const worker = inProcessSandboxClient({
  onPrompt: (): SandboxEvent[] => [
    { type: 'result', data: { result: { note: 'Shipped one-click restore.' } } },
  ],
})

const result = await runAgentRounds({
  task: 'Write a one-line release note for one-click restore.',
  driver: {
    // plan returns the tasks to run this iteration; [] means no more work.
    plan: async (task, history) => (history.length === 0 ? [task] : []),
    // 'done' is one of the four kernel keywords in TERMINAL_DECISIONS.
    decide: (): TerminalDecision => 'done',
  },
  agentRun: { profile, taskToPrompt: (t) => t },
  output: { parse: (events) => events },
  ctx: { sandboxClient: worker },
})

console.log(`decision: ${result.decision} — ${result.iterations.length} iteration(s)`)
```

Run it from a clone of this repo and you get exactly this:

```bash
$ pnpm i && pnpm build
$ pnpm tsx examples/quickstart/minimal.ts
decision: done — 1 iteration(s)
```

[`examples/quickstart`](./examples/quickstart) grows the same call into a loop that reads each output and writes the next prompt from it.

Five words appear everywhere:

| Word | What it means |
|---|---|
| **worker** | An agent that produces an answer. Here it is a `SandboxClient`. |
| **driver** | Your code. It runs a worker, reads the output, and writes the next prompt. |
| **decision** | What `decide` returns. The four keywords in `TERMINAL_DECISIONS` (`stop`, `pick-winner`, `fail`, `done`) end the loop; every other value is your own vocabulary and continues it. |
| **verdict** | What a validator returns: valid or not, with a score. |
| **harness** | What drives an agent: an in-process model loop (`cli-base`), or a coding CLI such as `claude-code`, `codex`, or `opencode`. |

## Which front door

One row per entry point, ordered by how often real products use it.
Each row links to a runnable example.

| Front door | When to call it | What you give it | What you get back |
|---|---|---|---|
| **`runAgentTaskStream`** · [example](./examples/stream-a-turn) | You run one agent turn and read its events yourself. | a task, a backend, a message | an async stream of `RuntimeStreamEvent` |
| **`handleChatTurn`** (`/durable`) · [example](./examples/chat-handler) | A web route must stream one turn to a browser and save the reply. | how to produce tokens, how to persist | an HTTP body plus a persist call after the last token |
| **`AgentExecutionBackend`** · [example](./examples/stream-backends) | You choose where the tokens come from: your loop, a sandbox, or an exact profile. | `kind` plus a `stream()` generator | the same event union from any source |
| **`runToolLoop`** (`/tool-loop`) · [example](./examples/tool-loop) | The model must call your tools and answer in the same turn. | one model turn, your executors | final text, every tool outcome, a stop reason |
| **`startRuntimeRun`** · [example](./examples/runtime-run) | You must record what a run cost and whether it succeeded. | run identity, a store adapter | a live cost tally and one persisted row |
| **`runAgentRounds`** (`/kernel`) · [example](./examples/quickstart) | One prompt is not enough, and your code owns the stop rule. | `plan`, `decide`, an output adapter, a sandbox client | every attempt, the verdicts, and a winner |
| **`supervise`** (`/kernel`) · [example](./examples/supervise) | A model must decide the plan and drive other agents. | a supervisor profile, a goal, a budget | the delivered result, or a typed reason and the spend |
| **`startRetainedRun`** (`/kernel`) · [example](./examples/retained-run) | The job must outlive the process that started it. | a provider, keys, a durable admission hook | a claim ticket any process can reattach to |
| **`improve`** · [example](./examples/improve) | You must change one part of an agent and prove the gain. | a profile field, three case sets, a judge | a detached candidate, a lift interval, ship or hold |

Five mechanisms continue interrupted work.
Pick by what died: the HTTP connection (`streamPrompt` with the same `executionId`), nothing but you want the same box (`openSandboxRun`), the coordinator process (`supervise({ runDir })`), the user's chat session (`/conversation` stores), or everything except the provider ([retained runs](./examples/retained-run)).

## Also in the box

- **Benchmarks and leaderboards** — compare strategies with significance stats (`runBenchmark`), or stand up a harness×model board (`defineLeaderboard`): [`examples/coding-benchmark`](./examples/coding-benchmark), [`examples/webcode-matrix`](./examples/webcode-matrix).
- **Agent graphs** — fixed topologies authored as data and run through `runGraph`: [`examples/graphs`](./examples/graphs).
- **Improve a knowledge base** — a measured candidate copy of a KB, wiki, or RAG corpus: [`docs/improve.md`](./docs/improve.md).
- **PrimeIntellect** — package the same runtime program as a Verifiers environment: [`docs/primeintellect.md`](./docs/primeintellect.md).
- **Conversations** (`/conversation`) — multi-turn two-agent sessions with SQL-backed resume.
- **MCP servers** (`/mcp`) — give any agent a `delegate` tool plus live coordination tools.
- **Live run view** (`/tui`) — `agent-runtime-top` shows every supervisor run in a workspace, with steer and cancel.
- **Telemetry** — every loop emits `loop.*` trace events, exported as OpenTelemetry GenAI spans when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

All 33 examples live in [`examples/`](./examples).

## How it works (the short version)

- **Roles are configuration.** Driver, worker, and coordinator describe what an agent does in a run. They are not separate agent types.
- **Runs are recorded.** A run can report tokens, dollars, time, outputs, and scores.
- **Candidates face fresh tasks.** The optimizer uses train and selection tasks. Promotion uses a separate final set.
- **Scores come from executed attempts.** Runtime recomputes results from the recorded cells and rejects incomplete cost or source evidence.

## Where to go next

- [`docs/concepts.md`](./docs/concepts.md), the mental model in plain terms.
- [`docs/canonical-api.md`](./docs/canonical-api.md), find the primitive: "I want to ___ → use ___".
- [`docs/api/primitive-catalog.md`](./docs/api/primitive-catalog.md), every export in one generated, never-stale list with its import path. Check it before building anything new.
- [`docs/improve.md`](./docs/improve.md), the improvement reference: optimizers, surfaces, redaction, proposal, review, activation.
- [`docs/STABILITY.md`](./docs/STABILITY.md), what `@stable` and `@experimental` promise you, and how a symbol graduates.
- [`docs/design.md`](./docs/design.md), the design philosophy and the research behind it: background reading, not required to use the package.
- [`bench/HARNESS.md`](./bench/HARNESS.md), the experiment harness and how to run a benchmark.

**Contributing:** `pnpm i && pnpm build && pnpm test` gets you running; the full local gate is the [`package.json`](./package.json) scripts (`lint`, `typecheck`, `docs:check`).
