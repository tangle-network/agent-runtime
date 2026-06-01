/**
 * AppWorld adapter. Worker artifact = the agent's API-calling solution code;
 * judge = AppWorld's programmatic state-checker over the simulated apps
 * (deterministic). Tests agentic tool-use breadth.
 *
 * Scaffolded against the shared {@link BenchmarkAdapter} contract; harness
 * wiring is the next chunk. `preflight` is real; `loadTasks`/`judge` fail loud
 * with the exact integration step rather than faking a result.
 */

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const execFileAsync = promisify(execFile)
const BENCH_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PY = join(BENCH_ROOT, '.venv', 'bin', 'python')

export function createAppWorldAdapter(): BenchmarkAdapter {
  return {
    name: 'appworld',
    async preflight() {
      try {
        await execFileAsync(PY, ['-c', 'import appworld; print("ok")'])
      } catch {
        throw new Error(
          'appworld not installed. Fix: bench/.venv/bin/pip install appworld ; ' +
            'appworld install ; appworld download data  (the simulated-app environment + tasks).',
        )
      }
    },
    async loadTasks(_opts: LoadOptions = {}): Promise<BenchTask[]> {
      throw new Error(
        'appworld loadTasks not yet wired. Next: enumerate the task suite (train/dev/test_normal/' +
          'test_challenge); prompt = the task instruction; metadata = the app APIs available.',
      )
    },
    async judge(_task: BenchTask, _artifact: string): Promise<BenchScore> {
      throw new Error(
        'appworld judge not yet wired. Next: run the solution against the AppWorld engine and ' +
          'invoke its programmatic evaluator (state checks) → resolved + per-check score.',
      )
    },
    async goldArtifact() {
      return undefined
    },
  }
}
