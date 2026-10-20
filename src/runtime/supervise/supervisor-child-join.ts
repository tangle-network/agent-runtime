import { RuntimeRunStateError } from '../../errors'
import { armDeadlineTimer } from './deadline'
import {
  hasRetriableTeardowns,
  releaseRetainedEnvironments,
  retryUnconfirmedTeardowns,
  unconfirmedTeardowns,
} from './scope'
import type { Scope, UnconfirmedTeardown } from './types'

/**
 * Drain the root scope's live set so every still-running/acquiring child is torn down
 * before `run` returns — the join barrier. Abort the cascade controller first (so each
 * child's executor stops cleanly), then pull `next()` to completion so every aborted
 * child's teardown + reconcile runs and its `settled` event is journaled by the scope.
 * A child's own teardown failure is already swallowed inside `runChild`, and the cursor
 * itself never rejects (a failing child is typed into a `down`), so the whole barrier is
 * `allSettled`'d — a stray throw here is NOT the primary error (firstError precedence).
 */
export async function drainLiveChildren(
  scope: Scope<unknown>,
  controller: AbortController,
  settleGraceMs: number | null = 0,
): Promise<ReadonlyArray<UnconfirmedTeardown>> {
  if (scope.view.inFlight === 0) {
    // Another cursor reader may have marked a child settled while its append is still pending.
    await drainCursor(scope)
    return unconfirmedTeardowns(scope)
  }
  // Cascade the abort into every live child's executor before draining — unless the caller granted
  // a settle grace, in which case the timer owns the cascade and the drain reads whatever the
  // children finish in the meantime. Exactly ONE cursor reader either way: the grace never races
  // `next()`, it only decides when the abort lands.
  let clearGraceTimer: (() => void) | undefined
  if (settleGraceMs !== null && settleGraceMs > 0 && !controller.signal.aborted) {
    clearGraceTimer = armDeadlineTimer(settleGraceMs, () =>
      controller.abort('root driver failed; child settle grace expired'),
    )
  } else if (settleGraceMs !== null && !controller.signal.aborted) {
    // Same event as the grace-timer branch above, so it carries the same named reason: one
    // path stating why and the other going silent is what put identical deaths in two
    // different diagnostic buckets.
    controller.abort('root driver failed; no child settle grace configured')
  }
  try {
    await drainCursor(scope)
  } finally {
    clearGraceTimer?.()
  }
  const after = scope.view
  if (after.inFlight > 0) {
    throw new RuntimeRunStateError(
      `supervisor: cleanup ended with ${after.inFlight} running and ${describeUnconfirmed(scope)}`,
    )
  }
  return unconfirmedTeardowns(scope)
}

/** Five minutes: long enough to outlast a provider's transient delete failures and a slow
 *  acknowledgement, short enough that a cancelled run still settles promptly. */
export const DEFAULT_TEARDOWN_CONFIRM_MS = 300_000

/** The fields a `teardown-pending` or `teardown-unconfirmed` record carries for one node. */
export function unconfirmedRecord(node: UnconfirmedTeardown) {
  return {
    id: node.id,
    label: node.label,
    runtime: node.runtime,
    status: node.status,
    ...(node.environments === undefined ? {} : { environments: node.environments }),
    ...(node.kept === undefined ? {} : { kept: node.kept }),
    ...(node.attempts === undefined ? {} : { attempts: node.attempts }),
    ...(node.detail === undefined ? {} : { detail: node.detail }),
  }
}

/**
 * Retry every unconfirmed teardown in the settled tree until each executor confirms destruction
 * or `windowMs` passes, and return what is still unconfirmed.
 *
 * Settled children are evidence about an EXECUTOR, not a cause of run failure, so the barrier
 * never fails the run over them; it asks again and then NAMES what it could not confirm. Backoff
 * starts at 1/300 of the window and doubles up to 1/10 of it, so the default window gives about
 * fourteen attempts. A request still running is awaited by later passes and never sent twice,
 * including a settlement request that missed its acknowledgement window, and it never holds up
 * another child's retry. Under `release`, a retained environment whose release
 * failed is released again; otherwise it is kept for a resume and not retried. The window is wall
 * clock, like the timers that pace it, so an injected `now` cannot stall it.
 */
export async function confirmSettledTeardowns(
  scope: Scope<unknown>,
  windowMs: number,
  release: boolean,
): Promise<ReadonlyArray<UnconfirmedTeardown>> {
  const closesAt = Date.now() + windowMs
  const maxDelayMs = windowMs / 10
  let delayMs = windowMs / 300
  let releasing: Promise<unknown> | undefined
  let failure: { error: unknown } | undefined
  while (failure === undefined && hasRetriableTeardowns(scope, release)) {
    if (closesAt - Date.now() <= 0) break
    await pause(Math.min(delayMs, closesAt - Date.now()))
    delayMs = Math.min(delayMs * 2, maxDelayMs)
    // One release in flight at a time: each one journals its receipts.
    if (release && releasing === undefined) {
      releasing = releaseRetainedEnvironments(scope).finally(() => {
        releasing = undefined
      })
    }
    const pass = Promise.all([releasing, retryUnconfirmedTeardowns(scope)]).catch(
      (error: unknown) => {
        failure ??= { error }
      },
    )
    const answerWindow = pausable(Math.min(delayMs, Math.max(0, closesAt - Date.now())))
    await Promise.race([pass, answerWindow.elapsed])
    answerWindow.cancel()
  }
  // A release still in flight journals its receipts; let it finish (each destroy it asks for is
  // bounded) so nothing writes to this run's journal after the run has settled.
  const inFlight: Promise<unknown> | undefined = releasing
  if (inFlight !== undefined) {
    await inFlight.catch((error: unknown) => {
      failure ??= { error }
    })
  }
  // A journal write that failed inside a release is a real fault; it is the barrier's to report.
  if (failure !== undefined) throw failure.error
  return unconfirmedTeardowns(scope)
}

/** A wall-clock wait that keeps the process alive until it ends. */
function pause(ms: number): Promise<void> {
  return pausable(ms).elapsed
}

/** A wall-clock wait that can be cancelled, so a wait that lost a race holds no timer open. */
function pausable(ms: number): { elapsed: Promise<void>; cancel: () => void } {
  if (ms <= 0) return { elapsed: Promise.resolve(), cancel: () => {} }
  let cancel = (): void => {}
  const elapsed = new Promise<void>((resolve) => {
    cancel = armDeadlineTimer(ms, resolve, true)
  })
  return { elapsed, cancel }
}

/** The unconfirmed set as one error clause: the count plus the node ids behind it. One integer is
 *  not actionable after a six-hour run. */
function describeUnconfirmed(scope: Scope<unknown>): string {
  const unconfirmed = scope.workerCapacity.unconfirmed
  const named = unconfirmed
    .map(
      (node) =>
        `${node.id} (${[
          node.label,
          node.runtime,
          node.status,
          ...(node.environments ?? []).map(
            (environment) => `${environment.provider}:${environment.environmentId}`,
          ),
        ].join(', ')})`,
    )
    .join(', ')
  return `${unconfirmed.length} executor resource(s) not confirmed destroyed${
    named.length > 0 ? `: ${named}` : ''
  }`
}

/** The settle window a driver's children actually get: the caller's grace, never past an explicit
 *  run deadline. `null` means no timer. `0` (the default) cascades immediately. */
export function boundedSettleGrace(
  graceMs: number | null | undefined,
  deadlineAtMs: number,
  now: () => number,
): number | null {
  if (graceMs === null && deadlineAtMs <= 0) return null
  if (graceMs === null) return Math.max(0, deadlineAtMs - now())
  if (graceMs === undefined || graceMs <= 0) return 0
  if (deadlineAtMs <= 0) return graceMs
  return Math.max(0, Math.min(graceMs, deadlineAtMs - now()))
}

async function drainCursor(scope: Scope<unknown>): Promise<void> {
  for (;;) {
    const settled = await scope.next()
    if (settled === null) return
  }
}
