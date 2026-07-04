/**
 * tau3-banking adapter.
 *
 * The current upstream tau3 release is the `sierra-research/tau2-bench` repo with
 * package namespace `tau2` and a new `banking_knowledge` domain. This adapter
 * reuses the shared tau reward recomputation path and only changes the default
 * domain/env names.
 */

import { join } from 'node:path'
import { benchRoot } from './_harness'
import { createTauBenchAdapter } from './tau-bench-shared'
import type { BenchmarkAdapter } from './types'

const FIXTURES = join(benchRoot, 'fixtures', 'tau3-banking.json')

export function createTau3BankingAdapter(): BenchmarkAdapter {
  return createTauBenchAdapter({
    name: 'tau3-banking',
    fixturePath: FIXTURES,
    fixturesEnv: 'TAU3_FIXTURES',
    dirEnv: 'TAU3_BENCH_DIR',
    domainEnv: 'TAU3_DOMAIN',
    defaultDomain: 'banking_knowledge',
    taskIntro: 'Run this tau3 banking task in the official tau3 knowledge benchmark.',
    installHint:
      'clone https://github.com/sierra-research/tau2-bench, run `uv sync --extra knowledge`, install/import it from bench/.venv, and set TAU3_BENCH_DIR=/path/to/tau2-bench.',
  })
}
