type: patch
---
Checkpoint cleanup reserves workspace capture capacity before creating its temporary Sandbox fork, so a fork cannot suspend while waiting in the capture queue. A cancelled owner leaves the queue promptly, and a fork that resolves after the capture deadline is still torn down.
