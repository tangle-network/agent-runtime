# Delegate

`delegate()` gives an intent to a supervisor that writes worker profiles, starts workers, and waits for a checked result.

```ts
const result = await delegate('Produce the exact word READY.', {
  worker: { provider },
  router,
  deliverable: {
    check: (out) => out.content.trim() === 'READY',
    describe: 'worker output is READY',
  },
})
```

The supervisor owns decomposition and worker instructions.
The environment provider owns execution and credentials.
The completion check decides whether a worker actually delivered.

Run the example:

```bash
TANGLE_API_KEY=... pnpm tsx examples/delegate/delegate.ts
```
