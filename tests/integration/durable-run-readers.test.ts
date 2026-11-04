import { appendFile, copyFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readRunState, readSpawnJournal } from '../../src/durable'
import { acquireRunDirectoryLock, runDirectoryHolderIsLive } from '../../src/durable/run-lock'
import { writeFailureRecord, writeSettleRecord } from '../../src/durable/settle-record'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { cancelRun } from '../../src/runtime/supervise/run-cancellation'
import type { SpawnEvent } from '../../src/runtime/supervise/types'

let runDir: string
let path: string
const at = '2026-09-07T00:00:00.000Z'
const begin = { kind: 'begin', root: 'root', at }
const spawned = (id: string, parent = 'root'): Extract<SpawnEvent, { kind: 'spawned' }> => ({
  kind: 'spawned',
  id,
  parent,
  label: id,
  runtime: 'cli',
  budget: { maxIterations: 1, maxTokens: 10 },
  seq: 0,
  at,
})
const line = (record: unknown) => `${JSON.stringify(record)}\n`
beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'durable-readers-'))
  path = join(runDir, 'spawn-journal.jsonl')
})
afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

describe('public committed spawn journal reads', () => {
  it('expands atomic groups, preserves owning roots, and resumes real file appends', async () => {
    const journal = new FileSpawnJournal(path)
    await journal.beginTree('root', at)
    await journal.appendEvents('root', [spawned('one'), spawned('two')])
    await journal.beginTree('nested', at)
    await journal.appendEvent('nested', spawned('three', 'nested'))
    const first = await readSpawnJournal(runDir)
    expect(first).toMatchObject({ reset: false, truncated: false, remainingBytes: 0 })
    expect(first.records).toEqual([
      begin,
      ...['one', 'two'].map((id) => ({ kind: 'event', root: 'root', event: spawned(id) })),
      { ...begin, root: 'nested' },
      { kind: 'event', root: 'nested', event: spawned('three', 'nested') },
    ])
    expect((await readSpawnJournal(runDir, { after: first.cursor })).records).toEqual([])
    await journal.appendEvent('root', spawned('four'))
    const next = await readSpawnJournal(runDir, { after: JSON.parse(JSON.stringify(first.cursor)) })
    expect(next.records).toEqual([{ kind: 'event', root: 'root', event: spawned('four') }])
    expect(next.reset).toBe(false)
  })

  it('keeps torn UTF-8 bytes unread and accepts historical complete unterminated records', async () => {
    const event = { kind: 'event', root: 'root', event: spawned('🙂') }
    const encoded = Buffer.from(line(event))
    const cut = encoded.indexOf(Buffer.from('🙂')) + 2
    await writeFile(path, Buffer.concat([Buffer.from(line(begin)), encoded.subarray(0, cut)]))
    const partial = await readSpawnJournal(runDir)
    expect(partial.records).toEqual([begin])
    expect(partial.cursor?.offset).toBe(Buffer.byteLength(line(begin)))
    expect(partial.remainingBytes).toBe(cut)
    await appendFile(path, encoded.subarray(cut, encoded.length - 1))
    const complete = await readSpawnJournal(runDir, { after: partial.cursor })
    expect(complete.records).toEqual([event])
    expect(complete.remainingBytes).toBe(0)
    await appendFile(path, '\n')
    expect((await readSpawnJournal(runDir, { after: complete.cursor })).records).toEqual([])
  })

  it('reports opening/tail omissions, completes large crossing records, and pages incrementally', async () => {
    const events = Array.from({ length: 20 }, (_, index) => ({
      kind: 'event',
      root: 'root',
      event: spawned(`worker-${index}`),
    }))
    events[19]!.event = { ...spawned('large'), label: '🙂'.repeat(70_000) }
    await writeFile(path, line(begin) + events.map(line).join(''))
    const tail = await readSpawnJournal(runDir, { tailBytes: 100 })
    expect(tail.records).toEqual([begin, events[19]])
    expect(tail).toMatchObject({ truncated: true, remainingBytes: 0 })
    expect(tail.cursor?.offset).toBe((await readFile(path)).length)
    const complete = await readFile(path)
    await appendFile(path, `{"kind":"event","root":"root","event":{"label":"${'x'.repeat(100_000)}`)
    const torn = await readSpawnJournal(runDir, { tailBytes: 100 })
    expect(torn.records).toEqual([begin, events[19]])
    expect(torn.remainingBytes).toBeGreaterThan(100_000)
    await writeFile(path, complete)
    const first = await readSpawnJournal(runDir)
    await appendFile(path, events.slice(0, 3).map(line).join(''))
    const page = await readSpawnJournal(runDir, { after: first.cursor, tailBytes: 1 })
    expect(page.records).toEqual([events[0]])
    expect(page.remainingBytes).toBeGreaterThan(0)
    const rest = await readSpawnJournal(runDir, { after: page.cursor })
    expect(rest.records).toEqual(events.slice(1, 3))
  })

  it('resets on truncation, replacement and same-inode boundary edits', async () => {
    await writeFile(
      path,
      line(begin) + line({ kind: 'event', root: 'root', event: spawned('one') }),
    )
    const first = await readSpawnJournal(runDir)
    await writeFile(path, line(begin))
    expect(await readSpawnJournal(runDir, { after: first.cursor })).toMatchObject({
      reset: true,
      records: [begin],
    })
    const short = await readSpawnJournal(runDir)
    await writeFile(join(runDir, 'replacement'), line({ ...begin, root: 'next' }))
    await rename(join(runDir, 'replacement'), path)
    expect(await readSpawnJournal(runDir, { after: short.cursor })).toMatchObject({ reset: true })
    const rotated = await readSpawnJournal(runDir)
    await writeFile(path, line({ ...begin, root: 'last' }))
    expect(await readSpawnJournal(runDir, { after: rotated.cursor })).toMatchObject({ reset: true })
    await rm(path)
    expect(await readSpawnJournal(runDir, { after: rotated.cursor })).toEqual({
      records: [],
      reset: true,
      truncated: false,
      remainingBytes: 0,
    })
  })

  it('refuses malformed committed JSON or UTF-8 and reads a retained historical journal', async () => {
    await writeFile(path, `${line(begin)}BAD\n`)
    await expect(readSpawnJournal(runDir)).rejects.toThrow('malformed JSONL')
    await writeFile(path, Buffer.concat([Buffer.from(line(begin)), Buffer.from([0xff, 10])]))
    await expect(readSpawnJournal(runDir)).rejects.toThrow('malformed UTF-8')
    await copyFile(
      join(import.meta.dirname, '../fixtures/durable/supervised-nested-turns/spawn-journal.jsonl'),
      path,
    )
    const retained = await readSpawnJournal(runDir)
    const root = retained.records.find((record) => record.kind === 'begin')!.root
    const events = retained.records.flatMap((record) =>
      record.kind === 'event' && record.root === root ? [record.event] : [],
    )
    expect(events).toEqual(await new FileSpawnJournal(path).loadTree(root))
  })
})

describe('public Runtime run state from durable evidence', () => {
  it('distinguishes absent evidence, a real held run, and a released run without mtime guesses', async () => {
    expect(await readRunState(join(runDir, 'absent'))).toBeUndefined()
    expect(await readRunState(runDir)).toBeUndefined()
    const lock = await acquireRunDirectoryLock(runDir, 'root', () => Date.parse(at))
    try {
      await new FileSpawnJournal(path).beginTree('root', at)
      expect(await readRunState(runDir)).toEqual({
        phase: 'running',
        holderLive: true,
        lastActivityAt: at,
      })
    } finally {
      await lock.release()
    }
    expect(await readRunState(runDir)).toEqual({
      phase: 'down',
      holderLive: false,
      lastActivityAt: at,
    })
  })

  it('keeps older/remote holder liveness unknown without weakening exclusion', async () => {
    await writeFile(
      join(runDir, 'supervise.lock'),
      JSON.stringify({ pid: process.pid, runId: 'root', startedAt: at }),
    )
    expect(await runDirectoryHolderIsLive(runDir)).toMatchObject({ live: true, unknown: true })
    expect(await readRunState(runDir)).toEqual({ lastActivityAt: at })
    await expect(acquireRunDirectoryLock(runDir, 'contender')).rejects.toThrow('held by pid')
  })

  it('composes parking, cancellation, settlement and typed root failure with explicit precedence', async () => {
    await writeFile(
      join(runDir, 'parking.json'),
      JSON.stringify({
        status: 'parked',
        runId: 'root',
        reason: 'seat-wait',
        since: at,
        wakeAt: '2026-09-08T00:00:00.000Z',
      }),
    )
    expect(await readRunState(runDir)).toMatchObject({ phase: 'parked', lastActivityAt: at })
    await writeFailureRecord(runDir, {
      runId: 'root',
      pursuitId: 'pursuit',
      at,
      error: { name: 'ProviderFailure', message: 'legacy untyped failure' },
    })
    expect((await readRunState(runDir))?.failureCode).toBeUndefined()
    cancelRun(runDir, 'cancel', { operator: 'integration', reason: 'stop' })
    expect(await readRunState(runDir)).toMatchObject({
      phase: 'cancelling',
      cancelRequest: { operationId: 'cancel' },
    })
    const settle = {
      kind: 'no-winner',
      tree: {
        root: 'root',
        nodes: [{ id: 'root', failure: { code: 'transport', owner: 'provider' } }],
      },
    }
    await writeSettleRecord(runDir, settle)
    expect(await readRunState(runDir)).toMatchObject({
      phase: 'settled',
      failureCode: 'transport',
      settle,
    })
  })

  it('tolerates older settlements without node timing and does not hide corrupt owned records', async () => {
    await writeSettleRecord(runDir, { kind: 'winner', tree: { root: 'root' } })
    expect(await readRunState(runDir)).toEqual({
      phase: 'settled',
      holderLive: false,
      settle: { kind: 'winner', tree: { root: 'root' } },
    })
    await writeFile(join(runDir, 'failure.json'), 'BROKEN')
    await expect(readRunState(runDir)).rejects.toThrow('not valid JSON')
  })
})
