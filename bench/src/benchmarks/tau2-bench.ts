/**
 * tau2-bench adapter (Sierra tau2/tau-bench successor).
 *
 * Worker artifact = a tau2 `results.json`/trajectory file. Judge = tau2's own
 * reward recomputation over that trajectory. A normal final-answer transcript is
 * not a valid artifact for this benchmark.
 */

import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { OutputAdapter } from '@tangle-network/agent-runtime/loops'
import { benchRoot, runVenvPython } from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const FIXTURES = join(benchRoot, 'fixtures', 'tau2-bench.json')

interface Tau2Row {
  id: string
  domain: string
  user_scenario?: unknown
  description?: unknown
  evaluation_criteria?: unknown
}

interface Tau2Meta {
  taskId: string
  domain: string
  split?: string
  userScenario?: unknown
  description?: unknown
  evaluationCriteria?: unknown
}

const tau2Dir = (): string | undefined => process.env.TAU2_BENCH_DIR
const tau2Domain = (): string => process.env.TAU2_DOMAIN ?? 'retail'

export const tau2ResultsOutput: OutputAdapter<string> = {
  parse(events) {
    let text = ''
    for (const ev of events) {
      const d = (ev as { data?: Record<string, unknown> })?.data
      const t = d?.finalText ?? d?.text ?? d?.result
      if (typeof t === 'string' && t.length > 0) text = t
    }
    const fences = [...text.matchAll(/```(?:text|path|json)?\s*\n([\s\S]*?)```/g)]
    return (fences.at(-1)?.[1] ?? text).trim()
  },
}

async function assertPath(path: string, label: string): Promise<void> {
  try {
    await stat(path)
  } catch (err) {
    throw new Error(`tau2-bench: missing ${label} at ${path} (${err instanceof Error ? err.message : err})`)
  }
}

function rowToTask(row: Tau2Row, split?: string): BenchTask {
  const meta: Tau2Meta = {
    taskId: row.id,
    domain: row.domain,
    split,
    userScenario: row.user_scenario,
    description: row.description,
    evaluationCriteria: row.evaluation_criteria,
  }
  return {
    id: row.id,
    split,
    prompt: [
      `Run this tau2 task in the official ${row.domain} domain.`,
      'The benchmark is a simulated multi-turn user/tool conversation.',
      '',
      typeof row.user_scenario === 'string' ? row.user_scenario : JSON.stringify(row.user_scenario ?? {}, null, 2),
      '',
      'Return the path to the official tau2 results.json or trajectory file containing this task run.',
    ].join('\n'),
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): Tau2Meta {
  const md = task.metadata
  if (!md || typeof md.taskId !== 'string' || typeof md.domain !== 'string') {
    throw new Error(`tau2-bench task ${task.id} missing metadata — loadTasks did not populate it`)
  }
  return md as unknown as Tau2Meta
}

function selectRows(rows: Tau2Row[], opts: LoadOptions, split?: string): BenchTask[] {
  let tasks = rows.map((row) => rowToTask(row, split))
  if (opts.ids) {
    const want = new Set(opts.ids)
    tasks = tasks.filter((task) => want.has(task.id))
  } else if (opts.limit !== undefined) {
    tasks = tasks.slice(0, opts.limit)
  }
  if (tasks.length === 0) throw new Error(`tau2-bench: no tasks matched ${JSON.stringify(opts)}`)
  return tasks
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(FIXTURES, 'utf8')) as Tau2Row[]
  console.warn(`[tau2-bench] TAU2_FIXTURES=1 — loading ${rows.length} adapter fixtures`)
  return selectRows(rows, opts, opts.split)
}

async function loadOfficialTasks(root: string, opts: LoadOptions): Promise<BenchTask[]> {
  const domain = tau2Domain()
  const script = `
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
domain = sys.argv[2]
split = sys.argv[3] or None
sys.path.insert(0, str(root / "src"))
from tau2.registry import registry
loader = registry.get_tasks_loader(domain)
tasks = loader(split)
rows = []
for task in tasks:
    row = task.model_dump(mode="json")
    row["domain"] = domain
    rows.append(row)
print(json.dumps(rows))
`
  const stdout = await runVenvPython(script, [root, domain, opts.split ?? ''])
  return selectRows(JSON.parse(stdout) as Tau2Row[], opts, opts.split)
}

async function scoreOfficialTrajectory(root: string, meta: Tau2Meta, artifactPath: string): Promise<Record<string, unknown>> {
  const script = `
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
task_id = sys.argv[2]
artifact = Path(sys.argv[3])
sys.path.insert(0, str(root / "src"))
from tau2.data_model.simulation import Results
from tau2.scripts.evaluate_trajectories import compute_simulation_rewards
results = Results.load(artifact)
updated = compute_simulation_rewards(results)
scores = []
for sim in updated.simulations:
    if sim.task_id == task_id and sim.reward_info is not None:
        scores.append(float(sim.reward_info.reward))
if not scores:
    raise SystemExit(f"no scored simulations for task_id={task_id} in {artifact}")
print(json.dumps({"count": len(scores), "score": sum(scores) / len(scores), "scores": scores}))
`
  const stdout = await runVenvPython(script, [root, meta.taskId, artifactPath], 0)
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>
}

export function createTau2BenchAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.TAU2_FIXTURES === '1'

  return {
    name: 'tau2-bench',
    output: tau2ResultsOutput,

    async preflight() {
      if (fixturesMode) return
      const dir = tau2Dir()
      if (!dir) {
        throw new Error(
          'TAU2_BENCH_DIR is required. Fix: clone https://github.com/sierra-research/tau2-bench, install its deps in bench/.venv, and set TAU2_BENCH_DIR=/path/to/tau2-bench.',
        )
      }
      await assertPath(join(dir, 'src', 'tau2', 'registry.py'), 'tau2 registry')
      await loadOfficialTasks(dir, { limit: 1 })
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      const dir = tau2Dir()
      if (!dir) throw new Error('TAU2_BENCH_DIR is required to load official tau2 tasks')
      return loadOfficialTasks(dir, opts)
    },

    async goldArtifact() {
      return undefined
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const dir = tau2Dir()
      if (!dir) throw new Error('TAU2_BENCH_DIR is required to judge tau2 trajectory artifacts')
      const meta = readMeta(task)
      const artifactPath = resolve(artifact.trim())
      await assertPath(artifactPath, 'tau2 results/trajectory artifact')
      const report = await scoreOfficialTrajectory(dir, meta, artifactPath)
      const score = typeof report.score === 'number' ? report.score : 0
      return {
        resolved: score === 1,
        score,
        detail: JSON.stringify({ taskId: meta.taskId, domain: meta.domain, count: report.count }),
      }
    },
  }
}
