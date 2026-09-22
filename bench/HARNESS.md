# Benchmark Operations

This guide covers the commands and records needed to run `@tangle-network/agent-bench` without hiding unavailable tasks or failed scoring.

## Package Checks

From the Runtime repository root:

```bash
pnpm run build
pnpm --filter @tangle-network/agent-bench run typecheck:public
pnpm --filter @tangle-network/agent-bench test
pnpm --filter @tangle-network/agent-bench run verify:package:local-runtime
```

The packed-consumer check proves that the published package exports resolve outside the monorepo.

## Registry

`ADAPTERS` contains the registered benchmark adapters.
`resolveAdapter(name)` returns one adapter and fails for an unknown name.

Every adapter must implement:

- `preflight()` for local dependencies and credentials;
- `load(options)` for deterministic task selection;
- `judge(task, artifact)` for benchmark-owned scoring;
- stable task IDs and structured score details.

An adapter must not silently replace its official scoring path with an LLM estimate or a placeholder score.

## Command-Line Matrix

The matrix command runs selected benchmarks over selected cells:

```bash
TANGLE_API_KEY=... \
BENCHMARKS=crag,ragbench \
CELLS=opencode/gpt-5,codex/gpt-5 \
N=20 \
REPS=3 \
CONCURRENCY=4 \
pnpm --filter @tangle-network/agent-bench run run-benchmarks
```

Useful variables:

| Variable | Meaning |
|---|---|
| `BENCHMARKS` | Comma-separated registry keys |
| `CELLS` | Comma-separated model or CLI/model cells |
| `N` | Tasks per benchmark |
| `IDS` | Exact task IDs instead of the first `N` |
| `SPLIT` | Dataset split when supported |
| `REPS` | Attempts per task and cell |
| `LOOP_ATTEMPTS` | Worker turns per attempt |
| `CONCURRENCY` | Maximum active attempts |
| `TIMEOUT_MS` | Per-attempt timeout |
| `BACKEND` | `router`, `sandbox`, or `cli-bridge` |
| `VERIFY_JUDGE` | Set to `0` only for adapter development |

The command prints every task result and reports unavailable benchmarks separately.

## SWE-bench

SWE-bench scoring requires Python, the official `swebench` package, and Docker:

```bash
python3 -m venv .venv
.venv/bin/pip install swebench
pnpm install
```

Retain official evaluator output for every scored attempt:

```ts
const adapter = createSweBenchAdapter({
  captureEvaluatorArtifacts: ({ taskId, attemptSequence }) => ({
    destination: path.join(runDirectory, taskId, String(attemptSequence)),
  }),
})
```

Each destination contains the evaluator tree, process output, and a receipt with file hashes.
The destination must be unique and absent before scoring.

## Pier

Run the local pair proof before using a prepared candidate with Pier:

```bash
PIER_REPO=/path/to/pier pnpm --filter @tangle-network/agent-bench run verify:pier
```

This checks a denied model claim, a valid claim, and cleanup recovery in a fresh process.

## Result Record

Retain these fields for every comparison:

- package and commit versions;
- date and exact command;
- benchmark, split, task IDs, and repetitions;
- profile, provider, CLI, and model for every cell;
- time, token, and cost limits;
- per-attempt score, failure, usage, cost, and duration;
- official scoring artifacts when the benchmark emits them;
- aggregate counts and distributions without dropping errors.

Do not compare cells with different task sets or attempt budgets as if the provider or profile caused the difference.
