---
name: loop-writer
description: Write a custom control policy only when current runtime composition APIs cannot express it.
---

# Loop Writer

Use this only for a control policy that the shipped high-level APIs cannot express.
Read `docs/canonical-api.md`, current exports, the implementation, and the nearest test before writing code.
Do not copy signatures from this skill.

## Choose The Existing Path First

| Need | Existing path |
|---|---|
| One product chat turn | `handleChatTurn(...)` |
| One task or bounded multi-turn task | `runAgentTask(...)` or `runAgentTaskStream(...)` |
| Two or more actors taking turns | `defineConversation(...)` and `runConversation(...)` |
| A driver coordinating workers | `supervise(...)` or `superviseSurface(...)` |
| Parallel or fixed composition | `fanout(...)`, `pipeline(...)`, `panel(...)`, `verify(...)`, or `loopUntil(...)` |
| Parallel repository workers with isolated branches | `worktreeFanout(...)` |
| Repeated work in a graded tool environment | `runAgentic(...)` |
| Equal-budget comparison over that environment | `runBenchmark(...)` |
| Low-level round policy with custom planning and stopping | `runAgentRounds(...)` |

If an existing row fits, use it and stop.
Do not create another wrapper solely to rename inputs or results.

## Custom Loop Contract

A custom loop has five explicit parts:

```text
task -> plan work -> execute attempts -> check outcomes -> continue or stop
```

Keep ownership separate:

- The driver chooses work and termination from task plus prior outcomes.
- Executors run attempts and return observed artifacts.
- Objective checks determine whether an artifact is usable.
- Trace emission records plans, attempts, tool effects, checks, spend, and decisions.
- The caller owns policy, budgets, credentials, persistence, and side-effect authority.

The driver must not mutate product state while planning.
An LLM score must not override failed builds, tests, missing evidence, denied permissions, or service errors.

## Required States

Model every terminal and resumable state explicitly:

- succeeded with the accepted artifact;
- exhausted by rounds, tokens, money, time, or concurrency;
- cancelled by the caller;
- blocked on a question or permission;
- failed before an attempt;
- failed during execution or checking;
- interrupted with enough durable state to resume safely.

Use stable run, attempt, task, and parent IDs.
Persist the accepted artifact, every attempted artifact identity, spend, and final reason.
Resume from durable facts, not an in-memory counter or summary alone.

## Steering And Questions

Steering is a typed input to a running or replacement attempt.
Record who sent it, why, which evidence motivated it, whether delivery succeeded, and which attempt consumed it.

Questions are explicit events.
Route them to the responsible parent or user, preserve unanswered blockers, and fail closed when a required answer is unavailable.
Do not bury a permission request in free-form worker output.

## Parallel And Recursive Work

Give parallel workers isolated state unless shared mutation is the point of the task.
For repository changes, use one worktree per worker and explicit merge outcomes.
For external writes, use idempotency keys and product-owned transactions.

Recursive supervisors use the same budget, cancellation, trace, question, and completion contracts at every depth.
Do not grant a child more authority than its parent.

## Tests

Cover:

- success on the first and later rounds;
- invalid output followed by a corrected attempt;
- every budget limit;
- abort propagation to in-flight work;
- service and check failures remaining distinct from agent failure;
- unresolved blocking questions;
- interrupted run recovery without duplicate side effects;
- deterministic replay of decisions from saved outcomes where supported.

## Completion

The change is complete when the public entrypoint is smaller than the policy it replaces, all states above are observable, a real task exercises the custom behavior, and package typecheck, tests, build, docs, and package verification pass.

## Then consider

- `critical-audit` when the loop changes a public contract or authority boundary.
- `eval-engineering` when the loop's stopping condition needs a new evaluation case.
- `verify` before publishing the package.
