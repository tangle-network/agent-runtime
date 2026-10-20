import type { ExecutorCancellation } from './types'

/**
 * The honest answer for a backend with no cancel operation: the local request stopped, and
 * nothing about the remote run is known. Never `accepted` — a client that advertises provider
 * cancellation from this would claim more than Runtime observed.
 */
export function localAbortCancellation(detail: string): ExecutorCancellation {
  return {
    status: 'unknown',
    effect: 'cancel_requested',
    observedAt: new Date().toISOString(),
    detail,
  }
}
