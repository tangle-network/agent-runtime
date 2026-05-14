# runtime-run

Canonical `RuntimeRunHandle` lifecycle: drive a streaming task through
`runAgentTaskStream`, observe `llm_call` events into a cost ledger, and
persist a `RuntimeRunRow` to your durable store.

Use as the replacement for bespoke `agentRuns`-row plumbing (legal-agent's
`completeProductionAgentRun` + `persistRuntimeRun` pair is the canonical
example of what this pattern subsumes).

## Run

```bash
pnpm tsx examples/runtime-run/runtime-run.ts
```

## What it shows

- `startRuntimeRun({ workspaceId, sessionId, taskSpec, adapter })` to open a run
- `handle.observe(event)` per yielded `RuntimeStreamEvent` to keep the cost
  ledger in sync (only `llm_call` events contribute; everything else is a
  no-op so you can pipe the whole stream through `observe`)
- `handle.complete({ status, resultSummary, error? })` exactly once at end-of-
  stream (idempotent for the same status, throws for status transitions)
- `handle.persist()` to write a `RuntimeRunRow` via your
  `RuntimeRunPersistenceAdapter` (D1, postgres, KV — anything with an
  `upsert(row)`)
- `handle.cost()` returns the accumulated `{ tokensIn, tokensOut, costUsd,
  wallMs, llmCalls }` for cost dashboards
