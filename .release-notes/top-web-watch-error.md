type: patch
---
The live graph viewer keeps serving when the host has no inotify watches left (ENOSPC) instead of ending the run it views; it falls back to its reconcile interval.
