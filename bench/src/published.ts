/**
 * Published benchmarks, run by their publishers' own runners, unmodified, at a pinned commit.
 *
 * One registry entry per benchmark: the publisher's repository and commit, its install and run commands, a parser from the
 * publisher's result file to `BenchScore`, the license, the data terms, and the judge the publisher names. Nothing here loads
 * tasks, drives an agent loop, or grades: the publisher's runner does all three. A target becomes the OpenAI-compatible
 * endpoint that runner calls:
 *
 *   model:<router model>       the Tangle Router with `TANGLE_API_KEY`; the target is a model driving the benchmark's tools.
 *   profile:<harness/model>    a CLI Bridge (`AGENT_BENCH_BRIDGE_URL`, default http://127.0.0.1:3344/v1) running that harness with
 *                              its own loop and tools; the benchmark's tools reach it as caller-executed MCP tools (cli-bridge#397).
 *   app:<agent app>            refused until the agent gateway and the sandbox sidecar forward the caller's tools.
 *
 * Every run says what it measured: `model-shaped` (the target as a model calling the benchmark's tools, which the
 * benchmark executes) or `own-loop` (the agent with its own loop and tools). The two are never compared as one.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BenchScore } from './benchmarks/types'

export type Measured = 'model-shaped' | 'own-loop'

/** The OpenAI-compatible endpoint a publisher's runner calls for one target. */
export interface Endpoint {
  target: string
  baseUrl: string
  model: string
  /** The environment variable that holds the endpoint's key; the runner reads it, nothing here prints it. */
  apiKeyVar: string
  /** What a run through this endpoint measures. */
  measured: Measured
}

export interface PublishedRunOptions {
  /** Run this many tasks in the publisher's order (a sample, never a full official run unless asked). */
  tasks?: number
  /** Run exactly these publisher task ids. */
  taskIds?: string[]
  /** Extra arguments passed to the publisher's runner unchanged, after the ones this registry sets. */
  args?: string[]
  /** Where the publisher's result file and this run's record are written. */
  out: string
  env?: NodeJS.ProcessEnv
  /** Where publisher checkouts are cached; defaults to ~/.cache/agent-bench/published. */
  cacheDir?: string
}

export type PublishedTaskScore = BenchScore & { id: string }

export interface PublishedBenchmark {
  name: string
  repository: string
  /** The exact publisher commit; a moved tag cannot change a recorded number. */
  ref: string
  version: string
  license: string
  terms: string
  /** The judge model the publisher names, or null when the publisher's grader is deterministic. */
  judge: string | null
  measured: Measured
  /** The runner writes a folder of results rather than one file. */
  resultIsFolder?: boolean
  install: string[][]
  run(endpoint: Endpoint, options: PublishedRunOptions, resultPath: string): string[]
  /** Read the publisher's result (a file or a folder) into one score per task, as the publisher's grader reported it. */
  parse(resultPath: string): Promise<PublishedTaskScore[]>
}

export interface PublishedRun {
  benchmark: string
  version: string
  ref: string
  target: string
  model: string
  measured: Measured
  judge: string | null
  /** True when the score comes from the publisher's own grader and judge; false whenever a judge was substituted. */
  official: boolean
  tasks: number
  passed: number
  /** Mean task score, 0..1, as the publisher's grader reports it. */
  score: number
  taskScores: PublishedTaskScore[]
  resultPath: string
  license: string
  terms: string
  startedAt: string
  finishedAt: string
}

export const PUBLISHED_BENCHMARKS: Readonly<Record<string, PublishedBenchmark>> = {
  automationbench: {
    name: 'automationbench',
    repository: 'https://github.com/zapier/AutomationBench.git',
    ref: '4a8e1061254004d9dac807054eed33fad7d1ff14',
    version: '1.0.6',
    license: 'MIT (Zapier, Inc.); third-party API schemas excluded',
    terms: 'MIT: tasks and code may be redistributed with attribution',
    judge: null,
    measured: 'model-shaped',
    install: [['uv', 'sync', '--frozen']],
    run: (endpoint, options, resultPath) => [
      'uv', 'run', 'auto-bench',
      '--model', endpoint.model, '--base-url', endpoint.baseUrl, '--api-key-var', endpoint.apiKeyVar,
      ...(options.taskIds?.length ? ['--tasks', options.taskIds.join(',')] : []),
      ...(options.tasks === undefined ? [] : ['--num-examples', String(options.tasks)]),
      '--max-concurrent', String(Math.max(1, Math.min(options.tasks ?? options.taskIds?.length ?? 4, 4))),
      '--export-json', resultPath,
      ...(options.args ?? []),
    ],
    parse: async (resultPath) => {
      const tasks = (JSON.parse(await readFile(resultPath, 'utf8')) as { tasks?: Array<{ name?: unknown; score?: unknown; passed?: unknown }> }).tasks
      if (!Array.isArray(tasks)) throw new Error('AutomationBench result has no tasks array')
      return tasks.map((task) => {
        if (typeof task.name !== 'string' || typeof task.score !== 'number' || typeof task.passed !== 'boolean') {
          throw new Error(`AutomationBench task result is malformed: ${JSON.stringify(task).slice(0, 200)}`)
        }
        return { id: task.name, resolved: task.passed, score: task.score }
      })
    },
  },
  'enterpriseops-gym': {
    name: 'enterpriseops-gym',
    repository: 'https://github.com/ServiceNow/EnterpriseOps-Gym.git',
    ref: '271f2c357f763376997dfd16807fcde2474ae41b',
    version: '271f2c3 (no release tag)',
    license: 'Apache-2.0 (ServiceNow; code and the ServiceNow-AI/EnterpriseOps-Gym dataset)',
    terms: 'Apache-2.0: tasks may be redistributed with attribution',
    judge: null,
    measured: 'model-shaped',
    resultIsFolder: true,
    install: [['uv', 'sync', '--extra', 'openai'], ['python3', '-c', "import zipfile; zipfile.ZipFile('gym_dbs.zip').extractall('.')"]],
    // A sample runs `--task` ids or the first --tasks of the domain (default teams, mode oracle; pass `-- --domain d --mode m`).
    run: (endpoint, options, resultPath) => [
      'sh', fileURLToPath(new URL('../scripts/enterpriseops-gym-run.sh', import.meta.url)),
      resultPath, endpoint.baseUrl, endpoint.model, endpoint.apiKeyVar,
      options.tasks === undefined ? 'all' : String(options.tasks), (options.taskIds ?? []).join(','),
      ...(options.args ?? []),
    ],
    parse: async (resultPath) => {
      const folder = path.join(resultPath, 'run_1')
      const files = (await readdir(folder)).filter((file) => file.startsWith('results_') && file.endsWith('.json')).sort()
      if (!files.length) throw new Error(`EnterpriseOps-Gym wrote no task results under ${folder}`)
      return Promise.all(files.map(async (file) => {
        const result = JSON.parse(await readFile(path.join(folder, file), 'utf8')) as {
          statistics?: { overall_success_rate?: unknown; verifier_level_pass_rate?: unknown }; runs?: Array<{ error?: unknown }>
        }
        const success = result.statistics?.overall_success_rate
        const verifiers = result.statistics?.verifier_level_pass_rate
        if (typeof success !== 'number') throw new Error(`EnterpriseOps-Gym result ${file} has no statistics.overall_success_rate`)
        const error = result.runs?.find((run) => run.error)?.error
        return {
          id: file.slice('results_'.length, -'.json'.length).split('__').pop()!, resolved: success === 1, score: success,
          detail: `verifier pass rate ${typeof verifiers === 'number' ? verifiers : 'unknown'}${error ? `; runner error: ${String(error).slice(0, 200)}` : ''}`,
        }
      }))
    },
  },
}

/** Resolve a `model:`, `app:` or `profile:` target to the endpoint a publisher's runner calls. */
export function resolveEndpoint(target: string, benchmark: PublishedBenchmark, env: NodeJS.ProcessEnv = process.env): Endpoint {
  const match = /^(model|app|profile):(.+)$/.exec(target)
  if (!match) throw new Error(`target must be model:<router model>, app:<agent app> or profile:<agent profile>, not '${target}'`)
  const [, kind, id] = match as unknown as [string, 'model' | 'app' | 'profile', string]
  if (kind === 'model') {
    return { target, model: id, baseUrl: env.AGENT_BENCH_ROUTER_URL ?? 'https://router.tangle.tools/v1', apiKeyVar: 'TANGLE_API_KEY', measured: benchmark.measured }
  }
  if (kind === 'profile') {
    // A loopback Bridge without a bearer accepts any key; the runner still needs one to send.
    return { target, model: id, baseUrl: env.AGENT_BENCH_BRIDGE_URL ?? 'http://127.0.0.1:3344/v1', apiKeyVar: 'AGENT_BENCH_BRIDGE_KEY', measured: 'own-loop' }
  }
  throw new Error(`${benchmark.name} executes its own tools from the target's tool calls, and an app target cannot return them yet: @tangle-network/agent-gateway (src/chat-input.ts) and the agent-container sidecar (apps/sidecar/src/routes/agent-invoke-chat.ts) do not forward the caller's tools. Use profile:<harness/model> to measure the same harness through a CLI Bridge.`)
}

/** Run one published benchmark against one target with the publisher's runner and grader, and record the result. */
export async function runPublished(name: string, target: string, options: PublishedRunOptions): Promise<PublishedRun> {
  const benchmark = PUBLISHED_BENCHMARKS[name]
  if (!benchmark) throw new Error(`no published benchmark '${name}'; registered: ${Object.keys(PUBLISHED_BENCHMARKS).join(', ')}`)
  const env = { ...process.env, ...options.env }
  const endpoint = resolveEndpoint(target, benchmark, env)
  if (!env[endpoint.apiKeyVar]) throw new Error(`${endpoint.apiKeyVar} is not set; the ${target} endpoint needs it`)
  const checkout = await publisherCheckout(benchmark, options.cacheDir, env)
  await mkdir(options.out, { recursive: true })
  const resultPath = path.resolve(options.out, `${benchmark.name}-result${benchmark.resultIsFolder ? '' : '.json'}`)
  const startedAt = new Date().toISOString()
  const [command, ...args] = benchmark.run(endpoint, options, resultPath)
  await execute(command!, args, checkout, env)
  const taskScores = await benchmark.parse(resultPath)
  const run: PublishedRun = {
    benchmark: benchmark.name, version: benchmark.version, ref: benchmark.ref, target, model: endpoint.model,
    measured: endpoint.measured, judge: benchmark.judge, official: true,
    tasks: taskScores.length, passed: taskScores.filter((task) => task.resolved).length,
    score: taskScores.length ? taskScores.reduce((sum, task) => sum + task.score, 0) / taskScores.length : 0,
    taskScores, resultPath, license: benchmark.license, terms: benchmark.terms, startedAt, finishedAt: new Date().toISOString(),
  }
  await writeFile(path.resolve(options.out, `${benchmark.name}-run.json`), `${JSON.stringify(run, null, 2)}\n`)
  return run
}

/** The publisher's repository at the pinned commit, installed once per cache. */
async function publisherCheckout(benchmark: PublishedBenchmark, cacheDir: string | undefined, env: NodeJS.ProcessEnv): Promise<string> {
  const root = cacheDir ?? path.join(homedir(), '.cache', 'agent-bench', 'published')
  const dir = path.join(root, `${benchmark.name}@${benchmark.ref}`)
  const installed = path.join(dir, '.agent-bench-installed')
  if (existsSync(installed)) return dir
  if (!existsSync(path.join(dir, '.git'))) {
    await mkdir(root, { recursive: true })
    await execute('git', ['clone', '--quiet', '--filter=blob:none', '--no-checkout', benchmark.repository, dir], root, env)
  }
  await execute('git', ['checkout', '--quiet', '--detach', benchmark.ref], dir, env)
  for (const [command, ...args] of benchmark.install) await execute(command!, args, dir, env)
  await writeFile(installed, `${benchmark.ref}\n`)
  return dir
}

function execute(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    child.once('error', (error) => reject(new Error(`${command} could not start in ${cwd}: ${error.message}`)))
    child.once('exit', (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`${command} ${args.slice(0, 3).join(' ')} exited ${signal ?? code} in ${cwd}`)))
  })
}
