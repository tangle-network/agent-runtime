/**
 * WebArena-Verified adapter (ServiceNow/webarena-verified).
 *
 * Worker artifact = a WebArena-Verified run output directory, not final chat text.
 * Judge = the official `webarena_verified eval-tasks` evaluator over that output
 * directory. The adapter refuses to score a plain answer so we do not turn a DOM
 * benchmark into a fake text benchmark.
 */

import { access, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { OutputAdapter } from '@tangle-network/agent-runtime/loops'
import { benchRoot, runVenvPython } from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const FIXTURES = join(benchRoot, 'fixtures', 'webarena-verified.json')
const DATASET_REL = join('assets', 'dataset', 'webarena-verified.json')

interface WebArenaRow {
  task_id: number
  intent: string
  intent_template_id?: number
  sites?: string[]
  start_urls?: string[]
  eval?: unknown[]
  revision?: number
}

interface WebArenaMeta {
  taskId: number
  intentTemplateId?: number
  sites: string[]
  startUrls: string[]
  revision?: number
  eval?: unknown[]
}

const webarenaDir = (): string | undefined => process.env.WEBARENA_VERIFIED_DIR

export const webarenaOutputDirOutput: OutputAdapter<string> = {
  parse(events) {
    let text = ''
    for (const ev of events) {
      const d = (ev as { data?: Record<string, unknown> })?.data
      const t = d?.finalText ?? d?.text ?? d?.result
      if (typeof t === 'string' && t.length > 0) text = t
    }
    const fences = [...text.matchAll(/```(?:text|path)?\s*\n([\s\S]*?)```/g)]
    return (fences.at(-1)?.[1] ?? text).trim()
  },
}

async function assertFile(path: string, label: string): Promise<void> {
  try {
    await access(path)
  } catch (err) {
    throw new Error(`WebArena-Verified: missing ${label} at ${path} (${err instanceof Error ? err.message : err})`)
  }
}

async function assertDir(path: string, label: string): Promise<void> {
  try {
    const s = await stat(path)
    if (!s.isDirectory()) throw new Error('not a directory')
  } catch (err) {
    throw new Error(`WebArena-Verified: missing ${label} at ${path} (${err instanceof Error ? err.message : err})`)
  }
}

function rowToTask(row: WebArenaRow): BenchTask {
  const meta: WebArenaMeta = {
    taskId: row.task_id,
    intentTemplateId: row.intent_template_id,
    sites: row.sites ?? [],
    startUrls: row.start_urls ?? [],
    revision: row.revision,
    eval: row.eval,
  }
  return {
    id: String(row.task_id),
    prompt: [
      'Run this WebArena-Verified browser task in the official environment.',
      `Goal: ${row.intent}`,
      row.start_urls?.length ? `Start URL templates: ${row.start_urls.join(', ')}` : undefined,
      row.sites?.length ? `Sites: ${row.sites.join(', ')}` : undefined,
      '',
      'Return the path to the official WebArena-Verified run output directory for this task.',
      'The judge expects that directory to contain the task response and network trace files.',
    ]
      .filter(Boolean)
      .join('\n'),
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): WebArenaMeta {
  const md = task.metadata
  if (!md || typeof md.taskId !== 'number') {
    throw new Error(`webarena-verified task ${task.id} missing metadata — loadTasks did not populate it`)
  }
  return md as unknown as WebArenaMeta
}

function selectRows(rows: WebArenaRow[], opts: LoadOptions): BenchTask[] {
  let tasks = rows.map(rowToTask)
  if (opts.ids) {
    const want = new Set(opts.ids)
    tasks = tasks.filter((task) => want.has(task.id))
  } else if (opts.limit !== undefined) {
    tasks = tasks.slice(0, opts.limit)
  }
  if (tasks.length === 0) throw new Error(`WebArena-Verified: no tasks matched ${JSON.stringify(opts)}`)
  return tasks
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(FIXTURES, 'utf8')) as WebArenaRow[]
  console.warn(`[webarena-verified] WEBARENA_VERIFIED_FIXTURES=1 — loading ${rows.length} adapter fixtures`)
  return selectRows(rows, opts)
}

async function loadOfficialRows(dir: string, opts: LoadOptions): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(join(dir, DATASET_REL), 'utf8')) as WebArenaRow[]
  return selectRows(rows, opts)
}

async function runOfficialEval(root: string, taskId: number, outputDir: string): Promise<Record<string, unknown>> {
  const script = `
import json, os, subprocess, sys
from pathlib import Path

root = Path(sys.argv[1])
task_id = sys.argv[2]
output_dir = Path(sys.argv[3])
env = os.environ.copy()
env["PYTHONPATH"] = str(root / "src") + os.pathsep + env.get("PYTHONPATH", "")
cmd = [sys.executable, "-m", "webarena_verified", "eval-tasks", "--task-ids", task_id, "--output-dir", str(output_dir)]
proc = subprocess.run(cmd, cwd=root, env=env, text=True, capture_output=True)
if proc.returncode != 0:
    raise SystemExit((proc.stderr or proc.stdout or f"exit {proc.returncode}")[:2000])
result_path = output_dir / task_id / "eval_result.json"
if not result_path.exists():
    raise SystemExit(f"official evaluator did not write {result_path}")
print(json.dumps(json.loads(result_path.read_text())))
`
  const stdout = await runVenvPython(script, [root, String(taskId), outputDir], 0)
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>
}

export function createWebArenaVerifiedAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.WEBARENA_VERIFIED_FIXTURES === '1'

  return {
    name: 'webarena-verified',
    output: webarenaOutputDirOutput,

    async preflight() {
      if (fixturesMode) return
      const dir = webarenaDir()
      if (!dir) {
        throw new Error(
          'WEBARENA_VERIFIED_DIR is required. Fix: clone https://github.com/ServiceNow/webarena-verified, install its deps in bench/.venv, and set WEBARENA_VERIFIED_DIR=/path/to/webarena-verified.',
        )
      }
      await assertFile(join(dir, DATASET_REL), 'official dataset')
      await assertFile(join(dir, 'src', 'webarena_verified', '__main__.py'), 'official CLI module')
      await runVenvPython(
        'import sys; sys.path.insert(0, sys.argv[1]); import webarena_verified; print("ok")',
        [join(dir, 'src')],
      )
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      const dir = webarenaDir()
      if (!dir) throw new Error('WEBARENA_VERIFIED_DIR is required to load official WebArena-Verified tasks')
      return loadOfficialRows(dir, opts)
    },

    async goldArtifact() {
      return undefined
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const dir = webarenaDir()
      if (!dir) throw new Error('WEBARENA_VERIFIED_DIR is required to judge WebArena-Verified artifacts')
      const outputDir = resolve(artifact.trim())
      await assertDir(outputDir, 'run output directory')
      const meta = readMeta(task)
      const report = await runOfficialEval(dir, meta.taskId, outputDir)
      const score = typeof report.score === 'number' ? report.score : 0
      const status = typeof report.status === 'string' ? report.status : 'unknown'
      return {
        resolved: score === 1,
        score,
        detail: JSON.stringify({ taskId: meta.taskId, status, outputDir }),
      }
    },
  }
}
