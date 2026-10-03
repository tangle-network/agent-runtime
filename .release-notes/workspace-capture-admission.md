type: patch
---
Bound overlapping provider workspace captures with optional `workspaceRetention.maxConcurrentCaptures`. Share the retention object across recursive workers to share its FIFO admission bound. The retention timeout includes queueing; timed-out I/O stays charged until it settles, and artifact verification holds the same slot.
