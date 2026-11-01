type: patch
---
Sandbox's typed placement refusals `CAPACITY_EXHAUSTED`, `HOST_PRESSURE` and `PROVISIONING_PAUSED` are unavailable codes by themselves: a create or dispatch refused with one pauses and re-enters within the run's deadline, budget and cancellation whatever status rides with it, and its attempt carries the code as `unavailableSignal` (for example `capacity_exhausted`, where a 503 used to read `http-503`).
