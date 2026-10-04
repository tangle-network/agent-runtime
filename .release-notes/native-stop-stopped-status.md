type: patch
---
A native-harness stop that the provider accepts asynchronously now ends on any terminal run status. A `stopped` status counts as the stop, as `cancelled` does; before, the stop waited out its deadline and recorded the harness as possibly still running.
