import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { contentAddress } from '../../src/durable/content-address'
import type { SpawnEvent } from '../../src/runtime'
import { createFencedSqlRunContext } from '../../src/runtime/supervise/sql-run-context'
import { EXPECTED_OUT, RUN_ID, WORKER_NODES } from '../helpers/durability/conformance-graph'
import { isSqlOwnershipDenial, openSql, TEST_LEASE } from '../helpers/durability/sql-adapter'
import {
  type Executables,
  ProcessFixture,
  prepareExecutables,
} from '../integration/fixtures/uncertain-create-harness'
import { readRecords } from '../integration/fixtures/uncertain-create-protocol'

let bundle: string
let executables: Executables
const services = new Map<string, ProcessFixture>()
beforeAll(async () => {
  ;({ bundle, executables } = await prepareExecutables())
})
afterAll(async () => {
  if (bundle) await rm(bundle, { recursive: true, force: true })
})
const roots: string[] = []
const children = new Set<ChildProcess>()
const leaseOptions = TEST_LEASE
const childFile = fileURLToPath(
  new URL('../helpers/durability/sql-run-context-child.ts', import.meta.url),
)
const tsx = createRequire(import.meta.url).resolve('tsx')
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
// A resumed graph run takes a few seconds on an idle host and several times that on a loaded CI
// runner or build host; these bound a hung child, not a slow one.
const CHILD_REPORT_MS = 90_000
const CASE_MS = 150_000

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'sql-run-context-'))
  roots.push(path)
  return path
}

afterEach(async ({ task }) => {
  await Promise.all(
    [...children].map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve()
            return
          }
          child.once('exit', () => resolve())
          child.kill('SIGKILL')
        }),
    ),
  )
  children.clear()
  for (const service of services.values()) {
    await service.captureCheckedFrontier(task.result?.state === 'fail' ? 'failed' : 'checked')
    await service.close()
  }
  services.clear()
  const paths = roots.splice(0)
  if (task.result?.state === 'fail')
    console.error(`SQL physical fixture evidence retained: ${paths.join(', ')}`)
  else await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })))
})

async function start(shared: string, cwd: string, mode = 'run', checkpoint = '') {
  if (mode !== 'lease' && !services.has(shared))
    services.set(
      shared,
      await ProcessFixture.start('sql-conformance', executables, {
        directory: shared,
        coordinator: false,
      }),
    )
  const child = spawn(
    process.execPath,
    ['--experimental-sqlite', '--import', tsx, childFile, shared, mode, checkpoint],
    {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  )
  children.add(child)
  const messages: Array<{ type: string; [key: string]: unknown }> = []
  let stdout = ''
  let stderr = ''
  child.stdout!.on('data', (chunk) => {
    stdout += String(chunk)
  })
  child.stderr!.on('data', (chunk) => {
    stderr += String(chunk)
  })
  child.on('message', (message) => messages.push(message as (typeof messages)[number]))
  const exit = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      children.delete(child)
      resolve({ code, signal })
    })
  })
  return {
    child,
    exit,
    async message(type: string) {
      for (let i = 0; i < 1500; i += 1) {
        const found = messages.find((message) => message.type === type)
        if (found) return found
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error(`child exited before ${type}: ${stderr}\n${stdout}`)
        await delay(20)
      }
      throw new Error(`child never reached ${type}: ${stderr}\n${stdout}`)
    },
    async report() {
      let timer: ReturnType<typeof setTimeout> | undefined
      const result = await Promise.race([
        exit,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`child timed out: ${stderr}`)), CHILD_REPORT_MS)
        }),
      ]).finally(() => clearTimeout(timer))
      expect(result, stderr).toEqual({ code: 0, signal: null })
      return JSON.parse(stdout.trim().split('\n').at(-1)!) as {
        kind: string
        out: unknown
        roots: number
        workers: number
        completed: number
        inDoubt: number
        escalations: unknown[]
        effects: string[]
        creations: number
        dispatches: number
        sqlCalls: number
        sqlBytes: number
        rootMaterializations: number
        uniqueRootAttempts: boolean
        uniqueCursorSequences: boolean
        settledPerWorker: boolean
        workerRecords: Array<{
          label: string
          spawns: number
          settlements: number
        }>
      }
    },
  }
}

function assertComplete(report: Awaited<ReturnType<Awaited<ReturnType<typeof start>>['report']>>) {
  expect(report.kind, JSON.stringify(report)).toBe('winner')
  expect(report.out).toEqual(EXPECTED_OUT)
  expect(report.roots).toBe(1)
  expect(report.rootMaterializations).toBe(1)
  expect(report.uniqueRootAttempts).toBe(true)
  expect(report.uniqueCursorSequences).toBe(true)
  expect(report.settledPerWorker).toBe(true)
  expect(report.workers).toBe(3)
  expect(report.completed).toBe(3)
  expect(report.inDoubt).toBe(0)
  expect(report.escalations).toEqual([])
  expect(report.workerRecords).toEqual(
    WORKER_NODES.map((label) => ({ label, spawns: 1, settlements: 1 })),
  )
  expect(report.effects).toEqual(['artifact:conductor:final'])
  expect(report.creations).toBe(3)
  expect(report.dispatches).toBe(3)
}

async function assertPhysical(shared: string) {
  const state = await services.get(shared)!.state()
  const processes = readRecords(join(shared, 'json-worker-processes.jsonl'))
  expect(state.failures).toEqual([])
  expect(state.provisions).toHaveLength(3)
  expect(state.runs).toHaveLength(3)
  expect(processes).toHaveLength(3)
  expect(new Set(processes.map((row) => row.executionId)).size).toBe(3)
  expect(processes.map((row) => row.name).sort()).toEqual([...WORKER_NODES].sort())
  const sql = openSql(join(shared, 'run-context.sqlite'))
  try {
    const context = await createFencedSqlRunContext(sql.adapter, RUN_ID, leaseOptions)
    const events = (await context.journal.loadTree(RUN_ID))!
    const results = events.filter(
      (event): event is Extract<SpawnEvent, { kind: 'execution-result' }> =>
        event.kind === 'execution-result',
    )
    expect(results).toHaveLength(3)
    for (const row of processes) {
      const run = state.runs.find((run) => run.executionId === row.executionId)!
      expect(run.processResult?.exitCode).toBe(0)
      const output = { node: row.name, pid: row.pid }
      expect(JSON.parse(run.processResult!.output)).toEqual(output)
      expect(
        state.requests.filter(
          (event) => event.kind === 'dispatch' && event.executionId === row.executionId,
        ),
      ).toHaveLength(1)
      expect(
        state.requests.filter(
          (event) => event.kind === 'json-worker-closed' && event.executionId === row.executionId,
        ),
      ).toHaveLength(1)
      expect(() => process.kill(Number(row.pid), 0)).toThrow(
        expect.objectContaining({ code: 'ESRCH' }),
      )
      const workers = events.filter((event) => event.kind === 'spawned' && event.label === row.name)
      expect(workers).toHaveLength(1)
      const id = workers[0]!.id
      const admissions = events.filter(
        (event): event is Extract<SpawnEvent, { kind: 'execution-admitted' }> =>
          event.kind === 'execution-admitted' &&
          event.id === id &&
          event.admission.phase === 'dispatched',
      )
      expect(admissions).toHaveLength(1)
      const admission = admissions[0]!.admission
      if (admission.phase !== 'dispatched') throw new Error('expected dispatched admission')
      expect(admission.controlRef).toEqual(run.runControlRef)
      const accepted = results.filter((event) => event.id === id)
      expect(accepted).toHaveLength(1)
      expect(accepted[0]!.outputFormat).toBe('json')
      const blob = await context.blobs.get(accepted[0]!.outRef!)
      expect(contentAddress(blob)).toBe(accepted[0]!.outRef)
      expect(blob).toEqual(output)
    }
  } finally {
    sql.database.close()
  }
}

describe('SQL run context', () => {
  it('retains a begun tree and content-addressed blobs across independent contexts', async () => {
    const path = join(await directory(), 'runs.sqlite')
    const a = openSql(path)
    const b = openSql(path)
    try {
      const first = await createFencedSqlRunContext(a.adapter, 'r', leaseOptions)
      const lease = await first.acquire()
      await lease.context.journal.beginTree('r', '2026-09-24T00:00:00.000Z')
      const output = { value: ['recorded'] }
      const ref = contentAddress(output)
      await lease.context.blobs.put(ref, output)
      output.value[0] = 'mutated'
      await lease.release()
      const second = await createFencedSqlRunContext(b.adapter, 'r', leaseOptions)
      const resumed = await second.acquire()
      try {
        expect(await resumed.context.journal.loadTree('r')).toEqual([])
        expect(await resumed.context.blobs.get(ref)).toEqual({
          value: ['recorded'],
        })
        await expect(lease.context.blobs.put(ref, { value: ['recorded'] })).rejects.toThrow()
      } finally {
        await resumed.release()
      }
    } finally {
      a.database.close()
      b.database.close()
    }
  })

  it('rejects a live second owner but does not serialize distinct runs', async () => {
    const db = openSql(join(await directory(), 'runs.sqlite'))
    try {
      const first = await createFencedSqlRunContext(db.adapter, 'one', leaseOptions)
      const second = await createFencedSqlRunContext(db.adapter, 'one', leaseOptions)
      const independent = await createFencedSqlRunContext(db.adapter, 'two', leaseOptions)
      const lease = await first.acquire()
      const other = await independent.acquire()
      try {
        await expect(second.acquire()).rejects.toSatisfy(isSqlOwnershipDenial)
      } finally {
        await other.release()
        await lease.release()
      }
    } finally {
      db.database.close()
    }
  })

  it(
    'shares one immutable read-only SQL inspection cut across journal, blobs and coordination',
    async () => {
      const shared = await directory()
      const rootId = 'inspection-root-node'
      const db = openSql(join(shared, 'run-context.sqlite'))
      let selects = 0
      let historyReads = 0
      let historyRows = 0
      let writes = 0
      let readOnly = false
      let appendDuringRead = false
      let writer: Awaited<ReturnType<typeof start>> | undefined
      const adapter = {
        async exec(sql: string, params?: readonly unknown[]) {
          writes += 1
          if (readOnly) throw new Error('Inspection attempted a SQL write or ownership acquisition')
          return db.adapter.exec(sql, params)
        },
        async query<Row>(sql: string, params?: readonly unknown[]) {
          selects += 1
          const history = sql.includes('FROM agent_run_records ')
          if (history) {
            historyReads += 1
            if (appendDuringRead) {
              appendDuringRead = false
              if (!writer) throw new Error('SQL writer was not started')
              writer.child.send('write')
              await writer.message('written')
              expect(await writer.exit).toEqual({ code: 0, signal: null })
            }
          }
          const rows = await db.adapter.query<Row>(sql, params)
          if (history) historyRows += rows.length
          return rows
        },
      }
      try {
        const context = await createFencedSqlRunContext(adapter, RUN_ID, leaseOptions)
        const foreign = await createFencedSqlRunContext(adapter, 'another-run', leaseOptions)
        const isolated = await createFencedSqlRunContext(adapter, RUN_ID, {
          ...leaseOptions,
          tablePrefix: 'inspection_other',
        })
        const values = Array.from({ length: 6 }, (_, index) => ({
          index,
          text: `retained-${index}`,
        }))
        const refs = values.map(contentAddress)
        const at = '2026-09-24T00:00:00.000Z'
        const rootEvent = {
          kind: 'spawned' as const,
          id: rootId,
          label: 'root',
          runtime: 'inline' as const,
          budget: { maxIterations: 5, maxTokens: 100 },
          seq: 0,
          at,
        }
        const instruction = {
          receiptId: 'inspection-receipt',
          kind: 'steer' as const,
          toWorker: 'worker',
          instruction: 'recorded instruction',
          instructionDigest: `sha256:${'a'.repeat(64)}`,
          interrupt: false,
        }
        const record = {
          seq: 0,
          at: 1000,
          priority: 0 as const,
          event: { type: 'instruction' as const, instruction },
        }
        const lease = await context.acquire()
        try {
          await lease.context.journal.beginTree(rootId, at)
          await lease.context.journal.appendEvent(rootId, rootEvent)
          for (const [index, ref] of refs.entries())
            await lease.context.blobs.put(ref, values[index])
          await lease.context.coordinationLog!.append(RUN_ID, record, 'inspection-owner')
        } finally {
          await lease.release()
        }
        const foreignValue = { origin: 'other SQL context' }
        const foreignRef = contentAddress(foreignValue)
        for (const other of [foreign, isolated]) {
          const owned = await other.acquire()
          try {
            await owned.context.journal.beginTree(rootId, at)
            await owned.context.journal.appendEvent(rootId, { ...rootEvent, label: 'foreign' })
            await owned.context.blobs.put(foreignRef, foreignValue)
            await owned.context.coordinationLog!.append(
              RUN_ID,
              {
                ...record,
                event: {
                  type: 'instruction',
                  instruction: { ...instruction, instruction: 'foreign instruction' },
                },
              },
              'inspection-owner',
            )
          } finally {
            await owned.release()
          }
        }
        readOnly = true
        writes = 0
        writer = await start(shared, await directory(), 'lease')
        await writer.message('owned')
        const pid = writer.child.pid
        if (pid === undefined) throw new Error('SQL writer has no process identity')
        const nextRef = contentAddress({ pid })
        await expect(lease.context.blobs.put(nextRef, { pid })).rejects.toSatisfy(
          isSqlOwnershipDenial,
        )

        // Real legacy ports are the RED control, with no cache or adapter substitution.
        selects = 0
        historyReads = 0
        historyRows = 0
        await context.journal.loadTree(rootId)
        await Promise.all(refs.map((ref) => context.blobs.get(ref)))
        await context.coordinationLog!.load(RUN_ID, 'inspection-owner')
        const baselineSelects = selects
        const baselineReads = historyReads
        const baselineRows = historyRows
        expect(baselineReads).toBe(refs.length + 2)
        expect(baselineSelects).toBe(2 * baselineReads)
        const before = db.database
          .prepare(
            'SELECT namespace, head, revision, generation FROM agent_run_heads WHERE run_id = ?',
          )
          .get(RUN_ID)
        if (!before) throw new Error('SQL run head is absent')
        selects = 0
        historyReads = 0
        historyRows = 0
        appendDuringRead = true
        const snapshot = context.readSnapshot ? await context.readSnapshot() : context
        expect(await snapshot.journal.loadTree(rootId)).toEqual([rootEvent])
        expect(await Promise.all(refs.map((ref) => snapshot.blobs.get(ref)))).toEqual(values)
        const prior = await snapshot.coordinationLog!.load(RUN_ID, 'inspection-owner')
        expect(prior.continuations[0]?.instruction).toBe('recorded instruction')
        console.info('SQL inspection history reads', {
          blobRefs: refs.length,
          baselineReads,
          baselineSelects,
          baselineRows,
          snapshotReads: historyReads,
          snapshotSelects: selects,
          snapshotRows: historyRows,
        })
        expect(historyReads).toBe(1)
        expect(selects).toBe(2)
        expect(historyRows).toBe(Number(before.revision))
        expect(await snapshot.blobs.get(nextRef)).toBeUndefined()
        expect(await snapshot.blobs.get(foreignRef)).toBeUndefined()
        expect(await snapshot.journal.loadTree('another-run')).toBeUndefined()
        expect((await snapshot.coordinationLog!.load('another-run')).records).toEqual([])
        expect(snapshot).toMatchObject({
          runId: RUN_ID,
          namespace: before.namespace,
          head: before.head,
          revision: Number(before.revision),
        })
        expect(Object.keys(snapshot).sort()).toEqual([
          'blobs',
          'coordinationLog',
          'head',
          'journal',
          'namespace',
          'revision',
          'runId',
        ])
        for (const port of [snapshot, snapshot.journal, snapshot.blobs, snapshot.coordinationLog])
          expect(Object.isFrozen(port)).toBe(true)
        expect(Object.keys(snapshot.journal)).toEqual(['loadTree'])
        expect(Object.keys(snapshot.blobs)).toEqual(['get'])
        expect(Object.keys(snapshot.coordinationLog!)).toEqual(['load'])
        expect(Reflect.set(snapshot, 'revision', -1)).toBe(false)
        if (!prior.continuations[0]) throw new Error('Recorded coordination instruction is absent')
        Reflect.set(prior.continuations[0], 'instruction', 'mutated reader output')
        expect(
          (await snapshot.coordinationLog!.load(RUN_ID, 'inspection-owner')).continuations[0]
            ?.instruction,
        ).toBe('recorded instruction')

        const after = db.database
          .prepare('SELECT head, revision, generation FROM agent_run_heads WHERE run_id = ?')
          .get(RUN_ID)
        expect(after?.generation).toBe(before.generation)
        expect(Number(after?.revision)).toBe(Number(before.revision) + 1)
        const fresh = context.readSnapshot ? await context.readSnapshot() : context
        expect(await fresh.blobs.get(nextRef)).toEqual({ pid })
        expect(fresh).toMatchObject({
          head: after?.head,
          revision: Number(after?.revision),
          namespace: before.namespace,
        })
        expect(historyReads).toBe(2)
        expect(await snapshot.blobs.get(nextRef)).toBeUndefined()
        expect(await context.blobs.get(nextRef)).toEqual({ pid })
        expect(historyReads).toBe(3)
        for (const other of [foreign, isolated]) {
          const cut = other.readSnapshot ? await other.readSnapshot() : other
          expect(await cut.blobs.get(refs[0]!)).toBeUndefined()
          expect(await cut.blobs.get(foreignRef)).toEqual(foreignValue)
          expect((await cut.journal.loadTree(rootId))?.[0]?.label).toBe('foreign')
          expect(
            (await cut.coordinationLog!.load(RUN_ID, 'inspection-owner')).continuations[0]
              ?.instruction,
          ).toBe('foreign instruction')
          expect(cut.namespace).not.toBe(snapshot.namespace)
        }
        expect(writes).toBe(0)
      } finally {
        db.database.close()
      }
    },
    CASE_MS,
  )

  it('rejects unsafe SQL identifiers before executing any SQL', async () => {
    const adapter = {
      exec: async () => {
        throw new Error('SQL was executed')
      },
      query: async <T>() => [] as T[],
    }
    await expect(
      createFencedSqlRunContext(adapter, 'r', {
        tablePrefix: 'x; DROP TABLE runs',
      }),
    ).rejects.toThrow(/prefix|identifier/i)
  })

  it('runs the graph with SQL as its only orchestration persistence', async () => {
    const shared = await directory()
    const host = await directory()
    assertComplete(await (await start(shared, host)).report())
    await assertPhysical(shared)
    expect(await readdir(host)).toEqual([])
  }, 45000)

  // Before/after are on opposite sides of the actual SQLite statement commit. In the after
  // cases the adapter NEVER acknowledges the write to Runtime: the process dies first.
  it.each([
    'sql:begin:before',
    'sql:begin:after',
    'sql:spawned-root:before',
    'sql:spawned-root:after',
    'sql:spawned-child:before',
    'sql:execution-input:before',
    'sql:spawned-child:after',
    'sql:execution-input:after',
    'sql:execution-admitted-intent:before',
    'sql:execution-admitted-intent:after',
    'sql:execution-admitted-environment:before',
    'sql:execution-admitted-environment:after',
    'provider:create:before',
    'provider:create:after',
    'provider:dispatch:before',
    'provider:dispatch:after',
    'sql:execution-admitted-dispatched:before',
    'sql:execution-admitted-dispatched:after',
    'sql:blob:before',
    'sql:blob:after',
    'sql:execution-result:before',
    'sql:execution-result:after',
    'sql:settled:before',
    'sql:settled:after',
    'tool:commit:before',
    'tool:commit:after',
  ])(
    'SIGKILL at %s resumes on another host without a replacement key',
    async (checkpoint) => {
      const shared = await directory()
      const firstHost = await directory()
      const secondHost = await directory()
      const first = await start(shared, firstHost, 'kill', checkpoint)
      await first.message('checkpoint')
      expect(await first.exit).toEqual({ code: null, signal: 'SIGKILL' })
      await rm(firstHost, { recursive: true, force: true })
      assertComplete(await (await start(shared, secondHost)).report())
      await assertPhysical(shared)
      expect(await readdir(secondHost)).toEqual([])
    },
    CASE_MS,
  )

  it.each(['contend', 'contend-locked'])(
    'two live orchestrators (%s): rejects the contender, then the SAME process takes over after SIGKILL',
    async (mode) => {
      const shared = await directory()
      const owner = await start(
        shared,
        await directory(),
        'hold',
        'sql:execution-admitted-dispatched:after',
      )
      await owner.message('checkpoint')
      const contender = await start(shared, await directory(), mode)
      if (mode === 'contend-locked') {
        await contender.message('claim')
        owner.child.send('lock')
        await owner.message('locked')
        contender.child.send('claim')
      }
      const denied = await contender.message('denied')
      expect(String(denied.error)).toMatch(/owned|lease|database is locked/i)
      if (mode === 'contend-locked')
        expect(denied).toMatchObject({ code: 'ERR_SQLITE_ERROR', errcode: 5 })
      owner.child.kill('SIGKILL')
      expect(await owner.exit).toEqual({ code: null, signal: 'SIGKILL' })
      contender.child.send('retry')
      assertComplete(await contender.report())
      await assertPhysical(shared)
    },
    CASE_MS,
  )
  it(
    'fences a SIGSTOP/SIGCONT owner without releasing its live successor',
    async () => {
      const shared = await directory()
      const owner = await start(shared, await directory(), 'lease')
      await owner.message('owned')
      owner.child.kill('SIGSTOP')
      const successor = await start(shared, await directory(), 'lease')
      await successor.message('owned')
      owner.child.kill('SIGCONT')
      owner.child.send('write')
      expect(String((await owner.message('fenced')).error)).toMatch(/lease|ownership/i)
      expect(await owner.exit).toEqual({ code: 0, signal: null })

      const db = openSql(join(shared, 'run-context.sqlite'))
      try {
        const observer = await createFencedSqlRunContext(db.adapter, RUN_ID, leaseOptions)
        await expect(observer.acquire()).rejects.toSatisfy(isSqlOwnershipDenial)
        successor.child.send('write')
        await successor.message('written')
        expect(await successor.exit).toEqual({ code: 0, signal: null })
        expect(await observer.blobs.get(contentAddress({ pid: owner.child.pid }))).toBeUndefined()
        expect(await observer.blobs.get(contentAddress({ pid: successor.child.pid }))).toEqual({
          pid: successor.child.pid,
        })
      } finally {
        db.database.close()
      }
    },
    CASE_MS,
  )
})
