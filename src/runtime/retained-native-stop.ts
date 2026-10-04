import {
  type AgentExactRunControlRef,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { awaitAbortable } from './retained-run-binding'
import { reconnectRetainedRun } from './retained-run-start'
import type { RetainedRunEffect, RetainedRunHandle } from './retained-run-types'
import { errorText } from './supervise/error-message'
import { sleep } from './util'

/** One request per run: every caller that stops the same execution replays one provider operation,
 *  so the operation id and its reason never disagree across a teardown and a release. */
const NATIVE_STOP_REASON = 'Runtime stopped the native harness: its execution is no longer observed'
/** How often a stop the provider accepted asynchronously reads the run's status. */
const STOP_STATUS_POLL_MS = 1_000

/** What one attempt to stop a retained execution's native harness process established. */
export interface RetainedNativeStop {
  readonly executionId: string
  /** `cancelled`: the provider stopped a live execution. `not_live`: it had already ended. Any
   *  other effect leaves the native process unconfirmed. */
  readonly effect: RetainedRunEffect
  readonly at: string
  readonly error?: string
}

/**
 * Stop the native harness process of a retained execution that Runtime no longer observes.
 *
 * A retained execution outlives its local stream by design, so an aborted observer can reconnect.
 * Keeping its environment preserves the files; it must not keep the harness running. Measured on
 * Discovery: after `disco cancel` on 2026-10-04 the kept root box ran `claude --print` for two
 * more minutes, untraced and charged to the subscription, until an operator stopped the box; on
 * 2026-10-03 a cancelled run kept 18 boxes whose `claude` processes ran until an operator stopped
 * them. The provider's exact cancellation stops the process; the box and its files stay.
 *
 * The operation id is derived from the run reference, so a repeated stop replays the first one.
 * Never rejects: the answer is evidence for the teardown receipt.
 */
export async function stopRetainedNativeExecution(options: {
  readonly provider: AgentEnvironmentProvider
  readonly controlRef: AgentExactRunControlRef
  /** The live handle, when this process holds one; otherwise the reference is reconnected. */
  readonly handle?: RetainedRunHandle
  /** Bounds the whole stop, so an unanswered provider cannot hold up a release. */
  readonly signal: AbortSignal
  readonly now?: () => number
}): Promise<RetainedNativeStop> {
  const now = options.now ?? Date.now
  const executionId = options.controlRef.executionId
  const operationId = `runtime-native-stop-${canonicalCandidateDigest({
    kind: 'runtime-native-stop.v1',
    run: options.controlRef,
  }).slice('sha256:'.length)}`
  // The last effect the provider confirmed, kept when the deadline cuts the stop short.
  let effect: RetainedRunEffect = 'unknown'
  const stop = async (): Promise<RetainedRunEffect> => {
    const handle =
      options.handle ??
      (await reconnectRetainedRun({ provider: options.provider, controlRef: options.controlRef }))
    // The provider no longer holds the environment, so nothing inside it can still run.
    if (handle === null) return 'not_live'
    const cancellation = await handle.cancel({
      operationId,
      reason: NATIVE_STOP_REASON,
      signal: options.signal,
    })
    effect = cancellation.status === 'conflict' ? 'unknown' : cancellation.effect
    // An asynchronous provider acknowledges the request before the process ends. Only a terminal
    // status proves it stopped, so the stop waits for one within its deadline.
    while (effect === 'cancel_requested') {
      await sleep(STOP_STATUS_POLL_MS, options.signal)
      const current = await handle.status({ signal: options.signal })
      if (current.effect === 'cancelled' || current.effect === 'not_live') effect = current.effect
    }
    return effect
  }
  try {
    // The deadline covers the reconnect too: its capability and environment reads are provider
    // calls, and a release that awaits this stop must not wait on a stalled one.
    effect = await awaitAbortable(stop(), options.signal)
    return { executionId, effect, at: new Date(now()).toISOString() }
  } catch (error) {
    return {
      executionId,
      effect: effect === 'cancel_requested' ? effect : 'unknown',
      at: new Date(now()).toISOString(),
      error: errorText(error instanceof Error ? error.message : error).slice(0, 512),
    }
  }
}

/**
 * The teardown-receipt text for stopped executions. A killed harness never reports the usage of
 * its last turn, so the receipt says so instead of letting a reader take the settled spend as
 * complete.
 */
export function describeRetainedNativeStops(stops: ReadonlyArray<RetainedNativeStop>): string {
  return stops
    .map((stop) => {
      if (stop.effect === 'cancelled') {
        return `native execution ${stop.executionId} stopped at ${stop.at}; usage unknown: killed at ${stop.at}`
      }
      if (stop.effect === 'not_live') {
        return `native execution ${stop.executionId} was not live at ${stop.at}`
      }
      return `native execution ${stop.executionId} stop unconfirmed at ${stop.at} (effect ${stop.effect}${
        stop.error === undefined ? '' : `: ${stop.error}`
      }); it may still be running`
    })
    .join('; ')
}
