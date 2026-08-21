/**
 * Shared tau-bench adapter spine.
 *
 * tau2 and tau3 live in the same upstream repository/package namespace today:
 * `sierra-research/tau2-bench`, Python package `tau2`. Keep one implementation
 * for task loading and reward recomputation so the domain/version adapters only
 * choose env names, default domain, and fixture file.
 */

import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { OutputAdapter } from '@tangle-network/agent-runtime/kernel'
import { runVenvPython } from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const execFileAsync = promisify(execFile)

export interface TauBenchConfig {
  name: string
  fixturePath: string
  fixturesEnv: string
  dirEnv: string
  domainEnv: string
  defaultDomain: string
  installHint: string
  taskIntro: string
}

interface TauRow {
  id: string
  domain: string
  user_scenario?: unknown
  description?: unknown
  evaluation_criteria?: unknown
}

interface TauMeta {
  taskId: string
  domain: string
  split?: string
  userScenario?: unknown
  description?: unknown
  evaluationCriteria?: unknown
  /** Git commit of the upstream checkout the task was loaded from. Official loads always carry it; fixtures never do. */
  upstreamCommit?: string
  /** Installed `tau2` distribution version in the interpreter that loaded the task. */
  upstreamVersion?: string
}

/** The exact upstream identity a tau task or score is bound to. */
export interface TauUpstreamPin {
  upstreamCommit: string
  upstreamVersion: string
}

/**
 * Resolve the upstream checkout's git identity. Throws when the directory is
 * not a git checkout or holds uncommitted changes, because a commit over dirty
 * state does not identify the code that produced the tasks or the score.
 */
async function resolveUpstreamCommit(root: string, benchName: string): Promise<string> {
  let head: string
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'rev-parse', 'HEAD'])
    head = stdout.trim()
  } catch (err) {
    throw new Error(
      `${benchName}: cannot resolve the upstream commit of ${root} (${err instanceof Error ? err.message : err}). ` +
        'The bench dir must be a git checkout of https://github.com/sierra-research/tau2-bench.',
    )
  }
  const { stdout: status } = await execFileAsync('git', ['-C', root, 'status', '--porcelain'])
  if (status.trim().length > 0) {
    const dirty = status.trim().split('\n').slice(0, 5).join(', ')
    throw new Error(
      `${benchName}: upstream checkout ${root} has uncommitted changes (${dirty}). ` +
        'Commit or stash them so the pinned commit identifies the benchmark code.',
    )
  }
  return head
}

/**
 * Refuse to score a task against a checkout that moved after the task was
 * loaded: the reward recomputation would run under a different upstream
 * identity than the one stamped on the task.
 */
export function assertTauUpstreamPinUnchanged(
  benchName: string,
  taskId: string,
  recorded: Readonly<{ upstreamCommit?: string; upstreamVersion?: string }>,
  live: TauUpstreamPin,
): void {
  if (recorded.upstreamCommit !== undefined && recorded.upstreamCommit !== live.upstreamCommit) {
    throw new Error(
      `${benchName} task ${taskId} was loaded from upstream commit ${recorded.upstreamCommit} ` +
        `but the checkout is now at ${live.upstreamCommit}; reload tasks before judging.`,
    )
  }
  if (recorded.upstreamVersion !== undefined && recorded.upstreamVersion !== live.upstreamVersion) {
    throw new Error(
      `${benchName} task ${taskId} was loaded with tau2 ${recorded.upstreamVersion} ` +
        `but the interpreter now holds tau2 ${live.upstreamVersion}; reload tasks before judging.`,
    )
  }
}

const upstreamVersionSnippet = `
import sys
sys.dont_write_bytecode = True
import importlib.metadata
try:
    upstream_version = importlib.metadata.version("tau2")
except importlib.metadata.PackageNotFoundError:
    raise SystemExit(
        "installed tau2 distribution not found in this interpreter; "
        "run 'uv sync' inside the tau2-bench checkout and set "
        "AGENT_BENCH_PYTHON to <checkout>/.venv/bin/python3"
    )
`

export const tauResultsOutput: OutputAdapter<string> = {
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

async function assertPath(path: string, label: string, benchName: string): Promise<void> {
  try {
    await stat(path)
  } catch (err) {
    throw new Error(`${benchName}: missing ${label} at ${path} (${err instanceof Error ? err.message : err})`)
  }
}

function benchDir(config: TauBenchConfig): string | undefined {
  return process.env[config.dirEnv]
}

function benchDomain(config: TauBenchConfig): string {
  return process.env[config.domainEnv] ?? config.defaultDomain
}

function rowToTask(row: TauRow, config: TauBenchConfig, split?: string, pin?: TauUpstreamPin): BenchTask {
  const meta: TauMeta = {
    taskId: row.id,
    domain: row.domain,
    split,
    userScenario: row.user_scenario,
    description: row.description,
    evaluationCriteria: row.evaluation_criteria,
    ...(pin ?? {}),
  }
  return {
    id: row.id,
    split,
    prompt: [
      config.taskIntro,
      `Run this task in the official ${row.domain} domain.`,
      'The benchmark is a simulated multi-turn user/tool conversation.',
      '',
      typeof row.user_scenario === 'string' ? row.user_scenario : JSON.stringify(row.user_scenario ?? {}, null, 2),
      '',
      'Return the path to the official tau results.json or trajectory file containing this task run.',
    ].join('\n'),
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask, benchName: string): TauMeta {
  const md = task.metadata
  if (!md || typeof md.taskId !== 'string' || typeof md.domain !== 'string') {
    throw new Error(`${benchName} task ${task.id} missing metadata — loadTasks did not populate it`)
  }
  return md as unknown as TauMeta
}

function selectRows(rows: TauRow[], opts: LoadOptions, config: TauBenchConfig, split?: string, pin?: TauUpstreamPin): BenchTask[] {
  let tasks = rows.map((row) => rowToTask(row, config, split, pin))
  if (opts.ids) {
    const want = new Set(opts.ids)
    tasks = tasks.filter((task) => want.has(task.id))
  } else if (opts.limit !== undefined) {
    tasks = tasks.slice(0, opts.limit)
  }
  if (tasks.length === 0) throw new Error(`${config.name}: no tasks matched ${JSON.stringify(opts)}`)
  return tasks
}

async function loadFixtures(config: TauBenchConfig, opts: LoadOptions): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(config.fixturePath, 'utf8')) as TauRow[]
  console.warn(`[${config.name}] ${config.fixturesEnv}=1 — loading ${rows.length} adapter fixtures`)
  return selectRows(rows, opts, config, opts.split)
}

async function loadOfficialTasks(config: TauBenchConfig, root: string, opts: LoadOptions): Promise<BenchTask[]> {
  const domain = benchDomain(config)
  const script = `
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
domain = sys.argv[2]
split = sys.argv[3] or None
sys.path.insert(0, str(root / "src"))
${upstreamVersionSnippet}
from tau2.registry import registry
loader = registry.get_tasks_loader(domain)
tasks = loader(split)
rows = []
for task in tasks:
    row = task.model_dump(mode="json")
    row["domain"] = domain
    rows.append(row)
print(json.dumps({"upstreamVersion": upstream_version, "rows": rows}))
`
  const upstreamCommit = await resolveUpstreamCommit(root, config.name)
  const stdout = await runVenvPython(script, [root, domain, opts.split ?? ''])
  const report = JSON.parse(stdout) as { upstreamVersion?: unknown; rows?: unknown }
  if (typeof report.upstreamVersion !== 'string' || report.upstreamVersion.length === 0 || !Array.isArray(report.rows)) {
    throw new Error(`${config.name}: upstream task loader returned no pinned version/rows`)
  }
  const pin: TauUpstreamPin = { upstreamCommit, upstreamVersion: report.upstreamVersion }
  return selectRows(report.rows as TauRow[], opts, config, opts.split, pin)
}

async function scoreOfficialTrajectory(root: string, meta: TauMeta, artifactPath: string): Promise<Record<string, unknown>> {
  const script = `
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
task_id = sys.argv[2]
artifact = Path(sys.argv[3])
sys.path.insert(0, str(root / "src"))
${upstreamVersionSnippet}
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
print(json.dumps({"count": len(scores), "score": sum(scores) / len(scores), "scores": scores, "upstreamVersion": upstream_version}))
`
  const stdout = await runVenvPython(script, [root, meta.taskId, artifactPath], 0)
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>
}

export function createTauBenchAdapter(config: TauBenchConfig): BenchmarkAdapter {
  const fixturesMode = process.env[config.fixturesEnv] === '1'

  return {
    name: config.name,
    output: tauResultsOutput,

    async preflight() {
      if (fixturesMode) return
      const dir = benchDir(config)
      if (!dir) {
        throw new Error(`${config.dirEnv} is required. Fix: ${config.installHint}`)
      }
      await assertPath(`${dir}/src/tau2/registry.py`, 'tau registry', config.name)
      await loadOfficialTasks(config, dir, { limit: 1 })
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(config, opts)
      const dir = benchDir(config)
      if (!dir) throw new Error(`${config.dirEnv} is required to load official ${config.name} tasks`)
      return loadOfficialTasks(config, dir, opts)
    },

    async goldArtifact() {
      return undefined
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const dir = benchDir(config)
      if (!dir) throw new Error(`${config.dirEnv} is required to judge ${config.name} trajectory artifacts`)
      const meta = readMeta(task, config.name)
      const artifactPath = resolve(artifact.trim())
      await assertPath(artifactPath, 'tau results/trajectory artifact', config.name)
      const upstreamCommit = await resolveUpstreamCommit(dir, config.name)
      const report = await scoreOfficialTrajectory(dir, meta, artifactPath)
      const upstreamVersion = report.upstreamVersion
      if (typeof upstreamVersion !== 'string' || upstreamVersion.length === 0) {
        throw new Error(`${config.name}: reward recomputation returned no pinned tau2 version`)
      }
      const live: TauUpstreamPin = { upstreamCommit, upstreamVersion }
      assertTauUpstreamPinUnchanged(config.name, meta.taskId, meta, live)
      const score = typeof report.score === 'number' ? report.score : 0
      return {
        resolved: score === 1,
        score,
        detail: JSON.stringify({
          taskId: meta.taskId,
          domain: meta.domain,
          count: report.count,
          upstreamCommit,
          upstreamVersion,
        }),
      }
    },
  }
}
