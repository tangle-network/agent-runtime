type: patch
---

A Router call whose completed response could not be observed is never run again, even after the request deadline and even when the caller's transport throws the `SDKError` of a different `@tangle-network/agent-core` copy. Runtime now recognizes the failure by its `context.phase: 'response_observation'`, not by `instanceof`. With discovery-lab pinned to agent-core 1.0.0 beside Runtime's `^1.0.1`, two copies were installed and a completed seat process re-ran up to `retry.maxAttempts` times, one paid model call each.
