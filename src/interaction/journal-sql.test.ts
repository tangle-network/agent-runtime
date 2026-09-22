import { describe, expect, it } from 'vitest'
import { d1SqlAdapter, type SqlAdapter, SqlInteractionJournal } from './journal-sql'
import type { InteractionActorRef, InteractionTurn } from './types'

interface RunRow {
  run_id: string
  definition_id: string
  started_at: string
  halted_payload: string | null
  ended_at: string | null
}

interface PayloadRow {
  runId: string
  key: string | number
  payload: string
}

function fakeSql(): SqlAdapter & {
  runs: Map<string, RunRow>
  actors: Map<string, PayloadRow>
  turns: Map<string, PayloadRow>
  writes: string[]
} {
  const runs = new Map<string, RunRow>()
  const actors = new Map<string, PayloadRow>()
  const turns = new Map<string, PayloadRow>()
  const writes: string[] = []
  return {
    runs,
    actors,
    turns,
    writes,
    async exec(sql, params = []) {
      const statement = sql.trim().replace(/\s+/g, ' ')
      writes.push(statement)
      if (statement.startsWith('CREATE ')) return { rowsAffected: 0 }
      if (statement.startsWith('INSERT INTO') && statement.includes('_runs ')) {
        const [runId, definitionId, startedAt] = params as [string, string, string]
        if (runs.has(runId)) throw new Error('UNIQUE constraint failed: runs.run_id')
        runs.set(runId, {
          run_id: runId,
          definition_id: definitionId,
          started_at: startedAt,
          halted_payload: null,
          ended_at: null,
        })
        return { rowsAffected: 1 }
      }
      if (statement.startsWith('INSERT INTO') && statement.includes('_actors ')) {
        const [runId, actorName, payload] = params as [string, string, string]
        const id = `${runId}\u0000${actorName}`
        if (actors.has(id)) throw new Error('UNIQUE constraint failed: actors')
        actors.set(id, { runId, key: actorName, payload })
        return { rowsAffected: 1 }
      }
      if (statement.startsWith('INSERT INTO') && statement.includes('_turns ')) {
        const [runId, turnIndex, payload] = params as [string, number, string]
        const id = `${runId}\u0000${turnIndex}`
        if (turns.has(id)) throw new Error('UNIQUE constraint failed: turns')
        turns.set(id, { runId, key: turnIndex, payload })
        return { rowsAffected: 1 }
      }
      if (statement.startsWith('UPDATE') && statement.includes('_runs SET')) {
        const [haltedPayload, endedAt, runId] = params as [string, string, string]
        const row = runs.get(runId)
        if (!row || row.halted_payload !== null) return { rowsAffected: 0 }
        row.halted_payload = haltedPayload
        row.ended_at = endedAt
        return { rowsAffected: 1 }
      }
      throw new Error(`unrecognized write: ${statement}`)
    },
    async query<Row>(sql: string, params: readonly unknown[] = []): Promise<Row[]> {
      const statement = sql.trim().replace(/\s+/g, ' ')
      const [runId] = params as [string]
      if (statement.startsWith('SELECT run_id')) {
        const row = runs.get(runId)
        return (row ? [structuredClone(row)] : []) as Row[]
      }
      if (statement.includes('_actors WHERE')) {
        return [...actors.values()]
          .filter((row) => row.runId === runId)
          .sort((left, right) => String(left.key).localeCompare(String(right.key)))
          .map(({ payload }) => ({ payload })) as Row[]
      }
      if (statement.includes('_turns WHERE')) {
        return [...turns.values()]
          .filter((row) => row.runId === runId)
          .sort((left, right) => Number(left.key) - Number(right.key))
          .map(({ payload }) => ({ payload })) as Row[]
      }
      throw new Error(`unrecognized query: ${statement}`)
    },
  }
}

const actor = (name: string, environmentId = `env-${name}`): InteractionActorRef => ({
  name,
  provider: 'test-provider',
  environmentId,
  sessionId: `session-${name}`,
})

const turn = (index: number, actorName: string): InteractionTurn => ({
  index,
  actor: actorName,
  turnId: `run.turn.${index}.${actorName}`,
  environmentId: `env-${actorName}`,
  sessionId: `session-${actorName}`,
  text: `turn ${index}`,
  usage: { inputTokens: 10, outputTokens: 3, costUsd: 0.001 },
  attempts: 1,
  startedAt: `2026-07-26T00:00:0${index}.000Z`,
  endedAt: `2026-07-26T00:00:0${index}.500Z`,
})

describe('SqlInteractionJournal', () => {
  it('creates the three tables and index and rejects unsafe prefixes', async () => {
    const database = fakeSql()
    const journal = new SqlInteractionJournal(database, 'runtime_interactions')
    await journal.migrate()
    await journal.migrate()

    expect(database.writes.filter((sql) => sql.startsWith('CREATE TABLE'))).toHaveLength(6)
    expect(database.writes.filter((sql) => sql.startsWith('CREATE INDEX'))).toHaveLength(2)
    expect(() => new SqlInteractionJournal(database, 'runs; DROP TABLE users')).toThrow(
      /invalid SQL table prefix/,
    )
  })

  it('round-trips actors, turns, definition identity, and the terminal state', async () => {
    const database = fakeSql()
    const journal = new SqlInteractionJournal(database)
    const startedAt = '2026-07-26T00:00:00.000Z'
    const endedAt = '2026-07-26T00:01:00.000Z'

    await journal.begin('run', startedAt, 'definition-a')
    await journal.begin('run', startedAt, 'definition-a')
    await journal.recordActor('run', actor('author'))
    await journal.recordActor('run', actor('reviewer'))
    await journal.appendTurn('run', turn(0, 'author'))
    await journal.appendTurn('run', turn(1, 'reviewer'))
    await journal.finish('run', { kind: 'stop', reason: 'approved' }, endedAt)
    await journal.finish('run', { kind: 'stop', reason: 'approved' }, endedAt)

    expect(await journal.load('run')).toEqual({
      runId: 'run',
      definitionId: 'definition-a',
      startedAt,
      actors: [actor('author'), actor('reviewer')],
      turns: [turn(0, 'author'), turn(1, 'reviewer')],
      halted: { kind: 'stop', reason: 'approved' },
      endedAt,
    })
  })

  it('accepts exact retries and rejects every conflicting identity', async () => {
    const database = fakeSql()
    const journal = new SqlInteractionJournal(database)
    const startedAt = '2026-07-26T00:00:00.000Z'
    await journal.begin('run', startedAt, 'definition-a')
    await expect(journal.begin('run', startedAt, 'definition-b')).rejects.toThrow(
      /definition changed/,
    )
    await expect(journal.begin('run', '2026-07-26T00:00:01.000Z', 'definition-a')).rejects.toThrow(
      /already started/,
    )

    await journal.recordActor('run', actor('author'))
    await journal.recordActor('run', actor('author'))
    await expect(journal.recordActor('run', actor('author', 'other-env'))).rejects.toThrow(
      /conflicting actor reference/,
    )
    await expect(journal.recordActor('run', actor('reviewer', 'env-author'))).rejects.toThrow(
      /already assigned/,
    )

    await journal.appendTurn('run', turn(0, 'author'))
    await journal.appendTurn('run', turn(0, 'author'))
    await expect(
      journal.appendTurn('run', { ...turn(0, 'author'), text: 'different' }),
    ).rejects.toThrow(/conflicting turn/)
    await expect(journal.appendTurn('run', turn(2, 'author'))).rejects.toThrow(
      /expected turn index 1/,
    )
  })

  it('does not overwrite a finished run and refuses later writes', async () => {
    const database = fakeSql()
    const journal = new SqlInteractionJournal(database)
    await journal.begin('run', '2026-07-26T00:00:00.000Z', 'definition')
    await journal.finish('run', { kind: 'max_turns', turns: 0 }, '2026-07-26T00:01:00.000Z')

    await expect(
      journal.finish('run', { kind: 'aborted' }, '2026-07-26T00:01:00.000Z'),
    ).rejects.toThrow(/conflicting halt reason/)
    await expect(journal.recordActor('run', actor('author'))).rejects.toThrow(/already finished/)
    await expect(journal.appendTurn('run', turn(0, 'author'))).rejects.toThrow(/already finished/)
  })

  it('fails closed on corrupt persisted JSON and turn order', async () => {
    const database = fakeSql()
    const journal = new SqlInteractionJournal(database)
    await journal.begin('run', '2026-07-26T00:00:00.000Z', 'definition')
    database.turns.set('run\u00000', { runId: 'run', key: 0, payload: '{' })
    await expect(journal.load('run')).rejects.toThrow(/invalid turn JSON/)

    database.turns.set('run\u00000', {
      runId: 'run',
      key: 0,
      payload: JSON.stringify(turn(1, 'author')),
    })
    await expect(journal.load('run')).rejects.toThrow(/expected turn index 0/)
  })
})

it('adapts D1 bindings without importing Cloudflare types', async () => {
  const calls: Array<{ sql: string; params: unknown[]; kind: 'run' | 'all' }> = []
  const database = {
    prepare(sql: string) {
      let params: unknown[] = []
      return {
        bind(...values: unknown[]) {
          params = values
          return this
        },
        async run() {
          calls.push({ sql, params, kind: 'run' })
          return { meta: { changes: 1 } }
        },
        async all<Row>() {
          calls.push({ sql, params, kind: 'all' })
          return { results: [{ ok: true }] as Row[] }
        },
      }
    },
  }
  const adapter = d1SqlAdapter(database)

  await expect(adapter.exec('UPDATE x SET y = ?', [1])).resolves.toEqual({ rowsAffected: 1 })
  await expect(adapter.query('SELECT * FROM x WHERE y = ?', [1])).resolves.toEqual([{ ok: true }])
  expect(calls).toEqual([
    { sql: 'UPDATE x SET y = ?', params: [1], kind: 'run' },
    { sql: 'SELECT * FROM x WHERE y = ?', params: [1], kind: 'all' },
  ])
})
