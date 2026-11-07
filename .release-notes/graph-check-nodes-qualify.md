type: patch
---
7.0.1 failed its Publish typecheck (#2475) and 7.0.2 failed the qualify suite: the `graph-check-nodes` assertion lacked the `secrets` that #2469 declared. The runtime code of 7.0.2 ships unchanged.
