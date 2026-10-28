type: patch
---
`reconnectRetainedInteractiveRun` and `recoverRetainedInteractiveRun` accept `journalRoot`, and an interactive run's journal is keyed by its session id, so turns sent from a reconnected handle in another process land in the same `observer.jsonl`. A turn record carries its operation id only.
