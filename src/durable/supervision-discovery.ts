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
  readonly event?: unknown
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

  const allRoots = new Set<NodeId>()
  const nestedRoots = new Set<NodeId>()
  if (spawnText !== undefined) {
    for (const record of parseCommittedJsonLines<SpawnJournalIdentityRecord>(
      spawnText,
      spawnJournalPath,
    )) {
      if (record.kind === 'begin') {
        if (typeof record.root !== 'string' || record.root.length === 0) {
          throw new Error(`${spawnJournalPath}: begin record has no non-empty string root identity`)
        }
        allRoots.add(record.root as NodeId)
        continue
      }
      if (record.kind !== 'event') continue
      const event = record.event
      if (!isRecord(event) || event.kind !== 'spawned') continue
      if (!Object.hasOwn(event, 'ownedTreeRoot')) continue
      if (typeof event.ownedTreeRoot !== 'string' || event.ownedTreeRoot.length === 0) {
        throw new Error(
          `${spawnJournalPath}: spawned event ownedTreeRoot must be a non-empty string when present`,
        )
      }
      nestedRoots.add(event.ownedTreeRoot as NodeId)
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
        throw new Error(`${coordinationLogPath}: record has no non-empty string runId identity`)
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
        throw new Error(`${coordinationLogPath}: ownerId must be a non-empty string when present`)
      }
      streams.set(record.runId, stream)
    }
  }

  const coordinationStreams = [...streams.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([runId, stream]) =>
      Object.freeze({
        runId,
        ownerIds: Object.freeze([...stream.owners].sort(compareText)),
        unscopedRecords: stream.unscopedRecords,
        recordCount: stream.recordCount,
      }),
    )

  return Object.freeze({
    runDir: canonicalRunDir,
    spawnJournalPath,
    coordinationLogPath,
    roots: Object.freeze([...allRoots].filter((root) => !nestedRoots.has(root)).sort(compareText)),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isNoEntError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  )
}
