import { randomUUID } from 'node:crypto'
import { linkSync } from 'node:fs'
import { mkdir, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { canonicalCandidateBytes } from '@tangle-network/agent-interface'

export interface WriteDurableRecordIfAbsentOptions {
  /** Prefix for the private temporary file created beside the destination. */
  temporaryPrefix: string
  /**
   * Synchronous authorization checked after the temporary file is durable and
   * immediately before the atomic publication call.
   */
  authorizePublish?: () => true
}

export class DurableRecordPublicationUncertainError extends Error {
  readonly code = 'durable_record_publication_uncertain' as const
  readonly destination: string

  constructor(destination: string, cause: unknown) {
    super(
      `durable record was published but its durability could not be confirmed: ${destination}`,
      {
        cause,
      },
    )
    this.name = 'DurableRecordPublicationUncertainError'
    this.destination = destination
  }
}

/**
 * Durably publish one canonical JSON record if its destination does not exist.
 *
 * The temporary file is written and fsynced first. A hard link is then the
 * cross-process create-if-absent linearization point, followed by a directory
 * fsync. Callers that lose the race must read and reconcile the winning record.
 */
export async function writeDurableRecordIfAbsent(
  directory: string,
  destination: string,
  record: object,
  options: WriteDurableRecordIfAbsentOptions,
): Promise<boolean> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporaryPath = join(
    directory,
    `.${options.temporaryPrefix}-${process.pid}-${randomUUID()}.tmp`,
  )
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(
      Buffer.concat([Buffer.from(canonicalCandidateBytes(record)), Buffer.from('\n')]),
    )
    await handle.sync()
  } finally {
    await handle.close()
  }

  let written = false
  let failure: unknown
  try {
    if (options.authorizePublish && options.authorizePublish() !== true) {
      throw new Error('durable record publication was not authorized')
    }
    linkSync(temporaryPath, destination)
    written = true
    await syncDirectory(directory)
  } catch (error) {
    if (!isNodeError(error, 'EEXIST')) failure = error
  }
  try {
    await unlink(temporaryPath)
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) failure ??= error
  }
  if (failure !== undefined) {
    if (written) throw new DurableRecordPublicationUncertainError(destination, failure)
    throw failure
  }
  return written
}

/** Fsync a directory after a rename, link, or unlink whose durability matters. */
export async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export function isNodeError(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}
