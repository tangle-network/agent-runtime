# Durable chat handler

The centerpiece production pattern every product chat handler
implements. `DurableChatTurnEngine.runTurn` composes the substrate
stack:

- Builds the durable manifest from the chat identity (`tenantId` /
  `sessionId` / `turnIndex`).
- Drives `runDurableTurn` — checkpoint + replay.
- Emits `session.run.*` lifecycle events around the producer stream.
- Returns a `ReadableStream` of NDJSON-encoded `ChatStreamEvent`s — the
  shape your HTTP/SSE route forwards verbatim.

The example shows:

- A fresh turn streaming events (the dots are `message.part.updated`).
- A second, different turn — a fresh `runId`, the producer runs again.
- A retry of turn 0 — same identity → same `runId` → the **replay path**
  emits the cached final text without re-running the producer.

In production, `produce()` is a thin wrapper over `runAgentTaskStream(...)`
against a real backend (`createOpenAICompatibleBackend` /
`createSandboxPromptBackend`). For the cross-worker-during-turn case —
worker dies *while* streaming — use `runSupervisedTurn` (see
`examples/durable-supervisor/`).

```bash
pnpm tsx examples/chat-handler/chat-handler.ts
```
