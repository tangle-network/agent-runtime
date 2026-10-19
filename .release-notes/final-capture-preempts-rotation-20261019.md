---
type: patch
---
A turn's final workspace capture no longer waits behind checkpoint captures on the same evidence store. Private CAS `offload()` callers that arrive while a pass waits to start share that pass, and each stops waiting at its own signal; before, every put could queue a full pass of its own (Discovery canary test-acceptance-canary-20261019j spent 26.6 minutes storing one 31.7 MB archive). A turn's workspace capture starting cuts short the captures of a checkpoint rotation, which also have their own 2-minute bound (`WORKSPACE_CHECKPOINT_ROTATION_CAPTURES_MS`); a checkpoint cut short is kept and captured at release. The journal gains `workspace-checkpoint-fork-ready` and `workspace-capture-started`.
