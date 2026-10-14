type: patch
---
Share committed JSONL writes and file locking across Runtime-owned stores. Graph and profile run registries now serialize atomic keyed updates and preserve prior records on corrupt input or failed publication. Keep replacement order and bounded snapshot storage unchanged.

Stop retaining a second full-history message index in router transcript capture; turn events retain only their pending messages while the evidence archive preserves the complete conversation and physical provider receipts.

Run one-shot fixture generation and verification directly through Node's supported tsx loader, removing the unnecessary CLI supervisor and IPC socket.
