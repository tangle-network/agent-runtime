# Agent into reviewer

Two runtimes, one driving the other. Agent A produces a draft as a
stream; Agent B is a reviewer — a normal `AgentAdapter` that scores the
collected draft against a rubric and stops with a verdict.

The pattern is the point:

1. **Collect** A's stream (any async iterable: `runAgentTaskStream`, a
   sandbox client, an OpenAI stream, a synthetic chunked generator).
2. **Pipe** the collected output into B's `task.inputs`.
3. **Run** B through the same task lifecycle every other agent-runtime
   call uses. B's adapter *is* the bridge — no separate "reviewer
   framework" needed.

The example uses a synthetic streaming generator for A so it runs
offline. In production, swap that generator for `runAgentTaskStream({
task, backend, input })` with the same shape — an async iterable of
events. The reviewer adapter is unchanged.

```bash
pnpm tsx examples/agent-into-reviewer/agent-into-reviewer.ts
```
