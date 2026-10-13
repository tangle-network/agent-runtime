type: patch
---
Bound retained provider event observation and exact-result reads so a missing terminal event cannot leave a supervised root or worker running silently. Settle from the original exact result when available; otherwise record an attributable pending state without replaying the execution. Deduplicate replayed provider events by identity before metering.
