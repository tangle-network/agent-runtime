type: major
---
`ProfileMaterializationReceipt` now requires `resources` when `status` is `known`. Consumers that construct these receipts must provide `MaterializedResources`: the observed resource values and their provenance, or `{ status: 'unknown', reason: '...' }` when no resource observation is available.
