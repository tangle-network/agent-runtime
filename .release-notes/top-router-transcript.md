type: minor
---

`agent-runtime-top --web` shows a `router` or `router-tools` worker's conversation: assistant text, tool calls and tool results. These executors run their tool loop in process and stream no progress, so 2.3.0's node streams never covered them ("every worker" overstated it). They retain the conversation as a harness transcript at settlement, and the viewer now renders that transcript when a worker has no stream file, in place of "Native conversation was not captured". `WorkerView` (from `@tangle-network/agent-runtime/tui`) gains optional `transcript: { ref, harness }`, the settled worker's retained-conversation receipt.
