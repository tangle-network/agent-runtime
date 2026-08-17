import { resolve } from 'node:path'
import { type SuperviseOptions, supervise } from '../runtime/supervise/supervise'
import type { SupervisorProfile } from '../runtime/supervise/supervisor-agent'
import {
  type RuntimeHookEvent,
  composeRuntimeHooks,
  withPursuitContext,
} from '../runtime-hooks'
import { createFileObserverHooks } from './observer-journal'
import { type PursuitProjection, projectPursuit } from './observer-projection'

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
}

/** A failed Runtime execution whose complete third-person projection was retained. */
export class SupervisePursuitError extends Error {
  readonly pursuit: PursuitProjection
  readonly observerPath: string

  constructor(cause: unknown, pursuit: PursuitProjection, observerPath: string) {
    super(`supervisePursuit: ${errorMessage(cause)}`, { cause })
    this.name = 'SupervisePursuitError'
    this.pursuit = pursuit
    this.observerPath = observerPath
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
  const { pursuitId: _pursuitId, hooks, ...superviseOptions } = opts
  const observer = createFileObserverHooks(observerPath, pursuitId)
  const runId = superviseOptions.runId ?? 'supervise'
  const now = superviseOptions.now ?? Date.now

  // Root lifecycle is an observer-plane fact, not something the manager has to
  // narrate about itself. This also makes a zero-spawn/single-agent run observable.
  await observer.journal.appendEvent(rootEvent(pursuitId, runId, 'before', now()))

  try {
    const result = await supervise(profile, task, {
      ...superviseOptions,
      // The observer runs first so a caller hook that throws cannot prevent the
      // canonical lifecycle fact from entering the durable journal.
      hooks: withPursuitContext(
        pursuitId,
        composeRuntimeHooks(observer.hooks, hooks),
      ),
    })
    await observer.journal.appendEvent(
      rootEvent(pursuitId, runId, 'after', now(), { status: 'done' }),
    )
    return Object.freeze({
      result,
      pursuit: projectPursuit(await observer.journal.read()),
      observerPath,
    })
  } catch (error) {
    let pursuit: PursuitProjection | undefined
    let observerError: unknown
    try {
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
    throw new SupervisePursuitError(error, pursuit, observerPath)
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
