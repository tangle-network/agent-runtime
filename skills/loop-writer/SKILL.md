---
name: loop-writer
description: Build a custom execution policy only when maintained Runtime composition cannot express it.
---

# Loop Writer

Use this for a required execution policy that maintained Runtime APIs cannot express.
Read the [current decision table](https://github.com/tangle-network/agent-runtime/blob/main/docs/canonical-api.md), [exports](https://github.com/tangle-network/agent-runtime/blob/main/package.json), selected implementation, and nearest test.
If an existing entrypoint fits, use it and stop.
A wrapper that only renames inputs or outputs does not justify a custom loop.

## Define the missing behavior

Name the consumer, required decision, and why existing composition cannot express it.
Reuse Runtime's execution, accounting, cancellation, questions, and recovery contracts.
The custom policy chooses work and continuation from the task and checked prior outcomes.
It must not introduce another scheduler or measurement system.

Keep planning separate from consequential writes.
The caller owns credentials, persistence, and authority; executors return observed artifacts; independent checks decide whether those artifacts satisfy the task.
A model score cannot override failed objective checks, denied actions, or service failures.

## Preserve observable state

Represent successful delivery, exhausted resources, cancellation, unresolved questions, execution failure, and interrupted recovery where they apply.
Keep measurement and service errors distinct from agent failure.
Retain task and attempt identities, artifacts, spend, and the reason for continuing or stopping.
Resume from durable facts and reconcile uncertain writes before retrying.

Steering and questions use the existing typed events and delivery records.
Keep unanswered required questions visible.
Parallel workers receive isolated state or an explicit shared-mutation contract.
Children remain within parent authority and the same accounting and cancellation rules.

## Prove the policy

Test the custom decision on a representative real task.
Exercise its relevant failure and recovery paths, including rejected output followed by correction, resource exhaustion, cancellation, and duplicate-side-effect prevention.
Use existing contract tests for unchanged Runtime behavior; add checks that distinguish the new policy.

Complete when the required behavior works through its public entrypoint, final and resumable states remain observable, and the relevant package and consumer checks pass.
Report the exact missing capability supplied, retained Runtime contracts, real result, and limits.

## Then consider

- `critical-audit` when the loop changes a public contract or authority boundary.
- `eval-engineering` when the stopping condition lacks an adequate evaluation case.
- `verify` when implementation is complete and release checks remain.
