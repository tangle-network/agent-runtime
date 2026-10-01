type: patch
---
Environment-provider executors preserve explicit managed or subscription credential intent from the exact AgentProfile.
Other transports reject this field before execution, and invalid credential sources and unknown model controls still fail closed.
