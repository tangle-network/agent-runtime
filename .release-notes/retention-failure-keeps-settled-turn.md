type: patch
---
A settled provider turn whose workspace retention fails or exceeds `workspaceRetention.timeoutMs` now keeps its result. The result carries `workspaceCaptureFailure` with the reason and no `workspaceSnapshot`, the source environment stays preserved as evidence, and the turn is not re-run. Before, the capture's `AbortError` became the turn's outcome: a worker settled `down`, and a provider-placed root driver classified it terminal and ended the whole run `no-winner`.
