# Measured improvement and activation

Read the current [improvement exports](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/index.ts), [intelligence exports](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts), and relevant sections of the [API decision table](https://github.com/tangle-network/agent-runtime/blob/main/docs/canonical-api.md).
For knowledge changes, also read the [knowledge exports](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/index.ts).
Use the selected function's current types and maintained example rather than copying a method signature from this guide.

## Search without changing the live system

Use the existing improvement API and a complete Eval optimization method for the chosen surface.
Keep development, selection, and final decision cases separate.
Record the delivered profile resources and execution identity so resumed work cannot silently reuse incompatible measurements.
Search returns a detached candidate; it cannot edit the live product, knowledge store, or repository.

Prompt, tool, resource, and profile changes remain portable profile data.
Code candidates use Runtime's isolated worktree and patch identity path.
Knowledge candidates use the existing snapshot and promotion contract.
Do not rebuild candidate hashing, statistics, or search history in the consumer.

## Apply only the measured candidate

Use the maintained proposal, review, and activation path.
The proposal must compare the unchanged baseline and exact candidate on tasks hidden during search.
Keep candidate identity checked before execution and before activation.
Retain quality, cost, latency, sample count, uncertainty, and rejected outcomes.

The product supplies authority, funding, target identities, persistence, and an atomic transaction.
That transaction compares expected current state, writes the authorized targets, and records the activation outcome under its retry identity.
Use read-only reconciliation to distinguish committed, uncommitted, and uncertain outcomes after a lost response.
Preserve expiry and authority checks; review evidence does not itself grant write authority.

Prove rejection, successful activation, expired or mismatched activation, and retry after an uncertain write.
A read-only experiment must not send customer messages, mutate customer data, or incur product billing side effects.
