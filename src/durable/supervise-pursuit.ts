import { open, readFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { canonicalCandidateJson } from '@tangle-network/agent-interface'
import { deriveNodeExecutionIdentity } from '../runtime/supervise/scope'
import { type SuperviseOptions, supervise } from '../runtime/supervise/supervise'
import type { SupervisorProfile } from '../runtime/supervise/supervisor-agent'
import { composeRuntimeHooks, type RuntimeHookEvent, withPursuitContext } from '../runtime-hooks'
import { isNoEntError, writeAllBytes } from './jsonl-file'
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

/** Runtime's own terminal record for one run, written once beside `observer.jsonl`. */
const RESULT_FILE = 'result.json'
const FAILURE_FILE = 'failure.json'

interface TerminalIdentity {
  readonly pursuitId: string
  readonly runId: string
  readonly profileDigest?: string
  readonly taskDigest?: string
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
 * The run's outcome outlives the process: a settled run writes `result.json` and a
 * thrown run writes `failure.json` beside `observer.jsonl`, once, as canonical JSON.
 * Either record makes the directory terminal for its `runId`; executing there again
 * requires a new `runId`, which retires the superseded record before spending.
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
  const runId = superviseOptions.runId ?? 'supervise'
  const now = superviseOptions.now ?? Date.now
  await retireTerminalRecords(runDir, runId)
  const identity = terminalIdentity(pursuitId, runId, profile, task)
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
      const failed = await observer.journal.appendEvent(
        rootEvent(pursuitId, runId, 'error', now(), {
          status: 'failed',
          error: errorMessage(error),
        }),
      )
      await writeTerminalRecord(resolve(runDir, FAILURE_FILE), {
        ...identity,
        settledAt: failed.observedAt,
        error: { name: errorName(error), message: errorMessage(error) },
      })
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
  // The record settles at the observer's terminal instant so it joins the projection's clock.
  const settled = await observer.journal.appendEvent(
    rootEvent(pursuitId, runId, 'after', now(), { status: 'done' }),
  )
  await writeTerminalRecord(resolve(runDir, RESULT_FILE), {
    ...identity,
    kind: result.kind,
    ...(result.kind === 'no-winner' ? { reason: result.reason } : {}),
    // agent-eval's runtime reader binds a `kind` to the spawn journal's root through
    // `tree.root` and refuses the record without it; the node snapshots stay out.
    tree: { root: result.tree.root },
    settledAt: settled.observedAt,
    spentTotal: result.spentTotal,
  })
  return Object.freeze({
    result,
    pursuit: projectPursuit(await observer.journal.read()),
    observerPath,
  })
}

/** The same derivation Runtime binds to its root node, so the record joins the journal's identity. */
function terminalIdentity(
  pursuitId: string,
  runId: string,
  profile: SupervisorProfile,
  task: unknown,
): TerminalIdentity {
  const identity = deriveNodeExecutionIdentity({ profile }, task)
  return {
    pursuitId,
    runId,
    ...(identity?.profileDigest ? { profileDigest: identity.profileDigest } : {}),
    ...(identity?.taskDigest ? { taskDigest: identity.taskDigest } : {}),
  }
}

/**
 * A terminal record settles the directory for the run it names: the same run must not execute
 * again over it, while a caller-named new run supersedes it and the stale record leaves before
 * the new run spends. A record that cannot be read fails closed, because executing over it
 * would spend against an outcome nobody can state.
 */
async function retireTerminalRecords(runDir: string, runId: string): Promise<void> {
  const superseded: string[] = []
  for (const file of [RESULT_FILE, FAILURE_FILE]) {
    const path = resolve(runDir, file)
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if (isNoEntError(error)) continue
      throw error
    }
    let recordedRunId: unknown
    try {
      recordedRunId = (JSON.parse(text) as { runId?: unknown } | null)?.runId
    } catch (cause) {
      throw new Error(`supervisePursuit: ${file} in ${runDir} is not a readable terminal record`, {
        cause,
      })
    }
    if (typeof recordedRunId !== 'string') {
      throw new Error(`supervisePursuit: ${file} in ${runDir} names no runId; refusing to execute`)
    }
    if (recordedRunId === runId) {
      throw new Error(
        `supervisePursuit: ${file} already records run '${runId}' in ${runDir}; supply a new runId to execute again`,
      )
    }
    superseded.push(path)
  }
  for (const path of superseded) await unlink(path)
}

/** The spawn journal's discipline: exclusive create, every byte written, fsync before acknowledgement. */
async function writeTerminalRecord(path: string, record: Record<string, unknown>): Promise<void> {
  const text = `${canonicalCandidateJson(record)}\n`
  const handle = await open(path, 'wx')
  try {
    await writeAllBytes(handle, text)
    await handle.sync()
  } finally {
    await handle.close()
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

/** Mirrors `NoWinnerError`: a non-`Error` rejection is normalized, never dropped. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'NonError'
}
