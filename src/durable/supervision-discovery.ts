import { resolve } from 'node:path'
import type { NodeId } from '../runtime/supervise/types'
import { parseCommittedJsonLines } from './jsonl-file'

export interface DurableCoordinationStreamIdentity {
  readonly runId: string
  /** Exact owner ids present in the side-log, sorted for deterministic display. */
  readonly ownerIds: readonly string[]
  /** Records written before owner-scoped coordination identities were introduced. */
  readonly unscopedRecords: number
  readonly recordCount: number
}

/**
 * Identities discoverable from one `supervise({ runDir })` directory without
 * already knowing the root node or coordination run id stored inside it.
 */
export interface DurableSupervisionDiscovery {
  readonly runDir: string
  readonly spawnJournalPath: string
  readonly coordinationLogPath: string
  readonly roots: readonly NodeId[]
  readonly coordinationStreams: readonly DurableCoordinationStreamIdentity[]
}

type SpawnJournalIdentityRecord = {
  readonly kind?: unknown
  readonly root?: unknown
}

type CoordinationIdentityRecord = {
  readonly runId?: unknown
  readonly ownerId?: unknown
}

/**
 * Discover the stable identities recorded by Runtime's durable supervision
 * files. This is the developer-facing first step before calling
 * `FileSpawnJournal.loadTree(root)`, `loadSpawnForest(journal, root)`, or
 * `FileCoordinationLog.load(runId, ownerId)`.
 *
 * Missing files produce empty collections. A malformed committed JSONL record
 * still fails loud through the same parser used by the runtime; a torn final
 * append is ignored because it was never acknowledged as committed.
 */
export async function discoverDurableSupervisionRun(
  runDir: string,
): Promise<DurableSupervisionDiscovery> {
  if (typeof runDir !== 'string' || runDir.trim().length === 0) {
    throw new TypeError('discoverDurableSupervisionRun: runDir must be a non-empty string')
  }

  const canonicalRunDir = resolve(runDir)
  const spawnJournalPath = `${canonicalRunDir}/spawn-journal.jsonl`
  const coordinationLogPath = `${canonicalRunDir}/coordination-log.jsonl`
  const [spawnText, coordinationText] = await Promise.all([
    readOptionalText(spawnJournalPath),
    readOptionalText(coordinationLogPath),
  ])

  const roots = new Set<NodeId>()
  if (spawnText !== undefined) {
    for (const record of parseCommittedJsonLines<SpawnJournalIdentityRecord>(
      spawnText,
      spawnJournalPath,
    )) {
      if (record.kind !== 'begin') continue
      if (typeof record.root !== 'string' || record.root.length === 0) {
        throw new Error(
          `${spawnJournalPath}: begin record has no non-empty string root identity`,
        )
      }
      roots.add(record.root as NodeId)
    }
  }

  const streams = new Map<
    string,
    { owners: Set<string>; unscopedRecords: number; recordCount: number }
  >()
  if (coordinationText !== undefined) {
    for (const record of parseCommittedJsonLines<CoordinationIdentityRecord>(
      coordinationText,
      coordinationLogPath,
    )) {
      if (typeof record.runId !== 'string' || record.runId.length === 0) {
        throw new Error(
          `${coordinationLogPath}: record has no non-empty string runId identity`,
        )
      }
      const stream = streams.get(record.runId) ?? {
        owners: new Set<string>(),
        unscopedRecords: 0,
        recordCount: 0,
      }
      stream.recordCount += 1
      if (record.ownerId === undefined) {
        stream.unscopedRecords += 1
      } else if (typeof record.ownerId === 'string' && record.ownerId.length > 0) {
        stream.owners.add(record.ownerId)
      } else {
        throw new Error(
          `${coordinationLogPath}: ownerId must be a non-empty string when present`,
        )
      }
      streams.set(record.runId, stream)
    }
  }

  const coordinationStreams = [...streams.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([runId, stream]) =>
      Object.freeze({
        runId,
        ownerIds: Object.freeze([...stream.owners].sort()),
        unscopedRecords: stream.unscopedRecords,
        recordCount: stream.recordCount,
      }),
    )

  return Object.freeze({
    runDir: canonicalRunDir,
    spawnJournalPath,
    coordinationLogPath,
    roots: Object.freeze([...roots].sort()),
    coordinationStreams: Object.freeze(coordinationStreams),
  })
}

async function readOptionalText(path: string): Promise<string | undefined> {
  const fs = await import('node:fs/promises')
  try {
    return await fs.readFile(path, 'utf8')
  } catch (error) {
    if (isNoEntError(error)) return undefined
    throw error
  }
}

function isNoEntError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  )
}
