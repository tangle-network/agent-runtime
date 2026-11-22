type: patch
---
A root opted into `driverRetry.pauseRootStops` now settles `budget-exhausted` at once when its spent token or known resource channel has nothing reserved, instead of pausing for a refund that cannot come; it still pauses while a live reservation could return budget.
