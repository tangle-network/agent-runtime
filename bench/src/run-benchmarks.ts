/**
 * The benchmark unifier — run ANY (or EVERY) wired benchmark uniformly, at scale,
 * with the developer supplying only an AgentProfile + which benchmark(s). It is
 * `runExperiment` mapped over the `ADAPTERS` registry: one entry per benchmark, the
 * loop never changes. Specificity lives ONLY here at the call site (the profile + the
 * benchmark list); orchestration, scoring, scale, trace, and the corpus are free
 * below it. No new engine — the developer's whole surface is `runBenchmarks(...)`.
 */

import type { AgentProfile, LoopSandboxClient } from '@tangle-network/agent-runtime/loops'
import { ADAPTERS, resolveAdapter } from './adapters'
import {
  type Arm,
  type ExperimentResult,
  randomArm,
  runExperiment,
  sandboxAgentRun,
  type WorkerBackendType,
} from './experiment'

export interface RunBenchmarksOptions {
  /** The ONE specificity: who the agent is (prompt / model / tools / mcp). */
  profile: AgentProfile
  /** Which benchmark(s) — keys into the registry, or 'all'. */
  benchmarks: string[] | 'all'
  /** The execution substrate, injected (fleet-swappable for scale). */
  sandboxClient: LoopSandboxClient
  /** Router endpoint + key the in-box worker calls. */
  routerBaseUrl: string
  routerKey: string
  /** The cost dial (which CLI/runtime runs in-box). Default opencode. */
  backendType?: WorkerBackendType
  /** Model id; defaults to the profile's default model, then gpt-5. */
  model?: string
  /** Arms: `arms[0]` is the compute control. Default a single blind arm. */
  arms?: [Arm, ...Arm[]]
  n?: number
  rounds?: number
  concurrency?: number
  ids?: string[]
  /** If set, each benchmark's RunRecords are written to `${corpusDir}/${key}.jsonl`. */
  corpusDir?: string
}

/**
 * Run each selected benchmark through `runExperiment` with one shared AgentProfile.
 * Returns the per-benchmark result keyed by registry key. Fails loud on an unknown key
 * (via `resolveAdapter`); a per-benchmark error rejects the whole run (no silent skip).
 */
export async function runBenchmarks(opts: RunBenchmarksOptions): Promise<Record<string, ExperimentResult>> {
  const keys = opts.benchmarks === 'all' ? Object.keys(ADAPTERS) : opts.benchmarks
  if (keys.length === 0) throw new Error('runBenchmarks: no benchmarks selected')
  const model = opts.model ?? opts.profile.model?.default ?? 'gpt-5'
  const arms: [Arm, ...Arm[]] = opts.arms ?? [randomArm('blind')]
  const results: Record<string, ExperimentResult> = {}
  for (const key of keys) {
    const adapter = resolveAdapter(key)
    const agentRun = sandboxAgentRun({
      model,
      routerBaseUrl: opts.routerBaseUrl,
      routerKey: opts.routerKey,
      ...(opts.backendType ? { backendType: opts.backendType } : {}),
      profile: opts.profile,
    })
    results[key] = await runExperiment({
      adapter,
      sandboxClient: opts.sandboxClient,
      agentRun,
      arms,
      model,
      ...(opts.n !== undefined ? { n: opts.n } : {}),
      ...(opts.rounds !== undefined ? { rounds: opts.rounds } : {}),
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.ids ? { ids: opts.ids } : {}),
      ...(adapter.output ? { output: adapter.output } : {}),
      ...(opts.corpusDir ? { corpusPath: `${opts.corpusDir}/${key}.jsonl` } : {}),
    })
  }
  return results
}
