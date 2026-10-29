import { randomUUID } from 'node:crypto'
import type {
  AgentCandidateWorkspaceSnapshotEvidence,
  AgentExactRunControlRef,
  AgentProfile,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { type HarnessTranscriptCapture, retainHarnessTranscript } from '../harness-transcript'
import {
  captureProviderLiveWorkspace,
  captureProviderWorkspaceSnapshot,
  DEFAULT_NATIVE_CAPTURE_INTERVAL_MS,
  nativeCopyDelayMs,
  openNativeMirror,
  type ProviderNativeCapturePhase,
  type ProviderWorkspaceCaptureReceipt,
  workspaceCaptureReceipt,
} from '../provider-workspace-retention'
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
import type { EnvironmentTeardownReceipt, ExecutorNodeContext } from '../supervise/types'
import { sleep } from '../util'
import type { ProviderExecutorOptions } from './provider-executor-admission'
import type { StreamProviderExecutorArgs } from './provider-invocation'

interface ProviderCaptureMirrorState {
  readonly workspaceSnapshot: AgentCandidateWorkspaceSnapshotEvidence | undefined
  readonly workspaceCapturePromise: Promise<AgentCandidateWorkspaceSnapshotEvidence> | undefined
  readonly workspaceExecutionId: string
  readonly workspaceControlRef: AgentExactRunControlRef | undefined
  readonly providerSessionId: string | null
  harnessTranscript: HarnessTranscriptCapture
  readonly harnessStopped: boolean
}

export function createProviderCaptureMirrors(
  options: ProviderExecutorOptions,
  createProfile: AgentProfile,
  node: ExecutorNodeContext | undefined,
  state: ProviderCaptureMirrorState,
) {
  // THE NATIVE SESSION, DURABLE AS IT HAPPENS. A turn's workspace capture runs once, when the
  // turn settles or fails; a deadline, cancel or cascade closes the stream with `return()`,
  // which reaches neither, and a workspace over its byte bound fails the whole capture. On
  // Runtime 0.297.x that left 85 of 116 Discovery nodes that ran with no session at all. With a
  // port that offers `captureNative`, the harness's own session is copied to durable artifacts on
  // an interval while the turn runs and once more however the turn ends, so its transcript is
  // the latest stored copy rather than whatever the end of the turn managed to read.
  const nativePort =
    options.workspaceRetention?.captureNative === undefined ? undefined : options.workspaceRetention
  let nativeInFlight: Promise<void> | undefined
  // The periodic ('running') copy in flight and its stop. A turn's end cuts it short, as the live
  // mirror's: on Discovery canary test-acceptance-canary-20261019o (Runtime 0.332.2) the copy in
  // flight at a turn's end ran on for 47 s, and the workspace capture waited for it.
  let nativeRunningInFlight: Promise<void> | undefined
  let nativeRunningStop: AbortController | undefined
  let nativeTimer: ReturnType<typeof setTimeout> | undefined
  // Provider events seen, and the count the last stored copy saw: a running copy of a session that
  // received nothing since is skipped. The last copy's duration paces the next one.
  let nativeEvents = 0
  let nativeEventsAtCopy: number | undefined
  let lastNativeCopyMs = 0
  let closeNativeMirror: (() => void) | undefined
  const livePort =
    options.workspaceRetention?.captureLive === undefined ? undefined : options.workspaceRetention
  let liveInFlight: Promise<void> | undefined
  let liveTimer: ReturnType<typeof setTimeout> | undefined
  // Stops the copy in flight too: it holds a capture slot, and a timer that keeps the process alive,
  // for up to its own bound.
  let liveStop: AbortController | undefined
  const stopLiveMirror = (): void => {
    if (liveTimer !== undefined) clearTimeout(liveTimer)
    liveTimer = undefined
    liveStop?.abort(new Error('live workspace capture stopped: its turn ended'))
    liveStop = undefined
  }
  const startLiveMirror = (next: AgentEnvironment): void => {
    if (livePort?.liveIntervalMs === undefined) return
    stopLiveMirror()
    const stop = new AbortController()
    liveStop = stop
    const schedule = (): void => {
      liveTimer = setTimeout(() => {
        if (liveInFlight === undefined && state.workspaceCapturePromise === undefined) {
          const running = captureProviderLiveWorkspace(
            livePort,
            {
              environment: next,
              executionId: state.workspaceExecutionId,
              ...(state.workspaceControlRef === undefined
                ? {}
                : { controlRef: state.workspaceControlRef }),
              ...(node === undefined ? {} : { node }),
              providerSessionId: state.providerSessionId,
              nativeSessionId: null,
              profile: createProfile,
            },
            stop.signal,
          ).then(
            () => undefined,
            () => undefined,
          )
          const tracked = running.finally(() => {
            if (liveInFlight === tracked) liveInFlight = undefined
          })
          liveInFlight = tracked
        }
        schedule()
      }, livePort.liveIntervalMs)
      liveTimer.unref?.()
    }
    schedule()
  }
  // Whether `harnessTranscript` currently holds a native copy. A settled workspace capture is the
  // fuller record and replaces it; a native copy never replaces a settled workspace capture.
  let nativeHoldsTranscript = false
  // A copy that failed while none is held names the failure instead of leaving the placeholder.
  // 64 nodes whose every capture failed (connect timeouts, HTTP 503 from the
  // evidence archive, byte limits) settled `capture-did-not-run`, which reads as nobody trying
  // (#1360). A later copy that succeeds replaces this receipt.
  const noteCaptureFailure = (error: unknown): void => {
    if (nativeHoldsTranscript || state.harnessTranscript.status !== 'unavailable') return
    if (
      state.harnessTranscript.reason !== 'capture-did-not-run' &&
      state.harnessTranscript.reason !== 'enumeration-failed'
    ) {
      return
    }
    state.harnessTranscript = {
      status: 'unavailable',
      reason: 'enumeration-failed',
      skipped: [
        {
          path: state.workspaceExecutionId,
          reason: errorText(error instanceof Error ? error.message : error),
        },
      ],
    }
  }
  const stopNativeMirror = async (): Promise<void> => {
    if (nativeTimer !== undefined) clearTimeout(nativeTimer)
    nativeTimer = undefined
    closeNativeMirror?.()
    closeNativeMirror = undefined
    nativeRunningStop?.abort(new Error('native session copy stopped: its turn ended'))
    nativeRunningStop = undefined
    await nativeInFlight
  }
  const captureNative = (
    next: AgentEnvironment,
    phase: ProviderNativeCapturePhase,
    admitted?: AgentExactRunControlRef,
    /** The harness was stopped: copy again, briefly, until the provider records how it ended. */
    afterStop = false,
  ): Promise<void> => {
    if (nativePort === undefined || createProfile.harness === undefined) return Promise.resolve()
    const harness = createProfile.harness
    const stop = phase === 'running' ? new AbortController() : undefined
    if (stop !== undefined) nativeRunningStop = stop
    const run = (nativeInFlight ?? Promise.resolve()).then(async () => {
      stop?.signal.throwIfAborted()
      // Without an admitted reference or a session id the provider attributes the copy by this
      // execution's id, which it records as the stream starts; a one-shot turn has neither.
      const controlRef = state.workspaceControlRef ?? admitted
      const sessionId = state.providerSessionId ?? admitted?.sessionId ?? null
      // A settled workspace capture of this execution already holds the session.
      if (state.workspaceSnapshot !== undefined && !nativeHoldsTranscript) return
      const invocationId = state.workspaceExecutionId
      const eventsAtStart = nativeEvents
      const copyStartedAt = Date.now()
      try {
        const takeCopy = () =>
          captureProviderWorkspaceSnapshot(
            nativePort,
            {
              environment: next,
              executionId: invocationId,
              ...(controlRef === undefined ? {} : { controlRef }),
              ...(node === undefined ? {} : { node }),
              providerSessionId: sessionId,
              nativeSessionId: null,
              profile: createProfile,
              phase,
            },
            'native',
            undefined,
            stop?.signal,
          )
        let captured = await takeCopy()
        // A provider confirms a stop as soon as the process is gone and records how the execution
        // ended a moment later; until then its copy reports the session live. On the 2026-10-04
        // trace re-proof the copy 0.3 s after a deadline stop was `native_snapshot_live` with the
        // attempt outcome `unknown`, and a capture 1 s later was complete.
        const settleBy = Date.now() + NATIVE_SETTLE_WINDOW_MS
        while (
          afterStop &&
          captured.coverageComplete !== true &&
          (captured.provenance.attempts ?? []).some((attempt) => attempt.outcome === 'unknown') &&
          Date.now() < settleBy
        ) {
          await sleep(NATIVE_SETTLE_POLL_MS)
          captured = await takeCopy()
        }
        if (state.workspaceSnapshot !== undefined && !nativeHoldsTranscript) return
        const copy = retainHarnessTranscript(
          providerWorkspaceCaptureReceipt(
            {
              executionId: invocationId,
              profile: createProfile,
              ...(node === undefined ? {} : { node }),
              workspaceControlRef: () => controlRef,
              workspaceProvenance: () => captured.provenance,
              workspaceCoverage: () => ({
                complete: captured.coverageComplete ?? false,
                incompleteReason: captured.incompleteReason,
              }),
            },
            next,
            captured.snapshot,
            sessionId,
          ),
          harness,
        )
        // A copy that found no session file, taken before the provider attributed the session or
        // after the box stopped answering, never replaces one that holds the session.
        if (nativeHoldsTranscript && !(copy.status === 'retained' && copy.fileCount > 0)) return
        state.harnessTranscript = copy
        nativeHoldsTranscript = true
        nativeEventsAtCopy = eventsAtStart
      } catch (error) {
        // A copy its turn's end cut short failed nothing: the final copy follows it.
        if (stop?.signal.aborted) return
        // A failed copy keeps the previous one. The final copy at the end of the turn, or the
        // settled workspace capture, is the next chance; the transcript names what was kept.
        noteCaptureFailure(error)
      } finally {
        lastNativeCopyMs = Date.now() - copyStartedAt
      }
    })
    const tracked = run
      .catch(() => undefined)
      .finally(() => {
        if (nativeInFlight === tracked) nativeInFlight = undefined
        if (nativeRunningInFlight === tracked) nativeRunningInFlight = undefined
        if (nativeRunningStop === stop) nativeRunningStop = undefined
      })
    nativeInFlight = tracked
    if (stop !== undefined) nativeRunningInFlight = tracked
    return tracked
  }
  const startNativeMirror = (next: AgentEnvironment): void => {
    startLiveMirror(next)
    if (nativePort === undefined) return
    if (nativeTimer !== undefined) clearTimeout(nativeTimer)
    closeNativeMirror?.()
    closeNativeMirror = openNativeMirror(nativePort)
    const port = nativePort
    const interval = nativePort.nativeIntervalMs ?? DEFAULT_NATIVE_CAPTURE_INTERVAL_MS
    const schedule = (): void => {
      nativeTimer = setTimeout(
        () => {
          // A copy still running when the next falls due is not doubled, and a stored copy of a
          // session that received no event since is not taken again; the schedule continues.
          const unchanged = nativeHoldsTranscript && nativeEventsAtCopy === nativeEvents
          if (nativeInFlight === undefined && !unchanged) void captureNative(next, 'running')
          schedule()
        },
        nativeCopyDelayMs(port, interval, lastNativeCopyMs),
      )
      nativeTimer.unref?.()
    }
    schedule()
  }
  // Every way a turn ends: stop both intervals, then copy the session once more unless a settled
  // workspace capture of this execution already holds it. The live interval stops here because a
  // turn closed by its consumer (a deadline or a budget stop) in an environment kept for recovery
  // reaches neither a workspace capture nor a destroy, the two other places that stop it. Measured
  // on Discovery run terraform-dc-model-20261010h-c1 (Runtime 0.314.0): five directors stopped that
  // way kept their live captures running against stopped boxes for up to 18 hours, on the capture
  // slots the release's checkpoint captures share, and kept the settled supervisor's process alive.
  const finishNativeMirror = async (
    next: AgentEnvironment,
    phase: ProviderNativeCapturePhase,
  ): Promise<void> => {
    stopLiveMirror()
    await stopNativeMirror()
    if (state.workspaceSnapshot !== undefined && !nativeHoldsTranscript) return
    await captureNative(next, phase, undefined, state.harnessStopped)
  }

  return {
    get nativePort() {
      return nativePort
    },
    get nativeRunningInFlight() {
      return nativeRunningInFlight
    },
    get liveInFlight() {
      return liveInFlight
    },
    get holdsTranscript() {
      return nativeHoldsTranscript
    },
    set holdsTranscript(value: boolean) {
      nativeHoldsTranscript = value
    },
    stopScheduledNativeCapture() {
      if (nativeTimer !== undefined) clearTimeout(nativeTimer)
      nativeTimer = undefined
    },
    noteProviderEvent() {
      nativeEvents += 1
    },
    noteCaptureFailure,
    stopLiveMirror,
    captureNative,
    startNativeMirror,
    finishNativeMirror,
  }
}

/** How long the final copy of a stopped harness waits for the provider to record how it ended. */
const NATIVE_SETTLE_WINDOW_MS = 15_000

const NATIVE_SETTLE_POLL_MS = 1_000

interface ProviderNativeControlState {
  readonly retained: RetainedRunHandle | undefined
  harnessStopped: boolean
  workspacePreservationRequired: boolean
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
      const stop = await awaitAbortable(stopNativeExecution(), signal)
      const stopped = stop === undefined ? undefined : describeRetainedNativeStops([stop])
      const controlRef = state.retained?.controlRef ?? admittedControlRef(retention)
      if (stop !== undefined && !state.harnessStopped && controlRef !== undefined) {
        state.workspacePreservationRequired = true
        return [
          {
            provider: provider.name,
            environmentId: controlRef.environmentId,
            destroyed: false,
            detail: stopped,
            permanent: true,
          },
        ]
      }
      const receipts = await release(signal)
      return receipts.map((receipt) =>
        receipt.destroyed || stopped === undefined
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

export function providerWorkspaceCaptureReceipt(
  args: Pick<
    StreamProviderExecutorArgs,
    | 'executionId'
    | 'profile'
    | 'node'
    | 'workspaceProvenance'
    | 'workspaceCoverage'
    | 'workspaceControlRef'
  >,
  environment: AgentEnvironment,
  snapshot: AgentCandidateWorkspaceSnapshotEvidence,
  fallbackSessionId: string | null,
): ProviderWorkspaceCaptureReceipt {
  const coverage = args.workspaceCoverage()
  const controlRef = args.workspaceControlRef()
  return workspaceCaptureReceipt(
    {
      executionId: args.executionId,
      ...(controlRef === undefined ? {} : { controlRef }),
      ...(args.node === undefined ? {} : { node: args.node }),
      environment,
      profile: args.profile,
      providerSessionId: controlRef?.sessionId ?? fallbackSessionId,
    },
    {
      snapshot,
      provenance: args.workspaceProvenance() ?? {
        status: 'unavailable',
        missing: ['Capture coverage metadata was not retained'],
      },
      coverageComplete: coverage.complete,
      ...(coverage.incompleteReason === undefined
        ? {}
        : { incompleteReason: coverage.incompleteReason }),
    },
  )
}
