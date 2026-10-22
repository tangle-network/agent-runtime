import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  publishExclusiveDurableFile,
  syncDurableDirectory,
} from '../runtime/supervise/durable-file'
import { runCancellationFile, runCancelRequestFile } from '../runtime/supervise/run-cancellation'
import { workerCancellationsDir } from '../runtime/supervise/run-layout'
import { assertValidBudget } from '../runtime/supervise/spend-validation'
import { assertResumeLimits } from '../runtime/supervise/supervisor-root-contract'
import type { Budget, SpawnEvent, SpawnJournal, SupervisorOpts } from '../runtime/supervise/types'
import type { FileObserverJournal } from './observer-journal'
import { fenceRunWrite } from './run-fence'
import { SETTLE_RECORD_FILE, settleRecordDigest } from './settle-record'
import { FileSpawnJournal } from './spawn-journal/journal-store'

/*
 * Reopening a settled run under its own run id.
 *
 * A wrong settle used to be final: `supervisePursuit` refuses a directory that holds `result.json`,
 * and `fork` and `versions` each start a new run id in a new directory. Magnetar used 21 run ids
 * from 2026-10-16 to 10-21 for one solve; 16 of those runs settled, 11 of them in under 5 hours.
 *
 * A reopen archives the settled segment and resumes the same journal. Before it writes anything it
 * checks the resume limits (`assertResumeLimits`): a reopen refused for its budget or reservation
 * policy leaves `result.json`, the cancel files and the journal as they were. The profile's identity
 * and materialization are checked by `supervise` itself, after these steps. Every step is
 * idempotent, so a later call with the same `operationId` finishes a reopen that crashed partway:
 *  1. copy `result.json` byte for byte to `settles/<n>.json`;
 *  2. append one `reopened` spawn-journal row naming the operator, the reason and the archive;
 *  3. append one observer event, so the pursuit projection shows one lineage;
 *  4. move the run's cancel request and acknowledgement aside under this reopen's and that
 *     request's operation ids, so a new `cancelRun` is accepted (one run carries one run-scoped
 *     cancel operation) and no later reopen overwrites an earlier segment's cancel;
 *  5. last, remove `result.json`.
 * The caller then runs `supervise` with `resume: true`: settled children replay by key, the pool
 * is restored from the journal, and the next settle writes `result.json` again.
 */

/** `supervisePursuit`'s `reopen` option: reopen this settled run under its own run id. */
export interface RunReopen {
  /** Who reopens the run. Required and non-empty. */
  readonly operator: string
  /** Why. Required and non-empty. */
  readonly reason: string
  /** Idempotency key: calling again with it finishes a reopen that crashed partway. */
  readonly operationId: string
  /**
   * The budget the reopened run is held to, recorded on its `reopened` row, which a later resume
   * must then match. Omit and the call's `budget` must equal the recorded one: the root's, or the
   * last budget a reopen recorded. A run that settled `budget-exhausted` and reopens without a
   * larger budget pauses at once (with `driverRetry.pauseRootStops`) or settles
   * `budget-exhausted` again. A deadline is measured from the original root instant, so a run
   * whose recorded deadline has passed settles `deadline` at once unless this budget drops the
   * deadline or moves it.
   */
  readonly budget?: Budget
}

/** The directory that holds a run's archived settle records. */
export const SETTLE_ARCHIVE_DIR = 'settles'

/** Refuse a reopen that names no operator or reason, or that is combined with a fork or versions. */
export function assertRunReopen(
  reopen: RunReopen,
  opts: { readonly fork?: unknown; readonly versions?: unknown },
): void {
  if (reopen.operator.trim().length === 0) {
    throw new TypeError('supervisePursuit: reopen.operator must be non-empty')
  }
  if (reopen.reason.trim().length === 0) {
    throw new TypeError('supervisePursuit: reopen.reason must be non-empty')
  }
  if (reopen.operationId.trim().length === 0) {
    throw new TypeError('supervisePursuit: reopen.operationId must be non-empty')
  }
  if (reopen.budget !== undefined) assertValidBudget(reopen.budget, 'reopen.budget')
  if (opts.fork !== undefined || opts.versions !== undefined) {
    throw new TypeError(
      'supervisePursuit: reopen continues this run under its own id; fork and versions start new runs',
    )
  }
}

/**
 * Archive the settled segment of the run at `runDir` and clear it for a resume. Runs under the
 * directory lock. Throws when there is nothing to reopen, or when `operationId` already reopened a
 * segment that has since settled again.
 */
export async function reopenSettledRun(input: {
  readonly runDir: string
  readonly runId: string
  readonly reopen: RunReopen
  readonly journal: SpawnJournal | undefined
  /** The call's budget and reservation policy, checked against the recorded ones before any write. */
  readonly limits: Pick<SupervisorOpts, 'budget' | 'reservationPolicy'>
  readonly observer: FileObserverJournal
  readonly pursuitId: string
  readonly now: () => number
}): Promise<void> {
  const { runDir, runId, reopen, observer, pursuitId, now } = input
  const operationId = reopen.operationId.trim()
  const settlePath = resolve(runDir, SETTLE_RECORD_FILE)
  const journal = input.journal ?? new FileSpawnJournal(resolve(runDir, 'spawn-journal.jsonl'))
  const events = (await journal.loadTree(runId)) ?? []
  const reopened = events.filter(
    (event): event is Extract<SpawnEvent, { kind: 'reopened' }> =>
      event.kind === 'reopened' && event.id === runId,
  )
  const mine = reopened.find((event) => event.operationId === operationId)
  const settled = await readBytes(settlePath)
  if (settled === undefined) {
    // Removing result.json is the last step, so a recorded reopen without it is complete.
    if (mine !== undefined) return
    throw new Error(
      `supervisePursuit: ${runDir} holds no ${SETTLE_RECORD_FILE}; nothing to reopen; resume it`,
    )
  }
  assertResumeLimits(
    events,
    {
      runId,
      budget: reopen.budget ?? input.limits.budget,
      ...(input.limits.reservationPolicy === undefined
        ? {}
        : { reservationPolicy: input.limits.reservationPolicy }),
    },
    mine === undefined ? reopen.budget : undefined,
  )
  const result = JSON.parse(settled) as { readonly kind?: unknown; readonly reason?: unknown }
  const digest = settleRecordDigest(result)
  if (mine !== undefined && mine.prior.digest !== digest) {
    throw new Error(
      `supervisePursuit: reopen '${operationId}' already reopened run '${runId}', which has settled again; reopen it under a new operationId`,
    )
  }
  const archivedAs = mine?.prior.archivedAs ?? (await archiveName(runDir, settled))
  const archivePath = resolve(runDir, archivedAs)
  if (
    !publishExclusiveDurableFile(archivePath, settled) &&
    (await readBytes(archivePath)) !== settled
  ) {
    throw new Error(
      `supervisePursuit: ${archivePath} already holds a different settle record; reopen refused`,
    )
  }
  const at = new Date(now()).toISOString()
  if (mine === undefined) {
    await journal.appendEvent(runId, {
      kind: 'reopened',
      id: runId,
      operator: reopen.operator,
      reason: reopen.reason,
      operationId,
      prior: {
        kind: String(result.kind),
        ...(typeof result.reason === 'string' ? { reason: result.reason } : {}),
        digest,
        archivedAs,
      },
      ...(reopen.budget === undefined ? {} : { budget: reopen.budget }),
      seq: reopened.length,
      at,
    })
  }
  const eventId = `${runId}:pursuit:reopened:${operationId}`
  if (!(await observer.read()).some((record) => record.event?.id === eventId)) {
    await observer.appendEvent({
      id: eventId,
      pursuitId,
      runId,
      target: 'agent.run',
      phase: 'event',
      timestamp: now(),
      payload: { reopened: { operator: reopen.operator, reason: reopen.reason, archivedAs } },
    })
  }
  fenceRunWrite(() => {
    setCancellationAside(runDir, operationId)
    unlinkSync(settlePath)
    syncDurableDirectory(runDir)
  })
}

/** The next free `settles/<n>.json`, or the archive that already holds these bytes (a reopen that
 *  crashed after archiving and before its journal row). */
async function archiveName(runDir: string, settled: string): Promise<string> {
  const dir = resolve(runDir, SETTLE_ARCHIVE_DIR)
  fenceRunWrite(() => mkdirSync(dir, { recursive: true }))
  const numbers = readdirSync(dir)
    .map((name) => /^(\d+)\.json$/u.exec(name)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b)
  for (const n of numbers) {
    if ((await readBytes(join(dir, `${n}.json`))) === settled)
      return `${SETTLE_ARCHIVE_DIR}/${n}.json`
  }
  return `${SETTLE_ARCHIVE_DIR}/${(numbers.at(-1) ?? 0) + 1}.json`
}

/** Move the settled run's cancel request and acknowledgement aside under the reopen's and the
 *  request's operation ids, so the reopened run accepts a new `cancelRun`. Idempotent: an absent
 *  file is skipped. A reopen's operation id names one segment, so a later segment cancelled under
 *  the same cancel operation id lands beside this one instead of over it. */
function setCancellationAside(runDir: string, reopenOperationId: string): void {
  const requestFile = runCancelRequestFile(runDir)
  const ackFile = runCancellationFile(runDir)
  if (!existsSync(requestFile) && !existsSync(ackFile)) return
  const source = existsSync(requestFile) ? requestFile : ackFile
  const { operationId } = JSON.parse(readFileSync(source, 'utf8')) as {
    readonly operationId: string
  }
  const reopenedDir = join(workerCancellationsDir(runDir), 'reopened')
  const aside = join(
    reopenedDir,
    encodeURIComponent(reopenOperationId),
    encodeURIComponent(operationId),
  )
  mkdirSync(aside, { recursive: true })
  if (existsSync(ackFile)) renameSync(ackFile, join(aside, 'run.json'))
  if (existsSync(requestFile)) renameSync(requestFile, join(aside, 'run.request.json'))
  syncDurableDirectory(aside)
  syncDurableDirectory(join(reopenedDir, encodeURIComponent(reopenOperationId)))
  syncDurableDirectory(reopenedDir)
  syncDurableDirectory(workerCancellationsDir(runDir))
}

async function readBytes(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
