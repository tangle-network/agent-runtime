# Intelligence Drop-In

This example wraps an agent with `withIntelligence(...)`.
The wrapper receives approved context and records each run without making Intelligence availability part of the agent's success path.

## Run

```bash
pnpm tsx examples/intelligence-drop-in/intelligence-drop-in.ts
```

The script starts a local collector and checks three behaviors:

1. The wrapped agent returns its answer.
2. An unavailable Intelligence service does not fail the agent call.
3. An `off` run exports a trace with zero Intelligence spend.

Use `allowInsecureLoopback: true` only for a local HTTP service.
Production uses the default HTTPS origin or an exact origin listed in `trustedBaseOrigins`.
