type: patch
---
- `spawn_worker` admits `successorOf` for a worker that is still live, so a director that revises a stalled worker keeps the lineage on the `spawned` event; `successor-live` is no longer a refusal (#1588).
