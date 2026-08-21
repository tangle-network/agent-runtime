/**
 * DABStep adapter (EnvCommons/DABStep) — data-analysis questions over synthetic
 * payment files. Worker artifact = final answer text. Judge = the official
 * DABStep `grade.py` normalization/matching function. No LLM judge.
 *
 * Live tasks require `DABSTEP_DIR` pointing at an official DABStep checkout
 * (https://github.com/EnvCommons/DABStep) for `splits/*.txt`, `files/*`, and
 * `grade.py`, plus the released `dataset.csv` task rows — beside the checkout
 * or anywhere via `DABSTEP_DATASET_CSV`. The checkout does not ship
 * `dataset.csv`; see the preflight error text for where the rows come from.
 * The adapter exposes `metadata.resourceRoot` so runners can mount the
 * benchmark files into AgentProfile.resources.files; it does not paste the
 * dataset into prompt text.
 */

import { isAbsolute, join } from 'node:path'
import { access, readFile, stat } from 'node:fs/promises'
import type { OutputAdapter } from '@tangle-network/agent-runtime/kernel'
import { benchRoot, runVenvPython, runVenvScriptStdin } from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const FIXTURES = join(benchRoot, 'fixtures', 'dabstep.json')
const DEFAULT_SPLIT = 'easy'

interface DabstepFixtureRow {
  task_id: number
  instructions: string
  all_golds_by_task: Array<Record<string, unknown>>
}

interface DabstepMeta {
  taskId: number
  split: string
  golds: Array<Record<string, unknown>>
  resourceRoot?: string
}

const dabstepDir = (): string | undefined => process.env.DABSTEP_DIR
const gradeFile = (dir: string): string => join(dir, 'grade.py')
const resourceRoot = (dir: string): string => join(dir, 'files')

/**
 * Where the released task rows come from. The EnvCommons/DABStep git checkout
 * carries grade.py, splits/, and files/ but not dataset.csv: the row file
 * (task_id,question,guidelines,all_golds_by_task) ships with the OpenReward
 * DABStep environment, mounted at /orwd_data/dataset.csv on that platform.
 * The public https://huggingface.co/datasets/adyen/DABstep release holds the
 * same task rows without golds (data/tasks/all.jsonl; answers withheld for the
 * leaderboard) and a 10-task dev split with reference answers
 * (data/tasks/dev.jsonl).
 */
const datasetAcquisitionHint =
  'The DABStep checkout ships grade.py, splits/, and files/ but not dataset.csv. ' +
  'dataset.csv (task_id,question,guidelines,all_golds_by_task) is distributed with the OpenReward DABStep environment ' +
  '(mounted at /orwd_data/dataset.csv on that platform); the public https://huggingface.co/datasets/adyen/DABstep release ' +
  'carries the task rows without golds (data/tasks/all.jsonl) and a 10-task dev split with reference answers (data/tasks/dev.jsonl). ' +
  'Place dataset.csv beside the checkout, or point DABSTEP_DATASET_CSV at it.'

/** The released row file: `<dir>/dataset.csv`, or the `DABSTEP_DATASET_CSV` override so checkout and export can live apart. */
function datasetFile(dir: string): string {
  const override = process.env.DABSTEP_DATASET_CSV
  if (override === undefined) return join(dir, 'dataset.csv')
  if (!isAbsolute(override)) throw new Error('DABSTEP_DATASET_CSV must be an absolute path')
  return override
}

async function assertFile(path: string, label: string): Promise<void> {
  try {
    await access(path)
  } catch (err) {
    throw new Error(`DABStep: missing ${label} at ${path} (${err instanceof Error ? err.message : err})`)
  }
}

async function assertOfficialFiles(dir: string, split: string): Promise<void> {
  const dataset = datasetFile(dir)
  try {
    await access(dataset)
  } catch (err) {
    throw new Error(
      `DABStep: missing released dataset.csv at ${dataset} (${err instanceof Error ? err.message : err}). ${datasetAcquisitionHint}`,
    )
  }
  await assertFile(join(dir, 'splits', `${split}.txt`), `${split} split file`)
  await assertFile(gradeFile(dir), 'official grade.py')
  const files = resourceRoot(dir)
  try {
    const s = await stat(files)
    if (!s.isDirectory()) throw new Error('not a directory')
  } catch (err) {
    throw new Error(`DABStep: missing benchmark files directory at ${files} (${err instanceof Error ? err.message : err})`)
  }
}

export const dabstepAnswerOutput: OutputAdapter<string> = {
  parse(events) {
    let text = ''
    for (const ev of events) {
      const d = (ev as { data?: Record<string, unknown> })?.data
      const t = d?.finalText ?? d?.text ?? d?.result
      if (typeof t === 'string' && t.length > 0) text = t
    }
    const fences = [...text.matchAll(/```(?:text|answer)?\s*\n([\s\S]*?)```/g)]
    return (fences.at(-1)?.[1] ?? text).trim()
  },
}

function rowToTask(row: DabstepFixtureRow, split: string, dir?: string): BenchTask {
  const meta: DabstepMeta = {
    taskId: row.task_id,
    split,
    golds: row.all_golds_by_task,
    ...(dir ? { resourceRoot: resourceRoot(dir) } : {}),
  }
  return {
    id: String(row.task_id),
    split,
    prompt: [
      'Solve this DABStep data-analysis task using the mounted payment files.',
      'Use code or shell commands as needed, then return only the final answer.',
      '',
      row.instructions,
    ].join('\n'),
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): DabstepMeta {
  const md = task.metadata
  if (!md || typeof md.taskId !== 'number' || !Array.isArray(md.golds)) {
    throw new Error(`dabstep task ${task.id} missing metadata — loadTasks did not populate it`)
  }
  return md as unknown as DabstepMeta
}

function selectRows(rows: DabstepFixtureRow[], opts: LoadOptions, split: string, dir?: string): BenchTask[] {
  let tasks = rows.map((row) => rowToTask(row, split, dir))
  if (opts.ids) {
    const want = new Set(opts.ids)
    tasks = tasks.filter((task) => want.has(task.id))
  } else if (opts.limit !== undefined) {
    tasks = tasks.slice(0, opts.limit)
  }
  if (tasks.length === 0) throw new Error(`DABStep: no tasks matched ${JSON.stringify(opts)} for split=${split}`)
  return tasks
}

async function loadFixtures(opts: LoadOptions, split: string): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(FIXTURES, 'utf8')) as DabstepFixtureRow[]
  console.warn(`[dabstep] DABSTEP_FIXTURES=1 — loading ${rows.length} adapter fixtures from ${FIXTURES}`)
  return selectRows(rows, opts, split)
}

async function loadOfficialTasks(dir: string, opts: LoadOptions, split: string): Promise<BenchTask[]> {
  const script = `
import ast, csv, json, sys
from pathlib import Path

root = Path(sys.argv[1])
split = sys.argv[2]
limit = None if sys.argv[3] == "" else int(sys.argv[3])
ids = set(json.loads(sys.argv[4]))
dataset = Path(sys.argv[5])
split_file = root / "splits" / f"{split}.txt"
if not dataset.exists():
    raise SystemExit(f"missing official DABStep dataset.csv at {dataset}; the checkout does not ship it — see the adapter preflight error for acquisition")
if not split_file.exists():
    raise SystemExit(f"missing official DABStep split file at {split_file}")
split_ids = {int(line.strip()) for line in split_file.read_text().splitlines() if line.strip()}
out = []
with dataset.open(newline="") as f:
    for row in csv.DictReader(f):
        task_id = int(row["task_id"])
        if task_id not in split_ids:
            continue
        if ids and str(task_id) not in ids:
            continue
        out.append({
            "task_id": task_id,
            "instructions": f"{row['question']}\\n{row['guidelines']}",
            "all_golds_by_task": ast.literal_eval(str(row["all_golds_by_task"])),
        })
        if limit is not None and len(out) >= limit:
            break
if not out:
    raise SystemExit(f"no DABStep rows matched split={split} ids={sorted(ids)} limit={limit}")
print(json.dumps(out))
`
  const stdout = await runVenvPython(script, [
    dir,
    split,
    opts.limit === undefined ? '' : String(opts.limit),
    JSON.stringify(opts.ids ?? []),
    datasetFile(dir),
  ])
  return selectRows(JSON.parse(stdout) as DabstepFixtureRow[], opts, split, dir)
}

export function createDabstepAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.DABSTEP_FIXTURES === '1'

  return {
    name: 'dabstep',
    output: dabstepAnswerOutput,

    async preflight() {
      if (fixturesMode) return
      const dir = dabstepDir()
      if (!dir) {
        throw new Error(
          'DABSTEP_DIR is required. Fix: clone https://github.com/EnvCommons/DABStep and set DABSTEP_DIR=/path/to/DABStep. ' +
            datasetAcquisitionHint,
        )
      }
      await assertOfficialFiles(dir, DEFAULT_SPLIT)
      await loadOfficialTasks(dir, { limit: 1 }, DEFAULT_SPLIT)
    },

    async loadTasks(opts: LoadOptions = {}) {
      const split = opts.split ?? DEFAULT_SPLIT
      if (fixturesMode) return loadFixtures(opts, split)
      const dir = dabstepDir()
      if (!dir) throw new Error('DABSTEP_DIR is required to load official DABStep tasks')
      return loadOfficialTasks(dir, opts, split)
    },

    async goldArtifact(task: BenchTask) {
      const meta = readMeta(task)
      const first = meta.golds[0]
      if (!first) return undefined
      const value = first.value
      return value === undefined ? undefined : String(value)
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      const dir = dabstepDir()
      if (!dir) throw new Error('DABSTEP_DIR is required to judge DABStep tasks with the official grade.py')
      const stdout = await runVenvScriptStdin(
        join(benchRoot, 'scripts', 'dabstep_judge.py'),
        ['--grade-file', gradeFile(dir)],
        JSON.stringify({ prediction: artifact, golds: meta.golds }),
        { cwd: benchRoot },
      )
      const report = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as { correct?: boolean; score?: number; error?: string }
      if (report.error) throw new Error(`DABStep judge error for ${task.id}: ${report.error}`)
      const score = typeof report.score === 'number' ? report.score : 0
      return {
        resolved: report.correct === true,
        score,
        detail: JSON.stringify({ taskId: meta.taskId, split: meta.split, correct: report.correct }),
      }
    },
  }
}
