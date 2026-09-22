# @tangle-network/agent-runtime

Run portable `AgentProfile` definitions through local, CLI, or sandbox providers.
Compose one turn, persistent sessions, multi-agent interactions, worker supervision, and measured improvement without changing the profile format.

## Install

```bash
pnpm add @tangle-network/agent-runtime @tangle-network/agent-interface
```

Add the provider used by your application.
For Tangle Sandbox:

```bash
pnpm add @tangle-network/agent-provider-tangle @tangle-network/sandbox
```

## One Turn

This example runs offline.
Replace the in-process provider with a production provider without changing the profile or `streamAgentTurn` call.

```ts
import { defineAgentProfile } from '@tangle-network/agent-interface'
import {
  inProcessEnvironmentProvider,
  streamAgentTurn,
} from '@tangle-network/agent-runtime/loops'

const profile = defineAgentProfile({
  name: 'reviewer',
  prompt: { systemPrompt: 'Review the input and return concrete findings.' },
})

const provider = inProcessEnvironmentProvider({
  onTurn: (prompt) => [
    { type: 'message.part.updated', data: { part: { type: 'text' }, delta: `Reviewed: ${prompt}` } },
    { type: 'done', data: { tokenUsage: { inputTokens: 4, outputTokens: 3 } } },
  ],
})

for await (const event of streamAgentTurn(
  { kind: 'provider', provider, profile },
  'Check this change.',
)) {
  if (event.type === 'text_delta') process.stdout.write(event.text)
  if (event.type === 'turn_error') throw new Error(event.message)
}
```

`streamAgentTurn` creates and destroys an environment when given a provider.
Pass `{ kind: 'environment', environment }` when the caller already owns one.

## Tangle Sandbox

```ts
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { Sandbox } from '@tangle-network/sandbox'

const provider = createTangleProvider({
  client: new Sandbox({ apiKey: process.env.TANGLE_API_KEY! }),
})
```

Providers own credentials, placement, and execution details.
Profiles own agent behavior: prompts, models, tools, skills, MCP servers, permissions, hooks, and subagents.

## Choose An Entry Point

| Need | Function | Import |
|---|---|---|
| One streamed response | `streamAgentTurn` | `/loops` |
| Several turns in one provider session | `openEnvironmentRun` | `/loops` |
| Named agents taking turns | `runInteraction` | `/interaction` |
| Deterministic code planning bounded rounds | `runAgentRounds` | `/loops` |
| A model creating and steering workers | `supervise` | `/loops` |
| A fixed refinement or search policy | `runStrategy` | `/loops` |
| A production chat HTTP response | `handleChatTurn` | root |
| Compare strategies on the same cases | `runBenchmark` | `/loops` |
| Optimize a profile field or repository code | `improve` | root |
| Build a measured knowledge-base candidate | `runKnowledgeImprovementJob` | `/knowledge` |

Use the smallest function that owns the state you need.

## Persistent Session

`openEnvironmentRun` keeps the same environment and provider session across calls to `turn()`.

```ts
import {
  extractEnvironmentTurnText,
  openEnvironmentRun,
} from '@tangle-network/agent-runtime/loops'

const run = await openEnvironmentRun({
  provider,
  agentRun: {
    profile,
    taskToPrompt: (task: string) => task,
  },
  deliverable: {
    kind: 'events',
    fromEvents: extractEnvironmentTurnText,
  },
  signal: new AbortController().signal,
})

try {
  await run.turn('Inspect the repository.')
  const result = await run.turn('Now focus on the failing tests.')
  console.log(result.output)
} finally {
  await run.close()
}
```

The provider must support session continuation.
Use `resumeFrom` to reattach a provider environment and session after a process restart.

## Multi-Agent Interaction

`runInteraction` gives each actor its own persistent environment and session.
The latest transcript is included in each next turn.

```ts
import { runInteraction } from '@tangle-network/agent-runtime/interaction'

const result = await runInteraction({
  actors: [
    { name: 'author', profile: authorProfile, provider },
    { name: 'reviewer', profile: reviewerProfile, provider },
  ],
  prompt: 'Produce and review a migration plan.',
  policy: {
    maxTurns: 8,
    turnOrder: 'alternate',
    stopWhen: ({ lastTurn }) => lastTurn.text.startsWith('APPROVED:'),
  },
})
```

Add an `InteractionJournal`, stable `runId`, and stable `definitionId` to resume after a process restart.
Runtime includes in-memory, file, and SQL journals.

## Improvement

`improve` evaluates a baseline, lets an Agent Eval optimization method search candidates, and checks the selected candidate on separate cases.
It returns a decision and measured candidate.
It does not mutate the live profile or repository.

Use:

- `@tangle-network/agent-eval` for cases, judges, comparisons, and official optimizer integrations such as GEPA and SkillOpt.
- `@tangle-network/agent-knowledge` for sources, indexing, retrieval, memory adapters, and knowledge evaluation.
- `runKnowledgeImprovementJob` when Runtime agents should research and edit an isolated knowledge-base candidate.
- `@tangle-network/agent-runtime/primeintellect` to package the same multi-turn program for PrimeIntellect runs.

See [canonical-api.md](./docs/canonical-api.md) for entry-point examples and [the generated API](./docs/api/) for signatures.

## Package Boundaries

```text
agent-interface   profiles and provider contracts
agent-eval        cases, scoring, comparison, optimization
agent-knowledge   knowledge state, retrieval, memory, evaluation
agent-runtime     execution, coordination, and improvement workflows
```

Applications own authentication, storage, product policy, and UI.

## Examples

| Task | Example |
|---|---|
| One provider turn | [`quickstart`](./examples/quickstart) |
| Persistent driver and worker rounds | [`driver-loop`](./examples/driver-loop) |
| Two persistent agents | [`interaction`](./examples/interaction) |
| Dynamic worker supervision | [`supervise`](./examples/supervise) |
| Product chat response | [`chat-handler`](./examples/chat-handler) |
| Strategy comparison | [`coding-benchmark`](./examples/coding-benchmark) |
| Redacted telemetry | [`sanitized-telemetry-streaming`](./examples/sanitized-telemetry-streaming) |

Start with [Concepts](./docs/concepts.md), then use [Runtime API](./docs/canonical-api.md) to choose a function.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```
