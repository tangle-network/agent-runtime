---
name: supervise
description: Author and drive recursive AgentProfiles with explicit capabilities, evidence, and recovery.
---

# Supervise

Use this when Runtime coordination tools are attached.
Author agents that can perform the required work, then direct them from checked evidence.

## Author complete agents

Put research choices, methods, revision rules, and stopping criteria in each profile's prompt.
Runtime owns shared budgets, recursion limits, concurrency, cancellation, journals, and recovery.
The caller configures root execution through [SuperviseOptions](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts).
Per-assignment budgets, continuity, and keys belong to the [coordination tools](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts), not invented profile fields.

An agent receives recursive authority by declaring `agent_runtime_coordination_spawn_worker: true` in its tools.
Declare each other Runtime tool it needs explicitly.
Metadata describes work; it does not grant authority.
Every profile that can spawn workers carries the complete `profile-authoring/SKILL.md` resource, using an immutable snapshot and `resources.failOnError: true`.
The authored profile must explain its own ability to delegate; Runtime does not invent that policy.

When creating or changing a descendant profile, read [profile authoring](references/profile-authoring.md) for the exact contract and resource placement.
The task names the concrete artifact and completion check; the profile names the method and granted capabilities.

## Direct the work

1. Split the objective into independent artifacts with checkable outcomes.
2. Start each assignment with a stable semantic key and a deliberate budget.
   Fill available capacity while distinct useful assignments remain.
3. Pull settlements, findings, and questions with `await_event`.
   A bounded wait returning does not establish failure.
4. Inspect quiet or stalled workers with `observe_agent` before steering them.
   Correct an observed wrong path, missing requirement, or new evidence.
5. Check each returned artifact before using it.
   Preserve failed attempts and change the profile or assignment when evidence supports another attempt.
6. After recovery, reconcile the journal, roster, settlements, questions, findings, and spend before creating replacements.

Use `continuity: 'resume'` to continue the most recent settled worker with that profile name.
A resumed assignment is a new execution and cannot carry a run-once key.
Completed keys resolve to committed results; an uncertain prior dispatch must be reconciled before replacement.
Stop at checked success, an authorized resource limit, cancellation, or a demonstrated dead end.
A quiet worker alone is not a reason to invent a deadline.

## Accept delivery

Inspect the artifact and its independent completion result.
Preserve profile identities, assignment keys, parent-child links, continuations, costs, failures, and missing accounting.
Worker prose cannot approve its own result.
Use `submit_result` only when the attached check can validate this agent's artifact.
Calling `stop` ends coordination; it does not establish completion.

## Then consider

- `build-with-agent-runtime` when the product must change Runtime limits or adapters.
- `eval-engineering` when no existing check can separate success from failure.
- `verify` when required artifacts pass and delivery checks remain.
