type: minor
---
`writeWorkerSteer` accepts an explicit `eventDir` matching the running supervisor control directory.
Requests, retry acknowledgments and inbox projections use that directory together.
The existing workspace-root default is unchanged.
