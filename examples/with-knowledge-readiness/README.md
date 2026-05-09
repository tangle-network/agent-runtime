# with-knowledge-readiness

A task that declares required knowledge. The runtime scores readiness
before running the control loop and stops if a blocking requirement is
missing. The adapter's `onKnowledgeBlocked` hook lets you convert the
block into a domain action (asking the user, querying a connector, etc.)
instead of failing the run.

## Run

```bash
pnpm tsx examples/with-knowledge-readiness/with-knowledge-readiness.ts
```

## What it shows

- `task.requiredKnowledge` — declaring what the task needs to know
- The runtime's default readiness scoring (no provider needed for the
  basic case) — `result.knowledge.readinessScore` and
  `result.knowledge.recommendedAction`
- `adapter.onKnowledgeBlocked` — converting a block into a domain action

## When you do need a knowledge provider

Pass an `AgentKnowledgeProvider` when you want to:

- Pull evidence/answers from your own DB or connectors before scoring
  (`buildReadiness`)
- Resolve user questions yourself instead of letting the runtime emit
  them (`answerQuestions`)
- Run acquisition plans (`executeAcquisitionPlans`) and re-score
  (`refreshReadiness`)

The provider interface is fully optional — every method has a default
fallback.
