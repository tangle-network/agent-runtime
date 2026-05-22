# Durable run supervisor

The cross-worker resume keystone. Worker 1 drains part of a long turn,
its isolate "dies" mid-stream, Worker 2 picks the same `runId` up and
resumes from the substrate's event log + cursor — the caller sees the
complete sequence exactly once.

What the example shows:

- `runSupervisedTurn` — the platform-agnostic supervisor (drains into
  the durable log, persists the `RunHandle`, heartbeats the lease).
- A toy `SandboxReconnectAdapter` — one typed contract: `start()` for a
  fresh run, `attach(handle, afterEventId)` to resume past a cursor.
- The three resolution modes — `fresh` / `resumed` / `replayed` — and
  the idempotent `appendStreamEvent` that dedups the reconnect seam.

For the Cloudflare Durable Object host — `createSessionSupervisorDO` —
see the README; it's a ~100-line glue layer around this same primitive.

```bash
pnpm tsx examples/durable-supervisor/durable-supervisor.ts
```
