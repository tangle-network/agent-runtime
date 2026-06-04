/**
 * The benchmark registry — the single source of truth for every wired benchmark.
 * One key per benchmark; the value is its `BenchmarkAdapter` factory. `runBenchmarks`
 * (the unifier) maps over this; `run.ts`, `rsi.ts`, and `corpus-replay.mts` all read it
 * here rather than each keeping their own copy.
 */

import { createAecBenchAdapter } from './benchmarks/aec-bench'
import { createAppWorldAdapter } from './benchmarks/appworld'
import { createCadBenchAdapter } from './benchmarks/cadbench'
import { createCadDesignAdapter } from './benchmarks/cad-design'
import { createCadGenBenchAdapter } from './benchmarks/cadgenbench'
import { createCommit0Adapter } from './benchmarks/commit0'
import { createFinsearchcompAdapter } from './benchmarks/finsearchcomp'
import { createFramesAdapter } from './benchmarks/frames'
import { createHotpotqaAdapter } from './benchmarks/hotpotqa'
import { createMind2WebAdapter } from './benchmarks/mind2web'
import { createProgrambenchAdapter } from './benchmarks/programbench'
import { createSimpleQaAdapter } from './benchmarks/simpleqa'
import { createSweBenchAdapter } from './benchmarks/swe-bench'
import { createTerminalBenchAdapter } from './benchmarks/terminal-bench'
import type { BenchmarkAdapter } from './benchmarks/types'

export const ADAPTERS: Record<string, () => BenchmarkAdapter> = {
  'swe-bench': createSweBenchAdapter,
  'terminal-bench': createTerminalBenchAdapter,
  // Code-benches sharing ./benchmarks/_harness (stage → external evaluator → report).
  // loadTasks fetches the REAL dataset (committed fixtures fallback offline); judge
  // delegates to the benchmark's own harness and fails loud when it/Docker is absent.
  'aec-bench': createAecBenchAdapter,
  commit0: createCommit0Adapter,
  programbench: createProgrambenchAdapter,
  appworld: createAppWorldAdapter,
  'cad-design': createCadDesignAdapter,
  cadbench: createCadBenchAdapter,
  cadgenbench: createCadGenBenchAdapter,
  frames: createFramesAdapter,
  finsearchcomp: createFinsearchcompAdapter,
  simpleqa: createSimpleQaAdapter,
  hotpotqa: createHotpotqaAdapter,
  mind2web: createMind2WebAdapter,
}

/** Resolve a benchmark key to its adapter, failing loud with the known keys. */
export function resolveAdapter(key: string): BenchmarkAdapter {
  const make = ADAPTERS[key]
  if (!make) throw new Error(`unknown benchmark ${JSON.stringify(key)} (have: ${Object.keys(ADAPTERS).join(', ')})`)
  return make()
}
