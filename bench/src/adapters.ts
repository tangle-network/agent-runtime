/**
 * The benchmark registry — the single source of truth for every wired benchmark.
 * One key per benchmark; the value is its `BenchmarkAdapter` factory. `runBenchmarks`
 * (the unifier) maps over this; `run.ts`, `rsi.ts`, and `corpus-replay.mts` all read it
 * here rather than each keeping their own copy.
 */

import { createAecBenchAdapter } from './benchmarks/aec-bench'
import { createAgentBenchAdapter } from './benchmarks/agentbench'
import { createAppWorldAdapter, createAppWorldReactAdapter } from './benchmarks/appworld'
import { createBfclAdapter } from './benchmarks/bfcl'
import { createCadBenchAdapter } from './benchmarks/cadbench'
import { createCadDesignAdapter } from './benchmarks/cad-design'
import { createCadGenBenchAdapter } from './benchmarks/cadgenbench'
import { createCommit0Adapter } from './benchmarks/commit0'
import { createCragAdapter } from './benchmarks/crag'
import { createDabstepAdapter } from './benchmarks/dabstep'
import { createEnterpriseOpsGymAdapter } from './benchmarks/enterpriseops-gym'
import { createFinResearchBenchAdapter } from './benchmarks/finresearchbench'
import { createFinsearchcompAdapter } from './benchmarks/finsearchcomp'
import { createFramesAdapter } from './benchmarks/frames'
import { createHotpotqaAdapter } from './benchmarks/hotpotqa'
import { createHumanEvalAdapter } from './benchmarks/humaneval'
import { createMcadBenchAdapter } from './benchmarks/mcad-bench'
import { createMind2WebAdapter } from './benchmarks/mind2web'
import { createNoMiraclAdapter } from './benchmarks/nomiracl'
import { createOpenRagBenchAdapter } from './benchmarks/open-rag-bench'
import { createProgrambenchAdapter } from './benchmarks/programbench'
import { createRagBenchAdapter } from './benchmarks/ragbench'
import { createSimpleQaAdapter } from './benchmarks/simpleqa'
import { createSweBenchAdapter } from './benchmarks/swe-bench'
import { createT2RagBenchAdapter } from './benchmarks/t2-ragbench'
import { createTau2BenchAdapter } from './benchmarks/tau2-bench'
import { createTau3BankingAdapter } from './benchmarks/tau3-banking'
import { createTerminalBenchAdapter } from './benchmarks/terminal-bench'
import { createToolLlmAdapter } from './benchmarks/toollm'
import { createTrataHedgeAdapter } from './benchmarks/trata-hedge'
import { createWebArenaVerifiedAdapter } from './benchmarks/webarena-verified'
import type { BenchmarkAdapter } from './benchmarks/types'

export const ADAPTERS: Record<string, () => BenchmarkAdapter> = {
  'swe-bench': createSweBenchAdapter,
  'terminal-bench': createTerminalBenchAdapter,
  // Code-benches sharing ./benchmarks/_harness (stage → external evaluator → report).
  // loadTasks fetches the REAL dataset (committed fixtures fallback offline); judge
  // delegates to the benchmark's own harness and fails loud when it/Docker is absent.
  'aec-bench': createAecBenchAdapter,
  commit0: createCommit0Adapter,
  dabstep: createDabstepAdapter,
  programbench: createProgrambenchAdapter,
  'webarena-verified': createWebArenaVerifiedAdapter,
  'tau2-bench': createTau2BenchAdapter,
  'tau3-banking': createTau3BankingAdapter,
  agentbench: createAgentBenchAdapter,
  bfcl: createBfclAdapter,
  toollm: createToolLlmAdapter,
  appworld: createAppWorldAdapter,
  // AppWorld's native interactive protocol — the worker is the in-engine ReAct
  // episode (execution feedback every turn), the mode published baselines use.
  'appworld-react': createAppWorldReactAdapter,
  'enterpriseops-gym': createEnterpriseOpsGymAdapter,
  'cad-design': createCadDesignAdapter,
  // Dimensioned mechanical parts: same OpenSCAD+xvfb judge deps as cad-design, but
  // the spec is metric (bbox / volume / body count / point-in-solid hole probes)
  // rather than qualitative, and every task carries a verified gold.
  mcad: createMcadBenchAdapter,
  cadbench: createCadBenchAdapter,
  cadgenbench: createCadGenBenchAdapter,
  frames: createFramesAdapter,
  ragbench: createRagBenchAdapter,
  crag: createCragAdapter,
  nomiracl: createNoMiraclAdapter,
  'open-rag-bench': createOpenRagBenchAdapter,
  't2-ragbench': createT2RagBenchAdapter,
  finresearchbench: createFinResearchBenchAdapter,
  finsearchcomp: createFinsearchcompAdapter,
  simpleqa: createSimpleQaAdapter,
  hotpotqa: createHotpotqaAdapter,
  // Deployable-checker code domain: worker = router completion, judge = Docker test
  // run (--network=none). The steering A/B counterpart to humaneval-gate.mts (selection).
  humaneval: createHumanEvalAdapter,
  mind2web: createMind2WebAdapter,
  'trata-hedge': createTrataHedgeAdapter,
}

/** Resolve a benchmark key to its adapter, failing loud with the known keys. */
export function resolveAdapter(key: string): BenchmarkAdapter {
  const make = ADAPTERS[key]
  if (!make) throw new Error(`unknown benchmark ${JSON.stringify(key)} (have: ${Object.keys(ADAPTERS).join(', ')})`)
  return make()
}
