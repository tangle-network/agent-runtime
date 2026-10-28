type: patch
---

A supervised child's abortable waits (budget, slot, execution) now run through the one `runAbortable` race. Behavior is unchanged: an abort still loses to a result the executor produces in the same tick, and a pre-aborted wait still observes the pending work.
