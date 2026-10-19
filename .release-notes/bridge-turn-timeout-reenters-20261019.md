type: patch
---
A bridge turn that runs out its own `timeoutMs` deadline is a failed turn, and the driver re-enters the run, counted and bounded like any other failure. Before, it surfaced as an `AbortError`, which classified terminal and settled the run.
