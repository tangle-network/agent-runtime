/**
 * SqlConversationJournal — exercises the journal end-to-end against a
 * fake-but-honest SqlAdapter that interprets the exact statements the
 * journal issues. We do not use sqlite/D1/postgres in unit tests; integrating
 * with a real driver is the consumer's job (and is documented in
 * docs/durability-adapters.md). What unit tests need to prove:
 *
 *  - migrate() is idempotent and creates both tables
 *  - beginRun is idempotent for matching startedAt, rejects on mismatch
 *  - appendTurn writes deterministic rows + rejects on halted/unknown runs
 *  - recordHalt persists the halt reason, endedAt
 *  - loadRun replays turns in turn_index order with the halt + timestamps
 *
 * The fake adapter is intentionally minimal — it implements the exact SQL
 * shapes the journal produces, with parameterised placeholders. If the
 * journal's queries ever drift, these tests break loudly, which is the
 * point.
 */
import { describe, expect, it } from 'vitest'

import { type SqlAdapter, SqlConversationJournal } from './journal-sql'
import type { ConversationTurn, HaltReason } from './types'

interface FakeRunRow {
  run_id: string
  started_at: string
  halted_kind: string | null
  halted_payload: string | null
  ended_at: string | null
}
interface FakeTurnRow {
  run_id: string
  turn_index: number
  payload: string
}

/**
 * In-process adapter that recognises the journal's six statements. Returns
 * `{ rowsAffected }` for writes and `T[]` for reads. Asserts on unrecognised
 * SQL — tests should fail loudly if the journal silently changes shape.
 */
function makeFakeAdapter(): SqlAdapter & {
  runs: Map<string, FakeRunRow>
  turns: FakeTurnRow[]
  execCalls: { sql: string; params: readonly unknown[] }[]
} {
  const runs = new Map<string, FakeRunRow>()
  const turns: FakeTurnRow[] = []
  const execCalls: { sql: string; params: readonly unknown[] }[] = []

  return {
    runs,
    turns,
    execCalls,
    async exec(sql, params = []) {
      execCalls.push({ sql, params })
      const s = sql.trim()
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) {
        return { rowsAffected: 0 }
      }
      if (s.startsWith('INSERT INTO') && s.includes('_runs')) {
        const [runId, startedAt] = params as [string, string]
        if (runs.has(runId)) return { rowsAffected: 0 }
        runs.set(runId, {
          run_id: runId,
          started_at: startedAt,
          halted_kind: null,
          halted_payload: null,
          ended_at: null,
        })
        return { rowsAffected: 1 }
      }
      if (s.startsWith('INSERT INTO') && s.includes('_turns')) {
        const [runId, turnIndex, payload] = params as [string, number, string]
        turns.push({ run_id: runId, turn_index: turnIndex, payload })
        return { rowsAffected: 1 }
      }
      if (s.startsWith('UPDATE') && s.includes('_runs')) {
        const [haltKind, haltPayload, endedAt, runId] = params as [string, string, string, string]
        const row = runs.get(runId)
        if (!row) return { rowsAffected: 0 }
        row.halted_kind = haltKind
        row.halted_payload = haltPayload
        row.ended_at = endedAt
        return { rowsAffected: 1 }
      }
      throw new Error(`unrecognised exec SQL: ${s}`)
    },
    async query<TRow>(sql: string, params: readonly unknown[] = []): Promise<TRow[]> {
      const s = sql.trim()
      if (s.startsWith('SELECT run_id') && s.includes('_runs WHERE run_id')) {
        const [runId] = params as [string]
        const row = runs.get(runId)
        return (row ? [row] : []) as TRow[]
      }
      if (s.startsWith('SELECT started_at') && s.includes('_runs WHERE run_id')) {
        const [runId] = params as [string]
        const row = runs.get(runId)
        return (row ? [{ started_at: row.started_at }] : []) as TRow[]
      }
      if (s.startsWith('SELECT halted_kind') && s.includes('_runs WHERE run_id')) {
        const [runId] = params as [string]
        const row = runs.get(runId)
        return (row ? [{ halted_kind: row.halted_kind }] : []) as TRow[]
      }
      if (s.startsWith('SELECT payload') && s.includes('_turns WHERE run_id')) {
        const [runId] = params as [string]
        const ordered = turns
          .filter((t) => t.run_id === runId)
          .sort((a, b) => a.turn_index - b.turn_index)
        return ordered.map((t) => ({ payload: t.payload, turn_index: t.turn_index })) as TRow[]
      }
      throw new Error(`unrecognised query SQL: ${s}`)
    },
  }
}

function makeTurn(index: number, speaker: string): ConversationTurn {
  return {
    index,
    speaker,
    turnId: `run.t${index}.${speaker}`,
    text: `turn ${index} from ${speaker}`,
    attempts: 1,
    startedAt: new Date(1_000_000 + index * 1000).toISOString(),
    endedAt: new Date(1_000_500 + index * 1000).toISOString(),
  }
}

describe('SqlConversationJournal.migrate', () => {
  it('issues both CREATE TABLE statements + the index, idempotent on rerun', async () => {
    const db = makeFakeAdapter()
    const journal = new SqlConversationJournal(db, 'tbl')
    await journal.migrate()
    expect(db.execCalls.filter((c) => c.sql.includes('CREATE TABLE')).length).toBe(2)
    expect(db.execCalls.filter((c) => c.sql.includes('CREATE INDEX')).length).toBe(1)
    expect(db.execCalls[0]?.sql).toContain('tbl_runs')
    expect(db.execCalls[1]?.sql).toContain('tbl_turns')

    // Second migrate is harmless — fake adapter accepts the DDL again.
    await journal.migrate()
    expect(db.execCalls.length).toBe(6)
  })
})

describe('SqlConversationJournal.beginRun', () => {
  it('inserts a fresh row, idempotent on matching startedAt', async () => {
    const db = makeFakeAdapter()
    const journal = new SqlConversationJournal(db, 'tbl')
    const t = new Date(2_000_000).toISOString()
    await journal.beginRun('r1', t)
    await journal.beginRun('r1', t) // idempotent
    expect(db.runs.get('r1')?.started_at).toBe(t)
  })

  it('rejects a mismatched startedAt on the same runId', async () => {
    const db = makeFakeAdapter()
    const journal = new SqlConversationJournal(db)
    await journal.beginRun('r1', new Date(2_000_000).toISOString())
    await expect(journal.beginRun('r1', new Date(3_000_000).toISOString())).rejects.toThrow(
      /refusing to overwrite/,
    )
  })
})

describe('SqlConversationJournal.appendTurn', () => {
  it('appends turns and they replay in turn_index order regardless of insertion order', async () => {
    const db = makeFakeAdapter()
    const journal = new SqlConversationJournal(db)
    const startedAt = new Date(4_000_000).toISOString()
    await journal.beginRun('r1', startedAt)
    // Append out of order to prove ordering is by turn_index, not insertion.
    await journal.appendTurn('r1', makeTurn(2, 'critic'))
    await journal.appendTurn('r1', makeTurn(0, 'researcher'))
    await journal.appendTurn('r1', makeTurn(1, 'critic'))

    const loaded = await journal.loadRun('r1')
    expect(loaded?.turns.map((t) => t.index)).toEqual([0, 1, 2])
    expect(loaded?.turns[0]?.speaker).toBe('researcher')
    expect(loaded?.turns[1]?.speaker).toBe('critic')
    expect(loaded?.startedAt).toBe(startedAt)
    expect(loaded?.halted).toBeUndefined()
  })

  it('rejects appendTurn for an unknown runId', async () => {
    const db = makeFakeAdapter()
    const journal = new SqlConversationJournal(db)
    await expect(journal.appendTurn('nope', makeTurn(0, 'a'))).rejects.toThrow(/unknown runId/)
  })

  it('rejects appendTurn after the run has been halted', async () => {
    const db = makeFakeAdapter()
    const journal = new SqlConversationJournal(db)
    await journal.beginRun('r1', new Date(5_000_000).toISOString())
    await journal.appendTurn('r1', makeTurn(0, 'a'))
    const halt: HaltReason = { kind: 'max_turns', turns: 1 }
    await journal.recordHalt('r1', halt, new Date(5_001_000).toISOString())
    await expect(journal.appendTurn('r1', makeTurn(1, 'b'))).rejects.toThrow(/halted run/)
  })
})

describe('SqlConversationJournal.recordHalt', () => {
  it('persists the halt + endedAt and surfaces them on loadRun', async () => {
    const db = makeFakeAdapter()
    const journal = new SqlConversationJournal(db)
    const startedAt = new Date(6_000_000).toISOString()
    const endedAt = new Date(6_500_000).toISOString()
    await journal.beginRun('r1', startedAt)
    await journal.appendTurn('r1', makeTurn(0, 'a'))
    const halt: HaltReason = { kind: 'max_credits', spentCents: 250, capCents: 200 }
    await journal.recordHalt('r1', halt, endedAt)

    const loaded = await journal.loadRun('r1')
    expect(loaded?.halted).toEqual(halt)
    expect(loaded?.endedAt).toBe(endedAt)
  })

  it('rejects recordHalt for an unknown runId', async () => {
    const db = makeFakeAdapter()
    const journal = new SqlConversationJournal(db)
    await expect(
      journal.recordHalt('nope', { kind: 'abort' }, new Date(7_000_000).toISOString()),
    ).rejects.toThrow(/unknown runId/)
  })
})

describe('SqlConversationJournal.loadRun', () => {
  it('returns undefined for an unknown runId', async () => {
    const db = makeFakeAdapter()
    const journal = new SqlConversationJournal(db)
    expect(await journal.loadRun('missing')).toBeUndefined()
  })
})
