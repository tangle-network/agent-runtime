type: patch
---

A flow graph's stored route check may name a `maps` join or a map item node, as it already could a routes node: the check reads that node's latest delivered output. Before, the join's workers were missing from the settled outputs the check reads, so a check naming the join was always false and the run ended `no-winner` / `no-result-selected` though every node delivered. The run's output stays the terminal nodes' results.
