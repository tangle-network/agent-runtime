# benchmark-matrix

Rank a matrix of agent cells (harness × model × persona) across a subset of the external benchmark
registry, in one `runBenchmarks` call.

This is the registry counterpart to [`webcode-matrix`](../webcode-matrix): that example ranks
profiles on one custom suite via `runProfileMatrix`; this one pulls scenarios from
[`@tangle-network/agent-bench`](../../bench)'s 23-adapter registry (swe-bench, terminal-bench,
humaneval, dabstep, …), each scored by its OWN deterministic judge.

```ts
const report = await runBenchmarks({
  benchmarks: ['humaneval', 'swe-bench'],          // any subset of the registry
  cells: [
    { label: 'opencode/glm-4.6', harness: 'opencode', model: 'glm-4.6', backend: 'sandbox' },
    { label: 'codex/gpt-5',      harness: 'codex',    model: 'gpt-5',   backend: 'sandbox' },
    { label: 'router/flash',     model: 'deepseek-v4-flash',           backend: 'router'  },
  ],
  routerBaseUrl, routerKey, n: 20,
})
console.log(printBenchmarksReport(report))
```

- **harness** rides the in-box `backend.type` (`opencode` / `codex` / `claude-code` / `kimi-code`).
- **model** rides the cell; **persona** rides the cell's optional `profile`.
- **transport**: `backend: 'router'` runs an off-box completion as the worker; anything else runs in
  a real sandbox with the chosen harness.
- The number is the adapter's judge — never a self-authored score. A benchmark whose harness is
  absent (no Docker/venv/dataset) or whose judge fails its own gold is listed under `unavailable`,
  never silently dropped.

## Run

```bash
# offline demo (no creds): a stub adapter + stub shot prove the matrix end to end
tsx examples/benchmark-matrix/benchmark-matrix.ts

# live
TANGLE_API_KEY=... BENCHMARKS=humaneval CELLS=opencode/glm-4.6,codex/gpt-5 \
  tsx examples/benchmark-matrix/benchmark-matrix.ts
```

Or via the package CLI:

```bash
TANGLE_API_KEY=... BENCHMARKS=humaneval,swe-bench CELLS=opencode/glm-4.6,codex/gpt-5 \
  N=20 CONCURRENCY=6 pnpm --filter @tangle-network/agent-bench run-benchmarks
```
