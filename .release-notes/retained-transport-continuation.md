type: patch
---
Continue retained provider leaves in their existing environment and native session after a producer-typed transport loss, preserving committed work, spend, cancellation and the original budget and deadline. Caller failures and untyped timeout diagnostics keep their existing stop policy.
