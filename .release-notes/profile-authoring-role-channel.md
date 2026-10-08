type: patch
---
The profile-authoring skill now states a node's role as the first entry of `prompt.instructions`, which every harness reads while keeping its own system prompt. It notes that Codex and Gemini refuse `prompt.appendSystemPrompt` at materialization, and that `prompt.systemPrompt` replaces the whole harness prompt (17,730 characters of base instructions on Codex).
