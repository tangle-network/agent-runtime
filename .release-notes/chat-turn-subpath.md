type: patch
---
Add `@tangle-network/agent-runtime/chat-turn`: `handleChatTurn`, `deriveExecutionId` and the chat turn types without the `durable` entry's file-backed supervision, campaigns and agent-eval, so a Worker running chat turns does not load them at startup.
