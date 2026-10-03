type: patch
---
Carry exact subscription AgentProfiles through the typed turn profile instead of bounded provider metadata. Bind profile content to retained request identity, validate fresh turns before environment creation, and settle deterministic provider schema refusals without retrying new sandboxes. Requires Agent Interface 2.17 or later.
