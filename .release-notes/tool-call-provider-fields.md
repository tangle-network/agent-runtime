type: patch
---
`ToolLoopCall` carries optional `providerFields`, which the tool loop echoes onto the call's assistant `tool_calls` entry in the next request. A Gemini 3 model returns `extra_content.google.thought_signature` on each tool call and refuses the follow-up request with HTTP 400 when it is missing.
