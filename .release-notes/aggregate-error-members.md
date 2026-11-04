type: patch
---
A driver attempt's `error`, a settlement's reason and a give-up message now name each member of an `AggregateError` (`name: message`, one level deep). On Discovery smoke setup-smoke-b736069f a worker's record read only `coordination binding and cleanup failed`; the binding failure and the cleanup failure behind it were lost.
