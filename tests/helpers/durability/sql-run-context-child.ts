import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AgentEnvironment, AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { runGraph } from '../../../src/runtime/supervise/graph'
import { createSqlRunContext } from '../../../src/runtime/supervise/sql-run-context'
import { durableRetainedProvider } from '../durable-retained-provider'
import { ConductorPlanner, conformanceGraph, RUN_ID } from './conformance-graph'
import { openSideEffectSite, SIDE_EFFECT_TOOL_NAME, sideEffectToolSpec } from './side-effect'
import { openSql, type SqlBoundary } from './sql-adapter'

const [shared, mode = 'run', checkpoint = ''] = process.argv.slice(2)
if (!shared) throw new Error('shared SQL/provider directory is required')
let stopped = false
async function hit(mark: string) {
  if (stopped || mark !== checkpoint) return
  stopped = true
  await new Promise<void>((resolve, reject) => process.send!({ type: 'checkpoint', mark }, (error) => error ? reject(error) : resolve()))
  if (mode === 'kill') process.kill(process.pid, 'SIGKILL')
  if (mode === 'hold') await new Promise<void>(() => {})
}

let sqlCalls = 0
let sqlBytes = 0
const boundary: SqlBoundary = async (when, sql, params) => {
  if (when === 'before') { sqlCalls += 1; sqlBytes += sql.length + JSON.stringify(params).length }
  let kind: string | undefined
  for (const param of params) {
    if (typeof param !== 'string' || !param.startsWith('{')) continue
    const value = JSON.parse(param) as { kind?: string; parent?: string; admission?: { phase: string } }
    if (!value.kind) continue
    kind = value.kind === 'spawned' ? `spawned-${value.parent === undefined ? 'root' : 'child'}` : value.kind
    if (value.kind === 'execution-admitted') kind += `-${value.admission!.phase}`
    break
  }
  if (params.includes('blobs')) kind = 'blob'
  if (kind) await hit(`sql:${kind}:${when}`)
}
const store = openSql(join(shared, 'run-context.sqlite'), boundary)
const physical = new DatabaseSync(join(shared, 'provider-effects.sqlite'))
physical.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS effects(kind TEXT NOT NULL, effect_key TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(kind,effect_key))')
function applied(kind: string, key: string) {
  physical.prepare('INSERT INTO effects VALUES (?, ?, 1) ON CONFLICT(kind,effect_key) DO UPDATE SET count=count+1').run(kind, key)
}
function total(kind: string) {
  return Number((physical.prepare('SELECT COALESCE(SUM(count),0) AS n FROM effects WHERE kind=?').get(kind) as { n: number }).n)
}

// This file is the EXTERNAL provider's durable state, not an orchestrator runDir. Each host has
// its own empty working directory; only SQL and this independently retained service survive.
const providerFile = join(shared, 'provider.json')
type ProviderState = { environments: Record<string, { sessions: Record<string, { controls: Record<string, unknown> }> }> }
function providerState(): ProviderState {
  return existsSync(providerFile) ? JSON.parse(readFileSync(providerFile, 'utf8')) as ProviderState : { environments: {} }
}
const base = durableRetainedProvider(providerFile)
function wrappedEnvironment(environment: AgentEnvironment): AgentEnvironment {
  return {
    ...environment,
    async dispatch(input) {
      await hit('provider:dispatch:before')
      const previous = providerState().environments[environment.id]?.sessions
      const known = new Set(Object.values(previous ?? {}).flatMap((session) => Object.keys(session.controls)))
      const session = await environment.dispatch(input)
      const executionId = session.controlRef!.executionId
      if (!known.has(executionId)) applied('dispatch', `${environment.id}:${executionId}`)
      await hit('provider:dispatch:after')
      return session
    },
  }
}
const provider: AgentEnvironmentProvider = {
  ...base,
  async create(input) {
    await hit('provider:create:before')
    const known = new Set(Object.keys(providerState().environments))
    const environment = await base.create(input)
    if (!known.has(environment.id)) applied('create', environment.id)
    await hit('provider:create:after')
    return wrappedEnvironment(environment)
  },
  async get(id) {
    const environment = await base.get(id)
    return environment ? wrappedEnvironment(environment) : null
  },
}

async function phase() {
  const context = await createSqlRunContext(store.adapter, RUN_ID, { leaseMs: 400, heartbeatMs: 60 })
  const planner = new ConductorPlanner()
  const site = openSideEffectSite(shared!)
  const result = await runGraph(conformanceGraph(), {
    runId: RUN_ID,
    runContext: context,
    workerSlots: 3,
    maxTurns: 24,
    perWorker: { maxIterations: 60, maxTokens: 500000 },
    brain: async (messages) => planner.nextTurn(messages as ReadonlyArray<Record<string, unknown>>),
    backend: { backend: 'provider', provider },
    extraTools: [sideEffectToolSpec()],
    executeExtraTool: async (name, args) => {
      if (name !== SIDE_EFFECT_TOOL_NAME) return null
      await hit('tool:commit:before')
      const receipt = site.commit(String(args.idempotencyKey), args.payload)
      await hit('tool:commit:after')
      return JSON.stringify(receipt)
    },
  })
  const events = (await context.journal.loadTree(RUN_ID)) ?? []
  const workers = events.filter((event) => event.kind === 'spawned' && event.parent !== undefined)
  const completed = new Set(events.filter((event) => event.kind === 'settled' && event.status === 'done').map((event) => event.id))
  const report = {
    kind: result.result.kind,
    out: result.result.kind === 'winner' ? result.result.out : result.result,
    roots: events.filter((event) => event.kind === 'spawned' && event.parent === undefined).length,
    workers: workers.length,
    completed: workers.filter((event) => completed.has(event.id)).length,
    inDoubt: workers.filter((event) => !completed.has(event.id)).length,
    escalations: planner.report().escalations,
    effects: site.committedKeys(),
    creations: total('create'),
    dispatches: total('dispatch'),
    sqlCalls, sqlBytes,
  }
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

try {
  if (mode === 'contend') {
    try {
      await phase()
      throw new Error('contender unexpectedly acquired the live run')
    } catch (error) {
      if (!/owned|lease|busy/i.test(String(error))) throw error
      process.send!({ type: 'denied', error: String(error) })
    }
    await new Promise<void>((resolve) => process.once('message', () => resolve()))
  }
  await phase()
  store.database.close()
  physical.close()
  process.disconnect?.()
} catch (error) {
  console.error(error)
  process.exitCode = 1
  process.disconnect?.()
}
