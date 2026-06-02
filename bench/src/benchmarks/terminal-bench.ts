/**
 * Terminal-Bench adapter. Each task = a Docker environment + an English
 * instruction + a per-task verifier (run-tests.sh + pytest). The worker artifact
 * is the shell script the agent ran to attempt the task; the judge REPLAYS that
 * script in a fresh task container via the Terminal-Bench harness (`tb run` with
 * our ScriptAgent), then the task's own verifier scores the resulting state.
 * Fully deterministic — no LLM judge, no self-authored score.
 *
 * Requires: the bench `.venv` with `terminal-bench` installed + a running Docker
 * daemon (per-task images are built on first run). loadTasks caches the dataset
 * from the Terminal-Bench registry on first run.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const execFileAsync = promisify(execFile)
const BENCH_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PY = join(BENCH_ROOT, '.venv', 'bin', 'python')
const TB = join(BENCH_ROOT, '.venv', 'bin', 'tb')
const BIG = 1024 * 1024 * 256

// Pinned dataset: the 0.1.1 core set is patched for terminal-bench >=0.2.4 (the
// installed CLI) and is the published launch task set. name==version is what `tb
// run -d` and `tb datasets download -d` both accept.
const DATASET = 'terminal-bench-core'
const DATASET_VERSION = '0.1.1'
const DATASET_REF = `${DATASET}==${DATASET_VERSION}`

// Bundled fixture: when no ids/limit are given, load these. hello-world is the
// fastest deterministic task (prebuilt python image, file-write verifier) so the
// adapter is runnable without a large pull.
const FIXTURE_IDS = ['hello-world']

// Import path the harness uses to load our replay agent (cwd = BENCH_ROOT).
const SCRIPT_AGENT = 'tb_agents.script_agent:ScriptAgent'

/** Run the bench venv python with a script on stdin; return stdout (throws on nonzero). */
async function py(script: string, args: string[] = [], timeoutMs = 0): Promise<string> {
  const { stdout } = await execFileAsync(PY, ['-c', script, ...args], {
    maxBuffer: BIG,
    timeout: timeoutMs,
  })
  return stdout
}

interface TbTaskRow {
  id: string
  instruction: string
  task_dir: string
  solution: string | null
}

/** Enumerate dataset tasks via tb's Dataset loader (caches from the registry on
 *  first run). Reads instruction from each task.yaml and the gold solution. */
async function loadRows(opts: LoadOptions): Promise<TbTaskRow[]> {
  const ids = opts.ids ?? (opts.limit ? null : FIXTURE_IDS)
  const limit = opts.limit ?? null
  const script = `
import json, sys
from pathlib import Path
from terminal_bench.dataset.dataset import Dataset
from terminal_bench.handlers.trial_handler import TaskPaths

req_ids = json.loads(sys.argv[1]) if sys.argv[1] else None
limit = json.loads(sys.argv[2]) if sys.argv[2] else None

ds = Dataset(name=${JSON.stringify(DATASET)}, version=${JSON.stringify(DATASET_VERSION)}, task_ids=req_ids, n_tasks=limit)

import yaml
out = []
for task_dir in ds:
    tp = TaskPaths(task_dir)
    cfg = yaml.safe_load(tp.task_config_path.read_text())
    try:
        sol = tp.solution_path.read_text()
    except FileNotFoundError:
        sol = None
    out.append({
        "id": task_dir.name,
        "instruction": cfg["instruction"],
        "task_dir": str(task_dir),
        "solution": sol if (tp.solution_path.suffix == ".sh" if sol is not None else False) else None,
    })
print(json.dumps(out))
`
  const stdout = await py(script, [ids ? JSON.stringify(ids) : '', limit !== null ? String(limit) : ''])
  return JSON.parse(stdout) as TbTaskRow[]
}

export function createTerminalBenchAdapter(): BenchmarkAdapter {
  return {
    name: 'terminal-bench',

    async preflight() {
      try {
        await py('import terminal_bench, docker; docker.from_env().ping(); print("ok")')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `terminal-bench preflight failed: ${msg}\n` +
            `Fix: (1) python3 -m venv bench/.venv && bench/.venv/bin/pip install terminal-bench ; ` +
            `(2) ensure the Docker daemon is running (the judge builds per-task images on first run). ` +
            `The ${DATASET_REF} dataset is cached from the Terminal-Bench registry on first loadTasks.`,
        )
      }
    },

    async loadTasks(opts: LoadOptions = {}) {
      const rows = await loadRows(opts)
      if (rows.length === 0) {
        throw new Error(
          `terminal-bench loadTasks returned no tasks for ${JSON.stringify(opts)} ` +
            `(dataset ${DATASET_REF}). Check the requested ids exist in the dataset.`,
        )
      }
      return rows.map(
        (r): BenchTask => ({
          id: r.id,
          split: DATASET_VERSION,
          prompt: r.instruction,
          metadata: {
            dataset: DATASET,
            datasetVersion: DATASET_VERSION,
            datasetRef: DATASET_REF,
            taskDir: r.task_dir,
            solution: r.solution,
            instruction: r.instruction,
          },
        }),
      )
    },

    async goldArtifact(task: BenchTask) {
      // Gold = the task's solution.sh (the oracle script). solution.yaml tasks have
      // no shell-script artifact form here, so they return undefined (cannot be
      // verify-judged via the script-replay seam — use a .sh-solution task).
      const sol = task.metadata?.solution
      return typeof sol === 'string' ? sol : undefined
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const runId = `bench-${task.id}-${Date.now()}`.replace(/[^a-zA-Z0-9_.-]/g, '_')
      const dir = await mkdtemp(join(tmpdir(), 'tbench-'))
      const scriptPath = join(dir, 'attempt.sh')
      const outPath = join(dir, 'runs')
      try {
        await writeFile(scriptPath, artifact)
        // The harness builds a fresh task container, runs ScriptAgent (which replays
        // the artifact script), then runs the task's verifier. --no-livestream keeps
        // stdout sane; --cleanup removes the per-run images.
        await execFileAsync(
          TB,
          [
            'run',
            '-d', DATASET_REF,
            '-t', task.id,
            '--agent-import-path', SCRIPT_AGENT,
            '--agent-kwarg', `script_path=${scriptPath}`,
            '--output-path', outPath,
            '--run-id', runId,
            '--n-concurrent', '1',
            '--no-livestream',
            '--cleanup',
          ],
          { cwd: BENCH_ROOT, maxBuffer: BIG },
        )
        const reportPath = join(outPath, runId, 'results.json')
        const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
          resolved_ids?: string[]
          results?: Array<{ task_id: string; is_resolved: boolean | null; parser_results?: unknown }>
        }
        const resolved = (report.resolved_ids ?? []).includes(task.id)
        const trial = report.results?.find((r) => r.task_id === task.id)
        return {
          resolved,
          score: resolved ? 1 : 0,
          detail: JSON.stringify(trial?.parser_results ?? report.resolved_ids ?? {}),
        }
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    },
  }
}
