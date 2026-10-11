type: minor
---
`./workspace-store`: put and delete take an optional `operationId`. A store that sets `idempotentOperations` returns the applied entry or tombstone when an at-least-once caller repeats an operation, instead of a conflict; `workspaceStoreContractCases(make, { idempotentOperations: true })` checks it. The in-memory store honours it.
