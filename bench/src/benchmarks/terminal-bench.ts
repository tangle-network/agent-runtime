/**
 * Terminal-Bench adapter. Worker artifact = the commands/solution the agent ran
 * in the task container; judge = the task's pytest suite run in that container
 * (deterministic). Native fit for the sandbox/terminal loop.
 *
 * Scaffolded against the shared {@link BenchmarkAdapter} contract; the harness
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

export function createTerminalBenchAdapter(): BenchmarkAdapter {
  return {
    name: 'terminal-bench',
    async preflight() {
      try {
        await execFileAsync(PY, ['-c', 'import terminal_bench; print("ok")'])
      } catch {
        throw new Error(
          'terminal-bench not installed. Fix: bench/.venv/bin/pip install terminal-bench ; ' +
            'then the task containers are pulled on first run (Docker required).',
        )
      }
    },
    async loadTasks(_opts: LoadOptions = {}): Promise<BenchTask[]> {
      throw new Error(
        'terminal-bench loadTasks not yet wired. Next: enumerate `tb tasks` and map each ' +
          '(Dockerfile + tests/) to a BenchTask; artifact = the agent transcript run via `tb run`.',
      )
    },
    async judge(_task: BenchTask, _artifact: string): Promise<BenchScore> {
      throw new Error(
        'terminal-bench judge not yet wired. Next: run the task container, apply the agent ' +
          "transcript, run the task's pytest suite → resolved.",
      )
    },
    async goldArtifact() {
      return undefined // terminal-bench tasks ship a solution.sh oracle; map it here when wiring.
    },
  }
}
