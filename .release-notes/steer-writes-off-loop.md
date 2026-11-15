type: patch
---
Steer admission, delivery claims, steer acknowledgements and worker interactive bindings no longer block the event loop on the disk: they run on the durable writer whether or not a run claim is held. New `writeWorkerSteerAsync` beside `writeWorkerSteer`, with the same admission, replay and conflict rules.
