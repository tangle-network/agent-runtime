import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DelegationPersistenceError,
  DelegationStateCorruptError,
  FileDelegationStore,
  InMemoryDelegationStore,
} from '../../src/mcp/delegation-store'
import type { DelegationRecord } from '../../src/mcp/task-queue'

function makeRecord(taskId: string, overrides: Partial<DelegationRecord> = {}): DelegationRecord {
  return {
    taskId,
    profile: 'coder',
    args: { goal: 'fix bug', repoRoot: '/repo' },
    status: 'completed',
    startedAt: new Date(1700000000000).toISOString(),
    completedAt: new Date(1700000001000).toISOString(),
    feedback: [],
    ...overrides,
  }
}

describe('InMemoryDelegationStore', () => {
  it('round-trips records and isolates them from caller mutation', async () => {
    const store = new InMemoryDelegationStore()
    const record = makeRecord('dlg-1')
    await store.upsert(record)
    record.status = 'failed'
    const loaded = await store.loadAll()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.status).toBe('completed')
  })

  it('resolves idempotency keys and removes records', async () => {
    const store = new InMemoryDelegationStore()
    await store.upsert(makeRecord('dlg-1', { idempotencyKey: 'k-1' }))
    await store.upsert(makeRecord('dlg-2'))
    expect(await store.lookupIdempotencyKey('k-1')).toBe('dlg-1')
    expect(await store.lookupIdempotencyKey('k-missing')).toBeUndefined()
    await store.remove(['dlg-1'])
    expect(await store.loadAll()).toHaveLength(1)
    expect(await store.lookupIdempotencyKey('k-1')).toBeUndefined()
  })
})

describe('FileDelegationStore', () => {
  let dir: string
  let filePath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dlg-store-'))
    filePath = join(dir, 'state', 'delegations.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('treats a missing file as an empty store', async () => {
    const store = new FileDelegationStore({ filePath })
    expect(await store.loadAll()).toEqual([])
  })

  it('throws DelegationPersistenceError when written before loadAll', async () => {
    const store = new FileDelegationStore({ filePath })
    await expect(store.upsert(makeRecord('dlg-1'))).rejects.toBeInstanceOf(
      DelegationPersistenceError,
    )
  })

  it('persists upserts across instances and leaves no tmp files behind', async () => {
    const store = new FileDelegationStore({ filePath })
    await store.loadAll()
    await store.upsert(makeRecord('dlg-1', { idempotencyKey: 'k-1' }))
    await store.upsert(makeRecord('dlg-2', { status: 'failed' }))

    const reopened = new FileDelegationStore({ filePath })
    const loaded = await reopened.loadAll()
    expect(loaded.map((r) => r.taskId).sort()).toEqual(['dlg-1', 'dlg-2'])
    expect(loaded.find((r) => r.taskId === 'dlg-2')?.status).toBe('failed')
    expect(await reopened.lookupIdempotencyKey('k-1')).toBe('dlg-1')

    const entries = await readdir(join(dir, 'state'))
    expect(entries).toEqual(['delegations.json'])
  })

  it('serializes concurrent upserts into one parseable snapshot', async () => {
    const store = new FileDelegationStore({ filePath })
    await store.loadAll()
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.upsert(makeRecord(`dlg-${i}`))))
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as { version: number; records: unknown[] }
    expect(parsed.version).toBe(1)
    expect(parsed.records).toHaveLength(20)
    const entries = await readdir(join(dir, 'state'))
    expect(entries).toEqual(['delegations.json'])
  })

  it('persists removals across instances', async () => {
    const store = new FileDelegationStore({ filePath })
    await store.loadAll()
    await store.upsert(makeRecord('dlg-1'))
    await store.upsert(makeRecord('dlg-2'))
    await store.remove(['dlg-1'])

    const reopened = new FileDelegationStore({ filePath })
    expect((await reopened.loadAll()).map((r) => r.taskId)).toEqual(['dlg-2'])
  })

  it('fails loud with DelegationStateCorruptError on unparseable state', async () => {
    const path = join(dir, 'delegations.json')
    await writeFile(path, 'not json {', 'utf8')
    const store = new FileDelegationStore({ filePath: path })
    await expect(store.loadAll()).rejects.toBeInstanceOf(DelegationStateCorruptError)
    // The corrupt file is left in place for inspection — never clobbered.
    expect(await readFile(path, 'utf8')).toBe('not json {')
  })

  it('fails loud on structurally-wrong JSON (valid JSON, wrong shape)', async () => {
    const path = join(dir, 'delegations.json')
    await writeFile(path, JSON.stringify({ version: 99, records: [] }), 'utf8')
    const store = new FileDelegationStore({ filePath: path })
    await expect(store.loadAll()).rejects.toBeInstanceOf(DelegationStateCorruptError)

    await writeFile(path, JSON.stringify({ version: 1, records: [{ nope: true }] }), 'utf8')
    const fresh = new FileDelegationStore({ filePath: path })
    await expect(fresh.loadAll()).rejects.toBeInstanceOf(DelegationStateCorruptError)
  })

  it('recoverCorrupt archives the corrupt file and starts empty', async () => {
    const path = join(dir, 'delegations.json')
    await writeFile(path, 'garbage!!', 'utf8')
    const store = new FileDelegationStore({ filePath: path, recoverCorrupt: true })
    expect(await store.loadAll()).toEqual([])

    const entries = await readdir(dir)
    const archive = entries.find((name) => name.startsWith('delegations.json.corrupt-'))
    expect(archive).toBeDefined()
    expect(await readFile(join(dir, archive as string), 'utf8')).toBe('garbage!!')

    await store.upsert(makeRecord('dlg-1'))
    const reopened = new FileDelegationStore({ filePath: path })
    expect((await reopened.loadAll()).map((r) => r.taskId)).toEqual(['dlg-1'])
  })
})
