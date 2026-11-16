type: patch
---
Run cancellation no longer blocks the event loop on the disk. New `cancelRunAsync` beside `cancelRun`, with the same admission, replay and conflict rules: the request file reaches disk on the durable writer whether or not the caller holds a run claim. Inside a run, the cancellation observer, the manager's turn boundary and the settle record write the acknowledgement on the durable writer under the run's claim; the abort itself is issued at once.
