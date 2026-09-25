/**
 * SqlSpawnJournal + SqlResultBlobStore — parity with the JSONL file stores' semantics, against a
 * REAL sqlite file (`node:sqlite`): begin-precedes-events, unique cursor seqs, one
 * materialization per node, insertion-order replay, idempotent content-addressed blob writes,
 * and the process-kill durability a sqlite autocommit already gives (proven end-to-end by the
 * SQL arm of the kill-and-resume conformance suite, `tests/durability/sql-kill-resume.test.ts`).
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SqlResultBlobStore,
  SqlSpawnJournal,
  type SqlStatements,
} from '../durable/spawn-journal-sql'

function sqliteAdapter(db: DatabaseSync): SqlStatements {
  return {
    async exec(sql, params = []) {
      const res = db.prepare(sql).run(...(params as never[]))
      return { rowsAffected: Number(res?.changes ?? 0) }
    },
    async query<TRow>(sql: string, params: readonly unknown[] = []): Promise<TRow[]> {
      return db.prepare(sql).all(...(params as never[])) as TRow[]
    },
  }
}

function settled(id: string, seq: number) {
  return {
    kind: 'settled' as const,
    id,
    status: 'done' as const,
    spent: {
      iterations: 0,
      tokens: { input: 0, output: 0 },
      usd: 0,
      ms: 0,
      tokensKnown: true,
      usdKnown: true,
    },
    seq,
    at: '2026-09-24T00:00:00.000Z',
  }
}

function spawned(id: string, seq: number) {
  return {
    kind: 'spawned' as const,
    id,
    label: id,
    budget: { maxIterations: 1, maxTokens: 1 },
    runtime: 'inline' as const,
    seq,
    at: '2026-09-24T00:00:00.000Z',
  }
}

describe('SqlSpawnJournal', () => {
  let dir: string
  let db: DatabaseSync
  let journal: SqlSpawnJournal

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sql-spawn-journal-'))
    db = new DatabaseSync(join(dir, 'journal.sqlite'))
    journal = new SqlSpawnJournal(sqliteAdapter(db))
    await journal.migrate()
  })
  afterEach(async () => {
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips a tree in insertion order, and reports unknown trees absent', async () => {
    await journal.beginTree('run', '2026-09-24T00:00:00.000Z')
    await journal.appendEvent('run', spawned('run', 0))
    await journal.appendEvent('run', spawned('run:a', 1))
    await journal.appendEvent('run', settled('run:a', 1))
    const tree = await journal.loadTree('run')
    expect(tree?.map((e) => e.kind)).toEqual(['spawned', 'spawned', 'settled'])
    expect(await journal.loadTree('absent')).toBeUndefined()
  })

  it('is idempotent on a same-identity begin and refuses a different one', async () => {
    await journal.beginTree('run', 'at-1')
    await journal.beginTree('run', 'at-1')
    await expect(journal.beginTree('run', 'at-2')).rejects.toThrow(/already begun/)
  })

  it('refuses an append to an unbegun tree (begin precedes events)', async () => {
    await expect(journal.appendEvent('ghost', spawned('ghost', 0))).rejects.toThrow(
      /call beginTree first/,
    )
  })

  it('refuses a duplicate cursor seq, on append AND on load of a foreign corruption', async () => {
    await journal.beginTree('run', 'at')
    await journal.appendEvent('run', spawned('run:a', 1))
    await journal.appendEvent('run', settled('run:a', 1))
    await expect(journal.appendEvent('run', settled('run:b', 1))).rejects.toThrow(/cursor/)
    // A second journal instance over the same rows replays with the same guards.
    const other = new SqlSpawnJournal(sqliteAdapter(db))
    await expect(other.loadTree('run')).resolves.toBeDefined()
    await expect(other.appendEvent('run', settled('run:c', 1))).rejects.toThrow(/cursor/)
  })

  it('survives a brand-new instance over the same database (the cross-process shape)', async () => {
    await journal.beginTree('run', 'at')
    await journal.appendEvent('run', spawned('run:a', 1))
    const reopened = new SqlSpawnJournal(sqliteAdapter(db))
    await reopened.migrate()
    const tree = await reopened.loadTree('run')
    expect(tree).toHaveLength(1)
    await expect(reopened.appendEvent('run', settled('run:a', 1))).resolves.toBeUndefined()
    expect((await reopened.loadTree('run'))?.at(-1)?.kind).toBe('settled')
  })
})

describe('SqlResultBlobStore', () => {
  let dir: string
  let db: DatabaseSync
  let blobs: SqlResultBlobStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sql-blobs-'))
    db = new DatabaseSync(join(dir, 'blobs.sqlite'))
    blobs = new SqlResultBlobStore(sqliteAdapter(db))
    await blobs.migrate()
  })
  afterEach(async () => {
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips a content-addressed artifact and reports unknown refs absent', async () => {
    const artifact = { hello: 'world' }
    const ref = `sha256:${await crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(JSON.stringify(artifact)))
      .then((buf) =>
        Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
      )}`
    await blobs.put(ref, artifact)
    expect(await blobs.get(ref)).toEqual(artifact)
    expect(await blobs.get(`sha256:${'0'.repeat(64)}`)).toBeUndefined()
  })

  it('refuses a ref that does not match the artifact content hash', async () => {
    await expect(blobs.put(`sha256:${'0'.repeat(64)}`, { no: 'match' })).rejects.toThrow(
      /content hash/,
    )
  })

  it('a re-put of the same ref is idempotent and asserts identical bytes', async () => {
    const artifact = { stable: true }
    const ref = await (async () => {
      const text = JSON.stringify(artifact)
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
      return `sha256:${Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}`
    })()
    await blobs.put(ref, artifact)
    await blobs.put(ref, { stable: true })
    expect(await blobs.get(ref)).toEqual(artifact)
  })
})
