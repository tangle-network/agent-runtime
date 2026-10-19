type: patch
---
`modelSilenceMs` runs only on a bridge route that declares `toolCallSpans: true` in `GET /v1/capabilities?model=`, meaning its stream reports each tool call at start and end. A turn on any other route is refused before dispatch. cli-bridge's opencode backend reports a tool call only once it has finished, so the bound would cut a long tool.
