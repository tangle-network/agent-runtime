/**
 * `@tangle-network/agent-bench` — the unified benchmark suite for agent-runtime agents.
 *
 * Any consumer (a product, a supervisor harness, a profile/skill/prompt change) imports the registry
 * and scores its agent's artifact against a real, deterministic judge — without owning the benchmark:
 *
 *   import { resolveAdapter } from '@tangle-network/agent-bench'
 *   const verdict = await resolveAdapter('commit0').judge(task, myAgentsDiff)
 *
 * Each adapter fails loud in `preflight()` when its harness/deps (Docker, a venv, a dataset) are
 * absent, so importing the registry is cheap; running a specific benchmark pulls only its deps.
 */
export { ADAPTERS, resolveAdapter } from './adapters'
export type {
  BenchmarkAdapter,
  BenchScore,
  BenchTask,
  LoadOptions,
} from './benchmarks/types'
