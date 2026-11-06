type: patch
---
- `spawn_worker` admits `successorOf` for a worker that is still live, so a director that revises a stalled worker keeps the lineage on the `spawned` event; `successor-live` is no longer a refusal (#1588).
- An AgentGraph `delegates` edge may start at any node that holds the spawn tool: the nested supervisor spawns only its own edges' targets, and the ledger row records the real `from` (#1774).
