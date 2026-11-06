type: patch
---
- `spawn_worker` admits `successorOf` for a worker that is still live, so a director that revises a stalled worker keeps the lineage on the `spawned` event; `successor-live` is no longer a refusal (#1588).
- An AgentGraph `delegates` edge may start at any node that holds the spawn tool: the nested supervisor spawns only its own edges' targets, and the ledger row records the real `from` (#1774).
- A buffered Router completion whose usage reports no cost takes the exact `x-tangle-cost-usd` charge, so router workers settle with known USD; a router-tools graph worker may declare the caller tools its backend supplies (`AgentProfile.tools`) (#1587).
- A graph analyst node on a backend is no longer graded by the worker's deliverable check or the backend `validator`: an analyst that attacks the worker's output settles ungraded (#1775).
- A manager whose profile declares coordination tools the run does not serve is refused with every unserved name, and the served list, in one error before its harness runs a turn (#1219).
