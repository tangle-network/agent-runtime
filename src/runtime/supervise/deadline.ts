import { ValidationError } from '../../errors'
import type { Executor } from './types'

// Node clamps larger delays to 1 ms instead of waiting, so long budgets must be armed in chunks.
const MAX_TIMER_DELAY_MS = 2_147_483_647

export const DEFAULT_SUCCESSFUL_SHUTDOWN_MS = 5_000
const TEARDOWN_ACKNOWLEDGEMENT_MS = 250

/** Arm one wall-clock deadline without keeping the Node.js process alive. */
export function armDeadlineTimer(delayMs: number, onDeadline: () => void): () => void {
  const deadlineAtMs = Date.now() + Math.max(0, delayMs)
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
    if (typeof timer.unref === 'function') timer.unref()
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

/** Invoke teardown once and bound how long the runtime waits for its acknowledgement. A hard
 * execution deadline always wins; without one, numeric grace gets a short acknowledgement
 * allowance and a brutal kill gets only that allowance. Explicit `infinity` remains unbounded
 * only when no execution deadline exists. The losing promise stays observed. */
export async function teardownExecutor<Out>(
  executor: Executor<Out>,
  grace: number | 'brutalKill' | 'infinity',
  deadlineAtMs: number | undefined,
  now: () => number,
): Promise<void> {
  const work = Promise.resolve(executor.teardown(grace))

  const requestedWaitMs =
    grace === 'infinity'
      ? undefined
      : grace === 'brutalKill'
        ? TEARDOWN_ACKNOWLEDGEMENT_MS
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

  let receipt: { destroyed: boolean }
  if (waitMs === undefined) {
    receipt = await work
  } else if (waitMs <= 0) {
    void work.catch(() => undefined)
    throw new ValidationError('executor teardown did not acknowledge before its deadline')
  } else {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(new ValidationError(`executor teardown did not acknowledge within ${waitMs}ms`)),
        waitMs,
      )
    })
    try {
      receipt = await Promise.race([work, timedOut])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  if (!receipt.destroyed) {
    throw new ValidationError('executor teardown reported destroyed=false')
  }
}
