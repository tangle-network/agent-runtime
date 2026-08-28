# @tangle-network/agent-runtime

The execution substrate for exact, measurable agent runs.

Runtime turns an `AgentProfile` into a real execution, coordinates one or many agents under conserved budgets, records what actually happened, and keeps candidate promotion separate from live activation. It does not own benchmark claims or a research archive.

```bash
pnpm add @tangle-network/agent-runtime @tangle-network/agent-eval @tangle-network/sandbox
```

## What belongs here

- **Exact execution** — one declared harness, provider, model, tool surface, and profile must be the execution that actually runs.
- **Agent control** — turns, tool loops, retries, supervision trees, graph traversals, steering, cancellation, and durable resume.
- **Truthful accounting** — outputs, failures, tokens, dollars, timing, traces, materialization receipts, and provider identity remain observed facts; unknown never becomes zero or success.
- **Independent completion checks** — a worker is delivered because a check passed, not because the worker said it finished.
- **A narrow improvement boundary** — Runtime can hand a frozen profile surface to a complete optimization method, then independently re-measure the selected candidate on a final-test partition. Search and activation remain detached.

`@tangle-network/agent-eval` owns scoring, statistical comparison, analyst contracts, and optimization-method interfaces. `@tangle-network/sandbox` owns isolated execution. These packages release independently; compatibility is proven through packed-consumer tests rather than by pretending they are one package.

## What does not belong here

- paid benchmark campaigns, result archives, or claims that a method improves a real benchmark;
- benchmark-specific proxy rewards presented as task success;
- successive generations of research scripts or one-off experiment dashboards;
- a second optimizer, evaluator, agent loop, or sandbox implementation hidden in an example.

Runtime keeps compact integration fixtures. Research questions and preregistrations belong in Discovery; reproducibility campaigns and long-horizon value evidence belong in Discovery Lab.

## Quickstart: one exact offline run

This is [`examples/quickstart/minimal.ts`](./examples/quickstart/minimal.ts). It runs without credentials.

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

const worker = inProcessSandboxClient({
  onPrompt: (): SandboxEvent[] => [
    { type: 'result', data: { result: { note: 'Shipped one-click restore.' } } },
  ],
})

const result = await runAgentRounds({
  task: 'Write a one-line release note for one-click restore.',
  driver: {
    plan: async (task, history) => (history.length === 0 ? [task] : []),
    decide: (): TerminalDecision => 'done',
  },
  agentRun: { profile, taskToPrompt: (task) => task },
  output: { parse: (events) => events },
  ctx: { sandboxClient: worker },
})

console.log(`decision: ${result.decision} — ${result.iterations.length} iteration(s)`)
```

```bash
pnpm i && pnpm build
pnpm tsx examples/quickstart/minimal.ts
```

## The core vocabulary

| Word | Meaning |
|---|---|
| **profile** | The complete behavioral declaration: harness, provider/model, prompt, tools, MCP, permissions, resources, hooks, and subagents. |
| **worker** | An agent that performs one assigned unit of work. |
| **driver / supervisor** | An agent or deterministic policy that observes work and decides what happens next. |
| **verdict** | An independently produced validity/score record. |
| **harness** | What drives the profile. `cli-base` is direct model execution; `claude-code`, `codex`, `opencode`, and `prime` run agent harnesses. The complete vocabulary is `HarnessType` in `@tangle-network/agent-interface`. |
| **delivery** | A settled result that passed the caller's completion check. Settlement alone is not delivery. |

## Choose a front door

| Front door | Use it for | Runnable example |
|---|---|---|
| `runAgentTaskStream` | one agent turn and a normalized event stream | [`stream-a-turn`](./examples/stream-a-turn) |
| `handleChatTurn` | one streamed HTTP chat turn plus persistence | [`chat-handler`](./examples/chat-handler) |
| `runToolLoop` | a model calling tools until it answers or stops | [`tool-loop`](./examples/tool-loop) |
| `startRuntimeRun` | one durable run record and cost ledger | [`runtime-run`](./examples/runtime-run) |
| `runAgentRounds` | caller-authored plan/decide loops | [`quickstart`](./examples/quickstart) |
| `supervise` | a manager agent driving workers under one budget | [`supervise`](./examples/supervise) |
| `runGraph` | a fixed topology expressed as data | [`graphs`](./examples/graphs) |
| `startRetainedRun` | work that must outlive the initiating process | [`retained-run`](./examples/retained-run) |
| `improve` | a detached candidate plus an independent final-test comparison | [`improve`](./examples/improve) |

Five mechanisms continue interrupted work; choose by what died:

- HTTP connection: reconnect with the same execution identity.
- Same live box, next turn: continue the sandbox session.
- Coordinator process: `supervise({ runDir })`.
- User conversation: the `/conversation` store adapters.
- Initiating process: a retained run owned by the provider.

## Truthfulness before value

Runtime's release checks prove that the declared profile reaches the selected backend.
They read the actual provider identity when available.
In-band failures cannot settle as empty success.
Approval, question, and plan waits remain resumable, while failed turns keep observed spend.
Budgets reconcile, resume identity is stable, and packed consumers install the supported package cohort.

Those are **integration proofs**, not benchmark-value proofs.

`pnpm verify:official-optimizers` verifies the official GEPA/Optimize Anything bridge, recipe identities, resume behavior, accounting, and package provenance on a controlled fixture. It does not claim to reproduce GEPA, Omni, AutoResearch, or Meta-Harness benchmark lift. Full benchmark reproduction belongs in Discovery Lab, using the benchmark's own evaluator, matched budgets, frozen partitions, and immutable receipts.

The same boundary applies to trace analysts, Prime Agent RLM, and DSPy RLM: Runtime may expose the execution seam, but analyst quality and benchmark lift must be established outside this repository.

## Other supported surfaces

- **Durable pursuit observer** — append-only third-person supervision records and projections: [`docs/api/durable.md`](./docs/api/durable.md).
- **Knowledge improvement jobs** — candidate copies and measured activation boundaries: [`docs/improve.md`](./docs/improve.md).
- **PrimeIntellect packaging** — expose a Runtime program as a Verifiers environment: [`docs/primeintellect.md`](./docs/primeintellect.md).
- **MCP** — delegation and live coordination tools under `/mcp`.
- **Telemetry** — Runtime hooks and OpenTelemetry GenAI spans.
- **Live operations** — `agent-runtime-top` for observe, steer, and cancel.
- **Intelligence integration** — the `/intelligence` adapter remains available, but it is not on Runtime's critical release path.

## Repository map

- [`examples/README.md`](./examples/README.md) — the compact learning path. Examples prove APIs, not benchmark superiority.
- [`docs/canonical-api.md`](./docs/canonical-api.md) — “I want to X → use Y.”
- [`docs/api/primitive-catalog.md`](./docs/api/primitive-catalog.md) — generated public surface.
- [`docs/improve.md`](./docs/improve.md) — exact improvement, proposal, review, and activation contracts.
- [`bench/HARNESS.md`](./bench/HARNESS.md) — supported integration and benchmark entry points, plus the evidence-level rules.
- [`docs/STABILITY.md`](./docs/STABILITY.md) — stability promises.

## Contributing

```bash
pnpm i
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm docs:check
```

A new example must demonstrate a public entry point that no existing example already teaches. A new benchmark script must either be a reusable adapter/integration fixture or live in Discovery Lab with a preregistration and result receipt.
