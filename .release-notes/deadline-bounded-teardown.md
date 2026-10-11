type: patch
---
A release's checkpoint captures share one 15-minute bound (`RELEASE_CHECKPOINT_CAPTURES_MS`): a capture it cuts short keeps its checkpoint and source, as a failed capture does, and the run settles instead of waiting on each capture's own port bound in turn. Live workspace captures stop whenever a turn ends, including a turn closed by its consumer (a deadline or budget stop) in an environment kept for recovery; before, those kept capturing until the process exited, on the capture slots the release shares, and kept a settled supervisor's process alive.
