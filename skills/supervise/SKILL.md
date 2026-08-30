---
name: supervise
description: Drive worker agents with explicit profiles, corrections, budgets, and checked delivery.
---

# Supervise

Use this policy only when the running agent has the coordination tools, including `spawn_worker` and `await_event`.
The supervisor plans and checks work; workers produce the artifacts.

## Run The Work

1. Split the job into independent deliverables with observable completion checks.
2. Call `spawn_worker` with a focused task and a complete worker profile.
3. Assign each worker only the tools, context, authority, and budget it needs.
4. Use `await_event` to collect questions, findings, progress, and settlements.
5. Answer blocking questions or steer the responsible worker with specific evidence.
6. When work fails, change the task, profile, evidence, or approach before spawning a replacement.
7. Accept only a settlement whose declared check passed and whose artifact can be inspected.
8. Stop when every required deliverable is accepted or a named limit or blocker is reached.

A worker profile names its role, task, relevant skills or system instructions, model constraints, tools, budget, expected artifact, and completion check.
Do not spawn empty profiles or blind retries.

## Parallel And Recursive Work

Run independent workers concurrently when their state and side effects are isolated.
Use one worktree per repository-writing worker.
Give external writes stable idempotency keys.

A worker may itself supervise only when its profile includes this policy and the runtime grants coordination tools.
Child workers inherit stricter authority and budget limits than their parent.

## Completion

Report worker IDs, assignments, accepted artifacts, failed or cancelled work, spend, unresolved questions, and the exact checks run.
The supervisor cannot turn an unchecked worker claim into completion.

## Then consider

- `build-with-agent-runtime` when this policy should become a reusable product integration.
- `eval-engineering` when worker acceptance needs a new executable case.
- `verify` after the accepted artifacts are assembled.
