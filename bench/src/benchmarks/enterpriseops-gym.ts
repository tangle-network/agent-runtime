/**
 * EnterpriseOps-Gym adapter (ServiceNow-AI/EnterpriseOps-Gym, Apache-2.0) —
 * stateful agentic planning + tool use in enterprise settings. Each record is an
 * enterprise-ops task (Customer Service, HR, ITSM, Calendar, Email, Drive, Teams,
 * Hybrid) handed to the agent with a domain `system_prompt`, a `selected_tools`
 * allow-list, and one or more containerized gym MCP servers (`gym_servers_config`).
 * Worker artifact = the ordered tool-call transcript the agent would issue against
 * those servers, emitted as a single fenced ```json block of
 * `{ "calls": [ { "tool": ..., "arguments": {...}, "gym_name"?: ... } ] }`.
 *
 * Judge = the benchmark's OWN deterministic state-checker. The driver replays the
 * transcript against a freshly-seeded gym server (mutating its database), then runs
 * each task's `database_state` verifier — an SQL SELECT executed via the gym
 * server's /api/sql-runner endpoint, compared to `expected_value` under
 * `comparison_type` (equals/greater_than/less_than/contains). GRADED: score =
 * (verifiers passing) / (total verifiers) = the bench's verifier_level_pass_rate;
 * binary `resolved` = ALL verifiers pass = the bench's overall_success_rate. Fully
 * deterministic — no LLM judge.
 *
 * loadTasks enumerates the real suite from the HF rows server (config = tool-set
 * MODE oracle|plus_5_tools|plus_10_tools|plus_15_tools; split = DOMAIN); a committed
 * sample (bench/fixtures/enterpriseops-gym.json) loads offline.
 *
 * Requires for a LIVE judge run: a Docker daemon with the domain gym images
 * (`docker pull shivakrishnareddyma225/enterpriseops-gym-mcp-<domain>:latest`) up
 * on the ports in `gym_servers_config`, seeded from gym_dbs.zip. preflight + judge
 * fail loud with the exact pull/run/unzip step when a server is unreachable — never
 * a fabricated score. No portable gold artifact ships, so goldArtifact is undefined.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OutputAdapter } from '@tangle-network/agent-runtime/loops'
import { benchRoot, runVenvScriptStdin } from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const FIXTURES = join(benchRoot, 'fixtures', 'enterpriseops-gym.json')
const JUDGE = join(benchRoot, 'scripts', 'enterpriseops_gym_judge.py')

/** Monotonic discriminator so concurrent judge calls stage distinct task-cache files. */
let judgeCallSeq = 0

const DATASET = 'ServiceNow-AI/EnterpriseOps-Gym'
/** Tool-set mode = HF config; oracle ships exact tools, plus_N adds N distractors. */
const DEFAULT_MODE = 'oracle'
/** Domain = HF split. */
const DEFAULT_DOMAIN = 'itsm'

const rowsApi = (mode: string, domain: string) =>
  `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(DATASET)}&config=${encodeURIComponent(mode)}&split=${encodeURIComponent(domain)}`

interface GymServerConfig {
  mcp_server_name: string
  mcp_server_url: string
  seed_database_file: string
  context?: Record<string, string>
  user_info?: Record<string, unknown>
}

interface Verifier {
  verifier_type: string
  name: string
  description?: string
  gym_name: string
  validation_config: { query: string; expected_value: unknown; comparison_type: string }
}

interface EopsRow {
  task_id: string
  domain: string
  system_prompt: string
  user_prompt: string
  selected_tools: string[]
  restricted_tools: string[]
  mcp_endpoint: string
  number_of_runs: number
  reset_database_between_runs: boolean
  /** HF parquet stores these as JSON strings; fixtures store them as parsed arrays. */
  gym_servers_config: string | GymServerConfig[]
  verifiers: string | Verifier[]
}

interface EopsMeta {
  taskId: string
  domain: string
  mode: string
  selectedTools: string[]
  servers: GymServerConfig[]
  verifiers: Verifier[]
}

/** Worker transcript = the last fenced ```json block, else the raw text. */
export const enterpriseOpsTranscriptOutput: OutputAdapter<string> = {
  parse(events) {
    let text = ''
    for (const ev of events) {
      const d = (ev as { data?: Record<string, unknown> })?.data
      const t = d?.finalText ?? d?.text ?? d?.result
      if (typeof t === 'string' && t.length > 0) text = t
    }
    const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)]
    return (fences.at(-1)?.[1] ?? text).trim()
  },
}

function asArray<T>(v: string | T[]): T[] {
  return typeof v === 'string' ? (JSON.parse(v) as T[]) : v
}

function workerContract(tools: string[]): string {
  return [
    '',
    `You have exactly these tools available (call NO others): ${tools.join(', ')}.`,
    'Plan the full sequence of tool calls that brings the enterprise database to the required final state, honoring every policy in the role above.',
    'Emit your COMPLETE plan as the LAST thing in your reply, in a single fenced ```json block, as an object:',
    '{ "calls": [ { "tool": "<tool_name>", "arguments": { ... } } ] }',
    'Include one entry per tool call in execution order. Nothing after the closing fence.',
  ].join('\n')
}

function rowToTask(row: EopsRow, mode: string): BenchTask {
  const servers = asArray<GymServerConfig>(row.gym_servers_config)
  const verifiers = asArray<Verifier>(row.verifiers)
  const meta: EopsMeta = {
    taskId: row.task_id,
    domain: row.domain,
    mode,
    selectedTools: row.selected_tools,
    servers,
    verifiers,
  }
  return {
    id: row.task_id,
    split: row.domain,
    prompt: [row.system_prompt, '', row.user_prompt, workerContract(row.selected_tools)].join('\n'),
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): EopsMeta {
  const md = task.metadata
  if (
    !md ||
    typeof md.taskId !== 'string' ||
    !Array.isArray(md.servers) ||
    !Array.isArray(md.verifiers) ||
    (md.verifiers as unknown[]).length === 0
  ) {
    throw new Error(`enterpriseops-gym task ${task.id} missing metadata — loadTasks did not populate it`)
  }
  return md as unknown as EopsMeta
}

function selectRows(rows: EopsRow[], mode: string, opts: LoadOptions): BenchTask[] {
  let tasks = rows.map((r) => rowToTask(r, mode))
  if (opts.ids) {
    const want = new Set(opts.ids)
    tasks = tasks.filter((t) => want.has(t.id))
  } else if (opts.limit !== undefined) {
    tasks = tasks.slice(0, opts.limit)
  }
  return tasks
}

async function loadFixtures(mode: string, opts: LoadOptions): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(FIXTURES, 'utf8')) as EopsRow[]
  console.warn(
    `[enterpriseops-gym] EOPS_FIXTURES=1 — loading ${rows.length} committed sample rows from ${FIXTURES} (no HF fetch)`,
  )
  const domain = opts.split
  const scoped = domain ? rows.filter((r) => r.domain === domain) : rows
  return selectRows(scoped, mode, opts)
}

/** Pull real rows from the HF rows server (paged) for one mode/domain. Throws loud on a non-OK response. */
async function fetchRows(mode: string, domain: string, opts: LoadOptions): Promise<EopsRow[]> {
  const target = opts.ids ? opts.ids.length * 4 : (opts.limit ?? 16)
  const rows: EopsRow[] = []
  const want = opts.ids ? new Set(opts.ids) : null
  const page = 100
  const base = rowsApi(mode, domain)
  for (let offset = 0; offset < 1024 && rows.length < target; offset += page) {
    const res = await fetch(`${base}&offset=${offset}&length=${page}`)
    if (!res.ok) {
      throw new Error(`enterpriseops-gym rows HTTP ${res.status} (offset ${offset}): ${(await res.text()).slice(0, 200)}`)
    }
    const body = (await res.json()) as { rows?: Array<{ row: EopsRow }> }
    const got = body.rows ?? []
    if (got.length === 0) break
    for (const r of got) {
      if (want && !want.has(r.row.task_id)) continue
      rows.push(r.row)
    }
    if (got.length < page) break
  }
  if (rows.length === 0) throw new Error(`enterpriseops-gym: no rows matched ${JSON.stringify(opts)} for ${mode}/${domain}`)
  return rows
}

/**
 * Run the benchmark's own state-checker for one task over the worker's transcript.
 * The driver replays the tool calls against the live gym server, runs each
 * database_state verifier's SQL via /api/sql-runner, and reports {passes,total}.
 * Score = passes/total (verifier_level_pass_rate); resolved = all pass
 * (overall_success_rate). This is the expensive Docker-backed boundary — delegated
 * to the python driver, not reimplemented. The transcript is piped on stdin via the
 * shared stdin-aware runner (execFile's `input` is not honored async and hangs the
 * reader).
 */
async function runJudge(meta: EopsMeta, artifact: string): Promise<BenchScore> {
  // Stage the full task record (servers + verifiers) so the driver has the live
  // server URLs/contexts and the SQL it must run. The path is UNIQUE per call: the gate
  // runs k judges for one task concurrently, so a `${taskId}.json` shared path would race.
  const taskJsonPath = join(
    benchRoot,
    '.eops-task-cache',
    `${meta.taskId}-${process.pid}-${judgeCallSeq++}.json`,
  )
  await writeTaskCache(taskJsonPath, meta)
  let stdout: string
  try {
    stdout = await runVenvScriptStdin(JUDGE, ['judge', '--task-json', taskJsonPath], artifact, { cwd: benchRoot })
  } catch (err) {
    const e = err as { message?: string }
    throw new Error(
      `enterpriseops-gym judge failed for ${meta.taskId}: ${(e.message || String(err)).slice(0, 1500)}\n` +
        `Fix: (1) run the ${meta.domain} gym server — ` +
        `docker pull shivakrishnareddyma225/enterpriseops-gym-mcp-${meta.domain}:latest ; ` +
        `docker run -d -p <host>:8005 shivakrishnareddyma225/enterpriseops-gym-mcp-${meta.domain}:latest ; ` +
        `(2) unzip gym_dbs.zip (ServiceNow/EnterpriseOps-Gym) and export EOPS_GYM_DBS_DIR to its dir ` +
        `(the judge seeds each task's database from seed_database_file).`,
    )
  } finally {
    await rm(taskJsonPath, { force: true }).catch(() => {})
  }
  const report = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as {
    success?: boolean
    passes?: number
    total?: number
    error?: string
  }
  if (report.error) throw new Error(`enterpriseops-gym judge error for ${meta.taskId}: ${report.error}`)
  if (typeof report.passes !== 'number' || typeof report.total !== 'number') {
    throw new Error(`enterpriseops-gym judge returned no {passes,total}: ${stdout.slice(0, 400)}`)
  }
  const score = report.total > 0 ? report.passes / report.total : 0
  return {
    resolved: report.success === true && report.total > 0 && report.passes === report.total,
    score,
    detail: JSON.stringify({ taskId: meta.taskId, domain: meta.domain, passes: report.passes, total: report.total }),
  }
}

async function writeTaskCache(path: string, meta: EopsMeta): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(
    path,
    JSON.stringify({ task_id: meta.taskId, domain: meta.domain, gym_servers_config: meta.servers, verifiers: meta.verifiers }),
  )
}

/** Ping the configured gym servers' SQL endpoint; throw loud with the docker fix if any is unreachable. */
async function probeServers(servers: GymServerConfig[], domain: string): Promise<void> {
  for (const s of servers) {
    const url = `${s.mcp_server_url.replace(/\/$/, '')}/api/sql-runner`
    try {
      // A HEAD/empty POST just proves reachability; a real query runs in judge.
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      // Any HTTP response (even an error status) proves the server is up. Only a
      // transport failure (refused/ENOTFOUND) means the container is not running.
      void res.status
    } catch (err) {
      throw new Error(
        `enterpriseops-gym preflight: ${s.mcp_server_name} unreachable at ${url}: ${err instanceof Error ? err.message : err}\n` +
          `Fix: docker pull shivakrishnareddyma225/enterpriseops-gym-mcp-${domain}:latest ; ` +
          `docker run -d -p <port>:<port> shivakrishnareddyma225/enterpriseops-gym-mcp-${domain}:latest ; ` +
          `seed from gym_dbs.zip. Set EOPS_FIXTURES=1 to load sample tasks offline (judge still needs a live server).`,
      )
    }
  }
}

export function createEnterpriseOpsGymAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.EOPS_FIXTURES === '1'
  const mode = process.env.EOPS_MODE ?? DEFAULT_MODE

  return {
    name: 'enterpriseops-gym',
    output: enterpriseOpsTranscriptOutput,

    async preflight() {
      // Fixtures mode proves only that the sample file is readable; a live judge
      // still requires running gym servers (and fails loud there if absent).
      if (fixturesMode) {
        await readFile(FIXTURES, 'utf8').catch((err) => {
          throw new Error(`EOPS_FIXTURES=1 but ${FIXTURES} unreadable: ${err instanceof Error ? err.message : err}`)
        })
        return
      }
      // Live mode: probe the gym servers for the default domain (the suite's tasks
      // each carry their own server config; preflight verifies reachability up
      // front so a batch fails fast with the docker fix rather than mid-run).
      const sample = await loadFixtures(mode, { split: DEFAULT_DOMAIN, limit: 1 }).catch(() => [])
      const servers = sample[0] ? readMeta(sample[0]).servers : []
      if (servers.length === 0) {
        throw new Error(
          `enterpriseops-gym preflight: no gym_servers_config to probe. ` +
            `Set EOPS_FIXTURES=1 to load offline, or ensure the dataset rows carry gym_servers_config.`,
        )
      }
      await probeServers(servers, DEFAULT_DOMAIN)
    },

    async loadTasks(opts: LoadOptions = {}) {
      const domain = opts.split ?? DEFAULT_DOMAIN
      if (fixturesMode) return loadFixtures(mode, opts)
      let rows: EopsRow[]
      try {
        rows = await fetchRows(mode, domain, opts)
      } catch (err) {
        console.warn(
          `[enterpriseops-gym] live rows fetch failed (${err instanceof Error ? err.message : err}); falling back to committed sample at ${FIXTURES}`,
        )
        return loadFixtures(mode, opts)
      }
      return selectRows(rows, mode, opts)
    },

    async goldArtifact() {
      // The benchmark ships no portable per-task oracle transcript — the reference
      // is the seeded final DB state the verifiers check, not a tool-call script.
      // Judge correctness is proven by replaying a real solve against the live gym
      // server, not by a synthetic gold transcript. Returns undefined (documented,
      // not faked).
      return undefined
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      return runJudge(meta, artifact)
    },
  }
}
