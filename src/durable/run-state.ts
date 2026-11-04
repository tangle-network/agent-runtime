import type { RuntimeFailureCause } from '../runtime/failure-cause'
import { type RunCancelRequest, readRunCancelRequest } from '../runtime/supervise/run-cancellation'
import { readRunParking } from '../runtime/supervise/run-parking'
import type { SupervisedResult } from '../runtime/supervise/types'
import { runDirectoryHolderIsLive } from './run-lock'
import { readFailureRecord, readSettleRecord } from './settle-record'
import { readSpawnJournal } from './spawn-journal/read'

/** Runtime evidence only. Product-specific launch, checks and trace completeness belong to callers. */
export interface RunState {
  /** Absent when a recorded holder cannot be verified on this host. */
  readonly phase?: 'running' | 'parked' | 'cancelling' | 'settled' | 'down'
  /** A persisted typed root failure; legacy failure messages do not establish a code. */
  readonly failureCode?: RuntimeFailureCause['code']
  readonly settle?: SupervisedResult<unknown>
  readonly cancelRequest?: RunCancelRequest
  /** Absent when holder liveness is unknown. This is advisory, never ownership authorization. */
  readonly holderLive?: boolean
  /** Latest explicit Runtime timestamp observed, as ISO UTC; never a filesystem mtime. */
  readonly lastActivityAt?: string
}

/** Compose maintained record readers. Terminal settlement outranks cancellation and parking;
 * a request remains cancelling until settlement. An unheld run with evidence is down.
 * No Runtime evidence (including a missing or empty directory) returns undefined. Reads are
 * advisory snapshots across independently published files, not a transaction or a resume gate.
 */
export async function readRunState(runDir: string): Promise<RunState | undefined> {
  const [settle, failure, parking, holder, journal] = await Promise.all([
    readSettleRecord(runDir),
    readFailureRecord(runDir),
    readRunParking(runDir),
    runDirectoryHolderIsLive(runDir),
    readSpawnJournal(runDir, { tailBytes: 65_536 }),
  ])
  const cancelRequest = readRunCancelRequest(runDir)
  if (
    !settle &&
    !failure &&
    !parking &&
    !holder.holder &&
    !cancelRequest &&
    journal.records.length === 0
  ) {
    return undefined
  }
  const holderLive = holder.unknown ? undefined : holder.live
  const phase = settle
    ? 'settled'
    : cancelRequest
      ? 'cancelling'
      : parking
        ? 'parked'
        : holderLive === true
          ? 'running'
          : holderLive === false
            ? 'down'
            : undefined
  const root = settle?.tree.nodes?.find((node) => node.id === settle.tree.root)
  const failureCode = root?.failure?.code
  let latest: number | undefined
  const observe = (at: string | number | undefined): void => {
    const timestamp = at === undefined ? undefined : new Date(at).getTime()
    if (timestamp !== undefined && Number.isFinite(timestamp)) {
      latest = latest === undefined ? timestamp : Math.max(latest, timestamp)
    }
  }
  observe(failure?.at)
  observe(parking?.since)
  observe(cancelRequest?.at)
  observe(holder.holder?.startedAt)
  for (const record of journal.records)
    observe(record.kind === 'begin' ? record.at : record.event.at)
  for (const node of settle?.tree.nodes ?? []) {
    observe(node.spawnedAt)
    observe(node.settledAt)
  }
  const lastActivityAt = latest === undefined ? undefined : new Date(latest).toISOString()
  return {
    ...(phase === undefined ? {} : { phase }),
    ...(failureCode === undefined ? {} : { failureCode }),
    ...(settle === undefined ? {} : { settle }),
    ...(cancelRequest === undefined ? {} : { cancelRequest }),
    ...(holderLive === undefined ? {} : { holderLive }),
    ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
  }
}
