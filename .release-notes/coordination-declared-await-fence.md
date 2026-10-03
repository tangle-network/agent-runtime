type: patch
---
`await_event` holds a caller whose harness declares a raised MCP tool-call timeout (`X-Mcp-Tool-Timeout-Ms`, written by the Tangle sidecar when an attachment declares `metadata.toolTimeoutMs`) for 60% of that timeout, up to 180 s, instead of 45 s. Runtime now asks harnesses for a 300 s timeout on its coordination attachment. Callers that declare nothing keep the 45 s fence, so older sidecars are unaffected.
