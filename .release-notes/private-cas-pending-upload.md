type: patch
---
Report in-progress private CAS durable uploads in `offload().pending`. A streamed put that reuses a buffered upload's digest can no longer produce a clean offload receipt before the remote copy is acknowledged. Local-only stores and configured cache budgets retain their existing behavior.
