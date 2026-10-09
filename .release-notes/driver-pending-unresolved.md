type: minor
---
The root driver stops with `stop: 'pending-unresolved'` (and the record's `pendingCause`) once `maxConsecutiveFailures` abandonments have each been replaced by an invocation that failed reconciliation the same way, instead of retrying the next one through the whole transient-outage window and settling an untyped `no-progress`. `DriverAttemptStop` gains `'pending-unresolved'`; consumers that switch over it exhaustively add the case.
