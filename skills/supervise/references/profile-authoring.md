# Author a descendant profile

Read the current [AgentProfile contract](https://github.com/tangle-network/agent-sdk/blob/main/packages/agent-interface/src/agent-profile.ts) and [profile schema](https://github.com/tangle-network/agent-sdk/blob/main/packages/agent-interface/src/profile-schema.ts).
For Runtime arguments and accepted tool names, inspect the [coordination schema](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts).
Use only fields that the selected backend can materialize.

Give the profile a distinct name, a standing prompt, and the capabilities its assignment requires.
Use model hints supported by the actual backend and the task's authorized execution configuration.
A leaf needs no coordination grants.
An agent that delegates declares the relevant Runtime coordination tools and receives the complete profile-authoring instructions as a skill resource.
Use an immutable inline resource or a resolvable immutable reference with resource errors set to fail closed.
A missing authoring resource must not silently produce a less capable worker.

The profile describes how the agent works; the assignment describes the current artifact and acceptance check.
Keep budgets, continuity mode, assignment keys, and root completion configuration in their Runtime-owned arguments.
Do not claim a limit is enforced because prompt text asks for it.

Confirm the materialized profile retains its instructions, resource bytes, and permitted tools before a large recursive run.
Check that a child cannot gain authority beyond its parent's grant.
