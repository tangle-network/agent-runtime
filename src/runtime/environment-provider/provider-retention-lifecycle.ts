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
import {
  ACCEPTED_RESULT_GRACE_MS,
  armDeadlineTimer,
  isDeadlineAbortReason,
} from '../supervise/deadline'
import type { RetainedExecutorContext } from '../supervise/retained-executor'
import type { EnvironmentTeardownReceipt } from '../supervise/types'
import { admittedEnvironmentId } from './provider-environment-teardown'

interface ProviderNativeControlState {
  readonly retained: RetainedRunHandle | undefined
  harnessStopped: boolean
  workspacePreservationRequired: boolean
  workspaceRunActive: boolean
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
      if (state.retained !== handle || !state.workspaceRunActive || state.harnessStopped) return
      void handle
        .cancel({
          operationId: `manager-stop:${randomUUID()}`,
          reason: String(managerStop.reason ?? 'the manager stopped'),
        })
        .catch(() => undefined)
    }
    const stop = (): void =>
      managerStop.reason === 'result-accepted'
        ? void armDeadlineTimer(ACCEPTED_RESULT_GRACE_MS, cancel)
        : cancel()
    if (managerStop.aborted) stop()
    else managerStop.addEventListener('abort', stop, { once: true })
  }
  /** Stop the native harness of this executor's retained execution, which local observation ending
   *  never stops. Undefined when nothing was dispatched. */
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
      if (stop.effect === 'cancelled' || stop.effect === 'not_live') {
        state.harnessStopped = true
        state.workspacePreservationRequired = false
      } else if (nativeStop === stopping) nativeStop = undefined
      return stop
    })
    nativeStop = stopping
    return stopping
  }
  /** Stop a retained harness when its turn's deadline or explicit cancellation ends it. */
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
      if (state.harnessStopped) return release(signal)
      const stop = await awaitAbortable(stopNativeExecution(), signal).catch(() => undefined)
      const stopped =
        stop === undefined
          ? 'native stop unconfirmed: no exact dispatch or cleanup interrupted'
          : describeRetainedNativeStops([stop])
      const controlRef = state.retained?.controlRef ?? admittedControlRef(retention)
      const environmentId = controlRef?.environmentId ?? admittedEnvironmentId(retention)
      if (environmentId !== undefined && !state.harnessStopped) {
        state.workspacePreservationRequired = true
        return [
          {
            provider: provider.name,
            environmentId,
            destroyed: false,
            detail: stopped,
            permanent: true,
          },
        ]
      }
      const receipts = await release(signal)
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
