type: patch
---

A flow graph's stored route check may name any node, not only a terminal one: each condition reads that node's latest delivered output. Before, the check saw only `{ [terminal node]: result }`, so a check that also named an upstream node (for example `fetch-pr /merge_sha` with `review-pr /approved`) was always false, and the run ended `no-winner` / `no-result-selected` though every node delivered. The run's output stays the terminal nodes' results, and the check stays exact.

`AgentGraph.entry`'s documentation now states this contract.
