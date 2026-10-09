type: patch
---
`AgentProfile.model.metadata.stream: true` now streams tool-free direct Router turns too, so a long thinking-model answer is no longer cut off by the Router's request deadline; the streamed turn returns the same content, reasoning, finish reason, usage, billed cost, and served-model checks as the buffered one, and a caller abort now stops a streamed completion mid-body.
