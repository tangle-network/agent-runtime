type: patch
---
A capacity refusal (`upstream_unavailable`, `provider_quota_exhausted` or HTTP 429) on a retained reconciliation's exact-result read pauses the driver instead of counting toward `pending-unresolved`, and reconciliation resumes after the replay position journaled as an `execution-observed` row, reading only new frames, also after a restart.
