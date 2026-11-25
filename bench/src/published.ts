/**
 * Published benchmarks, run by their publishers' own runners, unmodified, at a pinned commit.
 *
 * One registry entry per benchmark: the publisher's repository and commit, its install and run commands, a parser from the
 * publisher's result file to per-task scores (agent-eval's verdict names: `passed`, `score`, `notes`), the license, the data terms, and the judge the publisher names. Nothing here loads
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
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, RunRecordValidationError, UNKNOWN_MODEL, validateRunRecord, type RunRecord } from '@tangle-network/agent-eval'

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
 * Agent apps a benchmark can target, each by the executable AgentProfile it serves in production: the projection its own
 * sandbox sends a harness (gtm-agent toExecutableAgentProfile, legal-agent slimSandboxProfile). `AGENT_BENCH_APPS`, a JSON
 * object of app name to profile URL or absolute file path, adds an app or points one at another source: a staging deployment,
 * a profile exported from a checkout, or a candidate profile an optimizer is scoring.
 */
export const AGENT_APPS: Readonly<Record<string, { profileUrl: string }>> = {
  'gtm-agent': { profileUrl: 'https://gtm.tangle.tools/api/tools/profile?definition=executable' },
  'legal-agent': { profileUrl: 'https://legal.tangle.tools/api/tools/profile?definition=executable' },
}

function agentApps(env: NodeJS.ProcessEnv): Record<string, { profileUrl: string }> {
  if (!env.AGENT_BENCH_APPS) return { ...AGENT_APPS }
  const extra = JSON.parse(env.AGENT_BENCH_APPS) as unknown
  if (!extra || typeof extra !== 'object' || Array.isArray(extra) || !Object.values(extra).every((url) => typeof url === 'string')) {
    throw new Error('AGENT_BENCH_APPS must be a JSON object of app name to profile URL or absolute file path')
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
  /**
   * Replace the publisher's judge with `bridge/<harness/model>`, a model on a subscription seat behind a CLI Bridge
   * (AGENT_BENCH_JUDGE_URL, default the profile Bridge). The run is then not official, and its record says so.
   */
  judge?: string
  /** The agent-eval RunRecord identity each task row carries; defaults: experiment `<benchmark>@<ref>`, candidate the target, split holdout. */
  record?: { experimentId?: string; candidateId?: string; splitTag?: 'search' | 'dev' | 'holdout' }
}

/** One task's score; `raw` carries the publisher's numeric per-task detail (Harvey LAB: `crit.<id>` 1|0, criteria counts). */
export interface PublishedTaskScore {
  id: string
  passed: boolean
  score: number
  notes?: string
  raw?: Record<string, number>
}

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
  /** The benchmark's runner accepts a substituted judge (`--judge`). */
  judgeSubstitutable?: boolean
  /** Why no run of this entry is official, when the publisher reports from an implementation it does not release. */
  unofficial?: string
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
  /** The judge the publisher names, kept beside a substituted one. */
  publisherJudge: string | null
  /** True when the score comes from the publisher's own grader and judge; false whenever a judge was substituted. */
  official: boolean
  /** Why the entry is never official (`PublishedBenchmark.unofficial`). */
  unofficial?: string
  app?: AppProfile
  tasks: number
  passed: number
  /** Mean task score, 0..1, as the publisher's grader reports it. */
  score: number
  taskScores: PublishedTaskScore[]
  resultPath: string
  /** One agent-eval RunRecord per task (JSON lines), for the ledgers, dashboards and promotion gates every other run feeds. */
  runRecords: string
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
        return { id: task.name, passed: task.passed, score: task.score }
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
          id: file.slice('results_'.length, -'.json'.length).split('__').pop()!, passed: success === 1, score: success,
          notes: `verifier pass rate ${typeof verifiers === 'number' ? verifiers : 'unknown'}${error ? `; runner error: ${String(error).slice(0, 200)}` : ''}`,
        }
      }))
    },
  },
  'harvey-lab': {
    name: 'harvey-lab',
    repository: 'https://github.com/harveyai/harvey-labs.git',
    // v1.3.0, the latest tag: v1.0 has no OpenAI-compatible chat adapter; v1.3.0 ships baseten/ (chat completions with tools).
    ref: '81d6a31b22d7c9f661cda4770cffcc12a5735dc2',
    version: 'v1.3.0',
    license: 'MIT (Harvey AI)',
    terms: 'MIT: tasks and their synthetic documents ship in the repository; no training or redistribution restriction stated',
    judge: 'claude-sonnet-4-6 + gpt-5.5 (LAB standard dual judge, all-pass per criterion)',
    judgeSubstitutable: true,
    measured: 'model-shaped',
    resultIsFolder: true,
    install: [
      ['uv', 'sync', '--all-extras'],
      // The publisher's own pinned pandoc, which its grader needs for .docx deliverables, into the checkout.
      ['sh', 'lab_core/sandbox/install_pandoc.sh', '.agent-bench'],
      ['sh', fileURLToPath(new URL('../scripts/harvey-lab-sandbox.sh', import.meta.url))],
    ],
    // A sample runs --task ids or the first --tasks in sorted task-id order (pass `-- --area <practice area>` to stay in one).
    run: (endpoint, options, resultPath) => [
      'sh', fileURLToPath(new URL('../scripts/harvey-lab-run.sh', import.meta.url)),
      resultPath, endpoint.baseUrl, endpoint.model, endpoint.apiKeyVar,
      options.tasks === undefined ? 'all' : String(options.tasks), (options.taskIds ?? []).join(','), options.judge ?? 'publisher',
      ...(options.args ?? []),
    ],
    parse: async (resultPath) => {
      const runs = (await readFile(path.join(resultPath, 'tasks.tsv'), 'utf8')).trim().split('\n').map((line) => line.split('\t') as [string, string])
      return Promise.all(runs.map(async ([run, task]) => {
        const read = (file: string) => readFile(path.join(resultPath, run, file), 'utf8').then((text) => JSON.parse(text) as Record<string, unknown>, () => null)
        const dual = await read('scores_dual.json')
        if (dual) return { id: task, passed: dual.all_pass === true, score: Number(dual.dual_all_pass_rate), notes: `dual-judge criterion pass ${String(dual.dual_criterion_pass)}` }
        const single = await read('scores.json')
        if (single) {
          const criteria = Array.isArray(single.criteria_results) ? single.criteria_results as Array<{ id?: unknown; verdict?: unknown }> : []
          return { id: task, passed: single.all_pass === true, score: single.all_pass === true ? 1 : 0,
            notes: `${String(single.n_passed)} of ${String(single.n_criteria)} criteria passed${single.n_grading_errors ? `; ${String(single.n_grading_errors)} grading errors` : ''}`,
            raw: { criteria_passed: Number(single.n_passed) || 0, criteria_total: Number(single.n_criteria) || 0,
              ...Object.fromEntries(criteria.filter((c) => typeof c.id === 'string').map((c) => [`crit.${String(c.id)}`, c.verdict === 'pass' ? 1 : 0])) } }
        }
        return { id: task, passed: false, score: 0, notes: 'no scores: the harness or the grader failed (see the runner log)' }
      }))
    },
  },
  prbench: {
    name: 'prbench',
    repository: 'https://github.com/scaleapi/PRBench.git',
    ref: '7b2df0a28bf99ec51263c41b90dd510a740a7711',
    version: '7b2df0a (no release tag)',
    license: 'MIT (Scale AI); dataset ScaleAI/PRBench CC-BY-4.0',
    terms: 'CC-BY-4.0 dataset, not gated, loaded from Hugging Face at run time; attribution required, no training restriction stated',
    judge: 'openai/o4-mini (reasoning effort high), one call per rubric criterion',
    judgeSubstitutable: true,
    measured: 'model-shaped',
    resultIsFolder: true,
    // The publisher pins no dependency versions (requirements.txt), so a fresh install resolves them anew.
    install: [['uv', 'venv', '--quiet', '--python', '3.12'], ['uv', 'pip', 'install', '--quiet', '-r', 'requirements.txt']],
    // A sample runs --task ids or the first --tasks rows of the split (default legal; pass `-- --split finance`).
    run: (endpoint, options, resultPath) => [
      'sh', fileURLToPath(new URL('../scripts/prbench-run.sh', import.meta.url)),
      resultPath, endpoint.baseUrl, endpoint.model, endpoint.apiKeyVar,
      options.tasks === undefined ? 'all' : String(options.tasks), (options.taskIds ?? []).join(','), options.judge ?? 'publisher',
      ...(options.args ?? []),
    ],
    // Per task, the publisher's clipped score: rubric points over the positive weights (negative criteria can take it below
    // zero; clamped to 0..1 here). The publisher's aggregate, mean_clipped, is max(0, mean of the unclamped scores).
    parse: async (resultPath) => {
      const folder = path.join(resultPath, 'results')
      const files = (await readdir(folder)).filter((file) => file.endsWith('.json'))
      if (files.length !== 1) throw new Error(`PRBench wrote ${files.length} result files under ${folder}, expected one`)
      const result = JSON.parse(await readFile(path.join(folder, files[0]!), 'utf8')) as { outputs?: Record<string, Record<string, { points?: unknown; weights?: unknown }>> }
      const tasks = Object.values(result.outputs ?? {})[0]
      if (!tasks) throw new Error(`PRBench result ${files[0]} has no outputs`)
      return Object.entries(tasks).map(([id, task]) => {
        const weights = Array.isArray(task.weights) ? task.weights.filter((weight): weight is number => typeof weight === 'number') : []
        const best = weights.filter((weight) => weight > 0).reduce((sum, weight) => sum + weight, 0)
        const points = typeof task.points === 'number' ? task.points : Number.NaN
        if (!best || Number.isNaN(points)) throw new Error(`PRBench task ${id} has no points or weights`)
        return { id, passed: points >= best, score: Math.min(1, Math.max(0, points / best)), notes: `${points} of ${best} rubric points` }
      })
    },
  },
  'healthbench-professional': {
    name: 'healthbench-professional',
    repository: 'https://github.com/openai/simple-evals.git',
    ref: '652c89d0ca9df547706735883097e9537d40dc47',
    version: '652c89d (no release tag), data openai/healthbench-professional@349962fd',
    license: 'MIT (OpenAI simple-evals); dataset openai/healthbench-professional MIT',
    terms: 'MIT dataset, not gated, fetched from Hugging Face at the pinned revision at run time and never committed: the authors ask that examples not be revealed in plain text or images online. No training restriction stated.',
    judge: 'gpt-5.4-2026-03-05 (reasoning effort low), one call per rubric item; length-adjusted (center 2000 characters, 1.47 points per 500)',
    judgeSubstitutable: true,
    unofficial: 'OpenAI reports HealthBench Professional from an internal implementation it does not release; simple-evals with its Professional settings is the reference implementation',
    measured: 'model-shaped',
    resultIsFolder: true,
    // The publisher pins no dependency versions and ships no requirements file; these are the imports HealthBenchEval needs.
    install: [['uv', 'venv', '--quiet', '--python', '3.12'], ['uv', 'pip', 'install', '--quiet', 'openai', 'blobfile', 'numpy', 'pandas', 'jinja2', 'requests', 'tqdm']],
    // A sample runs the publisher's seeded sample of --tasks examples, or the --task ids.
    run: (endpoint, options, resultPath) => [
      'sh', fileURLToPath(new URL('../scripts/healthbench-professional-run.sh', import.meta.url)),
      resultPath, endpoint.baseUrl, endpoint.model, endpoint.apiKeyVar,
      options.tasks === undefined ? 'all' : String(options.tasks), (options.taskIds ?? []).join(','), options.judge ?? 'publisher',
      ...(options.args ?? []),
    ],
    // Per task, the publisher's length-adjusted rubric score, clamped to 0..1 (the publisher clips the mean, not each task).
    // Passed: every positive criterion met and no negative one.
    parse: async (resultPath) => {
      const result = JSON.parse(await readFile(path.join(resultPath, 'result.json'), 'utf8')) as {
        examples?: Array<{ prompt_id: string; overall_score: number; length_adjusted: number; response_chars: number; positive_met: number; positive_total: number; negative_met: number }>
      }
      if (!result.examples?.length) throw new Error(`HealthBench Professional wrote no examples under ${resultPath}`)
      return result.examples.map((example) => ({
        id: example.prompt_id,
        passed: example.positive_met === example.positive_total && example.negative_met === 0,
        score: Math.min(1, Math.max(0, example.length_adjusted)),
        notes: `${example.positive_met} of ${example.positive_total} positive criteria met, ${example.negative_met} negative met; rubric score ${example.overall_score.toFixed(3)}, length-adjusted for ${example.response_chars} characters`,
        raw: {
          overall_score: example.overall_score, length_adjusted: example.length_adjusted, response_chars: example.response_chars,
          positive_met: example.positive_met, positive_total: example.positive_total, negative_met: example.negative_met,
        },
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
  const { mcp, model, ...profile } = await readAppProfile(name, app.profileUrl)
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

/** An app's profile from its URL, or from an absolute file path. */
async function readAppProfile(name: string, source: string): Promise<Record<string, unknown>> {
  if (path.isAbsolute(source)) return JSON.parse(await readFile(source, 'utf8')) as Record<string, unknown>
  const response = await fetch(source)
  if (!response.ok) throw new Error(`${source} answered ${response.status}; app:${name} needs the profile the app serves`)
  return await response.json() as Record<string, unknown>
}

/** Run one published benchmark against one target with the publisher's runner and grader, and record the result. */
export async function runPublished(name: string, target: string, options: PublishedRunOptions): Promise<PublishedRun> {
  const benchmark = PUBLISHED_BENCHMARKS[name]
  if (!benchmark) throw new Error(`no published benchmark '${name}'; registered: ${Object.keys(PUBLISHED_BENCHMARKS).join(', ')}`)
  const env = { ...process.env, ...options.env }
  if (options.judge !== undefined && !benchmark.judgeSubstitutable) {
    throw new Error(`${benchmark.name} grades ${benchmark.judge === null ? 'deterministically' : `with ${benchmark.judge}`}; this registry cannot substitute its judge`)
  }
  if (options.judge !== undefined && !options.judge.startsWith('bridge/')) throw new Error(`--judge must be bridge/<harness/model>, not '${options.judge}'`)
  env.AGENT_BENCH_JUDGE_URL ??= env.AGENT_BENCH_BRIDGE_URL ?? 'http://127.0.0.1:3344/v1'
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
    measured: endpoint.measured, judge: options.judge ?? benchmark.judge, publisherJudge: benchmark.judge,
    official: options.judge === undefined && benchmark.unofficial === undefined,
    ...(benchmark.unofficial ? { unofficial: benchmark.unofficial } : {}),
    ...(endpoint.app ? { app: endpoint.app } : {}),
    tasks: taskScores.length, passed: taskScores.filter((task) => task.passed).length,
    score: taskScores.length ? taskScores.reduce((sum, task) => sum + task.score, 0) / taskScores.length : 0,
    taskScores, resultPath, runRecords: path.resolve(options.out, `${benchmark.name}-runrecords.jsonl`),
    license: benchmark.license, terms: benchmark.terms, startedAt, finishedAt: new Date().toISOString(),
  }
  await writeFile(run.runRecords, runRecords(run, options).map((record) => JSON.stringify(record)).join('\n') + '\n')
  await writeFile(path.resolve(options.out, `${benchmark.name}-run.json`), `${JSON.stringify(run, null, 2)}\n`)
  return run
}

/**
 * One agent-eval RunRecord per task, validated by agent-eval's own validator. The publisher's runner makes the model calls,
 * so cost and tokens are uncaptured, never zero. A RunRecord's model must name a served snapshot; a subscription harness
 * reports none, and a snapshot invented from the date would be false, so such rows record `unknown` with terminal outcome
 * `unknown` and keep the requested model in `candidateId`. A pinned model id (a Router snapshot) is recorded as served.
 */
function runRecords(run: PublishedRun, options: PublishedRunOptions): RunRecord[] {
  const split = options.record?.splitTag ?? 'holdout'
  const sha = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`
  const configHash = sha(canonicalJson({ benchmark: run.benchmark, ref: run.ref, target: run.target, judge: run.judge, args: options.args ?? [] }))
  return run.taskScores.map((task) => {
    const row = {
      runId: randomUUID(), experimentId: options.record?.experimentId ?? `${run.benchmark}@${run.ref}`,
      candidateId: options.record?.candidateId ?? run.target, seed: 0, model: run.model,
      // The publisher owns the prompt; an app run's prompt is its profile.
      promptHash: run.app?.profileDigest ?? sha(run.target), configHash, commitSha: run.ref,
      wallMs: Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt)),
      costUsd: null, costProvenance: { kind: 'uncaptured', usd: null }, tokenUsage: { input: 0, output: 0, tokensKnown: false },
      terminalOutcome: 'succeeded',
      outcome: { [split === 'holdout' ? 'holdoutScore' : 'searchScore']: task.score, raw: { passed: task.passed ? 1 : 0, ...task.raw } },
      splitTag: split, scenarioId: `${run.benchmark}:${task.id}`,
    }
    try {
      return validateRunRecord(row)
    } catch (error) {
      if (!(error instanceof RunRecordValidationError) || error.path !== 'model') throw error
      return validateRunRecord({ ...row, model: UNKNOWN_MODEL, terminalOutcome: 'unknown' })
    }
  })
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
