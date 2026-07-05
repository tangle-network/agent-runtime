# A cost-and-audit ledger for any agent run — one row, any database

Wrap a running agent task and this records what it cost and what happened: every model call rolls up
into a live tally (tokens in, tokens out, dollars, wall-clock, number of calls), and at the end you
get one durable row — run id, workspace, session, status, cost, start/finish timestamps — written to
whatever store you use through a single `upsert(row)` method. Point that method at Postgres, SQLite,
Cloudflare D1, or an in-memory array; the ledger doesn't care.

## Why it matters

Once agents run in production you need to answer "what did this run cost?" and "did it succeed?" for
every session — for dashboards, billing, and audit. Hand-rolling that means threading cost
accounting through your whole stream and inventing a row schema. This gives you both: a correct cost
tally that ignores everything except model-call events, and a canonical row shape you persist with
one method. Backend-agnostic (works over any agent backend) and store-agnostic (works over any DB).

## How it works

Four calls make up the lifecycle:

1. `startRuntimeRun({ workspaceId, sessionId, agentId, taskSpec, adapter })` opens a run. The
   identity fields land in the persisted row's typed columns; the task spec carries only what
   describes the *work*.
2. `run.observe(event)` on every streamed event keeps the cost tally in sync. Only `llm_call` events
   add to it — everything else is a no-op, so you can safely pipe the *entire* stream through it.
3. `run.complete({ status, resultSummary, error? })` exactly once at end of stream. It's idempotent
   for the same status and throws if you try to change a status after the fact.
4. `run.persist()` writes the row via your adapter; `run.cost()` returns the live tally any time.

## Run — fully offline, no key, no network

```bash
pnpm tsx examples/runtime-run/runtime-run.ts
```

A toy backend emits two model calls and some text, so the ledger has real numbers to add up. You'll
see the accumulated cost, then the exact row that would hit your database:

```
Cost ledger: {
  tokensIn: 1800,
  tokensOut: 390,
  costUsd: 0.0060999999999999995,
  wallMs: 1,
  llmCalls: 2
}
Persisted row: {
  id: 'legal-chat:thread-42:puomxsx1',
  workspaceId: 'ws-1',
  sessionId: 'thread-42',
  agentId: 'legal-chat-runtime',
  domain: 'legal',
  taskId: 'legal-chat:thread-42',
  scenarioId: 'legal-chat:thread-42',
  status: 'completed',
  resultSummary: 'Reviewed',
  cost: { tokensIn: 1800, tokensOut: 390, costUsd: 0.0061, wallMs: 1, llmCalls: 2 },
  startedAt: '...', completedAt: '...',
  metadata: { note: 'demo persistence metadata' }
}
```

`1800` in / `390` out / `2` calls is the tally summed from the two `llm_call` events (1200+600 in,
280+110 out) — proof `observe` only counts model calls.

## Make it real

- **Real work:** replace the toy backend with `createOpenAICompatibleBackend` (any OpenAI-style
  model API), `createSandboxPromptBackend` (a cloud sandbox), or any `AgentExecutionBackend`.
- **Real store:** implement `RuntimeRunPersistenceAdapter` — one `upsert(row)` method — against D1,
  Postgres, or your existing runs table. The row shape doesn't change.

## Files

| file | what it is |
|---|---|
| `runtime-run.ts` | the full lifecycle: open → observe → complete → persist, with a toy backend and in-memory store |
