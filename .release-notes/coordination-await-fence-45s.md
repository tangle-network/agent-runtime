type: patch
---
`await_event` now holds for up to 45 s before it returns a re-pollable `pending` snapshot, and the coordination server request timeout defaults to 90 s (were 15 s and 30 s). Harness-driven directors spend about 2.7x fewer inference turns re-polling, and the fence stays under the 60 s MCP tool-call timeout that Claude Code and Codex apply by default.
