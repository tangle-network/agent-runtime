# Chat handler

`handleChatTurn` wraps a product `produce()` hook with the `session.run.*`
lifecycle envelope, drains the producer stream through the NDJSON line
protocol, and calls the persist / post-process hooks after drain.

In production, `produce()` is a thin wrapper over `runAgentTaskStream(...)`
against a real backend (`createOpenAICompatibleBackend` /
`createSandboxPromptBackend`).

```bash
pnpm tsx examples/chat-handler/chat-handler.ts
```
