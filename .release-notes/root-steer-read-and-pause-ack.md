type: patch
---
A root steer the manager reads in its own journal is acknowledged `delivered` at the read, so a turn that later fails no longer reports it `not_live`; a root steer queued while the root is stop-paused carries `pausedOn` (`stop`, and `tokensLeft` when tokens are capped) on its acknowledgement at once.
