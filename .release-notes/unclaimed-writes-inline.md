type: patch
---
Only steer admission (`writeWorkerSteerAsync`) sends an unclaimed write to the durable writer. Since 10.0.4 every unclaimed result-blob put, interactive binding, steer delivery claim and acknowledgement waited on the writer as well; they run inline again, as before 10.0.4, and a claimed one still runs on the writer without blocking the event loop.
