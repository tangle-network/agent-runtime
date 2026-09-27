# Place an authored profile in Runtime

Follow the [Lab profile-authoring contract](https://github.com/tangle-network/discovery-lab/blob/82e9fed5feb5314fa89aa564433d3a77228ed61d/skills/profile-authoring/SKILL.md) for acceptance, audience, independent checks, stopping, and honest nulls.
This reference covers only Runtime schema and materialization details.

Read the current [AgentProfile contract](https://github.com/tangle-network/agent-sdk/blob/main/packages/agent-interface/src/agent-profile.ts) and [profile schema](https://github.com/tangle-network/agent-sdk/blob/main/packages/agent-interface/src/profile-schema.ts).
For Runtime arguments and accepted tool names, inspect the [coordination schema](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts).
Use only fields that the selected backend can materialize.
Grant coordination tools only when the assignment needs Runtime-managed execution.
Only `agent_runtime_coordination_spawn_worker: true` grants recursion.
An agent that delegates receives the complete Lab skill bytes as an immutable resource.
Use an immutable inline resource or a resolvable immutable reference with resource errors set to fail closed.
A missing authoring resource must not silently produce a less capable worker.

Keep budgets, continuity mode, assignment keys, and root completion configuration in their Runtime-owned arguments.

Confirm the materialized profile retains its instructions, resource bytes, and permitted tools before a large recursive run.
Check that a child cannot gain authority beyond its parent's grant.
