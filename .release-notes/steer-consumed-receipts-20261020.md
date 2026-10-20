---
type: minor
---
A steer or answer now ends in `consumed` or `failed`, never in `delivered`. `Inbox.drain()` is replaced by `Inbox.lease()`, which keeps each message until `commit(attemptId)` runs after the provider accepts the turn. A turn that fails before then folds the same messages into the next prompt. A queued authority message still unread after `STEER_PROMOTION_MS` (15 minutes) interrupts the live turn. `EventAcknowledgement.by` gains `consumed` (with `receiptId` and `attemptId`) in `coordination-log.jsonl`. A message never consumed reaches the sender's next wake as a failed `tool-outcome`. `WorkerSteerAcknowledgement.effect` gains `consumed` and `failed`, and `CoordinationTools.steerWorker` accepts `onConsumption`.
