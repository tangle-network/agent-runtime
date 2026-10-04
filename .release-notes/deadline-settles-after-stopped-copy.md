type: patch
---
A node that a deadline or a cancellation ends now settles with the session copy taken after its harness stopped, not its last running copy. The provider executor takes that copy before the failure capture of the whole workspace and exposes `Executor.harnessTranscriptSettled()`, which the scope awaits (bounded at 6 minutes) before it reads the transcript or tears the executor down; retry, completion-gate and driver wrappers forward it.
