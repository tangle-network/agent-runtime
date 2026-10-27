type: patch
---
An in-place CLI harness that exits nonzero (including a signal kill on cancel) or times out now reports a failed execution, so its node settles down and a flow is never counted a winner on it.
