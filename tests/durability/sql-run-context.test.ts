import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { contentAddress } from '../../src/durable/content-address'
import { createFencedSqlRunContext } from '../../src/runtime/supervise/sql-run-context'
import { EXPECTED_OUT, RUN_ID, WORKER_NODES } from '../helpers/durability/conformance-graph'
import { openSql } from '../helpers/durability/sql-adapter'

const roots: string[] = []
const children = new Set<ChildProcess>()
const leaseOptions = { leaseMs: 400, heartbeatMs: 60 }
const childFile = fileURLToPath(
  new URL('../helpers/durability/sql-run-context-child.ts', import.meta.url),
)
const tsx = createRequire(import.meta.url).resolve('tsx')
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'sql-run-context-'))
  roots.push(path)
  return path
}

afterEach(async () => {
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
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function start(shared: string, cwd: string, mode = 'run', checkpoint = '') {
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
          timer = setTimeout(() => reject(new Error(`child timed out: ${stderr}`)), 30000)
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
        workerRecords: Array<{ label: string; spawns: number; settlements: number }>
      }
    },
  }
}

function assertComplete(report: Awaited<ReturnType<ReturnType<typeof start>['report']>>) {
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
        expect(await resumed.context.blobs.get(ref)).toEqual({ value: ['recorded'] })
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
        await expect(second.acquire()).rejects.toThrow(/owned|lease|busy/i)
      } finally {
        await other.release()
        await lease.release()
      }
    } finally {
      db.database.close()
    }
  })

  it('rejects unsafe SQL identifiers before executing any SQL', async () => {
    const adapter = {
      exec: async () => {
        throw new Error('SQL was executed')
      },
      query: async <T>() => [] as T[],
    }
    await expect(
      createFencedSqlRunContext(adapter, 'r', { tablePrefix: 'x; DROP TABLE runs' }),
    ).rejects.toThrow(/prefix|identifier/i)
  })

  it('runs the graph with SQL as its only orchestration persistence', async () => {
    const shared = await directory()
    const host = await directory()
    assertComplete(await start(shared, host).report())
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
      const first = start(shared, firstHost, 'kill', checkpoint)
      await first.message('checkpoint')
      expect(await first.exit).toEqual({ code: null, signal: 'SIGKILL' })
      await rm(firstHost, { recursive: true, force: true })
      assertComplete(await start(shared, secondHost).report())
      expect(await readdir(secondHost)).toEqual([])
    },
    60000,
  )

  it('two live orchestrators: rejects the contender, then the SAME process takes over after SIGKILL', async () => {
    const shared = await directory()
    const owner = start(
      shared,
      await directory(),
      'hold',
      'sql:execution-admitted-dispatched:after',
    )
    await owner.message('checkpoint')
    const contender = start(shared, await directory(), 'contend')
    const denied = await contender.message('denied')
    expect(String(denied.error)).toMatch(/owned|lease|busy/i)
    owner.child.kill('SIGKILL')
    expect(await owner.exit).toEqual({ code: null, signal: 'SIGKILL' })
    contender.child.send('retry')
    assertComplete(await contender.report())
  }, 60000)
  it('fences a SIGSTOP/SIGCONT owner without releasing its live successor', async () => {
    const shared = await directory()
    const owner = start(shared, await directory(), 'lease')
    await owner.message('owned')
    owner.child.kill('SIGSTOP')
    const successor = start(shared, await directory(), 'lease')
    await successor.message('owned')
    owner.child.kill('SIGCONT')
    owner.child.send('write')
    expect(String((await owner.message('fenced')).error)).toMatch(/lease|ownership/i)
    expect(await owner.exit).toEqual({ code: 0, signal: null })

    const db = openSql(join(shared, 'run-context.sqlite'))
    try {
      const observer = await createFencedSqlRunContext(db.adapter, RUN_ID, leaseOptions)
      await expect(observer.acquire()).rejects.toThrow(/owned|lease|busy/i)
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
  }, 60000)
})
