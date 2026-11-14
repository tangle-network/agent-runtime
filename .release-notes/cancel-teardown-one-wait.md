type: patch
---
A cancelled or settled run releases every level of its tree at once, under one deadline, so its teardown ends within about one destroy wait (90 s) instead of one wait per level and retry pass. The default `teardownConfirmMs` is now 90000 and counts from the first release. An environment whose provider refuses deletion under a retention hold (409 `RETENTION_HOLD`, or an HTTP refusal naming the hold) is asked once, stays kept as evidence, is reported in `teardownUnconfirmed[].kept` rather than in `environments` for a sweeper, and is never reconnected to again by that process.
