/** Tests committed before implementation. Run against real SQLite, including competing OS processes. */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { contentAddress } from '../../src/durable/content-address'
import { createSqlRunContext } from '../../src/runtime/supervise/sql-run-context'
import type { SpawnEvent } from '../../src/runtime/supervise/types'
import { openSqlite } from '../helpers/durability/sqlite-adapter'

const childScript = new URL('../helpers/durability/sql-context-child.ts', import.meta.url).pathname
const at = '2026-09-24T00:00:00.000Z'
const root = { kind: 'spawned', id: 'run', label: 'root', runtime: 'router', budget: { maxIterations: 20 }, at } as SpawnEvent
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('SQL run context: atomic records, fencing and cross-process takeover', () => {
  let dir: string
  const children = new Set<ChildProcess>()
  const cleanups: Array<() => Promise<void> | void> = []
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'sql-run-context-')) })
  afterEach(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGCONT')
        child.kill('SIGKILL')
        await new Promise<void>((resolve) => child.once('close', () => resolve()))
      }
    }
    children.clear()
    for (const cleanup of cleanups.reverse()) await cleanup()
    cleanups.length = 0
    await rm(dir, { recursive: true, force: true })
  })

  function connect() {
    const connection = openSqlite(join(dir, 'context.sqlite'))
    cleanups.push(connection.close)
    return connection.db
  }

  function processFor(mode: string) {
    const child = spawn(process.execPath, ['--import', 'tsx', childScript, join(dir, 'context.sqlite'), mode], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    children.add(child)
    let stderr = ''
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    const messages: unknown[] = []
    const waiters: Array<(value: unknown) => void> = []
    child.on('message', (message) => {
      const waiter = waiters.shift()
      if (waiter) waiter(message)
      else messages.push(message)
    })
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => resolve({ code, signal }))
    })
    return {
      child, exit, stderr: () => stderr,
      next: () => messages.length ? Promise.resolve(messages.shift()) : new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`child IPC timeout: ${stderr}`)), 15_000)
        waiters.push((message) => { clearTimeout(timer); resolve(message) })
      }),
    }
  }

  it('reopens all acknowledged events and content-addressed blobs on an independent connection', async () => {
    const db = connect()
    const first = await createSqlRunContext(db, { runId: 'run' })
    await first.journal.beginTree('run', at)
    await first.journal.appendEvent('run', root)
    const artifact = { answer: 42 }
    const ref = contentAddress(artifact)
    await first.blobs.put(ref, artifact)
    await first.close()
    const second = await createSqlRunContext(connect(), { runId: 'run' })
    cleanups.push(() => second.close())
    expect(await second.journal.loadTree('run')).toEqual([root])
    expect(await second.blobs.get(ref)).toEqual(artifact)
    expect(second.resume).toBe(true)
  })

  it('retries an acknowledged append without duplicating it, but refuses conflicting records', async () => {
    const context = await createSqlRunContext(connect(), { runId: 'run' })
    cleanups.push(() => context.close())
    await context.journal.beginTree('run', at)
    await context.journal.appendEvent('run', root)
    await context.journal.appendEvent('run', structuredClone(root))
    expect(await context.journal.loadTree('run')).toEqual([root])
    await expect(context.journal.appendEvent('run', { ...root, label: 'conflict' } as SpawnEvent)).rejects.toThrow()
    await expect(context.journal.beginTree('run', '2026-09-25T00:00:00.000Z')).rejects.toThrow()
  })

  it('rejects a forged blob and an append before beginTree', async () => {
    const context = await createSqlRunContext(connect(), { runId: 'run' })
    cleanups.push(() => context.close())
    await expect(context.blobs.put(contentAddress({ answer: 41 }), { answer: 42 })).rejects.toThrow()
    await expect(context.journal.appendEvent('missing', root)).rejects.toThrow()
  })

  it('two live processes cannot both own a run; SIGKILL permits takeover', { timeout: 30_000 }, async () => {
    const owner = processFor('hold')
    expect(await owner.next()).toEqual({ kind: 'ready' })
    const contender = processFor('attempt')
    expect(await contender.next()).toMatchObject({ kind: 'busy' })
    expect((await contender.exit).code, contender.stderr()).toBe(0)
    owner.child.kill('SIGKILL')
    expect((await owner.exit).signal).toBe('SIGKILL')
    await delay(2200)
    const successor = processFor('attempt')
    expect(await successor.next()).toEqual({ kind: 'acquired' })
    expect((await successor.exit).code, successor.stderr()).toBe(0)
  })

  it('fences a stopped owner after takeover, even when that process later wakes', { timeout: 30_000 }, async () => {
    const owner = processFor('hold')
    expect(await owner.next()).toEqual({ kind: 'ready' })
    owner.child.kill('SIGSTOP')
    await delay(2200)
    const successor = processFor('hold')
    expect(await successor.next()).toEqual({ kind: 'ready' })
    owner.child.kill('SIGCONT')
    owner.child.send({ kind: 'append' })
    expect(await owner.next()).toMatchObject({ kind: 'fenced' })
    successor.child.send({ kind: 'close' })
    expect((await successor.exit).code, successor.stderr()).toBe(0)
  })
})
