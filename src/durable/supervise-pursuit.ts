import { resolve } from 'node:path'
import { type SuperviseOptions, supervise } from '../runtime/supervise/supervise'
import type { SupervisorProfile } from '../runtime/supervise/supervisor-agent'
import { composeRuntimeHooks, type RuntimeHookEvent, withPursuitContext } from '../runtime-hooks'
import { createFileObserverHooks } from './observer-journal'
import { type PursuitProjection, projectPursuit } from './observer-projection'
import { acquireRunDirectoryLock } from './run-lock'
import {
  FAILURE_RECORD_FILE,
  readSettleRecord,
  SETTLE_RECORD_FILE,
  SettledRunDirectoryError,
  writeFailureRecord,
  writeSettleRecord,
} from './settle-record'

export interface SupervisePursuitOptions extends SuperviseOptions {
  /** Stable objective identity spanning concrete Runtime runs. */
  readonly pursuitId: string
  /**
   * One concrete Runtime execution owns one durable directory and observer journal.
   * A pursuit spanning several runs reuses `pursuitId` across distinct `runDir`s;
   * Intelligence joins those isolated projections without a shared write head.
   */
  readonly runDir: string
}

export interface SupervisedPursuitResult<Result> {
  readonly result: Result
  readonly pursuit: PursuitProjection
  readonly observerPath: string
  /** `runDir/result.json`: `result` as canonical JSON, written once at settle. */
  readonly settlePath: string
}

/** A failed Runtime execution whose complete third-person projection was retained. */
export class SupervisePursuitError extends Error {
  readonly pursuit: PursuitProjection
  readonly observerPath: string
  /** `runDir/failure.json`: the record of this throw. */
  readonly failurePath: string

  constructor(
    cause: unknown,
    pursuit: PursuitProjection,
    observerPath: string,
    failurePath: string,
  ) {
    super(`supervisePursuit: ${errorMessage(cause)}`, { cause })
    this.name = 'SupervisePursuitError'
    this.pursuit = pursuit
    this.observerPath = observerPath
    this.failurePath = failurePath
  }
}

/**
 * One-call durable pursuit execution over the canonical `supervise()` kernel.
 *
 * This is an adapter, not a second executor: it composes a durable third-person
 * observer into Runtime's existing recursive hook stream and then rebuilds the
 * operator projection after the same `supervise()` call settles. Agents never
 * receive the observer path or projection and their behavior does not depend on it.
 *
 * Every concrete execution writes only inside its own `runDir`. Cross-run pursuit
 * aggregation is therefore lock-free at the observer layer: reuse `pursuitId` across
 * run directories and let Intelligence join the independently verified projections.
 *
 * The directory's terminal state is recorded beside `observer.jsonl`: `result.json` holds the
 * returned result once the run settles and `failure.json` the most recent throw. A directory
 * whose `result.json` exists refuses re-entry before any compute; a failure record alone does
 * not, because a caller can correct its input and drive the same run again. For the life of the
 * call the directory is held by `supervise.lock`, so a second process on the same directory
 * refuses and names the holder instead of sharing one journal.
 */
export async function supervisePursuit(
  profile: SupervisorProfile,
  task: unknown,
  opts: SupervisePursuitOptions,
): Promise<SupervisedPursuitResult<Awaited<ReturnType<typeof supervise>>>> {
  const pursuitId = opts.pursuitId.trim()
  if (pursuitId.length === 0) {
    throw new TypeError('supervisePursuit: pursuitId must be non-empty')
  }
  const runDir = opts.runDir.trim()
  if (runDir.length === 0) {
    throw new TypeError('supervisePursuit: runDir must be non-empty')
  }

  const observerPath = resolve(runDir, 'observer.jsonl')
  const settlePath = resolve(runDir, SETTLE_RECORD_FILE)
  const failurePath = resolve(runDir, FAILURE_RECORD_FILE)
  const { pursuitId: _pursuitId, hooks, ...superviseOptions } = opts
  const runId = superviseOptions.runId ?? 'supervise'
  const now = superviseOptions.now ?? Date.now

  // The lock is taken before the settle record is read so a run that settles between the read
  // and the lock cannot be re-entered; both refusals happen before the observer journal is touched.
  const lock = await acquireRunDirectoryLock(runDir, runId, now)
  try {
    const settled = await readSettleRecord(runDir)
    if (settled !== undefined) {
      throw new SettledRunDirectoryError(settlePath, settled.tree.root, runId)
    }

    const observer = createFileObserverHooks(observerPath, pursuitId)

    // Root lifecycle is an observer-plane fact, not something the manager has to
    // narrate about itself. This also makes a zero-spawn/single-agent run observable.
    await observer.journal.appendEvent(rootEvent(pursuitId, runId, 'before', now()))

    let result: Awaited<ReturnType<typeof supervise>>
    try {
      result = await supervise(profile, task, {
        ...superviseOptions,
        // The observer runs first so a caller hook that throws cannot prevent the
        // canonical lifecycle fact from entering the durable journal.
        hooks: withPursuitContext(pursuitId, composeRuntimeHooks(observer.hooks, hooks)),
      })
    } catch (error) {
      let pursuit: PursuitProjection | undefined
      let observerError: unknown
      try {
        // The journal fact is raw evidence and lands first; the failure record summarizes it.
        await observer.journal.appendEvent(
          rootEvent(pursuitId, runId, 'error', now(), {
            status: 'failed',
            error: errorMessage(error),
          }),
        )
        pursuit = projectPursuit(await observer.journal.read())
      } catch (failure) {
        observerError = failure
      }
      if (observerError !== undefined || pursuit === undefined) {
        const causes = observerError === undefined ? [error] : [error, observerError]
        throw new Error(
          'supervisePursuit: Runtime failed and durable observer completeness could not be proven',
          { cause: new AggregateError(causes) },
        )
      }
      // A failure record that cannot be written must not hide the journal fact above; it is
      // reported as its own cause beside the run's error.
      try {
        await writeFailureRecord(runDir, {
          runId,
          pursuitId,
          at: new Date(now()).toISOString(),
          error: { name: errorName(error), message: errorMessage(error) },
        })
      } catch (recordError) {
        throw new Error(
          `supervisePursuit: Runtime failed and the failure record ${failurePath} could not be written`,
          { cause: new AggregateError([error, recordError]) },
        )
      }
      throw new SupervisePursuitError(error, pursuit, observerPath, failurePath)
    }

    // The settle record is the re-entry guard, so it is durable before the journal says `done`.
    // A record that cannot be written leaves the attempt open in the journal and the run
    // re-enterable, which replays the settled children and settles again.
    try {
      await writeSettleRecord(runDir, result)
    } catch (cause) {
      throw new Error(
        `supervisePursuit: Runtime settled but the settle record ${settlePath} could not be written`,
        { cause },
      )
    }
    await observer.journal.appendEvent(
      rootEvent(pursuitId, runId, 'after', now(), { status: 'done' }),
    )
    return Object.freeze({
      result,
      pursuit: projectPursuit(await observer.journal.read()),
      observerPath,
      settlePath,
    })
  } finally {
    await lock.release()
  }
}

function rootEvent(
  pursuitId: string,
  runId: string,
  phase: 'before' | 'after' | 'error',
  timestamp: number,
  payload?: Record<string, unknown>,
): RuntimeHookEvent {
  return Object.freeze({
    id: `${runId}:pursuit:${phase}:${timestamp}`,
    pursuitId,
    runId,
    target: 'agent.run',
    phase,
    timestamp,
    ...(payload ? { payload: Object.freeze({ ...payload }) } : {}),
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'NonError'
}
