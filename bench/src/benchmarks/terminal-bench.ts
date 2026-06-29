/**
 * Terminal-Bench adapter. Each task = a Docker environment + an English
 * instruction + a per-task verifier (run-tests.sh + pytest). The worker artifact
 * is the shell script the agent ran to attempt the task; the judge REPLAYS that
 * script in a fresh task container via the Terminal-Bench harness (`tb run` with
 * our ScriptAgent), then the task's own verifier scores the resulting state.
 * Fully deterministic — no LLM judge, no self-authored score.
 *
 * Requires: an isolated bench `.venv-terminal-bench` with `terminal-bench`
 * installed + a running Docker daemon (per-task images are built on first run).
 * Override with TERMINAL_BENCH_VENV. loadTasks caches the dataset from the
 * Terminal-Bench registry on first run.
 *
 * Process/Docker/report plumbing is shared via ./_harness; this file owns the
 * Terminal-Bench-specific pieces: the Dataset enumeration, the ScriptAgent replay
 * argv, and the results.json shape.
 */

import { join } from 'node:path'
import {
  benchRoot,
  preflightVenvImports,
  readJsonReport,
  runStagedJudge,
  runVenvPython,
  safeRunId,
  stageFile,
  venvPythonAt,
} from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

// Terminal-Bench imports LiteLLM/Pydantic-2 APIs, while AppWorld pins Pydantic 1.
// Keep it out of the shared bench .venv. Resolved at call-time so tests/runs can
// override the env without reloading this module.
const terminalBenchVenvDir = (): string => process.env.TERMINAL_BENCH_VENV ?? '.venv-terminal-bench'
const terminalBenchPython = (): string => venvPythonAt(terminalBenchVenvDir())
const terminalBenchBin = (): string => join(benchRoot, terminalBenchVenvDir(), 'bin', 'tb')

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

// Import path the harness uses to load our replay agent (cwd = benchRoot).
const SCRIPT_AGENT = 'tb_agents.script_agent:ScriptAgent'

interface TbTaskRow {
  id: string
  instruction: string
  task_dir: string
  solution: string | null
}

interface TbReport {
  resolved_ids?: string[]
  results?: Array<{ task_id: string; is_resolved: boolean | null; parser_results?: unknown }>
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
  const stdout = await runVenvPython(
    script,
    [ids ? JSON.stringify(ids) : '', limit !== null ? String(limit) : ''],
    0,
    terminalBenchPython(),
  )
  return JSON.parse(stdout) as TbTaskRow[]
}

export function createTerminalBenchAdapter(): BenchmarkAdapter {
  return {
    name: 'terminal-bench',

    async preflight() {
      await preflightVenvImports({
        modules: ['terminal_bench'],
        requireDocker: true,
        python: terminalBenchPython(),
        fix:
          `Fix: (1) python3 -m venv bench/${terminalBenchVenvDir()} && ` +
          `bench/${terminalBenchVenvDir()}/bin/pip install terminal-bench ` +
          `(an ISOLATED venv — Terminal-Bench/LiteLLM require Pydantic 2 while AppWorld pins Pydantic 1; ` +
          `override the dir with TERMINAL_BENCH_VENV) ; ` +
          `(2) ensure the Docker daemon is running (the judge builds per-task images on first run). ` +
          `The ${DATASET_REF} dataset is cached from the Terminal-Bench registry on first loadTasks.`,
      })
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
      const runId = safeRunId('bench', `${task.id}-${Date.now()}`)
      return runStagedJudge({
        tmpPrefix: 'tbench-',
        bin: terminalBenchBin(),
        cwd: () => benchRoot,
        async stage(dir) {
          await stageFile(join(dir, 'attempt.sh'), artifact)
        },
        // The harness builds a fresh task container, runs ScriptAgent (which replays
        // the artifact script), then runs the task's verifier. --no-livestream keeps
        // stdout sane; --cleanup removes the per-run images.
        argv: (dir) => [
          'run',
          '-d', DATASET_REF,
          '-t', task.id,
          '--agent-import-path', SCRIPT_AGENT,
          '--agent-kwarg', `script_path=${join(dir, 'attempt.sh')}`,
          '--output-path', join(dir, 'runs'),
          '--run-id', runId,
          '--n-concurrent', '1',
          '--no-livestream',
          '--cleanup',
        ],
        async parseReport(dir) {
          const report = await readJsonReport<TbReport>(join(dir, 'runs', runId, 'results.json'))
          const resolved = (report.resolved_ids ?? []).includes(task.id)
          const trial = report.results?.find((r) => r.task_id === task.id)
          return {
            resolved,
            score: resolved ? 1 : 0,
            detail: JSON.stringify(trial?.parser_results ?? report.resolved_ids ?? {}),
          }
        },
      })
    },
  }
}
