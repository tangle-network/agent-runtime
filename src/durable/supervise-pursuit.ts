import { resolve } from 'node:path'
import { readRootStreamReceipt } from '../runtime/supervise/root-stream'
import { supervisorRunDir } from '../runtime/supervise/run-layout'
import { type SuperviseOptions, supervise } from '../runtime/supervise/supervise'
import type { SupervisorProfile } from '../runtime/supervise/supervisor-agent'
import { composeRuntimeHooks, type RuntimeHookEvent, withPursuitContext } from '../runtime-hooks'
import { createFileObserverHooks } from './observer-journal'
import { type PursuitProjection, projectPursuit } from './observer-projection'
import {
  type PursuitVersions,
  type PursuitVersionsRecord,
  runPursuitVersions,
} from './pursuit-versions'
import { type PursuitFork, prepareRunFork } from './run-fork'
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
  /**
   * Always `'release'`. The settle record refuses re-entry, so no later call resumes a settled
   * pursuit and nothing else would release the provider environments its retained children hold.
   * `'keep'` is refused rather than ignored.
   */
  readonly retainedAtSettlement?: 'release'
  /**
   * Run this pursuit as a version of a settled run: `profile`, `task` and `budget` must equal the
   * parent's recorded root, and Runtime executes the parent's profile with `fork.change` applied.
   * The root's `execution.correlation` records the parent, its sealed digest, the change and the
   * lineage (`RUN_FORK_CORRELATION_KEYS`). The fork's `runDir` must lie outside the parent's, and
   * the parent's outside it. The parent's directory is never written, and a refused fork, such as
   * one whose parent has an uncertain node, writes nothing.
   */
  readonly fork?: PursuitFork
  /**
   * Continue this pursuit across versions. The first version runs at `runDir` as usual, or is
   * read back when that directory already settled. After each version settles, `versions.judge`
   * scores it from outside its tree; unless `versions.stop` ends the chain, the next version forks
   * from the best version so far with the change `versions.next` returns, at `<runDir>.v<n>` with
   * run id `<runId>.v<n>`. `<runDir>.versions/versions.jsonl` records every version, its parent,
   * its change, its verdict and its dollars, and the stop. A call on a chain that stopped reads
   * that record back; a call on a chain that did not resumes it without re-running or re-judging a
   * settled version. The call returns the best version's result with the chain's record.
   */
  readonly versions?: PursuitVersions
}

export interface SupervisedPursuitResult<Result> {
  readonly result: Result
  readonly pursuit: PursuitProjection
  readonly observerPath: string
  /** `runDir/result.json`: `result` as canonical JSON, written once at settle. */
  readonly settlePath: string
  /** The version chain's record, when the call set `versions`. */
  readonly versions?: PursuitVersionsRecord
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
 * An abandoned `supervise.lock.guard` requires removal after confirming no lock mutation is active.
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
  if ((opts.retainedAtSettlement as string | undefined) === 'keep') {
    throw new TypeError(
      "supervisePursuit: retainedAtSettlement 'keep' cannot hold, because a settled pursuit is never re-entered",
    )
  }

  if (opts.versions !== undefined) {
    return runPursuitVersions(
      profile,
      task,
      opts as SupervisePursuitOptions & { readonly versions: PursuitVersions },
      supervisePursuit,
    ) as Promise<SupervisedPursuitResult<Awaited<ReturnType<typeof supervise>>>>
  }

  const observerPath = resolve(runDir, 'observer.jsonl')
  const settlePath = resolve(runDir, SETTLE_RECORD_FILE)
  const failurePath = resolve(runDir, FAILURE_RECORD_FILE)
  const { pursuitId: _pursuitId, hooks, fork, versions: _versions, ...superviseOptions } = opts
  const runId = superviseOptions.runId ?? 'supervise'
  const now = superviseOptions.now ?? Date.now

  // A fork is verified on every entry, a resume included, so the recorded root identity it
  // derives is the one the Supervisor's resume contract compares against. It reads only the
  // settled parent, and runs before the lock so a refused fork writes nothing, not even runDir.
  const forked =
    fork === undefined ? undefined : await prepareRunFork(profile, task, superviseOptions, fork)

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
      result = await supervise(forked?.profile ?? profile, task, {
        ...superviseOptions,
        ...(forked === undefined ? {} : { execution: forked.execution }),
        // `runDir` owns the pursuit journal and terminal records. The public steer writer addresses
        // the canonical per-run event directory beneath that root, so keep its control plane there
        // without moving the durable pursuit records.
        steerDir: superviseOptions.steerDir ?? supervisorRunDir(runDir, runId),
        // The settle record written below makes this settlement final, so the environments a
        // retained child holds are released at the barrier instead of kept for a resume that the
        // record will refuse (measured 2026-09-11: 18 of a 60-slot fleet held 19 to 37 hours).
        retainedAtSettlement: 'release',
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
        // The root's stream is already on disk whether or not the run settled; the record names
        // it so a root that died mid-turn keeps what it had streamed.
        const rootStream = await readRootStreamReceipt(runDir)
        await writeFailureRecord(runDir, {
          runId,
          pursuitId,
          at: new Date(now()).toISOString(),
          error: { name: errorName(error), message: errorMessage(error) },
          ...(rootStream === undefined ? {} : { rootStream }),
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
