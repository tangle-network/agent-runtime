# Chat handler

The centerpiece production pattern every product chat handler implements.
`chatTurnEngine.runTurn` wraps a product `produce()` hook with the
`session.run.*` lifecycle envelope, drains the producer stream through
the NDJSON line protocol, and calls the persist / post-process hooks
after drain.

The engine owns no execution state. Long-running execution durability
lives in the substrate: `@tangle-network/sandbox`'s `box.streamPrompt({
executionId, lastEventId })` buffers the stream by `executionId`,
replays strictly after `lastEventId` on reconnect, and never spawns a
duplicate execution. `deriveExecutionId({ projectId, sessionId,
turnIndex })` gives a stable id products persist alongside their
session row.

In production, `produce()` is a thin wrapper over `runAgentTaskStream(...)`
against a real backend (`createOpenAICompatibleBackend` /
`createSandboxPromptBackend`).

```bash
pnpm tsx examples/chat-handler/chat-handler.ts
```
