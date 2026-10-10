type: patch
---
A coordination credential without `ttlMs` now lives as long as its scope, not its scope's deadline. A child's own time box checks the child in and keeps it running, so a checked-in child can still record its state and submit; every stop (cancellation, the run's deadline, its lead stopping it) still refuses the credential at once. Every coordination refusal now carries a JSON-RPC error body naming its reason (`credential-refused`, `scope-stopped`, `request-limit`, `action-timeout` and the rest), and the audit event records it as `reason`.
