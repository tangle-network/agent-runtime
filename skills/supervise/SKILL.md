---
name: supervise
description: Author and drive recursive AgentProfiles with durable assignments, evidence, and recovery.
---

# Supervise

Use this when Runtime coordination tools are attached.
Author agents that can perform the work, then drive them from checked evidence.

## Keep policy in its owner

Put research choices, methods, revision rules, and scientific stopping conditions in each profile's prompt.
Runtime owns recursion depth, the shared budget, cancellation, concurrency, journals, retries, and recovery.

`AgentProfile` has no `policy`, `budget`, `continuity`, `key`, or `deliverable` field.
Pass budget, continuity, and assignment keys to `spawn_worker`.
The caller configures the root budget and completion check in `SuperviseOptions`.
Do not claim a limit is enforced because it appears in prompt text or metadata.

## Author a descendant

Write a valid `AgentProfile`, not a prose description of one.
Use only fields the selected backend can materialize.

```json
{
  "name": "source-skeptic-v1",
  "description": "Challenge one candidate claim against primary evidence.",
  "prompt": {
    "systemPrompt": "Return a claim table with source locations, contradictions, unknowns, and a reproducible rejection check."
  },
  "model": {
    "default": "<allowed-model-id>",
    "reasoningEffort": "xhigh"
  },
  "tools": {
    "agent_runtime_coordination_spawn_worker": true,
    "agent_runtime_coordination_await_event": true
  },
  "resources": {
    "failOnError": true,
    "skills": [
      {
        "kind": "inline",
        "name": "profile-authoring/SKILL.md",
        "content": "<the complete profile-authoring skill text>"
      }
    ]
  }
}
```

The example shows placement, not required values.
Every agent is the same `AgentProfile` shape.
An agent becomes a recursive lead only by declaring `agent_runtime_coordination_spawn_worker: true`.
Declare each other Runtime verb it will use, such as `await_event`, `steer_agent`, or `read_journal`.
Runtime mounts only the declared bare verbs through its coordination surface; the provider receives a profile projection without Runtime-owned declarations.
Metadata can describe the work, but it never grants execution authority.
Every profile that can spawn workers carries the complete profile-authoring skill in `resources.skills`.
Make that resource an immutable inline snapshot or a pinned reference, and set `resources.failOnError: true`.
This is taught through the profile, not injected or enforced by Runtime: the authored profile remains the complete record of why it can delegate.
Omit Runtime coordination tools for a leaf.

The task argument names the concrete artifact and a check that can fail.
The profile names how the agent works and which capabilities it receives.
Together they must leave no acceptance criterion for the worker to invent.

## Drive the tree

1. Split the objective into independent checked artifacts.
2. Start each new assignment with a stable semantic `key` and a deliberate per-spawn `budget`.
3. Fill available parallel capacity while `freeSlots > 0` and distinct useful assignments remain.
4. Pull settlements and findings with `await_event`.
   A bounded wait returns control; it does not prove failure.
5. Inspect a quiet or `stalled` worker with `observe_agent`.
   Steer only when its recorded work shows a wrong path, missing requirement, or useful new evidence.
6. Check every settled artifact before using it.
   Feed accepted results, contradictions, and negative results into the next profile or task revision.
7. After a refusal or failed check, preserve the attempt and author a materially changed profile or assignment.
8. Use `continuity: 'resume'` only to continue the most recent settled worker with the same profile name.
   A resume is a new execution and cannot carry a run-once `key`.
9. After recovery, call `read_journal` and reconcile Runtime's restored roster, settlements, questions, findings, and spend before spawning.
   Completed keys resolve to their committed results; do not replace them.

Do not add a deadline because a worker is quiet.
Stop research only at checked success, a declared resource limit, cancellation, or a demonstrated dead end.

## Accept delivery

Inspect the artifact and its independent completion result.
Preserve exact profile identities, assignment keys, parent-child links, continuations, costs, failures, and unknown accounting.
Worker prose cannot promote its own result.

Use `submit_result` only when the attached completion check can validate this agent's own artifact.
Calling `stop` ends coordination; it does not turn missing evidence into success.

## Exact contracts

When a field is unclear, read the owner instead of inventing it:

- [`AgentProfile`](https://github.com/tangle-network/agent-sdk/blob/main/packages/agent-interface/src/agent-profile.ts) and its [exact schema](https://github.com/tangle-network/agent-sdk/blob/main/packages/agent-interface/src/profile-schema.ts) own authored fields.
- [`spawn_worker` tool schema](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts) owns per-assignment arguments.
- [`SuperviseOptions`](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts) owns root execution policy.

## Then consider

- `build-with-agent-runtime` when a product must configure the Runtime-owned limits and adapters.
- `eval-engineering` when no existing check can separate success from failure.
- `verify` after every required artifact passes its independent check.
