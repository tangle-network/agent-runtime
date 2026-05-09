# basic-task

The smallest possible `runAgentTask` invocation. A domain adapter that
finishes after a single `decide` step, with no streaming, no knowledge
provider, no telemetry. Use as the starting point for any new domain
agent.

## Run

```bash
pnpm tsx examples/basic-task/basic-task.ts
```

## What it shows

- Minimal `AgentAdapter<TState, TAction, TActionResult, TEval>` implementation
- The four lifecycle methods: `observe`, `validate`, `decide`, `act`
- How `runAgentTask` returns `runRecords` you can persist
