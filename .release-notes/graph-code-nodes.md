type: minor
---
A graph node can be a code node: `AgentProfile.model.metadata.codeMode` (true, or `{ concurrency, maxCalls, timeoutMs, memoryLimitBytes, directTools }`) presents `tool_search` + `codemode` instead of the raw tool set for that node's workers on the router-tools backend — one authored program over the granted handlers instead of one tool call per turn. The profile declaration overrides the backend default per node; validation is fail-loud and host-owned options (wasm/workerUrl/store) are refused. Rebuilds the worker-level half of #998 on the current AgentGraph contract.
