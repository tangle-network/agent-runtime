type: patch
---
Materialization receipts now record the applied box sizes (`resources`) the created environment reported through its observation — with provenance (`origin`, `observedAt`) — or an explicit unknown naming why, never the create request. Bridge spawn admission reads the host executor's capacity gate from `GET /health` when the bridge reports it, so a spawn that would wait on the host semaphore and die as capacity is refused up front with the counters in the signal. Spawn admission settles exactly once, and provider `environmentReader` documents sidecar handling.
