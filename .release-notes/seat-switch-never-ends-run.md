type: patch
---
A usage-limit seat switch no longer ends a run. An owner with no checkpoint capture now deletes its oldest superseded checkpoint when a provider refuses a newer one, such as under a plan's snapshot limit, and asks once more; refusals are journaled as `workspace-checkpoint-refused`. A switch that still has no checkpoint journals `seat-paused` with its `detail` and rechecks every two minutes, and a move to a seat on the same box no longer needs one.
