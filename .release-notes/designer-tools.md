type: minor
---
`graphDesignerExtraTools`: the meta-graph designer's three tools (`designer_lookup_graph`, `designer_run_graph`, `designer_history`) on the existing `extraTools`/`executeExtraTool` seam. A supervisor root whose only tools are these becomes a designer agent: it looks up what a task shape has run, replays the stored winner (near-zero inference) or authors a new graph as data, and every run is recorded with terminal accounting — running IS recording. Execution stays environment-owned: the caller closes over how graphs run and how the deliverable's check is re-bound.
