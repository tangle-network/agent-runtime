/**
 * tau2-bench adapter (Sierra tau2/tau-bench successor).
 *
 * Worker artifact = a tau2 `results.json`/trajectory file. Judge = tau2's own
 * reward recomputation over that trajectory. A normal final-answer transcript is
 * not a valid artifact for this benchmark.
 */

import { join } from 'node:path'
import { benchRoot } from './_harness'
import { createTauBenchAdapter, tauResultsOutput } from './tau-bench-shared'
import type { BenchmarkAdapter } from './types'

const FIXTURES = join(benchRoot, 'fixtures', 'tau2-bench.json')

export const tau2ResultsOutput = tauResultsOutput

export function createTau2BenchAdapter(): BenchmarkAdapter {
  return createTauBenchAdapter({
    name: 'tau2-bench',
    fixturePath: FIXTURES,
    fixturesEnv: 'TAU2_FIXTURES',
    dirEnv: 'TAU2_BENCH_DIR',
    domainEnv: 'TAU2_DOMAIN',
    defaultDomain: 'retail',
    taskIntro: 'Run this tau2 task in the official tau2 text benchmark.',
    installHint:
      'clone https://github.com/sierra-research/tau2-bench, install its deps in bench/.venv, and set TAU2_BENCH_DIR=/path/to/tau2-bench.',
  })
}
