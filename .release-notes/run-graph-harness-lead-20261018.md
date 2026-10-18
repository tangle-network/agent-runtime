type: patch
---
A `run_graph` lead that runs on a harness starts and settles on its own submission. Since 0.325.3 the node check it holds needed a continuation policy, so every such graph was refused before its lead started.
