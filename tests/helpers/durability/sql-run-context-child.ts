import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { Sandbox } from '@tangle-network/sandbox'
import { contentAddress } from '../../../src/durable/content-address'
import { runGraph } from '../../../src/runtime/supervise/graph'
import { createFencedSqlRunContext } from '../../../src/runtime/supervise/sql-run-context'
import { readRecords } from '../../integration/fixtures/uncertain-create-protocol'
import { ConductorPlanner, conformanceGraph, RUN_ID, WORKER_NODES } from './conformance-graph'
import { openSideEffectSite, SIDE_EFFECT_TOOL_NAME, sideEffectToolSpec } from './side-effect'
import { isSqlOwnershipDenial, openSql, type SqlBoundary, TEST_LEASE } from './sql-adapter'

const [shared, mode = 'run', checkpoint = ''] = process.argv.slice(2)
if (!shared) throw new Error('shared SQL/provider directory is required')
let stopped = false
async function hit(mark: string) {
  if (stopped || mark !== checkpoint) return
  stopped = true
  await new Promise<void>((resolve, reject) =>
    process.send!({ type: 'checkpoint', mark }, (error) => (error ? reject(error) : resolve())),
  )
  if (mode === 'kill') process.kill(process.pid, 'SIGKILL')
  if (mode === 'hold')
    await new Promise<void>((resolve) =>
      process.once('message', (message) => {
        if (message !== 'lock') return resolve()
        store.database.exec('BEGIN IMMEDIATE')
        process.send!({ type: 'locked' })
      }),
    )
}

let sqlCalls = 0
let sqlBytes = 0
let publicationKinds: string[] = []
const boundary: SqlBoundary = async (when, sql, params) => {
  if (!stopped && mode === 'contend-locked' && when === 'before' && sql.includes(' SET owner =')) {
    stopped = true
    process.send!({ type: 'claim' })
    await new Promise<void>((resolve) => process.once('message', () => resolve()))
  }
  if (when === 'before') {
    sqlCalls += 1
    sqlBytes += Buffer.byteLength(sql) + Buffer.byteLength(JSON.stringify(params))
  }
  if (when === 'before' && sql.includes('_records') && sql.startsWith('INSERT')) {
    const entry = JSON.parse(params.at(-1) as string) as {
      kind: string
      events?: Array<{ kind: string; parent?: string; admission?: { phase: string } }>
    }
    publicationKinds =
      entry.kind === 'events'
        ? entry.events!.map((event) =>
            event.kind === 'spawned'
              ? `spawned-${event.parent === undefined ? 'root' : 'child'}`
              : event.kind === 'execution-admitted'
                ? `${event.kind}-${event.admission!.phase}`
                : event.kind,
          )
        : [entry.kind === 'blobs' ? 'blob' : entry.kind]
  }
  if (sql.includes(' SET head =')) {
    for (const kind of publicationKinds) await hit(`sql:${kind}:${when}`)
  }
}

const store = openSql(join(shared, 'run-context.sqlite'), boundary)
function graphProvider(): AgentEnvironmentProvider {
  // This independent HTTP service survives each killed orchestrator. Its real finite workers,
  // provision ledger and dispatch ledger are external effects, never orchestration persistence.
  const { url } = JSON.parse(readFileSync(join(shared, 'service-ready.json'), 'utf8')) as {
    url: string
  }
  const base = createTangleProvider({
    client: new Sandbox({
      apiKey: 'local-fixture-not-a-secret',
      baseUrl: url,
      platformUrl: url,
      trustLocalCliAuth: false,
      directExec: false,
    }),
    name: 'sql-http-process',
  })
  function wrappedEnvironment(environment: AgentEnvironment): AgentEnvironment {
    return {
      ...environment,
      async dispatch(input) {
        await hit('provider:dispatch:before')
        if (!environment.dispatch) throw new Error('fixture environment must support dispatch')
        const session = await environment.dispatch(input)
        await hit('provider:dispatch:after')
        return session
      },
    }
  }
  return {
    ...base,
    async create(input) {
      await hit('provider:create:before')
      const environment = await base.create(input)
      await hit('provider:create:after')
      return wrappedEnvironment(environment)
    },
    async get(id) {
      if (!base.get) throw new Error('fixture provider must support retained lookup')
      const environment = await base.get(id)
      return environment ? wrappedEnvironment(environment) : null
    },
  }
}

async function phase() {
  const context = await createFencedSqlRunContext(store.adapter, RUN_ID, TEST_LEASE)
  const planner = new ConductorPlanner({ forbidInDoubt: true })
  const site = openSideEffectSite(shared!)
  const authored = conformanceGraph()
  const graph = {
    ...authored,
    nodes: authored.nodes.map((node) =>
      node.id === 'conductor'
        ? node
        : {
            ...node,
            profile: {
              ...node.profile,
              harness: 'opencode',
              model: { provider: 'openai', default: 'fixture-model' },
            },
          },
    ),
  }
  const result = await runGraph(graph, {
    runId: RUN_ID,
    runContext: context,
    workerSlots: 3,
    maxTurns: 24,
    perWorker: { maxIterations: 60, maxTokens: 500000 },
    brain: async (messages) => {
      const response = planner.nextTurn(messages as ReadonlyArray<Record<string, unknown>>)
      return { ...response, toolCalls: response.toolCalls ?? [] }
    },
    backend: { backend: 'provider', provider: graphProvider() },
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
  const completed = new Set(
    events
      .filter((event) => event.kind === 'settled' && event.status === 'done')
      .map((event) => event.id),
  )
  const attempts = events.flatMap((event) =>
    event.kind === 'execution-bound' && event.id === RUN_ID ? [event.binding.attemptId] : [],
  )
  const cursors = events
    .filter((event) => event.kind === 'settled' || event.kind === 'cancelled')
    .map((event) => event.seq)
  const workerIds = new Set(workers.map((event) => event.id))
  const settledCounts = new Map<string, number>()
  for (const event of events) {
    if (event.kind === 'settled' && workerIds.has(event.id))
      settledCounts.set(event.id, (settledCounts.get(event.id) ?? 0) + 1)
  }
  const settledPerWorker = workers.every(
    (event) => settledCounts.get(event.id) === 1 && completed.has(event.id),
  )
  const report = {
    kind: result.result.kind,
    out: result.result.kind === 'winner' ? result.result.out : result.result,
    rootMaterializations: events.filter(
      (event) => event.kind === 'materialized' && event.id === RUN_ID,
    ).length,
    uniqueRootAttempts: attempts.length === new Set(attempts).size,
    uniqueCursorSequences: cursors.length === new Set(cursors).size,
    settledPerWorker,
    roots: events.filter((event) => event.kind === 'spawned' && event.parent === undefined).length,
    workers: workers.length,
    completed: workers.filter((event) => completed.has(event.id)).length,
    inDoubt: workers.filter((event) => !completed.has(event.id)).length,
    workerRecords: WORKER_NODES.map((label) => {
      const spawns = workers.filter((event) => event.label === label)
      return {
        label,
        spawns: spawns.length,
        settlements: events.filter(
          (event) =>
            event.kind === 'settled' &&
            event.status === 'done' &&
            spawns.some((spawn) => spawn.id === event.id),
        ).length,
      }
    }),
    planner: planner.report(),
    escalations: planner.report().escalations,
    effects: site.committedKeys(),
    creations: readRecords(join(shared, 'service-ledger.jsonl')).filter(
      (row) => row.kind === 'provision-admitted',
    ).length,
    dispatches: readRecords(join(shared, 'service-ledger.jsonl')).filter(
      (row) => row.kind === 'dispatch',
    ).length,
    sqlCalls,
    sqlBytes,
  }
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

try {
  if (mode === 'lease') {
    const context = await createFencedSqlRunContext(store.adapter, RUN_ID, TEST_LEASE)
    const lease = await context.acquire()
    const write = new Promise<void>((resolve) => process.once('message', () => resolve()))
    process.send!({ type: 'owned' })
    await write
    try {
      const value = { pid: process.pid }
      await lease.context.blobs.put(contentAddress(value), value)
      process.send!({ type: 'written' })
    } catch (error) {
      process.send!({ type: 'fenced', error: String(error) })
    } finally {
      await lease.release()
    }
  } else {
    if (mode === 'contend' || mode === 'contend-locked') {
      try {
        await phase()
        throw new Error('contender unexpectedly acquired the live run')
      } catch (error) {
        if (!isSqlOwnershipDenial(error)) throw error
        process.send!({ ...error, type: 'denied', error: String(error) })
      }
      await new Promise<void>((resolve) => process.once('message', () => resolve()))
    }
    await phase()
  }
  store.database.close()
  process.disconnect?.()
} catch (error) {
  console.error(error)
  process.exitCode = 1
  process.disconnect?.()
}
