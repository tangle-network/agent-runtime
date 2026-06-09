/**
 * EnterpriseOps-Gym depth-vs-breadth gate — the agentic, stateful domain where
 * steering is hypothesized to beat compute (the opposite regime to HumanEval,
 * where breadth/resampling won). The worker is the TOOL-USING router backend
 * (`routerToolLoop`): it calls the gym's live MCP tools, sees the results, and
 * acts — off-box (router inference + host→gym HTTP), no sandbox.
 *
 *   breadth@K — K independent shots, each a short agentic loop on its OWN fresh
 *               seeded DB; keep the best by the deployable verifier (resample).
 *   depth@K   — ONE sustained agentic loop over ONE DB, ~K× the turn budget; the
 *               artifact (DB state) accumulates, so each action conditions the next.
 *
 * Equal compute = equal total inference turns (K·M). Score = the task's own SQL
 * verifiers (deployable check), run on the final DB state. Per-task {0,1} resolved,
 * paired 95% bootstrap CI.
 *
 * Stand up first:
 *   docker run -d --rm --name eops -p 8006:8005 shivakrishnareddyma225/enterpriseops-gym-mcp-itsm:latest
 *   # gym_dbs.zip from github.com/ServiceNow/EnterpriseOps-Gym (root), unzipped:
 *   export EOPS_GYM_DBS_DIR=/path/to/unzipped/dbs
 *   TANGLE_API_KEY=… N=20 K=3 M=5 WORKER_MODEL=gpt-4o-mini tsx src/eops-gate.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type RouterConfig, type ToolSpec, routerChatWithUsage, routerToolLoop } from './router-client'
import { type PairedLift, pairedLift, pool } from './stats.mts'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

const dataset = 'ServiceNow-AI/EnterpriseOps-Gym'

type ComparisonType = 'equals' | 'greater_than' | 'less_than' | 'contains'
interface Verifier {
  verifier_type?: string
  gym_name?: string
  /** EOPS nests the deterministic check here; comparison_type defaults to 'equals'. */
  validation_config?: { query?: string; expected_value?: unknown; comparison_type?: ComparisonType }
}
interface GymServer {
  mcp_server_url: string
  seed_database_file: string
  context?: Record<string, string>
}
export interface EopsTask {
  taskId: string
  systemPrompt: string
  userPrompt: string
  selectedTools: string[]
  servers: GymServer[]
  verifiers: Verifier[]
}

const asArray = <T,>(v: unknown): T[] => (typeof v === 'string' ? JSON.parse(v) : v) as T[]

/** Pull itsm tasks from the HF rows server (the oracle tool-set config). Fail loud. */
export async function loadTasks(n: number, offset: number): Promise<EopsTask[]> {
  const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(dataset)}&config=oracle&split=itsm&offset=${offset}&length=${n}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`EOPS HF rows HTTP ${res.status}: ${url}`)
  const data = (await res.json()) as { rows?: Array<{ row: Record<string, unknown> }> }
  const rows = data.rows ?? []
  if (rows.length === 0) throw new Error('EOPS HF returned 0 rows')
  return rows.map(({ row }) => ({
    taskId: String(row.task_id),
    systemPrompt: String(row.system_prompt ?? ''),
    userPrompt: String(row.user_prompt ?? ''),
    selectedTools: asArray<string>(row.selected_tools),
    servers: asArray<GymServer>(row.gym_servers_config),
    verifiers: asArray<Verifier>(row.verifiers),
  }))
}

// ── gym client (mirrors scripts/enterpriseops_gym_judge.py) ────────────────────

function authHeaders(server: GymServer, dbId: string): Record<string, string> {
  return { 'content-type': 'application/json', ...(server.context ?? {}), 'x-database-id': dbId }
}

/** POST and parse a JSON body OR the last `data:` line of an SSE stream (/mcp streams SSE). */
async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await r.text()
  const dataLines = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim())
  const payload = dataLines.length ? dataLines[dataLines.length - 1] : text
  try {
    return { status: r.status, json: JSON.parse(payload ?? 'null') }
  } catch {
    return { status: r.status, json: text }
  }
}

async function seedDb(server: GymServer, dbsDir: string): Promise<string> {
  const dbId = `gate_${Math.random().toString(36).slice(2, 12)}`
  const sql = readFileSync(join(dbsDir, server.seed_database_file), 'utf8')
  const url = `${server.mcp_server_url.replace(/\/$/, '')}/api/seed-database`
  const { status, json } = await postJson(url, { database_id: dbId, name: `gate_${dbId}`, description: 'gate', sql_content: sql }, { 'content-type': 'application/json' })
  if (status !== 200 || !(json as { success?: boolean })?.success) throw new Error(`seed-database failed (${status}): ${JSON.stringify(json).slice(0, 200)}`)
  return dbId
}

async function deleteDb(server: GymServer, dbId: string): Promise<void> {
  await fetch(`${server.mcp_server_url.replace(/\/$/, '')}/api/delete-database`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ database_id: dbId }),
  }).catch(() => {})
}

/** Coerce an MCP inputSchema to an OpenAI-tool-valid top-level object schema. The
 *  router rejects top-level oneOf/anyOf/allOf/enum/not — keep the properties (nested
 *  combinators are fine) but guarantee a plain `{type:'object'}` head. */
function sanitizeSchema(s: unknown): { type: 'object'; properties: Record<string, unknown>; required?: string[] } {
  const o = s && typeof s === 'object' ? (s as Record<string, unknown>) : {}
  const banned = o.oneOf || o.anyOf || o.allOf || o.not || o.enum
  if (o.type === 'object' && !banned && o.properties && typeof o.properties === 'object') {
    return { type: 'object', properties: o.properties as Record<string, unknown>, ...(Array.isArray(o.required) ? { required: o.required as string[] } : {}) }
  }
  return { type: 'object', properties: {} }
}

/** Build OpenAI-shape tool specs for the task's selected tools from the gym's MCP tools/list. */
async function toolSpecs(server: GymServer, dbId: string, selected: string[]): Promise<ToolSpec[]> {
  const url = `${server.mcp_server_url.replace(/\/$/, '')}/mcp`
  const { json } = await postJson(url, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, authHeaders(server, dbId))
  const all = ((json as { result?: { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> } }).result?.tools) ?? []
  const want = new Set(selected)
  return all
    .filter((t) => want.has(t.name))
    .map((t) => ({ type: 'function' as const, function: { name: t.name, description: (t.description ?? '').slice(0, 1000), parameters: sanitizeSchema(t.inputSchema) } }))
}

async function callTool(server: GymServer, dbId: string, name: string, args: Record<string, unknown>): Promise<string> {
  const url = `${server.mcp_server_url.replace(/\/$/, '')}/mcp`
  const { json } = await postJson(url, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, authHeaders(server, dbId))
  const result = (json as { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: unknown }) ?? {}
  if (result.error) return `error: ${JSON.stringify(result.error).slice(0, 300)}`
  const text = result.result?.content?.map((c) => c.text ?? '').join('\n') ?? JSON.stringify(result.result ?? json)
  return text.slice(0, 1500)
}

function compare(actual: unknown, expected: unknown, kind: ComparisonType): boolean {
  const fa = Number(actual)
  const fe = Number(expected)
  const numeric = !Number.isNaN(fa) && !Number.isNaN(fe)
  if (kind === 'equals') return numeric ? fa === fe : String(actual) === String(expected)
  if (kind === 'greater_than') return numeric && fa > fe
  if (kind === 'less_than') return numeric && fa < fe
  if (kind === 'contains') return String(actual).includes(String(expected))
  throw new Error(`unsupported comparison_type ${kind}`)
}

/** Run the task's SQL verifiers on the final DB state; resolved = all pass. */
async function score(server: GymServer, dbId: string, verifiers: Verifier[]): Promise<{ passes: number; total: number; resolved: boolean }> {
  // Only deterministic database_state verifiers are scoreable (the judge rejects others).
  const dbv = verifiers.filter((v) => (v.verifier_type ?? 'database_state') === 'database_state' && v.validation_config?.query)
  let passes = 0
  for (const v of dbv) {
    const vc = v.validation_config as NonNullable<Verifier['validation_config']>
    const url = `${server.mcp_server_url.replace(/\/$/, '')}/api/sql-runner`
    const { json } = await postJson(url, { query: vc.query, database_id: dbId }, authHeaders(server, dbId))
    const out = json as { data?: Array<Record<string, unknown>>; rows?: Array<Record<string, unknown>>; error?: unknown }
    if (out.error) continue
    const first = (out.data ?? out.rows ?? [])[0]
    const actual = first && typeof first === 'object' ? Object.values(first)[0] : first
    if (compare(actual, vc.expected_value, vc.comparison_type ?? 'equals')) passes += 1
  }
  return { passes, total: dbv.length, resolved: dbv.length > 0 && passes === dbv.length }
}

// ── one agentic shot: the tool-using worker acts on a (seeded) DB ──────────────

function shotPrompt(task: EopsTask, steer?: string): string {
  return [
    task.userPrompt,
    '',
    'Use the available tools to investigate the current state, then take the actions needed to complete the task.',
    'Inspect before you mutate. When you are confident the task is complete, give a one-line summary and stop calling tools.',
    ...(steer ? ['', `CORRECTION FROM YOUR PRIOR ATTEMPT: ${steer}`] : []),
  ].join('\n')
}

type ToolTrace = Array<{ name: string; args: string; result: string }>

async function runShot(cfg: RouterConfig, task: EopsTask, server: GymServer, dbId: string, tools: ToolSpec[], maxTurns: number, steer?: string): Promise<{ toolCalls: number; toolTrace: ToolTrace }> {
  const r = await routerToolLoop(
    cfg,
    task.systemPrompt || 'You are an IT service-management operations agent.',
    shotPrompt(task, steer),
    tools,
    async (name, args) => callTool(server, dbId, name, args as Record<string, unknown>),
    { maxTurns, temperature: 0.3 },
  )
  return { toolCalls: r.toolCalls, toolTrace: r.toolTrace }
}

type Score = { passes: number; total: number; resolved: boolean }
const scoreRatio = (x: Score) => x.passes / Math.max(x.total, 1)

const genericNudge =
  'Re-inspect the current state with the read tools, identify what the task still requires, and complete it. Do not stop until every required change is verified in place.'

/** A depth steerer under test. No template ⇒ the fixed generic nudge. With a template
 *  ⇒ an LLM steerer: {task}/{trace} are substituted; it reads BEHAVIOR only (firewalled). */
export interface Steerer {
  id: string
  systemPrompt?: string
  userTemplate?: string
}

function traceSummary(trace: ToolTrace): string {
  return trace.map((t) => `${t.name}(${t.args.slice(0, 140)}) -> ${t.result.slice(0, 180)}`).join('\n').slice(-4000) || '(no tool calls yet)'
}

/** The next-shot instruction for a steerer. FIREWALLED: trace only, never verifiers. */
async function steerInstruction(steerCfg: RouterConfig, steerer: Steerer, task: EopsTask, trace: ToolTrace): Promise<string> {
  if (!steerer.userTemplate) return genericNudge
  const user = steerer.userTemplate.replaceAll('{task}', task.userPrompt).replaceAll('{trace}', traceSummary(trace))
  const r = await routerChatWithUsage(
    steerCfg,
    [
      { role: 'system', content: steerer.systemPrompt ?? 'You are an ITSM operations reviewer. Output one concrete corrective instruction.' },
      { role: 'user', content: user },
    ],
    { temperature: 0.2 },
  )
  return r.content.trim()
}

/** One depth arm: K sequential steered shots over ONE persistent DB, scored after each
 *  shot. Returns the best checkpoint (deployable, symmetric with breadth's best-of-K),
 *  the final state, the trajectory, and tool-call count. */
async function runDepthArm(
  cfg: RouterConfig,
  steerCfg: RouterConfig,
  steerer: Steerer,
  task: EopsTask,
  server: GymServer,
  dbsDir: string,
  k: number,
  m: number,
): Promise<{ best: Score; final: Score; traj: string; toolCalls: number }> {
  const dbId = await seedDb(server, dbsDir)
  let toolCalls = 0
  try {
    const tools = await toolSpecs(server, dbId, task.selectedTools)
    const trace: ToolTrace = []
    const shots: Score[] = []
    for (let s = 0; s < k; s += 1) {
      const steer = s === 0 ? undefined : await steerInstruction(steerCfg, steerer, task, trace)
      const sr = await runShot(cfg, task, server, dbId, tools, m, steer)
      toolCalls += sr.toolCalls
      trace.push(...sr.toolTrace)
      shots.push(await score(server, dbId, task.verifiers))
    }
    const final = shots[shots.length - 1] ?? { passes: 0, total: 1, resolved: false }
    const best = shots.reduce((a, b) => (scoreRatio(b) > scoreRatio(a) ? b : a), shots[0] ?? final)
    return { best, final, traj: shots.map((x) => `${x.passes}/${x.total}`).join('→'), toolCalls }
  } finally {
    await deleteDb(server, dbId)
  }
}

/** The built-in inline analyst (STEER=analyst back-compat / the S1 baseline). */
const inlineAnalyst: Steerer = {
  id: 'analyst',
  systemPrompt:
    "You are a senior ITSM operations reviewer. You are shown an agent's tool-call trace on a task it has NOT completed. Diagnose precisely what the task still requires and issue ONE concrete corrective instruction — name the specific records, fields, and target values to set. Do not restate the task, do not praise, do not summarize the trace. Output only the single next instruction.",
  userTemplate: 'TASK:\n{task}\n\nAGENT TRACE SO FAR:\n{trace}\n\nThe single most important still-missing or incorrect step, as one concrete instruction:',
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`

export interface SteererRank {
  id: string
  bestRate: number
  lift: PairedLift
  liftRes: PairedLift
  degradation: number
}
export interface SteererLoss {
  steererId: string
  userPrompt: string
  breadth: number
  depthBest: number
  traj: string
}
export interface EvalResult {
  ok: Array<{ taskId: string; userPrompt: string; breadthR: number; breadthRes: number; perSteerer: Record<string, { bestR: number; finalR: number; bestRes: number; traj: string }> }>
  excluded: number
  ranked: SteererRank[]
  losses: SteererLoss[]
}

/** The fitness function — runs every steerer as a depth arm against ONE shared breadth
 *  baseline per task, returns ranked lift + the per-steerer LOSSES (tasks where depth-best
 *  < breadth, with the trajectory). The losses are GEPA's reflection fuel. */
export async function evaluateSteerers(args: {
  cfg: RouterConfig
  steerCfg: RouterConfig
  steerers: Steerer[]
  tasks: EopsTask[]
  dbsDir: string
  k: number
  m: number
  concurrency: number
}): Promise<EvalResult> {
  const { cfg, steerCfg, steerers, tasks, dbsDir, k, m, concurrency } = args
  const rows = await pool(tasks, concurrency, async (task, i) => {
    const server = task.servers[0]
    if (!server) return null
    try {
      const breadthScores: Score[] = []
      for (let s = 0; s < k; s += 1) {
        const dbId = await seedDb(server, dbsDir)
        try {
          const tools = await toolSpecs(server, dbId, task.selectedTools)
          await runShot(cfg, task, server, dbId, tools, m)
          breadthScores.push(await score(server, dbId, task.verifiers))
        } finally {
          await deleteDb(server, dbId)
        }
      }
      const breadthBest = breadthScores.reduce((a, b) => (scoreRatio(b) > scoreRatio(a) ? b : a), breadthScores[0] ?? { passes: 0, total: 1, resolved: false })
      const perSteerer: Record<string, { bestR: number; finalR: number; bestRes: number; traj: string }> = {}
      const tags: string[] = []
      for (const st of steerers) {
        const arm = await runDepthArm(cfg, steerCfg, st, task, server, dbsDir, k, m)
        perSteerer[st.id] = { bestR: scoreRatio(arm.best), finalR: scoreRatio(arm.final), bestRes: arm.best.resolved ? 1 : 0, traj: arm.traj }
        tags.push(`${st.id}=${arm.best.passes}/${arm.best.total}`)
      }
      process.stderr.write(`  [${i + 1}/${tasks.length}] ${task.taskId.slice(-12)}: breadth=${breadthBest.passes}/${breadthBest.total} | ${tags.join(' ')}\n`)
      return { taskId: task.taskId, userPrompt: task.userPrompt, breadthR: scoreRatio(breadthBest), breadthRes: breadthBest.resolved ? 1 : 0, perSteerer }
    } catch (err) {
      process.stderr.write(`  [${i + 1}/${tasks.length}] ${task.taskId.slice(-12)}: SKIP (${err instanceof Error ? err.message.slice(0, 90) : String(err)})\n`)
      return null
    }
  })
  const ok = rows.filter((r): r is NonNullable<typeof r> => r !== null)
  const rate = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1)
  const breadthR = ok.map((r) => r.breadthR)
  const breadthRes = ok.map((r) => r.breadthRes)
  const ranked = steerers
    .map((st) => {
      const bestR = ok.map((r) => r.perSteerer[st.id]?.bestR ?? 0)
      const finalR = ok.map((r) => r.perSteerer[st.id]?.finalR ?? 0)
      const bestRes = ok.map((r) => r.perSteerer[st.id]?.bestRes ?? 0)
      return { id: st.id, bestRate: rate(bestR), lift: pairedLift(breadthR, bestR), liftRes: pairedLift(breadthRes, bestRes), degradation: rate(bestR) - rate(finalR) }
    })
    .sort((a, b) => b.lift.point - a.lift.point)
  // Losses = the reflection fuel: tasks where a steerer's depth-best lost to breadth.
  const losses: SteererLoss[] = []
  for (const r of ok) {
    for (const st of steerers) {
      const ps = r.perSteerer[st.id]
      if (ps && ps.bestR < r.breadthR) losses.push({ steererId: st.id, userPrompt: r.userPrompt, breadth: r.breadthR, depthBest: ps.bestR, traj: ps.traj })
    }
  }
  return { ok, excluded: rows.length - ok.length, ranked, losses }
}

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 20)
  const k = Number(process.env.K ?? 3)
  const m = Number(process.env.M ?? 5)
  const offset = Number(process.env.OFFSET ?? 0)
  const model = process.env.WORKER_MODEL ?? 'gpt-4o-mini'
  const dbsDir = must('EOPS_GYM_DBS_DIR')
  const cfg: RouterConfig = { routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1', routerKey: must('TANGLE_API_KEY'), model }
  const concurrency = Number(process.env.CONCURRENCY ?? 4)
  const steerCfg: RouterConfig = { ...cfg, model: process.env.STEER_MODEL ?? model }
  // The steerer population under test: generic (control) + either a STEERERS_FILE
  // (JSON array of {id,systemPrompt,userTemplate}) or the built-in inline analyst.
  const steerers: Steerer[] = [{ id: 'generic' }]
  if (process.env.STEERERS_FILE) steerers.push(...(JSON.parse(readFileSync(process.env.STEERERS_FILE, 'utf8')) as Steerer[]))
  else if (process.env.STEER === 'analyst') steerers.push(inlineAnalyst)

  console.log(`=== EOPS steerer sweep · worker=${model} · steerer=${steerCfg.model} · N=${n} K=${k} M=${m} ===`)
  console.log(`  steerers (depth arms, all vs ONE shared breadth baseline): ${steerers.map((s) => s.id).join(', ')}`)
  const tasks = await loadTasks(n, offset)
  console.log(`  loaded ${tasks.length} itsm task(s); each scored depth-BEST (checkpoint) vs breadth best-of-K, conc=${concurrency}\n`)

  const { ok, excluded, ranked } = await evaluateSteerers({ cfg, steerCfg, steerers, tasks, dbsDir, k, m, concurrency })
  const breadthR = ok.map((r) => r.breadthR)
  const breadthRes = ok.map((r) => r.breadthRes)
  const rate = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1)
  const sig = (l: PairedLift) => (l.low > 0 ? 'SIGNIF +' : l.high < 0 ? 'SIGNIF -' : 'n.s.')

  console.log(`\n${'='.repeat(86)}`)
  console.log(`RESULTS · EOPS steerer sweep · n=${ok.length} (excluded ${excluded}) · K=${k} M=${m} · worker=${model} · steerer=${steerCfg.model}`)
  console.log('='.repeat(86))
  console.log(`  breadth@${k} (best-of-K, shared baseline): score ${pct(rate(breadthR))}  resolved ${pct(rate(breadthRes))}\n`)
  console.log(`  ${'steerer'.padEnd(22)} ${'depth-best'.padStart(10)} ${'− breadth'.padStart(10)} ${'95% CI'.padStart(18)} ${'resolved Δ'.padStart(11)} ${'degrade'.padStart(8)}`)
  console.log(`  ${'-'.repeat(84)}`)
  for (const r of ranked) {
    console.log(
      `  ${r.id.padEnd(22)} ${pct(r.bestRate).padStart(10)} ${pp(r.lift.point).padStart(10)} ${`[${pp(r.lift.low)},${pp(r.lift.high)}]`.padStart(18)} ${pp(r.liftRes.point).padStart(11)} ${pp(r.degradation).padStart(8)}  ${sig(r.lift)}`,
    )
  }
  const best = ranked[0]
  console.log(`\n  WINNER: ${best?.id} — depth-best beats breadth ${best ? pp(best.lift.point) : 'n/a'} (${best ? sig(best.lift) : ''}). Degradation across steerers shows how much keep-best recovers.`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`eops-gate: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    process.exit(1)
  })
}
