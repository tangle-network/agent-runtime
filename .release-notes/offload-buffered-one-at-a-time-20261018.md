type: patch
---
A private CAS pass to a buffered-only durable store (no `putStream`) copies one object at a time, as before 16-at-a-time offload, because a buffered copy holds the whole object in memory.
