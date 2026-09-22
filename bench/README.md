# Agent Bench

`@tangle-network/agent-bench` provides benchmark adapters and one runner for comparing agent cells on the same tasks.

## Install

```bash
pnpm add -D @tangle-network/agent-bench
```

## Score One Artifact

```ts
import { resolveAdapter } from '@tangle-network/agent-bench'

const adapter = resolveAdapter('crag')
await adapter.preflight()

const [task] = await adapter.load({ limit: 1 })
const score = await adapter.judge(task, artifact)
```

Each adapter owns task loading, output parsing, and benchmark-specific scoring.
Missing datasets, Docker, Python packages, or credentials fail in `preflight()` instead of producing a partial score.

## Compare Agents

```ts
import {
  printBenchmarksReport,
  runBenchmarks,
} from '@tangle-network/agent-bench'

const report = await runBenchmarks({
  benchmarks: ['crag', 'ragbench'],
  cells,
  n: 20,
  reps: 3,
  concurrency: 4,
})

console.log(printBenchmarksReport(report))
```

A cell supplies a profile, provider, and model label.
Use the same tasks, attempt count, time limits, and resource limits for every compared cell.

See [`HARNESS.md`](./HARNESS.md) for local setup, command-line runs, and result requirements.
