import { ValidationError } from '../../errors'
import type { Executor } from './types'

// Node clamps larger delays to 1 ms instead of waiting, so long budgets must be armed in chunks.
const MAX_TIMER_DELAY_MS = 2_147_483_647

export const DEFAULT_SUCCESSFUL_SHUTDOWN_MS = 5_000
const TEARDOWN_ACKNOWLEDGEMENT_MS = 250

/** Arm a finite wall-clock deadline in safe chunks. Resource deadlines unref by default;
 * a standalone wait opts into keeping the process alive until it settles or is cancelled. */
export function armDeadlineTimer(
  delayMs: number,
  onDeadline: () => void,
  keepAlive = false,
): () => void {
  const deadlineAtMs = Date.now() + Math.max(0, delayMs)
  if (!Number.isFinite(delayMs) || !Number.isSafeInteger(Math.ceil(deadlineAtMs))) {
    throw new ValidationError('timer delay must produce a finite safe deadline')
  }
  let cleared = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const arm = (): void => {
    if (cleared) return
    const remainingMs = Math.max(0, deadlineAtMs - Date.now())
    timer = setTimeout(
      () => {
        if (cleared) return
        if (Date.now() >= deadlineAtMs) onDeadline()
        else arm()
      },
      Math.min(remainingMs, MAX_TIMER_DELAY_MS),
    )
    if (!keepAlive && typeof timer.unref === 'function') timer.unref()
  }

  arm()
  return () => {
    cleared = true
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Resolve a spawned child's duration into one absolute cutoff. An omitted child deadline inherits
 * the parent cutoff; an explicit child duration may shorten, but never extend, that cutoff.
 */
export function boundedChildDeadlineAt(
  parentDeadlineAtMs: number,
  childDeadlineMs: number | undefined,
  nowMs: number,
): number | undefined {
  const parent = parentDeadlineAtMs > 0 ? parentDeadlineAtMs : undefined
  const child = childDeadlineMs === undefined ? undefined : nowMs + childDeadlineMs
  if (parent === undefined) return child
  if (child === undefined) return parent
  return Math.min(parent, child)
}

/** One answer from `Executor.teardown`. */
export type TeardownAnswer = Awaited<ReturnType<Executor<unknown>['teardown']>>

/** Invoke teardown once and bound how long the runtime waits for its acknowledgement. A hard
 * execution deadline always wins; without one, numeric grace gets a short acknowledgement
 * allowance and a brutal kill gets only that allowance. Explicit `infinity` remains unbounded
 * only when no execution deadline exists. The losing promise stays observed. `ask` issues the
 * request; a scope passes its per-child single-flight asker (see `singleFlightTeardown`). */
export async function teardownExecutor<Out>(
  executor: Executor<Out>,
  grace: number | 'brutalKill' | 'infinity',
  deadlineAtMs: number | undefined,
  now: () => number,
  ask: (grace: number | 'brutalKill' | 'infinity') => Promise<TeardownAnswer> = (requested) =>
    Promise.resolve(executor.teardown(requested)),
): Promise<void> {
  const work = Promise.resolve(ask(grace))

  const requestedWaitMs =
    grace === 'infinity'
      ? undefined
      : grace === 'brutalKill'
        ? (executor.teardownTimeoutMs ?? TEARDOWN_ACKNOWLEDGEMENT_MS)
        : grace + TEARDOWN_ACKNOWLEDGEMENT_MS
  // The execution cutoff stops new work; cleanup still gets a small, bounded acknowledgement
  // window after that cutoff. Otherwise an already-resolved brutal kill invoked exactly at the
  // deadline would be mislabeled as a cleanup failure without receiving one microtask.
  const deadlineWaitMs =
    deadlineAtMs === undefined
      ? undefined
      : Math.max(0, deadlineAtMs - now()) + TEARDOWN_ACKNOWLEDGEMENT_MS
  const waitMs =
    requestedWaitMs === undefined
      ? deadlineWaitMs
      : deadlineWaitMs === undefined
        ? requestedWaitMs
        : Math.min(requestedWaitMs, deadlineWaitMs)

  let receipt: TeardownAnswer
  if (waitMs === undefined) {
    receipt = await work
  } else if (waitMs <= 0) {
    void work.catch(() => undefined)
    throw new ValidationError('executor teardown did not acknowledge before its deadline')
  } else {
    let clearTimer: (() => void) | undefined
    const timedOut = new Promise<never>((_resolve, reject) => {
      clearTimer = armDeadlineTimer(
        waitMs,
        () =>
          reject(new ValidationError(`executor teardown did not acknowledge within ${waitMs}ms`)),
        true,
      )
    })
    try {
      receipt = await Promise.race([work, timedOut])
    } finally {
      clearTimer?.()
    }
  }

  if (!receipt.destroyed) {
    throw new ValidationError(
      `executor teardown reported destroyed=false${receipt.detail ? `: ${receipt.detail}` : ''}`,
    )
  }
}

/**
 * The optional teardown surfaces a wrapping executor forwards, so wrapping never changes how a
 * child is released: the acknowledgement window a remote teardown needs, the release of a
 * retained execution at root settlement, and the environments an unconfirmed teardown names for
 * a sweeper. A wrapper that dropped `releaseRetained` left every retained child it wrapped
 * running after settlement. Each surface is present only when the inner executor implements it.
 */
export function teardownSurfaces(
  inner: Executor<unknown>,
): Pick<Executor<unknown>, 'teardownTimeoutMs' | 'releaseRetained' | 'heldEnvironments'> {
  return {
    ...(inner.teardownTimeoutMs === undefined
      ? {}
      : { teardownTimeoutMs: inner.teardownTimeoutMs }),
    ...(inner.releaseRetained === undefined
      ? {}
      : { releaseRetained: (signal: AbortSignal) => inner.releaseRetained!(signal) }),
    ...(inner.heldEnvironments === undefined
      ? {}
      : { heldEnvironments: () => inner.heldEnvironments!() }),
  }
}

/**
 * An asker that sends an executor at most one teardown at a time. While a request is still
 * running, every later ask returns that same request instead of sending another beside it.
 *
 * A settlement's own teardown has a short acknowledgement window, and a request that misses it
 * keeps running. Without this, the first settlement retry sent a second teardown next to the
 * first. An executor that does not deduplicate internally, such as one that re-issues its
 * cancels, then ran two teardowns at once. `onRequest` runs once for each request actually sent.
 */
export function singleFlightTeardown<Out>(
  executor: Executor<Out>,
  onRequest: () => void,
): (grace: number | 'brutalKill' | 'infinity') => Promise<TeardownAnswer> {
  let inFlight: Promise<TeardownAnswer> | undefined
  return (grace) => {
    if (inFlight !== undefined) return inFlight
    onRequest()
    let request: Promise<TeardownAnswer>
    try {
      request = Promise.resolve(executor.teardown(grace))
    } catch (error) {
      request = Promise.reject(error)
    }
    inFlight = request
    const settle = (): void => {
      if (inFlight === request) inFlight = undefined
    }
    request.then(settle, settle)
    return request
  }
}
