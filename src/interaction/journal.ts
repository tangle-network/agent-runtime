import type { InteractionActorRef, InteractionHaltReason, InteractionTurn } from './types'

export interface InteractionJournalEntry {
  runId: string
  definitionId: string
  startedAt: string
  actors: InteractionActorRef[]
  turns: InteractionTurn[]
  halted?: InteractionHaltReason
  endedAt?: string
}

export interface InteractionJournal {
  load(runId: string): Promise<InteractionJournalEntry | undefined>
  begin(runId: string, startedAt: string, definitionId: string): Promise<void>
  recordActor(runId: string, actor: InteractionActorRef): Promise<void>
  appendTurn(runId: string, turn: InteractionTurn): Promise<void>
  finish(runId: string, halted: InteractionHaltReason, endedAt: string): Promise<void>
}

/** Store resumable interaction state in process memory. */
export class InMemoryInteractionJournal implements InteractionJournal {
  private readonly entries = new Map<string, InteractionJournalEntry>()

  async load(runId: string): Promise<InteractionJournalEntry | undefined> {
    const entry = this.entries.get(runId)
    return entry ? cloneEntry(entry) : undefined
  }

  async begin(runId: string, startedAt: string, definitionId: string): Promise<void> {
    const existing = this.entries.get(runId)
    if (existing) {
      assertDefinition(existing, definitionId)
      if (existing.startedAt !== startedAt) {
        throw new Error(
          `interaction "${runId}" already started at ${existing.startedAt}; received ${startedAt}`,
        )
      }
      return
    }
    this.entries.set(runId, {
      runId,
      definitionId,
      startedAt,
      actors: [],
      turns: [],
    })
  }

  async recordActor(runId: string, actor: InteractionActorRef): Promise<void> {
    const entry = requireOpenEntry(this.entries.get(runId), runId)
    const existing = entry.actors.find((candidate) => candidate.name === actor.name)
    if (existing) {
      assertSameRecord('actor reference', existing, actor)
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
    entry.actors.push(structuredClone(actor))
  }

  async appendTurn(runId: string, turn: InteractionTurn): Promise<void> {
    const entry = requireOpenEntry(this.entries.get(runId), runId)
    const existing = entry.turns.find((candidate) => candidate.index === turn.index)
    if (existing) {
      assertSameRecord('turn', existing, turn)
      return
    }
    if (turn.index !== entry.turns.length) {
      throw new Error(
        `interaction "${runId}" expected turn index ${entry.turns.length}; received ${turn.index}`,
      )
    }
    entry.turns.push(structuredClone(turn))
  }

  async finish(runId: string, halted: InteractionHaltReason, endedAt: string): Promise<void> {
    const entry = this.entries.get(runId)
    if (!entry) throw new Error(`unknown interaction "${runId}"`)
    if (entry.halted) {
      assertSameRecord('halt reason', entry.halted, halted)
      if (entry.endedAt !== endedAt) {
        throw new Error(`interaction "${runId}" already ended at ${entry.endedAt}`)
      }
      return
    }
    entry.halted = structuredClone(halted)
    entry.endedAt = endedAt
  }
}

/** Persist resumable interaction state in a local JSON file. */
export class FileInteractionJournal implements InteractionJournal {
  constructor(private readonly path: string) {}

  async load(runId: string): Promise<InteractionJournalEntry | undefined> {
    const fs = await import('node:fs/promises')
    let text: string
    try {
      text = await fs.readFile(this.path, 'utf8')
    } catch (error) {
      if (isNoEntError(error)) return undefined
      throw error
    }

    let entry: InteractionJournalEntry | undefined
    for (const line of text.split('\n')) {
      if (!line) continue
      const record = JSON.parse(line) as FileRecord
      if (record.runId !== runId) continue
      if (record.kind === 'begin') {
        if (entry) throw new Error(`duplicate begin record for interaction "${runId}"`)
        entry = {
          runId,
          definitionId: record.definitionId,
          startedAt: record.startedAt,
          actors: [],
          turns: [],
        }
      } else if (record.kind === 'actor') {
        const target = requireEntry(entry, runId, record.kind)
        const existing = target.actors.find((actor) => actor.name === record.actor.name)
        if (existing) assertSameRecord('actor reference', existing, record.actor)
        else target.actors.push(record.actor)
      } else if (record.kind === 'turn') {
        const target = requireEntry(entry, runId, record.kind)
        const existing = target.turns.find((turn) => turn.index === record.turn.index)
        if (existing) assertSameRecord('turn', existing, record.turn)
        else target.turns.push(record.turn)
      } else {
        const target = requireEntry(entry, runId, record.kind)
        if (target.halted) assertSameRecord('halt reason', target.halted, record.halted)
        else {
          target.halted = record.halted
          target.endedAt = record.endedAt
        }
      }
    }
    if (!entry) return undefined
    entry.turns.sort((left, right) => left.index - right.index)
    return cloneEntry(entry)
  }

  async begin(runId: string, startedAt: string, definitionId: string): Promise<void> {
    const existing = await this.load(runId)
    if (existing) {
      assertDefinition(existing, definitionId)
      if (existing.startedAt !== startedAt) {
        throw new Error(
          `interaction "${runId}" already started at ${existing.startedAt}; received ${startedAt}`,
        )
      }
      return
    }
    await this.append({ kind: 'begin', runId, startedAt, definitionId })
  }

  async recordActor(runId: string, actor: InteractionActorRef): Promise<void> {
    const entry = requireOpenEntry(await this.load(runId), runId)
    const existing = entry.actors.find((candidate) => candidate.name === actor.name)
    if (existing) {
      assertSameRecord('actor reference', existing, actor)
      return
    }
    await this.append({ kind: 'actor', runId, actor })
  }

  async appendTurn(runId: string, turn: InteractionTurn): Promise<void> {
    const entry = requireOpenEntry(await this.load(runId), runId)
    const existing = entry.turns.find((candidate) => candidate.index === turn.index)
    if (existing) {
      assertSameRecord('turn', existing, turn)
      return
    }
    if (turn.index !== entry.turns.length) {
      throw new Error(
        `interaction "${runId}" expected turn index ${entry.turns.length}; received ${turn.index}`,
      )
    }
    await this.append({ kind: 'turn', runId, turn })
  }

  async finish(runId: string, halted: InteractionHaltReason, endedAt: string): Promise<void> {
    const entry = await this.load(runId)
    if (!entry) throw new Error(`unknown interaction "${runId}"`)
    if (entry.halted) {
      assertSameRecord('halt reason', entry.halted, halted)
      if (entry.endedAt !== endedAt) {
        throw new Error(`interaction "${runId}" already ended at ${entry.endedAt}`)
      }
      return
    }
    await this.append({ kind: 'finish', runId, halted, endedAt })
  }

  private async append(record: FileRecord): Promise<void> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.mkdir(path.dirname(this.path), { recursive: true })
    const file = await fs.open(this.path, 'a')
    try {
      await file.write(`${JSON.stringify(record)}\n`)
      await file.sync()
    } finally {
      await file.close()
    }
  }
}

type FileRecord =
  | {
      kind: 'begin'
      runId: string
      startedAt: string
      definitionId: string
    }
  | { kind: 'actor'; runId: string; actor: InteractionActorRef }
  | { kind: 'turn'; runId: string; turn: InteractionTurn }
  | {
      kind: 'finish'
      runId: string
      halted: InteractionHaltReason
      endedAt: string
    }

function requireEntry(
  entry: InteractionJournalEntry | undefined,
  runId: string,
  recordKind: string,
): InteractionJournalEntry {
  if (!entry) {
    throw new Error(
      `interaction journal is corrupt: ${recordKind} record precedes begin for "${runId}"`,
    )
  }
  return entry
}

function requireOpenEntry(
  entry: InteractionJournalEntry | undefined,
  runId: string,
): InteractionJournalEntry {
  if (!entry) throw new Error(`unknown interaction "${runId}"`)
  if (entry.halted) throw new Error(`interaction "${runId}" is already finished`)
  return entry
}

function assertDefinition(entry: InteractionJournalEntry, definitionId: string): void {
  if (entry.definitionId !== definitionId) {
    throw new Error(
      `interaction "${entry.runId}" definition changed: expected "${entry.definitionId}", received "${definitionId}"`,
    )
  }
}

function assertSameRecord(label: string, left: unknown, right: unknown): void {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`conflicting ${label} for the same interaction identity`)
  }
}

function cloneEntry(entry: InteractionJournalEntry): InteractionJournalEntry {
  return structuredClone(entry)
}

function isNoEntError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  )
}
