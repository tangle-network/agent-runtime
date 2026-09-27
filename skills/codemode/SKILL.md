---
name: codemode
description: Batch mechanical tool work in code while preserving judgment, authorization, and accounting.
---

# Codemode

Batch stretches of mechanical tool work whose intermediate results require no judgment.
Keep decisions that could change the plan in the agent's turn.

## Batch the work

Identify independent calls and the points where an observed result must change the next action.
Use the session's permitted execution tool to hold intermediate data in variables or workspace files.
Return the decision-relevant values, failures, and artifact locations.
Inspect every result; a successful batch must not hide a failed item.
Retain results needed later instead of rerunning expensive work to recover them.

Respect each tool's concurrency, cancellation, and authorization contract.
A batch does not expand the permission of its individual operations.
Meter paid operations on the owning execution path and preserve their usage records.
Keep dependent actions sequential unless their contract supports safe composition.

## Runtime-supervised code

When configuring code execution for a Runtime supervisor, read [the execution boundary](references/runtime-execution.md).
That branch supplies a generated API over Runtime's existing coordination tools and requires an explicit runner.
For ordinary shell or session-tool batching, no additional runtime is needed.

Complete the requested work and inspect the resulting artifact.
Code reduces mechanical round trips; it does not replace judgment or prove the quality of the result.

## Then consider

- `supervise` when the work needs workers with their own judgment.
- `agent-graphs` when fixed roles require explicit Runtime relationships and shared accounting.
- `loop-writer` when no maintained composition expresses the required control policy.
