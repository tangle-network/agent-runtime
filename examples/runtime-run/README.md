# Record what a run cost

## When to use it

Use this when you must record what a run cost and whether it succeeded.
`startRuntimeRun` opens a run handle, keeps a live tally from the stream, and writes one canonical row through your store adapter.
The tally counts model calls only, so you can pipe the whole stream through it.

Use a sibling instead when cost is not the question.
[`../stream-a-turn`](../stream-a-turn) is the same stream with no ledger.
[`../chat-handler`](../chat-handler) adds the HTTP framing and the message write.
[`../sanitized-telemetry-streaming`](../sanitized-telemetry-streaming) redacts user data before you log it.

## How to use it

```bash
pnpm build && pnpm tsx examples/runtime-run/runtime-run.ts
```

The example runs offline.
A toy backend emits two model calls, so the ledger has real numbers:

```text
Cost ledger: { tokensIn: 1800, tokensOut: 390, costUsd: 0.0061, wallMs: 1, llmCalls: 2 }
Persisted row: {
  id: 'legal-chat:thread-42:puomxsx1',
  workspaceId: 'ws-1', sessionId: 'thread-42', agentId: 'legal-chat-runtime',
  status: 'completed', resultSummary: 'Reviewed',
  cost: { tokensIn: 1800, tokensOut: 390, costUsd: 0.0061, wallMs: 1, llmCalls: 2 },
  startedAt: '...', completedAt: '...'
}
```

The tally sums the two `llm_call` events (1200+600 in, 280+110 out), which proves `observe` counts model calls only.

Four calls make the lifecycle.

1. `startRuntimeRun({ workspaceId, sessionId, agentId, taskSpec, adapter })` opens the run. The identity lands in typed columns; the task spec describes only the work.
2. `run.observe(event)` on every streamed event keeps the tally correct.
3. `run.complete({ status, resultSummary, error })` once, at the end of the stream. It is idempotent for the same status and refuses a changed status.
4. `run.persist()` writes the row. `run.cost()` returns the live tally at any time.

Implement `RuntimeRunPersistenceAdapter` — one `upsert(row)` method — against D1, Postgres, SQLite, or your existing runs table.
The row shape does not change.

## Why this exists

Once agents run in production, two questions arrive for every session: what did this cost, and did it work.
Answering them by hand means threading cost accounting through the whole stream and inventing a row schema.
This gives you a correct tally and one canonical row, over any backend and any store.
