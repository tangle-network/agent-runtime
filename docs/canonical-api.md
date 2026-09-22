# Runtime API

`AgentProfile` defines an agent.
`AgentEnvironmentProvider` decides where and how that profile runs.
Runtime functions compose turns, sessions, agents, and improvement work.

## Pick The Smallest Entry Point

| Need | Use |
|---|---|
| One streamed agent response | `streamAgentTurn` |
| Several turns in one persistent agent session | `openEnvironmentRun` |
| Two or more agents taking turns | `runInteraction` |
| A driver planning bounded batches of agent work | `runAgentRounds` |
| A model creating and steering workers at runtime | `supervise` |
| A fixed optimization strategy | `runStrategy` |
| A model and local tools in one process | `runToolLoop` |
| A production chat HTTP response | `handleChatTurn` |
| Compare strategies on the same tasks | `runBenchmark` |
| Optimize a profile field or repository code | `improve` |
| Produce a reviewable knowledge-base candidate | `runKnowledgeImprovementJob` |

Do not add another execution wrapper when one row already matches the job.
Do not put provider credentials or connection settings in an `AgentProfile`.

## Core Types

An `AgentProfile` is portable configuration: prompts, models, tools, skills, MCP servers, permissions, hooks, and subagents.

An `AgentEnvironmentProvider` validates a profile and creates an `AgentEnvironment`.
Providers may offer sessions, workspace access, branching, placement details, and usage data.
Runtime checks required capabilities before using them.

An `AgentEnvironment` is one live execution workspace.
Its `stream` method runs a turn.
Its `destroy` method releases owned resources.

## One Turn

```ts
import { defineAgentProfile } from '@tangle-network/agent-interface'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { streamAgentTurn } from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'

const provider = createTangleProvider({
  client: new Sandbox({ apiKey: process.env.TANGLE_API_KEY! }),
})

const profile = defineAgentProfile({
  name: 'reviewer',
  prompt: { systemPrompt: 'Review the change and return concrete findings.' },
})

for await (const event of streamAgentTurn(
  { kind: 'provider', provider, profile },
  'Review pull request 42.',
)) {
  if (event.type === 'text_delta') process.stdout.write(event.text)
  if (event.type === 'turn_error') throw new Error(event.message)
}
```

Passing a provider creates and destroys one environment for the turn.
Passing an existing environment leaves its lifecycle with the caller.

## Persistent Session

```ts
import { openEnvironmentRun } from '@tangle-network/agent-runtime/loops'

const run = await openEnvironmentRun<string>({
  provider,
  agentRun: {
    profile,
    taskToPrompt: (task) => task,
  },
  signal: new AbortController().signal,
  deliverable: {
    kind: 'events',
    fromEvents: (events) =>
      events
        .filter((event) => event.type === 'message.part.updated')
        .map((event) => String(event.data?.delta ?? ''))
        .join(''),
  },
})

try {
  await run.turn('Inspect the repository.')
  const answer = await run.turn('Now focus on the failing tests.')
  console.log(answer.output)
} finally {
  await run.close()
}
```

`openEnvironmentRun` requires provider session continuation and uses the same provider session for every `turn()` call.
Call `close` in a `finally` block.

## Multi-Agent Interaction

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

Each actor keeps its own environment and session across turns.
Use an `InteractionJournal` with a stable `runId` and `definitionId` to resume after a process restart.

## Provider Choice

- `createTangleProvider` runs profiles in Tangle Sandbox.
- `createCliBridgeProvider` runs profiles through CLI Bridge.
- `localEnvironmentProvider` runs a trusted profile with local router and stdio MCP access.
- `inProcessEnvironmentProvider` is for deterministic tests and same-process callbacks.
- `inlineEnvironmentProvider` adapts an existing Runtime executor.
- Implement `AgentEnvironmentProvider` when another service owns execution.

Construct providers once at the application boundary and pass them into Runtime.
Use a provider registry only when configuration selects among several providers by name.

## Ownership Rules

- Runtime owns execution flow, limits, cancellation, event projection, and resource cleanup.
- Agent Interface owns portable profile and provider contracts.
- Agent Eval owns cases, scoring, comparisons, traces, and optimizer contracts.
- Agent Knowledge owns sources, indexes, retrieval, memory adapters, and knowledge evaluation.
- Applications own authentication, policy, UI, domain tools, and persistence choices.

Generated signatures and every public export live in [`docs/api`](./api/).
