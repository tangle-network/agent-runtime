type: patch
---
Carry the exact subscription AgentProfile through new provider turns, including quota continuations that reconnect to an existing environment. Reject a substituted turn profile before provisioning, and preserve the original digest when replaying an older retained admission.
