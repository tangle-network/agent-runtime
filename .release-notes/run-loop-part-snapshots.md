type: patch
---
`runAgentRounds` iterations keep one snapshot per streamed text or reasoning part, as `openSandboxRun` turns do since 0.336.1. Each iteration had held every opencode `message.part.updated` frame, each carrying the part's whole text so far, for the whole run: O(L²) bytes per long turn, which still crashed the platform API (heap 423 MB to 2 GB in 18 min) after the `openSandboxRun` fix.
