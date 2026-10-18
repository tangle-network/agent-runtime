type: patch
---
A private CAS pass or put that waits for another caller's copy in flight stops at its own abort signal, so one stalled upload no longer holds every pass in the process.
