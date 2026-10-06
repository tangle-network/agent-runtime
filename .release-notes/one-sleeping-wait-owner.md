type: minor
---
Removed the supervise wait-state nodes: `Scope.wait`, `timerAt`, `pollFor`, `waitUntil`, `createWaitProbes`, `pendingWaits`, the `probes` option and registry table, the journal `waiting`/`woken` events, the `waiting` node status and the `waiting` counts on `TreeView` and `ProgressView`. They kept a second sleeping-wait mechanism inside the supervisor process, and nothing outside this repository called them. A wait for time or an external event belongs to a Platform workflow `wait.*` action, whose stores own the sleep outside customer compute.
