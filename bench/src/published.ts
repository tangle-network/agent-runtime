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
 *   app:<agent app>@<harness/model>
 *                              the AgentProfile the app serves in production (prompt, skills, subagents, resources), run by
 *                              that subscription harness through the same CLI Bridge at `/profiles/<id>/v1` (cli-bridge#408).
 *                              The app's production model and its own MCP servers are not part of it; the run record names both.
 *
 * Every run says what it measured: `model-shaped` (the target as a model calling the benchmark's tools, which the
 * benchmark executes) or `own-loop` (the agent with its own loop and tools). The two are never compared as one.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
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
  /** For an app target: which served profile ran, and what of the app it leaves out. */
  app?: AppProfile
}

/** An agent app's served AgentProfile as an app target runs it. */
export interface AppProfile {
  app: string
  profileUrl: string
  profileName: string | null
  profileVersion: string | null
  /** sha256 of the profile as run (served profile without `model` and `mcp`). */
  profileDigest: string
  /** The model the app runs in production, replaced by the target's harness model. */
  productionModel: unknown
  /** The app's own MCP servers, which need the app's deployment and are not mounted. */
  omittedMcp: string[]
}

/**
 * Agent apps a benchmark can target, each by the AgentProfile it serves in production. `AGENT_BENCH_APPS`, a JSON object
 * of app name to profile URL, adds an app or points one at another deployment, such as staging.
 */
export const AGENT_APPS: Readonly<Record<string, { profileUrl: string }>> = {
  'gtm-agent': { profileUrl: 'https://gtm.tangle.tools/api/tools/profile?definition' },
}

function agentApps(env: NodeJS.ProcessEnv): Record<string, { profileUrl: string }> {
  if (!env.AGENT_BENCH_APPS) return { ...AGENT_APPS }
  const extra = JSON.parse(env.AGENT_BENCH_APPS) as unknown
  if (!extra || typeof extra !== 'object' || Array.isArray(extra) || !Object.values(extra).every((url) => typeof url === 'string')) {
    throw new Error('AGENT_BENCH_APPS must be a JSON object of app name to profile URL')
  }
  return { ...AGENT_APPS, ...Object.fromEntries(Object.entries(extra as Record<string, string>).map(([name, profileUrl]) => [name, { profileUrl }])) }
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
  app?: AppProfile
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
export async function resolveEndpoint(target: string, benchmark: PublishedBenchmark, env: NodeJS.ProcessEnv = process.env): Promise<Endpoint> {
  const match = /^(model|app|profile):(.+)$/.exec(target)
  if (!match) throw new Error(`target must be model:<router model>, app:<agent app>@<harness/model> or profile:<harness/model>, not '${target}'`)
  const [, kind, id] = match as unknown as [string, 'model' | 'app' | 'profile', string]
  if (kind === 'model') {
    return { target, model: id, baseUrl: env.AGENT_BENCH_ROUTER_URL ?? 'https://router.tangle.tools/v1', apiKeyVar: 'TANGLE_API_KEY', measured: benchmark.measured }
  }
  // A loopback Bridge without a bearer accepts any key; the runner still needs one to send.
  const bridge = env.AGENT_BENCH_BRIDGE_URL ?? 'http://127.0.0.1:3344/v1'
  if (kind === 'profile') return { target, model: id, baseUrl: bridge, apiKeyVar: 'AGENT_BENCH_BRIDGE_KEY', measured: 'own-loop' }
  const at = id.indexOf('@')
  const [name, harness] = at === -1 ? [id, ''] : [id.slice(0, at), id.slice(at + 1)]
  const apps = agentApps(env)
  const app = apps[name]
  if (!app) throw new Error(`no agent app '${name}'; registered: ${Object.keys(apps).join(', ')} (add one with AGENT_BENCH_APPS)`)
  if (!harness) throw new Error(`app:${name} needs @<harness/model>, the subscription harness that runs the app's profile, e.g. app:${name}@opencode/zai-coding-plan/glm-5.3`)
  const catalog = env.AGENT_BENCH_BRIDGE_PROFILES_DIR
  if (!catalog) throw new Error(`AGENT_BENCH_BRIDGE_PROFILES_DIR is not set: point it at the CLI Bridge's SANDBOX_PROFILES_DIR, where app:${name} writes its profile`)
  const response = await fetch(app.profileUrl)
  if (!response.ok) throw new Error(`${app.profileUrl} answered ${response.status}; app:${name} needs the profile the app serves`)
  const { mcp, model, ...profile } = await response.json() as Record<string, unknown>
  const text = JSON.stringify(profile)
  const digest = createHash('sha256').update(text).digest('hex')
  // Content-addressed: the Bridge rereads its catalog only for an id it does not know.
  const profileId = `${name}-${digest.slice(0, 12)}`
  await mkdir(catalog, { recursive: true })
  await writeFile(path.join(catalog, `${profileId}.json`), text)
  return {
    target, model: harness, baseUrl: `${bridge.replace(/\/v1\/?$/, '')}/profiles/${profileId}/v1`, apiKeyVar: 'AGENT_BENCH_BRIDGE_KEY', measured: 'own-loop',
    app: {
      app: name, profileUrl: app.profileUrl, profileDigest: `sha256:${digest}`, productionModel: model ?? null,
      profileName: typeof profile.name === 'string' ? profile.name : null, profileVersion: typeof profile.version === 'string' ? profile.version : null,
      omittedMcp: mcp && typeof mcp === 'object' ? Object.keys(mcp) : [],
    },
  }
}

/** Run one published benchmark against one target with the publisher's runner and grader, and record the result. */
export async function runPublished(name: string, target: string, options: PublishedRunOptions): Promise<PublishedRun> {
  const benchmark = PUBLISHED_BENCHMARKS[name]
  if (!benchmark) throw new Error(`no published benchmark '${name}'; registered: ${Object.keys(PUBLISHED_BENCHMARKS).join(', ')}`)
  const env = { ...process.env, ...options.env }
  const endpoint = await resolveEndpoint(target, benchmark, env)
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
    measured: endpoint.measured, judge: benchmark.judge, official: true, ...(endpoint.app ? { app: endpoint.app } : {}),
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
