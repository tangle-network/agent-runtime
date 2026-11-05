type: patch
---
Preserve Runtime failure classification and bounded provider codes in MCP tool error data without exposing command diagnostics or changing JSON-RPC error codes. The existing test command now builds and checks types and lint before the full suite; release qualification reuses that complete source check.
