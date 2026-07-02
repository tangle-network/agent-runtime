# supervise — the one-call supervisor

`supervise(profile, task, opts)` is the simplest way to run a supervisor: author a profile + a goal,
and the runtime defaults the scaffolding (blobs / perWorker / journal / executors / maxDepth).

```ts
const result = await supervise(
  { name: 'supervisor', harness: null, systemPrompt: '…delegate, do not solve…' },
  'Produce the exact line: READY',
  { budget, router, backend },
)
```

- **`profile.harness`** picks the brain: `null` → the in-process router tool-loop; a coding CLI
  (`'opencode'`/`'claude-code'`/`'codex'`) → a sandboxed harness driving the coordination verbs.
- **`backend`** is WHERE the workers run — one data value (swap `router-tools` → `sandbox`+harness).
- **`deliverable`** (optional, recommended) is the completion oracle: "delivered" means a real check
  passed, not the worker's self-report.

Run: `TANGLE_API_KEY=<router key> pnpm tsx examples/supervise/supervise.ts`

This is the smallest call — router brain, router-tools workers, everything defaulted. When your
workers need a real backend (a sandbox box, a local harness CLI, or the coordination MCP), graduate
to [`../supervisor-loop/`](../supervisor-loop/) — the same `supervise()` call with the worker
backend as the only knob. For the lower-level seams (`supervisorAgent` + `createSupervisor().run`)
see its README.
