# Multi-agent interaction

`runInteraction` gives each actor one profile, one provider environment, and one provider session.
Actors take turns by responding to the transcript they have not seen yet.

```bash
pnpm tsx examples/interaction/interaction.ts
```

The example runs offline.
Replace either in-process provider with CLI Bridge, Tangle Sandbox, E2B, Daytona, or another `AgentEnvironmentProvider` without changing the interaction policy.

Use a journal plus a stable `definitionId` when the run must continue after the coordinator restarts.
The provider must support environment lookup and idempotent turn IDs for that mode.
