# Supervise

`supervise()` runs a model that can create, observe, steer, and stop workers.

```ts
const result = await supervise(supervisorProfile, task, {
  budget: { maxIterations: 50, maxTokens: 500_000 },
  router,
  worker: { provider },
  deliverable,
})
```

Use `worker.environment` to pass provider-specific creation fields such as the coding backend or workspace.
Use `makeWorkerAgent` only when a custom executor cannot be represented by an environment provider.

Run the example:

```bash
TANGLE_API_KEY=... pnpm tsx examples/supervise/supervise.ts
```
