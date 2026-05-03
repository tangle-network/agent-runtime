# agent-runtime

Reusable runtime lifecycle for domain-specific agents.

`agent-runtime` is the shared skeleton for tax, legal, GTM, creative,
agent-builder generated agents, blueprint-agent, redteam, and similar packages.
It does not own domain policy, tools, connectors, or UI. It standardizes the
task lifecycle and delegates domain behavior to an adapter.

```txt
TaskSpec
  -> Knowledge readiness
  -> Question / acquisition decision
  -> Agent control loop
  -> Eval / verification
  -> Run evidence
```

## Install

```bash
pnpm add @tangle-network/agent-runtime @tangle-network/agent-eval
```

## Usage

```ts
import { runAgentTask } from '@tangle-network/agent-runtime'

const result = await runAgentTask({
  task: {
    id: 'tax-2026-return-review',
    intent: 'Review the return for missing evidence',
    domain: 'tax',
    requiredKnowledge: [{
      id: 'filing-status',
      description: 'Taxpayer filing status',
      requiredFor: ['return-review'],
      category: 'user_specific',
      acquisitionMode: 'ask_user',
      importance: 'blocking',
      freshness: 'static',
      sensitivity: 'private',
      confidenceNeeded: 1,
      currentConfidence: 0,
      evidenceIds: [],
      fallbackPolicy: 'ask',
    }],
  },
  adapter,
})
```

If knowledge readiness fails, `runAgentTask` stops before domain actions by
default. Adapters can override `onKnowledgeBlocked` to emit a domain action,
such as asking a user, querying a connector, or inspecting a repo.

`runAgentTask` also emits typed lifecycle events through `onEvent`:

```ts
await runAgentTask({
  task,
  adapter,
  knowledge,
  onEvent(event) {
    console.log(event.type)
  },
})
```

Events cover readiness, question answering, acquisition, control-loop steps,
and task completion. This keeps streaming UI, logs, and telemetry out of domain
adapters while making every runtime transition observable.

Knowledge providers may implement:

- `buildReadiness`
- `answerQuestions`
- `executeAcquisitionPlans`
- `refreshReadiness`

That lets a task collect missing context before the control loop starts, then
rerun readiness scoring against the new evidence.

## Package Boundaries

- `agent-runtime` owns the reusable lifecycle and adapter contracts.
- `agent-eval` owns control loops, readiness scoring, traces, evals, failure
  classes, optimization, and release evidence.
- `agent-knowledge` owns evidence, claims, wiki pages, retrieval, and knowledge
  bundle builders.
- Domain packages own domain tools, policies, credentials, UI text, and rubrics.

The primary API intentionally uses `runAgentTask`, not `runVerticalAgentTask`.
`domain` is metadata on the task, because the runtime should be reusable across
many kinds of agents without baking taxonomy into type names.
