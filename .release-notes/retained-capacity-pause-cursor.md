type: patch
---
A capacity refusal (`upstream_unavailable`, `provider_quota_exhausted` or HTTP 429) on a retained reconciliation's exact-result read pauses the driver instead of counting toward `pending-unresolved`. A retained owner's reconciliation resumes after the replay position its last `driver-attempt` record carries (new optional `DriverAttemptRecord.observed`), reading only new frames, also after a restart.
