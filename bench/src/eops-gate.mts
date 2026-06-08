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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type RouterConfig, type ToolSpec, routerToolLoop } from './router-client'
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
interface EopsTask {
  taskId: string
  systemPrompt: string
  userPrompt: string
  selectedTools: string[]
  servers: GymServer[]
  verifiers: Verifier[]
}

const asArray = <T,>(v: unknown): T[] => (typeof v === 'string' ? JSON.parse(v) : v) as T[]

/** Pull itsm tasks from the HF rows server (the oracle tool-set config). Fail loud. */
async function loadTasks(n: number, offset: number): Promise<EopsTask[]> {
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

/** Build OpenAI-shape tool specs for the task's selected tools from the gym's MCP tools/list. */
async function toolSpecs(server: GymServer, dbId: string, selected: string[]): Promise<ToolSpec[]> {
  const url = `${server.mcp_server_url.replace(/\/$/, '')}/mcp`
  const { json } = await postJson(url, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, authHeaders(server, dbId))
  const all = ((json as { result?: { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> } }).result?.tools) ?? []
  const want = new Set(selected)
  return all
    .filter((t) => want.has(t.name))
    .map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema ?? { type: 'object', properties: {} } } }))
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

async function runShot(cfg: RouterConfig, task: EopsTask, server: GymServer, dbId: string, tools: ToolSpec[], maxTurns: number, steer?: string): Promise<number> {
  const r = await routerToolLoop(
    cfg,
    task.systemPrompt || 'You are an IT service-management operations agent.',
    shotPrompt(task, steer),
    tools,
    async (name, args) => callTool(server, dbId, name, args as Record<string, unknown>),
    { maxTurns, temperature: 0.3 },
  )
  return r.toolCalls
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 20)
  const k = Number(process.env.K ?? 3)
  const m = Number(process.env.M ?? 5)
  const offset = Number(process.env.OFFSET ?? 0)
  const model = process.env.WORKER_MODEL ?? 'gpt-4o-mini'
  const dbsDir = must('EOPS_GYM_DBS_DIR')
  const cfg: RouterConfig = { routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1', routerKey: must('TANGLE_API_KEY'), model }
  const concurrency = Number(process.env.CONCURRENCY ?? 4)

  console.log(`=== EOPS depth-vs-breadth gate · tool-using router worker · N=${n} K=${k} M=${m} model=${model} ===`)
  const tasks = await loadTasks(n, offset)
  console.log(`loaded ${tasks.length} itsm task(s); breadth@${k} (resample, K×M turns) vs depth@${k} (one loop, ${k * m} turns), conc=${concurrency}\n`)

  const rows = await pool(tasks, concurrency, async (task, i) => {
    const server = task.servers[0]
    if (!server) return { breadthR: 0, depthR: 0, breadthRes: 0, depthRes: 0 }

    const ratio = (x: { passes: number; total: number }) => x.passes / Math.max(x.total, 1)
    let acts = 0
    // breadth@K: K INDEPENDENT short loops on fresh DBs; keep the best verifier score.
    const breadthScores: Array<{ passes: number; total: number; resolved: boolean }> = []
    for (let s = 0; s < k; s += 1) {
      const dbId = await seedDb(server, dbsDir)
      try {
        const tools = await toolSpecs(server, dbId, task.selectedTools)
        acts += await runShot(cfg, task, server, dbId, tools, m)
        breadthScores.push(await score(server, dbId, task.verifiers))
      } finally {
        await deleteDb(server, dbId)
      }
    }
    const breadthBest = breadthScores.reduce((a, b) => (ratio(b) > ratio(a) ? b : a), breadthScores[0] ?? { passes: 0, total: 1, resolved: false })

    // depth@K: K SEQUENTIAL shots over ONE persistent DB — the artifact accumulates and
    // each re-engagement is steered to finish what's left (the regime where depth won
    // before). Equal compute: K shots × M turns, same as breadth's K × M.
    const depthDb = await seedDb(server, dbsDir)
    let depth = { passes: 0, total: 1, resolved: false }
    try {
      const tools = await toolSpecs(server, depthDb, task.selectedTools)
      for (let s = 0; s < k; s += 1) {
        const steer = s === 0 ? undefined : 'Re-inspect the current state with the read tools, identify what the task still requires, and complete it. Do not stop until every required change is verified in place.'
        acts += await runShot(cfg, task, server, depthDb, tools, m, steer)
      }
      depth = await score(server, depthDb, task.verifiers)
    } finally {
      await deleteDb(server, depthDb)
    }

    process.stderr.write(`  [${i + 1}/${tasks.length}] ${task.taskId.slice(-12)}: breadth=${breadthBest.passes}/${breadthBest.total} depth=${depth.passes}/${depth.total} toolcalls=${acts}\n`)
    return { breadthR: ratio(breadthBest), depthR: ratio(depth), breadthRes: breadthBest.resolved ? 1 : 0, depthRes: depth.resolved ? 1 : 0 }
  })

  const breadthR = rows.map((r) => r.breadthR)
  const depthR = rows.map((r) => r.depthR)
  const breadthRes = rows.map((r) => r.breadthRes)
  const depthRes = rows.map((r) => r.depthRes)
  const rate = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1)
  const sig = (l: PairedLift) => (l.low > 0 ? 'SIGNIF +' : l.high < 0 ? 'SIGNIF -' : 'n.s. (CI spans 0)')

  console.log(`\n${'='.repeat(72)}`)
  console.log(`RESULTS · EOPS itsm · n=${tasks.length} · K=${k} M=${m} · ${model}`)
  console.log('='.repeat(72))
  console.log(`  verifier score (partial credit, the signal at this difficulty):`)
  console.log(`    breadth@${k} (resample) ${pct(rate(breadthR))}    depth@${k} (steered) ${pct(rate(depthR))}`)
  console.log(`  fully-resolved rate (all verifiers):`)
  console.log(`    breadth@${k} ${pct(rate(breadthRes))}    depth@${k} ${pct(rate(depthRes))}`)
  const liftScore = pairedLift(breadthR, depthR)
  const liftRes = pairedLift(breadthRes, depthRes)
  console.log(`\n  PAIRED LIFTS (95% bootstrap CI, B=10000):`)
  console.log(`    depth − breadth, SCORE     ${pp(liftScore.point)}   CI [${pp(liftScore.low)}, ${pp(liftScore.high)}]   (paired ${liftScore.pairs}, disc ${liftScore.discordant})  ${sig(liftScore)}`)
  console.log(`    depth − breadth, RESOLVED  ${pp(liftRes.point)}   CI [${pp(liftRes.low)}, ${pp(liftRes.high)}]   (paired ${liftRes.pairs}, disc ${liftRes.discordant})  ${sig(liftRes)}`)
  console.log(`\n  VERDICT: does steered depth beat blind breadth on this stateful agentic domain @ equal compute? ${liftScore.point > 0 ? 'yes (score)' : 'no'} (${sig(liftScore)})`)
}

main().catch((err) => {
  console.error(`eops-gate: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  process.exit(1)
})
