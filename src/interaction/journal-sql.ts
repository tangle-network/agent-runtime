import type { InteractionJournal, InteractionJournalEntry } from './journal'
import type { InteractionActorRef, InteractionHaltReason, InteractionTurn } from './types'

export interface SqlAdapter {
  exec(sql: string, params?: readonly unknown[]): Promise<{ rowsAffected: number }>
  query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<Row[]>
}

export interface D1DatabaseLike {
  prepare(sql: string): D1StatementLike
}

export interface D1StatementLike {
  bind(...params: unknown[]): D1StatementLike
  run(): Promise<unknown>
  all<Row = unknown>(): Promise<{ results?: Row[] }>
}

/** Adapt a Cloudflare D1 database to the interaction journal SQL contract. */
export function d1SqlAdapter(database: D1DatabaseLike): SqlAdapter {
  return {
    async exec(sql, params = []) {
      const statement = bindD1(database.prepare(sql), params)
      const result = await statement.run()
      const meta = (result as { meta?: { rows_written?: number; changes?: number } }).meta
      return { rowsAffected: meta?.rows_written ?? meta?.changes ?? 0 }
    },
    async query<Row>(sql: string, params: readonly unknown[] = []): Promise<Row[]> {
      const result = await bindD1(database.prepare(sql), params).all<Row>()
      return result.results ?? []
    },
  }
}

function bindD1(statement: D1StatementLike, params: readonly unknown[]): D1StatementLike {
  return params.length === 0 ? statement : statement.bind(...params)
}

interface RunRow {
  run_id: string
  definition_id: string
  started_at: string
  halted_payload: string | null
  ended_at: string | null
}

interface PayloadRow {
  payload: string
}

/** Persist resumable interaction state in a SQL database. */
export class SqlInteractionJournal implements InteractionJournal {
  private readonly table: string

  constructor(
    private readonly database: SqlAdapter,
    table = 'agent_runtime_interaction',
  ) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      throw new Error(`invalid SQL table prefix "${table}"`)
    }
    this.table = table
  }

  async migrate(): Promise<void> {
    await this.database.exec(`
      CREATE TABLE IF NOT EXISTS ${this.table}_runs (
        run_id TEXT PRIMARY KEY,
        definition_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        halted_payload TEXT,
        ended_at TEXT
      )
    `)
    await this.database.exec(`
      CREATE TABLE IF NOT EXISTS ${this.table}_actors (
        run_id TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (run_id, actor_name)
      )
    `)
    await this.database.exec(`
      CREATE TABLE IF NOT EXISTS ${this.table}_turns (
        run_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (run_id, turn_index)
      )
    `)
    await this.database.exec(
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_turns_run ON ${this.table}_turns (run_id, turn_index)`,
    )
  }

  async load(runId: string): Promise<InteractionJournalEntry | undefined> {
    const [run] = await this.database.query<RunRow>(
      `SELECT run_id, definition_id, started_at, halted_payload, ended_at FROM ${this.table}_runs WHERE run_id = ?`,
      [runId],
    )
    if (!run) return undefined
    const actors = await this.database.query<PayloadRow>(
      `SELECT payload FROM ${this.table}_actors WHERE run_id = ? ORDER BY actor_name ASC`,
      [runId],
    )
    const turns = await this.database.query<PayloadRow>(
      `SELECT payload FROM ${this.table}_turns WHERE run_id = ? ORDER BY turn_index ASC`,
      [runId],
    )
    const entry: InteractionJournalEntry = {
      runId: requireString(run.run_id, 'run_id'),
      definitionId: requireString(run.definition_id, 'definition_id'),
      startedAt: requireString(run.started_at, 'started_at'),
      actors: actors.map((row) => parseJson<InteractionActorRef>(row.payload, 'actor')),
      turns: turns.map((row) => parseJson<InteractionTurn>(row.payload, 'turn')),
    }
    if (run.halted_payload !== null) {
      entry.halted = parseJson<InteractionHaltReason>(run.halted_payload, 'halt reason')
      entry.endedAt = requireString(run.ended_at, 'ended_at')
    } else if (run.ended_at !== null) {
      throw new Error(`interaction journal is corrupt: "${runId}" ended without a halt reason`)
    }
    assertLoadedEntry(entry)
    return entry
  }

  async begin(runId: string, startedAt: string, definitionId: string): Promise<void> {
    const existing = await this.load(runId)
    if (existing) {
      assertBegin(existing, startedAt, definitionId)
      return
    }
    try {
      const inserted = await this.database.exec(
        `INSERT INTO ${this.table}_runs (run_id, definition_id, started_at) VALUES (?, ?, ?)`,
        [runId, definitionId, startedAt],
      )
      if (inserted.rowsAffected !== 1) {
        const raced = await this.load(runId)
        if (!raced) throw new Error(`failed to begin interaction "${runId}"`)
        assertBegin(raced, startedAt, definitionId)
      }
    } catch (error) {
      const raced = await this.load(runId)
      if (!raced) throw error
      assertBegin(raced, startedAt, definitionId)
    }
  }

  async recordActor(runId: string, actor: InteractionActorRef): Promise<void> {
    const entry = requireOpen(await this.load(runId), runId)
    const existing = entry.actors.find((candidate) => candidate.name === actor.name)
    if (existing) {
      assertSame('actor reference', existing, actor)
      return
    }
    if (
      entry.actors.some(
        (candidate) =>
          candidate.provider === actor.provider &&
          candidate.environmentId === actor.environmentId &&
          candidate.name !== actor.name,
      )
    ) {
      throw new Error(
        `environment "${actor.environmentId}" is already assigned to another interaction actor`,
      )
    }
    try {
      const inserted = await this.database.exec(
        `INSERT INTO ${this.table}_actors (run_id, actor_name, payload) VALUES (?, ?, ?)`,
        [runId, actor.name, JSON.stringify(actor)],
      )
      if (inserted.rowsAffected !== 1) {
        const raced = await this.load(runId)
        const stored = raced?.actors.find((candidate) => candidate.name === actor.name)
        if (!stored) throw new Error(`failed to record actor "${actor.name}"`)
        assertSame('actor reference', stored, actor)
      }
    } catch (error) {
      const raced = await this.load(runId)
      const stored = raced?.actors.find((candidate) => candidate.name === actor.name)
      if (!stored) throw error
      assertSame('actor reference', stored, actor)
    }
  }

  async appendTurn(runId: string, turn: InteractionTurn): Promise<void> {
    const entry = requireOpen(await this.load(runId), runId)
    const existing = entry.turns.find((candidate) => candidate.index === turn.index)
    if (existing) {
      assertSame('turn', existing, turn)
      return
    }
    if (turn.index !== entry.turns.length) {
      throw new Error(
        `interaction "${runId}" expected turn index ${entry.turns.length}; received ${turn.index}`,
      )
    }
    try {
      const inserted = await this.database.exec(
        `INSERT INTO ${this.table}_turns (run_id, turn_index, payload) VALUES (?, ?, ?)`,
        [runId, turn.index, JSON.stringify(turn)],
      )
      if (inserted.rowsAffected !== 1) {
        const raced = await this.load(runId)
        const stored = raced?.turns.find((candidate) => candidate.index === turn.index)
        if (!stored) throw new Error(`failed to record turn ${turn.index}`)
        assertSame('turn', stored, turn)
      }
    } catch (error) {
      const raced = await this.load(runId)
      const stored = raced?.turns.find((candidate) => candidate.index === turn.index)
      if (!stored) throw error
      assertSame('turn', stored, turn)
    }
  }

  async finish(runId: string, halted: InteractionHaltReason, endedAt: string): Promise<void> {
    const entry = await this.load(runId)
    if (!entry) throw new Error(`unknown interaction "${runId}"`)
    if (entry.halted) {
      assertFinished(entry, halted, endedAt)
      return
    }
    const result = await this.database.exec(
      `UPDATE ${this.table}_runs SET halted_payload = ?, ended_at = ? WHERE run_id = ? AND halted_payload IS NULL`,
      [JSON.stringify(halted), endedAt, runId],
    )
    if (result.rowsAffected === 1) return
    const raced = await this.load(runId)
    if (!raced?.halted) {
      throw new Error(`failed to finish interaction "${runId}"`)
    }
    assertFinished(raced, halted, endedAt)
  }
}

function requireOpen(
  entry: InteractionJournalEntry | undefined,
  runId: string,
): InteractionJournalEntry {
  if (!entry) throw new Error(`unknown interaction "${runId}"`)
  if (entry.halted) throw new Error(`interaction "${runId}" is already finished`)
  return entry
}

function assertBegin(
  entry: InteractionJournalEntry,
  startedAt: string,
  definitionId: string,
): void {
  if (entry.definitionId !== definitionId) {
    throw new Error(
      `interaction "${entry.runId}" definition changed: expected "${entry.definitionId}", received "${definitionId}"`,
    )
  }
  if (entry.startedAt !== startedAt) {
    throw new Error(`interaction "${entry.runId}" already started at ${entry.startedAt}`)
  }
}

function assertFinished(
  entry: InteractionJournalEntry,
  halted: InteractionHaltReason,
  endedAt: string,
): void {
  assertSame('halt reason', entry.halted, halted)
  if (entry.endedAt !== endedAt) {
    throw new Error(`interaction "${entry.runId}" already ended at ${entry.endedAt}`)
  }
}

function assertLoadedEntry(entry: InteractionJournalEntry): void {
  const actorNames = new Set<string>()
  const environments = new Set<string>()
  for (const actor of entry.actors) {
    if (!actor || typeof actor !== 'object') throw new Error('invalid actor record')
    requireString(actor.name, 'actor.name')
    requireString(actor.provider, 'actor.provider')
    requireString(actor.environmentId, 'actor.environmentId')
    requireString(actor.sessionId, 'actor.sessionId')
    if (actorNames.has(actor.name)) throw new Error(`duplicate actor "${actor.name}"`)
    actorNames.add(actor.name)
    const environmentKey = `${actor.provider}\u0000${actor.environmentId}`
    if (environments.has(environmentKey)) {
      throw new Error(`duplicate environment "${actor.environmentId}"`)
    }
    environments.add(environmentKey)
  }
  entry.turns.forEach((turn, index) => {
    if (!turn || typeof turn !== 'object' || turn.index !== index) {
      throw new Error(`interaction journal is corrupt: expected turn index ${index}`)
    }
    requireString(turn.actor, 'turn.actor')
    requireString(turn.turnId, 'turn.turnId')
    requireString(turn.environmentId, 'turn.environmentId')
    requireString(turn.sessionId, 'turn.sessionId')
    requireString(turn.startedAt, 'turn.startedAt')
    requireString(turn.endedAt, 'turn.endedAt')
  })
  if (entry.halted) requireString(entry.halted.kind, 'halted.kind')
}

function parseJson<Value>(payload: string, label: string): Value {
  if (typeof payload !== 'string') throw new Error(`invalid ${label} payload`)
  try {
    return JSON.parse(payload) as Value
  } catch (error) {
    throw new Error(`invalid ${label} JSON`, { cause: error })
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`invalid ${label}`)
  }
  return value
}

function assertSame(label: string, left: unknown, right: unknown): void {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`conflicting ${label} for the same interaction identity`)
  }
}
