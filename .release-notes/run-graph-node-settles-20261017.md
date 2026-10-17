type: patch
---
A managed node of a `run_graph` subtask settles on its own `submit_result`: the run's completion check and continuation no longer hold graph nodes, so a graph under a check that only its caller's result can pass settles and wakes its caller with `{ deliverable, edges }`.
