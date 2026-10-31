type: patch
---
A coordination credential renewal keeps the replaced bearer valid until its own expiry instead of revoking it when the provider acknowledges the new one, so a manager whose environment never picked up the renewal keeps its coordination tools. A signed bearer that arrives expired stops the manager with `coordination credential expired in its holder: no renewal reached it` in the run's continuation, and a manager stopped by its coordination server now carries that server's reason as `continuation.stopReason`.
