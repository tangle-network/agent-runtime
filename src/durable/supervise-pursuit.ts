import { resolve } from 'node:path'
import type { SupervisorProfile } from '../runtime/supervise/supervisor-agent'
import {
  supervise,
  type SuperviseOptions,
} from '../runtime/supervise/supervise'
import { composeRuntimeHooks } from '../runtime-hooks'
import { createFileObserverHooks } from './observer-journal'
import { projectPursuit, type PursuitProjection } from './observer-projection'

export interface SupervisePursuitOptions extends SuperviseOptions {
  /** Stable objective identity spanning concrete Runtime runs. */
  readonly pursuitId: string
  /**
   * Shared durable observer file. Defaults under `runDir`. Supply an explicit
   * path when one pursuit intentionally spans multiple run directories.
   */
  readonly observerPath?: string
}

export interface SupervisedPursuitResult<Result> {
  readonly result: Result
  readonly pursuit: PursuitProjection
  readonly observerPath: string
}

/**
 * One-call durable pursuit execution over the canonical `supervise()` kernel.
 *
 * This is an adapter, not a second executor: it composes a durable third-person
 * observer into Runtime's existing recursive hook stream and then rebuilds the
 * operator projection after the same `supervise()` call settles. The agents never
 * receive the observer path or projection and their behavior does not depend on it.
 *
 * A pursuit must have durable observer storage. `runDir` is the normal path; an
 * explicit `observerPath` supports a pursuit that spans several concrete run dirs.
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
  const observerPath = resolveObserverPath(opts)
  const { pursuitId: _pursuitId, observerPath: _observerPath, hooks, ...superviseOptions } = opts
  const observer = createFileObserverHooks(observerPath, pursuitId)

  const result = await supervise(profile, task, {
    ...superviseOptions,
    hooks: composeRuntimeHooks(hooks, observer.hooks),
  })

  // Runtime hook notifications are deliberately non-blocking for execution. `read()`
  // joins the journal's serialized append tail here, so the returned projection covers
  // every observer append that was scheduled by this execution before settlement.
  const records = await observer.journal.read()
  if (records.length === 0) {
    throw new Error('supervisePursuit: execution produced no observer records')
  }
  return Object.freeze({
    result,
    pursuit: projectPursuit(records),
    observerPath,
  })
}

function resolveObserverPath(opts: SupervisePursuitOptions): string {
  if (opts.observerPath !== undefined) {
    const path = opts.observerPath.trim()
    if (path.length === 0) throw new TypeError('supervisePursuit: observerPath must be non-empty')
    return resolve(path)
  }
  if (opts.runDir === undefined) {
    throw new TypeError(
      'supervisePursuit: provide runDir or observerPath; pursuit observation must be durable',
    )
  }
  return resolve(opts.runDir, 'observer.jsonl')
}
