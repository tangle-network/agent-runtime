type: patch
---
Retained provider acquisition backs off through explicit retry-later capacity refusals before charging a failed driver attempt, preserving the same environment and execution identity and honoring cancellation.
