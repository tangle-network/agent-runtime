type: patch
---
The profile-authoring skill tells authors to state a node's role in `prompt.appendSystemPrompt` so the harness's own system prompt stays in force, to put procedure in `prompt.instructions`, and to set `prompt.systemPrompt` only to replace the harness prompt on purpose.
