import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openSqlRunStore } from '../../src/durable/sql-run-store'
import { openSql } from '../helpers/durability/sql-adapter'

const directories: string[] = []
const policy = { leaseMs: 400, heartbeatMs: 60 }
async function databasePath() {
  const directory = await mkdtemp(join(tmpdir(), 'sql-store-'))
  directories.push(directory)
  return join(directory, 'run.sqlite')
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('SQL publication and fencing', () => {
  it('recovers a committed publication whose acknowledgement was lost, exactly once', async () => {
    let lost = false
    const db = openSql(await databasePath(), (when, sql) => {
      if (when === 'after' && sql.includes(' SET head =') && !lost) {
        lost = true
        throw new Error('connection lost after COMMIT')
      }
    })
    try {
      const store = await openSqlRunStore(db.adapter, 'run', policy)
      const lease = await store.acquire()
      await lease.append({ step: 1 })
      await lease.release()
      const resumed = await openSqlRunStore(db.adapter, 'run', policy)
      expect(await resumed.read()).toEqual([{ step: 1 }])
      expect(resumed.namespace).toBe(store.namespace)
    } finally {
      db.database.close()
    }
  })

  it('never replays a staged record that was not published', async () => {
    let failed = false
    const db = openSql(await databasePath(), (when, sql) => {
      if (when === 'before' && sql.includes(' SET head =') && !failed) {
        failed = true
        throw new Error('connection lost before publication')
      }
    })
    try {
      const store = await openSqlRunStore(db.adapter, 'run', policy)
      const first = await store.acquire()
      await expect(first.append({ orphan: true })).rejects.toThrow('before publication')
      expect(first.signal.aborted).toBe(true)
      await first.release()
      expect(await store.read()).toEqual([])
      const second = await store.acquire()
      await second.append({ committed: true })
      await second.release()
      expect(await store.read()).toEqual([{ committed: true }])
      expect(db.database.prepare('SELECT COUNT(*) AS n FROM agent_run_records').get()?.n).toBe(2)
    } finally {
      db.database.close()
    }
  })

  it('fences a stale publisher on the SAME row that changed ownership, and cannot release the successor', async () => {
    const path = await databasePath()
    const successor = openSql(path)
    let steal = false
    const original = openSql(path, async (when, sql) => {
      if (steal && when === 'after' && sql.startsWith('INSERT INTO agent_run_records')) {
        steal = false
        // The hard interleaving: staging used the old owner; another connection wins the
        // ownership row BEFORE publication. INSERT ... SELECT owner alone does not fence this.
        await successor.adapter.exec(
          "UPDATE agent_run_heads SET owner = 'successor', generation = generation + 1, pulse = pulse + 1 WHERE run_id = 'run'",
        )
      }
    })
    try {
      const store = await openSqlRunStore(original.adapter, 'run', policy)
      const lease = await store.acquire()
      steal = true
      await expect(lease.append({ forbidden: true })).rejects.toThrow(/lease|ownership/)
      expect(lease.signal.aborted).toBe(true)
      expect(await store.read()).toEqual([])
      await lease.release()
      expect(successor.database.prepare('SELECT owner FROM agent_run_heads').get()?.owner).toBe(
        'successor',
      )
    } finally {
      original.database.close()
      successor.database.close()
    }
  })

  it('does not change the shared lease policy or namespace on another host', async () => {
    const db = openSql(await databasePath())
    try {
      const first = await openSqlRunStore(db.adapter, 'run', policy)
      const second = await openSqlRunStore(db.adapter, 'run', policy)
      expect(second.namespace).toBe(first.namespace)
      await expect(openSqlRunStore(db.adapter, 'run', { ...policy, leaseMs: 800 })).rejects.toThrow(
        /lease configuration differs/,
      )
      const other = await openSqlRunStore(db.adapter, 'other', policy)
      expect(other.namespace).not.toBe(first.namespace)
    } finally {
      db.database.close()
    }
  })

  it('serializes concurrent appends with constant SQL work and no history reads', async () => {
    let writes = 0
    let reads = 0
    const db = openSql(await databasePath(), (when, sql) => {
      if (
        when === 'before' &&
        (sql.startsWith('INSERT INTO agent_run_records') || sql.includes(' SET head ='))
      )
        writes += 1
    })
    const adapter = {
      exec: db.adapter.exec,
      async query<Row>(sql: string, params?: readonly unknown[]) {
        reads += 1
        return db.adapter.query<Row>(sql, params)
      },
    }
    try {
      const store = await openSqlRunStore(adapter, 'run', { leaseMs: 30000, heartbeatMs: 10000 })
      const lease = await store.acquire()
      reads = 0
      const values = Array.from({ length: 100 }, (_, step) => ({ step, payload: 'x'.repeat(128) }))
      await Promise.all(values.map((value) => lease.append(value)))
      expect(writes).toBe(200)
      expect(reads).toBe(0)
      expect(lease.records).toEqual(values)
      await lease.release()
      expect(await store.read()).toEqual(values)
    } finally {
      db.database.close()
    }
  })
})
