import { randomUUID } from 'node:crypto'
import type { AgentExactRunControlRef } from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import {
  describeRetainedNativeStops,
  type RetainedNativeStop,
  stopRetainedNativeExecution,
} from '../retained-native-stop'
import { awaitAbortable } from '../retained-run-binding'
import type { RetainedRunHandle } from '../retained-run-types'
import { isDeadlineAbortReason } from '../supervise/deadline'
import { errorText } from '../supervise/error-message'
import type { RetainedExecutorContext } from '../supervise/retained-executor'
import type { EnvironmentTeardownReceipt } from '../supervise/types'

interface ProviderNativeControlState {
  readonly retained: RetainedRunHandle | undefined
  harnessStopped: boolean
  cancelledExplicitly(): boolean
}

export function createProviderNativeControl(
  provider: AgentEnvironmentProvider,
  retention: RetainedExecutorContext | undefined,
  managerStop: AbortSignal | undefined,
  state: ProviderNativeControlState,
) {
  let nativeStop: Promise<RetainedNativeStop | undefined> | undefined
  const cancelRetainedOnManagerStop = (handle: RetainedRunHandle): void => {
    if (managerStop === undefined) return
    const cancel = (): void => {
      void handle
        .cancel({
          operationId: `manager-stop:${randomUUID()}`,
          reason: String(managerStop.reason ?? 'the manager stopped'),
        })
        .catch(() => undefined)
    }
    if (managerStop.aborted) cancel()
    else managerStop.addEventListener('abort', cancel, { once: true })
  }
  /**
   * Stop the native harness of this executor's retained execution. Local observation ending does
   * not stop a retained execution, so an environment kept after it keeps its harness spending
   * unless the provider is asked to stop it. Undefined when nothing was dispatched.
   */
  const stopNativeExecution = (): Promise<RetainedNativeStop | undefined> => {
    if (nativeStop !== undefined) return nativeStop
    const controlRef = state.retained?.controlRef ?? admittedControlRef(retention)
    if (controlRef === undefined) return Promise.resolve(undefined)
    const stopping = stopRetainedNativeExecution({
      provider,
      controlRef,
      ...(state.retained === undefined ? {} : { handle: state.retained }),
      signal: AbortSignal.timeout(NATIVE_STOP_TIMEOUT_MS),
    }).then((stop) => {
      if (stop.effect === 'cancelled' || stop.effect === 'not_live') state.harnessStopped = true
      else if (nativeStop === stopping) nativeStop = undefined
      return stop
    })
    nativeStop = stopping
    return stopping
  }
  /**
   * A turn that its deadline or an explicit cancellation ended stops its harness, and waits within
   * the stop's bound for the provider to report it stopped, before the turn's final native copy.
   * Nothing else stops a retained execution before teardown, so that copy read a session the
   * harness was still writing and was stored partial (2026-10-04 trace proof:
   * `native_snapshot_live`, `events_not_settled`), and the harness spent past its deadline.
   */
  const stopEndedHarness = async (signal: AbortSignal): Promise<void> => {
    if (!isDeadlineAbortReason(signal.reason) && !state.cancelledExplicitly()) return
    await stopNativeExecution()
  }
  /**
   * A release that keeps an environment keeps its files, never its running harness. The root has
   * settled and no process will reconcile this execution, so its native process stops before the
   * release records what it kept.
   */
  const withoutRunningHarness =
    (release: (signal: AbortSignal) => Promise<ReadonlyArray<EnvironmentTeardownReceipt>>) =>
    async (signal: AbortSignal): Promise<ReadonlyArray<EnvironmentTeardownReceipt>> => {
      const receipts = await release(signal)
      if (receipts.every((receipt) => receipt.destroyed)) return receipts
      const stop = await awaitAbortable(stopNativeExecution(), signal).catch(
        (error: unknown): RetainedNativeStop | undefined => {
          const controlRef = state.retained?.controlRef ?? admittedControlRef(retention)
          return controlRef === undefined
            ? undefined
            : {
                executionId: controlRef.executionId,
                effect: 'unknown',
                at: new Date().toISOString(),
                error: errorText(error instanceof Error ? error.message : error),
              }
        },
      )
      if (stop === undefined) return receipts
      const stopped = describeRetainedNativeStops([stop])
      return receipts.map((receipt) =>
        receipt.destroyed
          ? receipt
          : { ...receipt, detail: receipt.detail ? `${receipt.detail}; ${stopped}` : stopped },
      )
    }
  return {
    cancelRetainedOnManagerStop,
    stopNativeExecution,
    stopEndedHarness,
    withoutRunningHarness,
  }
}

/** The exact run the latest durable dispatch names, when dispatch got that far. */
export function admittedControlRef(
  retention: RetainedExecutorContext | undefined,
): AgentExactRunControlRef | undefined {
  for (const admission of [...(retention?.admissions ?? [])].reverse()) {
    if (admission.phase === 'dispatched') return admission.controlRef
  }
  return undefined
}

/** Bounds one provider stop: a reconnect, the exact cancellation and its status read. */
const NATIVE_STOP_TIMEOUT_MS = 30_000
