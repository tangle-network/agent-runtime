/**
 * Offline gate-plumbing test. A deterministic stub `ExecutorRegistry` is injected so the gate
 * path runs with NO network: it proves the bridge wiring end-to-end — the persona + `fanout`
 * drives the `Supervisor`, the per-child deployable verdict drives selection, the paired metric is
 * derived from the run's own trajectory, and the conserved pool yields equal-k across arms.
 *
 * The LIVE solve-and-grade path (`benchSolverRegistry` → router + `adapter.judge`) is exercised
 * by a real gate run against a deployable-checker domain, not here.
 *
 *   tsx bench/src/gate.test.mts
 */

import assert from 'node:assert/strict'
import type {
  AgentSpec,
  DefaultVerdict,
  ExecutorContext,
  ExecutorRegistry,
  Executor,
  ExecutorFactory,
  ExecutorResult,
} from '@tangle-network/agent-runtime/loops'
import type { BenchmarkAdapter, BenchScore, BenchTask } from './benchmarks/types'
import { runGate, type SolveTask } from './gate'

/** A child whose verdict is decided purely by whether its prompt carries the STRONG marker — so a
 *  diverse arm that injects a STRONG strategy beats a blind arm that never does. Fixed spend per
 *  child (independent of prompt length) so both arms spend identically → equal-k is exact. */
function stubLeaf(_spec: AgentSpec, ctx: ExecutorContext): Executor<unknown> {
  let artifact: ExecutorResult<unknown> | undefined
  return {
    runtime: 'stub',
    execute(task): Promise<ExecutorResult<unknown>> {
      void ctx.signal
      const t = task as SolveTask
      const strong = t.prompt.includes('STRONG')
      const verdict: DefaultVerdict = { valid: strong, score: strong ? 0.9 : 0.2 }
      artifact = {
        outRef: `stub:${t.instance.id}:${strong ? 1 : 0}`,
        out: `cand:${t.instance.id}:${strong ? 'strong' : 'weak'}`,
        verdict,
        spent: { iterations: 1, tokens: { input: 100, output: 20 }, usd: 0, ms: 1 },
      }
      return Promise.resolve(artifact)
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact() {
      if (!artifact) throw new Error('stubLeaf: resultArtifact before execute')
      return artifact
    },
  }
}

const stubRegistry: ExecutorRegistry = {
  register() {
    throw new Error('stub: register unsupported')
  },
  resolve<Out>(_spec: AgentSpec) {
    const factory: ExecutorFactory<Out> = (s, ctx) => stubLeaf(s, ctx) as Executor<Out>
    return { succeeded: true as const, value: factory }
  },
}

function stubAdapter(n: number): BenchmarkAdapter {
  const tasks: BenchTask[] = Array.from({ length: n }, (_v, i) => ({
    id: `t${i}`,
    prompt: `solve instance ${i}`,
  }))
  return {
    name: 'stub-bench',
    preflight: () => Promise.resolve(),
    loadTasks: (opts) =>
      Promise.resolve(opts?.limit !== undefined ? tasks.slice(0, opts.limit) : tasks),
    // judge is NOT exercised on the injected-registry path (the stub leaf sets verdicts directly);
    // a real run reaches the adapter judge through benchSolverRegistry.
    judge: (): Promise<BenchScore> => {
      throw new Error('stub judge must not be called on the injected-registry path')
    },
    goldArtifact: () => Promise.resolve(undefined),
  }
}

const profile = { name: 'stub-solver', model: { default: 'stub-model' } } as never

const report = await runGate({
  adapter: stubAdapter(5),
  profile,
  strategies: ['plain restate', 'use the STRONG verified approach', 'enumerate edge cases'],
  routerBaseUrl: 'http://unused',
  routerKey: 'unused',
  model: 'stub-model',
  solverRegistry: stubRegistry,
})

assert.equal(report.benchmark, 'stub-bench')
assert.equal(report.k, 3, 'k = strategies.length')
assert.equal(report.n, 5, 'n = loaded tasks')
assert.equal(report.perTask.length, 5)

const blind = report.arms.find((a) => a.label === 'blind')
const diverse = report.arms.find((a) => a.label === 'diverse')
assert.ok(blind && diverse, 'both arms present')

// Blind = k identical copies of a prompt with no STRONG marker → every child weak → never resolves.
assert.equal(blind.resolved, 0, 'blind resolves nothing (no STRONG strategy)')
assert.equal(blind.errored, 0, 'no infra-errored blind runs')
assert.equal(blind.resolveRate, 0)

// Diverse injects a STRONG strategy → the deployable selector picks that child → resolves each task.
assert.equal(diverse.resolved, 5, 'diverse resolves every task via the STRONG strategy child')
assert.equal(diverse.resolveRate, 1)

assert.equal(report.deltaPp, 100, 'diverse − blind = +100pp on this constructed signal')
for (const row of report.perTask) {
  assert.equal(row.blind, false, `${row.id}: blind not resolved`)
  assert.equal(row.diverse, true, `${row.id}: diverse resolved`)
}

// Both arms opened k=3 children at a fixed per-child spend → identical conserved cost → equal-k.
assert.equal(report.equalK.withinTolerance, true, 'arms are at equal compute (the equal-k proof)')
assert.equal(blind.totalSpend.iterations, 15, 'blind: 5 tasks × 3 children')
assert.equal(diverse.totalSpend.iterations, 15, 'diverse: 5 tasks × 3 children')
assert.equal(
  blind.totalSpend.tokens.input + blind.totalSpend.tokens.output,
  diverse.totalSpend.tokens.input + diverse.totalSpend.tokens.output,
  'identical token spend across arms',
)

console.log('gate.test: OK — gate runs through the Supervisor, deployable selection + equal-k verified')
