import { randomUUID } from 'node:crypto'
import {
  type AgentCandidateWorkspaceSnapshotEvidence,
  type AgentExactRunControlRef,
  type AgentProfile,
  canonicalAgentProfileDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import {
  captureHarnessTranscript,
  type HarnessTranscriptCapture,
  harnessTranscriptUnavailable,
  retainHarnessTranscript,
} from '../harness-transcript'
import {
  assertProviderWorkspaceRetentionPort,
  captureProviderWorkspaceSnapshot,
  type ProviderWorkspaceCaptureProvenance,
  type ProviderWorkspaceCaptureTiming,
} from '../provider-workspace-retention'
import { environmentGone } from '../retained-interactive-lifecycle'
import { awaitAbortable, freezeControlRef } from '../retained-run-binding'
import type { RetainedRunHandle } from '../retained-run-types'
import { linkAbort, RunCancellationReason } from '../supervise/abortable'
import { bridgeStopSignalKey } from '../supervise/bridge-config'
import { readOptionalAbortSignal } from '../supervise/executor-seams'
import {
  attestRuntimeOwnedPendingExecutor,
  finalizeRuntimeOwnedPendingExecutor,
  runtimeOwnedExecutorMaterialization,
} from '../supervise/materialization'
import {
  type RetainedExecutorContext,
  retainedExecutorContext,
} from '../supervise/retained-executor'
import { detachedSnapshot } from '../supervise/snapshot'
import { createPushTraceSource, type TraceSource } from '../supervise/trace-source'
import type {
  EnvironmentTeardownReceipt,
  Executor,
  ExecutorCancellation,
  ExecutorContext,
  ExecutorResult,
  HeldEnvironment,
  HeldForContinuation,
  Runtime,
  Spend,
  UsageEvent,
} from '../supervise/types'
import { unavailablePauseMs } from '../supervise/upstream-unavailable'
import { sleep } from '../util'
import type { ProviderExecutorOptions } from './provider-executor-admission'
import { streamProviderExecutor } from './provider-invocation'
import { providerMaterialization } from './provider-materialization'
import {
  admittedControlRef,
  createProviderCaptureMirrors,
  createProviderNativeControl,
  providerWorkspaceCaptureReceipt,
} from './provider-retention-lifecycle'
import { ValidationError } from './provider-validation-error'

export function createProviderExecutor(
  provider: AgentEnvironmentProvider,
  profile: AgentProfile,
  ctx: ExecutorContext,
  options: ProviderExecutorOptions,
  placement?: { id: string; digest: string },
): Executor<unknown> {
  if (options.workspaceRetention !== undefined) {
    assertProviderWorkspaceRetentionPort(
      options.workspaceRetention,
      `providerAsExecutor(${provider.name})`,
    )
  }
  const controller = new AbortController()
  const node =
    ctx.node === undefined ? undefined : detachedSnapshot(ctx.node, 'provider executor node')

  let environment: AgentEnvironment | undefined
  let artifact: ExecutorResult<unknown> | undefined
  let retained: RetainedRunHandle | undefined
  let pending = false
  // The child's own harness transcript, read out of the environment while it was still live.
  //
  // It is held HERE, on the executor, rather than only inside the settled result, because the
  // children whose reasoning an operator most wants are the ones that never produce a result:
  // a stream that throws lands in the `catch` below with no artifact to ride in (#1244). The
  // scope pulls this after `execute` resolves OR throws, exactly as it pulls `metered()`.
  //
  // Seeded, never left undefined, so the two absences stay apart: a child killed at admission
  // never had a box and keeps this seed, while a child whose box was created and then dropped
  // reports `capture-did-not-run`. Reporting the second as the first would file a child that
  // reasoned for twenty seconds as one that never ran — which is the #1240 population exactly.
  let harnessTranscript: HarnessTranscriptCapture =
    harnessTranscriptUnavailable('execution-never-started')
  const retention = retainedExecutorContext(ctx)
  // A manager's stop (an accepted `submit_result`, `stop`, a stop rule) ends its turn. The bridge
  // executor reads this seam at its turn boundary; a retained run asks its backend to cancel the
  // turn, so the stream ends and the harness session and the turn's usage are still read. Before,
  // a provider-placed director ran its harness on after acceptance: measured 2026-10-05, accepted
  // directors settled 13 to 29 minutes after their submissions. A run with no retained control
  // could only abort locally, which skips those reads, so it keeps running to the end of its turn.
  const managerStop = readOptionalAbortSignal(ctx, bridgeStopSignalKey, 'provider')
  // The stream destroys the environment on settle by default, so a later `teardown` would issue a
  // SECOND delete against a resource that is already gone. That second call is what the provider
  // answered 409 to.
  let destroyed = false
  // Set when the settled turn kept its environment for a keyed continuation; cleared when the
  // environment is released or handed to the successor node.
  let holdingForContinuation = false
  let workspaceEnvironmentId: string | undefined
  let workspaceSnapshot: AgentCandidateWorkspaceSnapshotEvidence | undefined
  let workspaceProvenance: ProviderWorkspaceCaptureProvenance | undefined
  let workspaceCoverageComplete = false
  let workspaceIncompleteReason: string | undefined
  let workspacePublishedSnapshot: AgentCandidateWorkspaceSnapshotEvidence | undefined
  let workspaceCaptureFailure: unknown
  let workspaceCapturePromise: Promise<AgentCandidateWorkspaceSnapshotEvidence> | undefined
  let workspaceCleanupPromise: Promise<TeardownAnswer> | undefined
  let retainedReleasePromise: Promise<ReadonlyArray<EnvironmentTeardownReceipt>> | undefined
  let releaseReadTried = false
  let releaseNativeTried = false
  let workspaceOutcome: AgentRunOutcome | undefined
  let workspacePreservationRequired = false
  let workspaceRunActive = false
  let providerSessionId: string | null = null
  let workspaceControlRef: AgentExactRunControlRef | undefined
  // A cancellation teardown and the release share one stop; only an unconfirmed answer is retried.
  // Whether the provider confirmed this execution's harness stopped.
  let harnessStopped = false
  // Settles when `harnessTranscript` is final for the running invocation
  // (`Executor.harnessTranscriptSettled`); settled between invocations.
  let transcriptSettled: Promise<void> = Promise.resolve()
  let settleTranscript: () => void = () => {}
  // The latest invocation's combined abort signal, which keeps the reason it was aborted with.
  let runSignal: AbortSignal | undefined
  const cancelledExplicitly = (): boolean =>
    ctx.signal?.reason instanceof RunCancellationReason ||
    runSignal?.reason instanceof RunCancellationReason

  const nativeControl = createProviderNativeControl(provider, retention, managerStop, {
    get retained() {
      return retained
    },
    get harnessStopped() {
      return harnessStopped
    },
    set harnessStopped(value) {
      harnessStopped = value
    },
    cancelledExplicitly,
  })

  const runtime = options.runtime ?? (provider.name as Runtime)
  // The exact bytes this executor hands to `provider.create`. A `profileForCreate` overlay changes
  // them, so the declaration carries the overlaid profile and exact turn execution refuses the run
  // rather than presenting the authored profile as what the provider received.
  const createProfile = options.profileForCreate?.(profile) ?? profile
  if (
    placement &&
    canonicalAgentProfileDigest(createProfile) !== canonicalAgentProfileDigest(profile)
  ) {
    throw new ValidationError(
      'provider placement: profileForCreate cannot change the selected profile',
    )
  }
  const executionId = retention?.executionId ?? node?.nodeId ?? `provider-run-${randomUUID()}`

  let workspaceExecutionId = executionId
  const resetWorkspaceState = (
    next: AgentEnvironment,
    invocationId = workspaceExecutionId,
  ): void => {
    if (workspaceEnvironmentId === next.id && workspaceExecutionId === invocationId) return
    workspaceEnvironmentId = next.id
    workspaceExecutionId = invocationId
    workspaceSnapshot = undefined
    workspaceProvenance = undefined
    workspaceCoverageComplete = false
    workspaceIncompleteReason = undefined
    workspacePublishedSnapshot = undefined
    workspaceCaptureFailure = undefined
    workspaceCapturePromise = undefined
    workspaceCleanupPromise = undefined
    retainedReleasePromise = undefined
    workspaceOutcome = undefined
    workspacePreservationRequired = false
    destroyed = false
  }

  // One executor may be retried. A retry is a new capture generation even when a provider
  // reuses its environment id; otherwise the prior turn's archive could authorize deleting a
  // workspace whose files changed during the retry. A failed generation stays fail-closed until
  // the caller constructs a fresh executor after resolving its unreceipted source.
  const beginWorkspaceExecution = (): void => {
    if (workspaceRunActive) {
      throw new ValidationError(`providerAsExecutor(${provider.name}): executor is already running`)
    }
    if (options.workspaceRetention !== undefined) {
      if (workspacePreservationRequired) {
        throw new ValidationError(
          `providerAsExecutor(${provider.name}): a prior failed execution has no retrievable workspace receipt; source remains preserved and this executor cannot be reused`,
        )
      }
      if (environment !== undefined && !destroyed) {
        throw new ValidationError(
          `providerAsExecutor(${provider.name}): the prior workspace environment is still live; teardown must release it before this executor can be reused`,
        )
      }
    }
    if (runtimeOwnedExecutorMaterialization(executor) !== undefined) {
      throw new ValidationError(
        `providerAsExecutor(${provider.name}): this executor has already materialized; create a new executor for another run`,
      )
    }
    if (environment !== undefined && destroyed) {
      // Do not leave a confirmed-destroyed handle in the next generation. If the new create fails
      // before onEnvironment runs, a later teardown must not retry deletion of the old source.
      environment = undefined
      workspaceEnvironmentId = undefined
    }
    workspaceRunActive = true
    workspaceControlRef = undefined
    providerSessionId = null
    workspaceSnapshot = undefined
    workspaceProvenance = undefined
    workspaceCoverageComplete = false
    workspaceIncompleteReason = undefined
    workspacePublishedSnapshot = undefined
    workspaceCaptureFailure = undefined
    workspaceCapturePromise = undefined
    workspaceCleanupPromise = undefined
    retainedReleasePromise = undefined
    workspaceOutcome = undefined
    workspacePreservationRequired = false
    destroyed = false
  }

  const captureWorkspace = async (
    next: AgentEnvironment,
    outcome: AgentRunOutcome | undefined,
  ): Promise<AgentCandidateWorkspaceSnapshotEvidence | undefined> => {
    const workspaceRetention = options.workspaceRetention
    if (workspaceRetention === undefined) return undefined
    resetWorkspaceState(next)
    if (workspaceSnapshot !== undefined) return workspaceSnapshot
    if (workspaceCapturePromise === undefined) {
      workspaceOutcome = outcome
      // A running copy may still be reading this environment. Finish it before the final
      // capture or destruction so the two snapshots have an unambiguous order.
      mirrors.stopLiveMirror()
      // The workspace capture reads the session too; an interval copy must not race it.
      mirrors.stopScheduledNativeCapture()
      const captureContext = {
        environment: next,
        executionId: workspaceExecutionId,
        ...(workspaceControlRef === undefined ? {} : { controlRef: workspaceControlRef }),
        ...(node === undefined ? {} : { node }),
        providerSessionId,
        nativeSessionId: null,
        profile: createProfile,
        ...(outcome === undefined ? {} : { outcome }),
      }
      // Where the capture's time went, journaled on the node before its outcome is used.
      const reportTiming = retention?.onWorkspaceCapture
      let timing: ProviderWorkspaceCaptureTiming | undefined
      const capturedExecutionId = workspaceExecutionId
      // Journaled before the capture waits for anything, so a reader sees it in flight; its
      // timing record is written after this one.
      const started =
        retention
          ?.onWorkspaceCaptureStarted?.({
            executionId: capturedExecutionId,
            environmentId: next.id,
          })
          .catch(() => undefined) ?? Promise.resolve()
      // A turn's final session copy runs beside this capture, which holds the session too.
      workspaceCapturePromise = Promise.all([mirrors.nativeRunningInFlight, mirrors.liveInFlight])
        .then(() =>
          captureProviderWorkspaceSnapshot(
            workspaceRetention,
            captureContext,
            'environment',
            reportTiming === undefined
              ? undefined
              : (measured) => {
                  timing = measured
                },
          ),
        )
        .finally(async () => {
          await started
          if (timing === undefined || reportTiming === undefined) return
          await reportTiming({
            executionId: capturedExecutionId,
            environmentId: next.id,
            ...timing,
          }).catch(() => undefined)
        })
        .then(({ snapshot, provenance, coverageComplete, incompleteReason }) => {
          workspaceSnapshot = snapshot
          workspaceProvenance = provenance
          workspaceCoverageComplete = coverageComplete ?? false
          workspaceIncompleteReason = incompleteReason
          try {
            harnessTranscript =
              createProfile.harness === undefined
                ? harnessTranscriptUnavailable('unknown-harness')
                : retainHarnessTranscript(
                    providerWorkspaceCaptureReceipt(
                      {
                        executionId: workspaceExecutionId,
                        profile: createProfile,
                        ...(node === undefined ? {} : { node }),
                        workspaceControlRef: () => workspaceControlRef,
                        workspaceProvenance: () => provenance,
                        workspaceCoverage: () => ({
                          complete: coverageComplete ?? false,
                          incompleteReason,
                        }),
                      },
                      next,
                      snapshot,
                      providerSessionId,
                    ),
                    createProfile.harness,
                  )
            mirrors.holdsTranscript = false
          } catch (error) {
            // A native copy already stored stays the transcript; only its absence is reported.
            if (!mirrors.holdsTranscript) {
              harnessTranscript = {
                status: 'unavailable',
                reason: 'retained-projection-failed',
                skipped: [
                  {
                    path: workspaceExecutionId,
                    reason: error instanceof Error ? error.message : String(error),
                  },
                ],
              }
            }
          }
          if (workspaceRetention.requireCompleteProvenance && !coverageComplete) {
            workspacePreservationRequired = true
          }
          return snapshot
        })
        .catch((error: unknown) => {
          workspaceCaptureFailure = error
          mirrors.noteCaptureFailure(error)
          throw error
        })
    }
    return await workspaceCapturePromise
  }

  const workspaceFailureDetail = (): string => {
    const reason =
      workspaceCaptureFailure instanceof Error
        ? workspaceCaptureFailure.message
        : String(workspaceCaptureFailure ?? 'capture was not accepted')
    return `providerAsExecutor(${provider.name}): workspace retention failed — ${reason}; source environment preserved`
  }

  const mirrors = createProviderCaptureMirrors(options, createProfile, node, {
    get workspaceSnapshot() {
      return workspaceSnapshot
    },
    get workspaceCapturePromise() {
      return workspaceCapturePromise
    },
    get workspaceExecutionId() {
      return workspaceExecutionId
    },
    get workspaceControlRef() {
      return workspaceControlRef
    },
    get providerSessionId() {
      return providerSessionId
    },
    get harnessTranscript() {
      return harnessTranscript
    },
    set harnessTranscript(value) {
      harnessTranscript = value
    },
    get harnessStopped() {
      return harnessStopped
    },
  })
  const destroyEnvironment = async (cleanupSignal?: AbortSignal): Promise<TeardownAnswer> => {
    if (workspaceCleanupPromise !== undefined) return await workspaceCleanupPromise
    const cleanupPromise = (async () => {
      const target = environment
      if (target === undefined) return { destroyed: true }
      if (workspacePreservationRequired) {
        return {
          destroyed: false,
          detail:
            workspaceIncompleteReason ??
            'provider workspace retention: source preserved because execution failed before a retrievable settled workspace receipt existed',
          permanent: true,
        }
      }
      if (options.workspaceRetention !== undefined) {
        try {
          const currentSnapshot = await captureWorkspace(target, workspaceOutcome)
          if (
            workspacePublishedSnapshot !== undefined &&
            currentSnapshot !== undefined &&
            currentSnapshot.digest !== workspacePublishedSnapshot.digest
          ) {
            workspacePreservationRequired = true
            return {
              destroyed: false,
              detail:
                'provider workspace retention: live workspace changed after the published receipt; source preserved',
              permanent: true,
            }
          }
        } catch {
          return { destroyed: false, detail: workspaceFailureDetail(), permanent: true }
        }
      }
      if (destroyed) return { destroyed: true }
      try {
        await awaitAbortable(Promise.resolve(target.destroy?.()), cleanupSignal)
        destroyed = true
        return { destroyed: true }
      } catch (error) {
        // An earlier delete may have run on the server with its answer lost; every later delete
        // then fails not-found, so the provider's own lookup is what confirms the environment gone.
        if (await environmentGone(provider, target.id, cleanupSignal)) {
          destroyed = true
          return { destroyed: true }
        }
        return {
          destroyed: false,
          detail: `providerAsExecutor(${provider.name}): environment.destroy() failed — ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    })()
    let cleanupReference!: Promise<TeardownAnswer>
    cleanupReference = cleanupPromise.then((result) => {
      // A provider destroy can fail transiently after a verified capture. Keep the snapshot
      // single-flight, but allow a later caller to retry the release. Capture failures and
      // unsettled execution failures stay cached so retries cannot bypass preservation.
      if (
        !result.destroyed &&
        workspaceCleanupPromise === cleanupReference &&
        !workspacePreservationRequired &&
        workspaceCaptureFailure === undefined
      ) {
        // The live workspace may have changed while the provider rejected the delete. A retry
        // must capture the current bytes instead of reusing the prior receipt as authority.
        if (options.workspaceRetention !== undefined) {
          workspaceSnapshot = undefined
          workspaceCapturePromise = undefined
        }
        workspaceCleanupPromise = undefined
      }
      return result
    })
    workspaceCleanupPromise = cleanupReference
    return await cleanupReference
  }
  const trace = createPushTraceSource({ runId: executionId })
  const { plannedDeclaration, plannedBinding } = providerMaterialization(
    provider,
    createProfile,
    node,
    executionId,
    retention,
    options,
    placement,
  )
  let executor!: Executor<unknown>
  const run = async function* (
    task: unknown,
    signal: AbortSignal,
    recovering = false,
  ): AsyncIterable<UsageEvent> {
    beginWorkspaceExecution()
    const linked = linkAbort(ctx.signal, signal, controller.signal)
    runSignal = linked.signal
    harnessStopped = false
    transcriptSettled = new Promise<void>((resolve) => {
      settleTranscript = resolve
    })
    try {
      // One execution is one or more invocations: the first runs `task`; a later one continues it
      // in the same environment after the upstream refused a turn for capacity.
      const executionStartedAt = Date.now() - (retention?.priorSpent?.ms ?? 0)
      let invocation: {
        task: unknown
        retention: RetainedExecutorContext | undefined
        executionId: string
        recovering: boolean
      } = { task, retention, executionId, recovering }
      let carried: Spend | undefined = retention?.priorSpent
      let refusalsInARow = 0
      for (let attempt = 1; ; attempt += 1) {
        const continued = attempt > 1
        if (continued && environment !== undefined) {
          // A resumed turn can change this same workspace. Its predecessor's receipt cannot
          // authorize cleanup, including when dispatch fails before returning a new handle.
          resetWorkspaceState(environment, invocation.executionId)
          workspaceControlRef = undefined
          providerSessionId = null
          workspacePreservationRequired = options.workspaceRetention !== undefined
        }
        const ended = yield* streamProviderExecutor({
          provider,
          profile,
          createProfile,
          task: invocation.task,
          signal: linked.signal,
          ...(node === undefined ? {} : { node }),
          options,
          retention: invocation.retention,
          executionId: invocation.executionId,
          trace,
          recovering: invocation.recovering,
          ...(carried === undefined ? {} : { carried }),
          executionStartedAt,
          mayContinue:
            options.unavailablePause !== false &&
            invocation.retention?.continueInvocation !== undefined,
          managerStopped: () => managerStop?.aborted === true,
          onRetained: (handle) => {
            retained = handle
            workspaceControlRef = freezeControlRef(handle.controlRef)
            providerSessionId = workspaceControlRef.sessionId
            nativeControl.cancelRetainedOnManagerStop(handle)
          },
          onPending: (value) => {
            pending = value
          },
          onEnvironment: (env) => {
            if (continued) {
              // A continuation runs in the environment the execution already materialized in; a
              // different one would be a different execution, which the receipt cannot name.
              if (env.id !== environment?.id) {
                throw new ValidationError(
                  `providerAsExecutor(${provider.name}): a continuation ran in environment ${env.id}, not ${environment?.id ?? '<none>'}`,
                )
              }
              environment = env
              return
            }
            environment = env
            resetWorkspaceState(env)
            // A box now exists, so `execution-never-started` has stopped being true. Until the
            // capture reports, the honest answer is that nobody read it.
            if (
              harnessTranscript.status === 'unavailable' &&
              harnessTranscript.reason === 'execution-never-started'
            ) {
              harnessTranscript = harnessTranscriptUnavailable('capture-did-not-run')
            }
            // `create` resolved, so the environment identity the provider issued is now evidence. It
            // goes in `execution`, which the mid-run guard treats as per-attempt routing, and NOT in
            // `plan`, which the guard holds fixed across attempts. It used to be written to both, so a
            // re-prompted attempt in a new environment changed `materializationPlanDigest` and was
            // refused as a changed materialization even after #1230 excused `execution.id`. Measured
            // on mech-interp-foundations-pi-20260915i under 0.225.5, which was the first guard able to
            // name the field. The admission events already record which environment served each
            // attempt; nothing reads the id from the plan.
            finalizeRuntimeOwnedPendingExecutor(
              executor,
              {
                ...plannedDeclaration,
                execution: { kind: 'environment', id: env.id },
              },
              plannedBinding,
            )
          },
          onArtifact: (next) => {
            artifact = next
          },
          onProviderSessionId: (id) => {
            providerSessionId = id
          },
          onHarnessTranscript: (next) => {
            harnessTranscript = next
          },
          onTranscriptSettled: () => settleTranscript(),
          onUnsettledFailure: () => {
            workspacePreservationRequired = true
          },
          onPublishedSnapshot: (snapshot) => {
            workspacePublishedSnapshot = snapshot
            if (
              continued &&
              snapshot !== undefined &&
              (!options.workspaceRetention?.requireCompleteProvenance || workspaceCoverageComplete)
            ) {
              workspacePreservationRequired = false
            }
          },
          captureWorkspace,
          startNativeMirror: mirrors.startNativeMirror,
          noteProviderEvent: mirrors.noteProviderEvent,
          stopEndedHarness: nativeControl.stopEndedHarness,
          finishNativeMirror: mirrors.finishNativeMirror,
          workspaceControlRef: () => workspaceControlRef,
          workspaceProvenance: () => workspaceProvenance,
          workspaceCoverage: () => ({
            complete: workspaceCoverageComplete,
            incompleteReason: workspaceIncompleteReason,
          }),
          destroyEnvironment,
          onHeld: () => {
            holdingForContinuation = true
          },
        })
        const refusal = ended.unavailable
        const continueInvocation = invocation.retention?.continueInvocation
        if (
          refusal === undefined ||
          continueInvocation === undefined ||
          workspacePreservationRequired ||
          workspaceCaptureFailure !== undefined
        )
          return
        // The same pause rule a driver follows: doubling per refusal in a row, restarting after a
        // refused turn that still did work. Only the deadline, cancellation and budget end it.
        refusalsInARow = ended.madeProgress ? 1 : refusalsInARow + 1
        const pauseMs = unavailablePauseMs(refusalsInARow, options.unavailablePause || {})
        await invocation.retention?.onPause?.({
          attempt,
          signal: refusal.signal,
          cause: refusal.cause,
          attemptMs: ended.durationMs,
          pauseMs,
          madeProgress: ended.madeProgress,
        })
        await sleep(pauseMs, linked.signal)
        // Cancelled or past its deadline during the pause: the refused turn's committed result is
        // the execution's outcome, and the kept environment is released by teardown.
        linked.signal.throwIfAborted()
        const next = await continueInvocation(LEAF_CONTINUATION_TASK)
        if (next.executionId === undefined) {
          throw new ValidationError(
            `providerAsExecutor(${provider.name}): a continuation has no execution id of its own`,
          )
        }
        carried = ended.spent
        invocation = {
          task: LEAF_CONTINUATION_TASK,
          retention: next,
          executionId: next.executionId,
          recovering: false,
        }
      }
    } finally {
      linked.release()
      workspaceRunActive = false
      settleTranscript()
    }
  }
  executor = {
    runtime,
    execute: run,
    recover: (task, signal) => run(task, signal, true),
    async cancel(request): Promise<ExecutorCancellation> {
      if (retained) {
        const acknowledgement = await retained.cancel(request)
        return {
          status:
            acknowledgement.status === 'conflict'
              ? 'rejected'
              : acknowledgement.status === 'replayed'
                ? 'accepted'
                : acknowledgement.status,
          effect: acknowledgement.effect,
          observedAt: acknowledgement.snapshot.observedAt,
          evidence: { operationId: request.operationId, controlRef: retained.controlRef },
          ...(acknowledgement.reason ? { detail: acknowledgement.reason } : {}),
        }
      }
      // The provider streams a turn rather than dispatching a durable run, so this executor holds
      // no exact control reference the provider could cancel against. Aborting the local stream is
      // all Runtime can prove; the environment stays alive for `teardown` to release.
      controller.abort()
      return {
        status: 'unknown',
        effect: 'cancel_requested',
        observedAt: new Date().toISOString(),
        detail: `providerAsExecutor(${provider.name}): the streamed turn carries no durable run reference, so the provider acknowledged nothing`,
        evidence: {
          operationId: request.operationId,
          ...(environment ? { environmentId: environment.id } : {}),
        },
      }
    },
    async teardown(_grace): Promise<TeardownAnswer> {
      controller.abort()
      // Held for a continuation: the scope releases it (hold ceiling, cancel_worker, join barrier)
      // or hands it to the successor; an ordinary teardown must not destroy it underneath them.
      if (holdingForContinuation) {
        return {
          destroyed: false,
          detail: 'environment held for a keyed continuation after a budget stop',
        }
      }
      // A cancelled execution is not kept for a resume to reconcile, so its harness stops now
      // rather than at root release. Not awaited: teardown acknowledges within a short window,
      // and the release awaits this same stop before it records what it kept.
      if (pending && cancelledExplicitly()) void nativeControl.stopNativeExecution()
      if (options.workspaceRetention !== undefined && workspaceRunActive) {
        return {
          destroyed: false,
          detail: harnessStopped
            ? 'provider workspace retention: source preserved while the stopped execution writes its failure capture'
            : 'provider workspace retention: source preserved while the execution is still active',
        }
      }
      if (pending) {
        return {
          destroyed: false,
          detail: 'retained execution requires reconciliation',
          permanent: true,
        }
      }
      // A failed or timed-out capture keeps the source alive. The shared cleanup promise also
      // means a stream-finally teardown and a caller teardown cannot race two provider deletes.
      return await destroyEnvironment()
    },
    heldEnvironments(): ReadonlyArray<HeldEnvironment> {
      if (destroyed) return []
      // The live handle first; a retained execution whose handle this process never received is
      // still named by its durable admission, which is the id a sweeper deletes.
      const environmentId =
        environment?.id ?? retained?.controlRef.environmentId ?? admittedEnvironmentId(retention)
      if (environmentId === undefined) return []
      // A source that workspace retention preserved is evidence, kept on purpose.
      const preserved = workspacePreservationRequired || workspaceCaptureFailure !== undefined
      return [
        {
          provider: provider.name,
          environmentId,
          ...(preserved
            ? { keptFor: 'evidence' as const }
            : holdingForContinuation
              ? { keptFor: 'continuation' as const }
              : {}),
        },
      ]
    },
    heldForContinuation(): HeldForContinuation | undefined {
      const held = environment
      if (!holdingForContinuation || held === undefined || destroyed) return undefined
      return {
        provider: provider.name,
        environmentId: held.id,
        release: async (signal) => {
          if (!holdingForContinuation) return { destroyed: true }
          holdingForContinuation = false
          return await destroyEnvironment(signal)
        },
        handOver: () => {
          // The successor's executor owns the environment now; this one never destroys it.
          holdingForContinuation = false
          environment = undefined
          destroyed = true
        },
      }
    },
    releaseRetained: nativeControl.withoutRunningHarness(async (signal) => {
      controller.abort()
      // `teardown` keeps a pending retained execution alive so a resumed process can reconcile the
      // paid work inside it. The supervisor calls this once no process will: the root has settled.
      if (!pending) return []
      const environmentId =
        retained?.controlRef.environmentId ?? environment?.id ?? admittedEnvironmentId(retention)
      // An intent-phase admission names no environment yet; if `create` never returned there is
      // nothing this process can name, and the node stays unconfirmed rather than receipted.
      if (environmentId === undefined) return []
      const receipt = (
        destroyed: boolean,
        detail?: string,
        permanent?: boolean,
      ): EnvironmentTeardownReceipt => ({
        provider: provider.name,
        environmentId,
        destroyed,
        ...(detail === undefined ? {} : { detail }),
        ...(permanent === true ? { permanent } : {}),
      })
      if (options.workspaceRetention !== undefined && workspaceRunActive) {
        return [
          receipt(
            false,
            'provider workspace retention: source preserved while execution is still active',
          ),
        ]
      }
      if (retainedReleasePromise !== undefined) return await retainedReleasePromise
      const releasePromise = (async () => {
        try {
          const target =
            environment ??
            (provider.get === undefined
              ? undefined
              : await awaitAbortable(provider.get(environmentId), signal))
          if (target === undefined) {
            return [
              receipt(
                false,
                `providerAsExecutor(${provider.name}): no environment handle and the provider exposes no get()`,
                true,
              ),
            ]
          }
          // `null` is the provider saying it no longer holds the environment: nothing remains to
          // destroy, which is the same answer `recoverRetainedRun` reads as `not_found`.
          if (target === null) {
            pending = false
            destroyed = true
            return [receipt(true)]
          }
          if (target.destroy === undefined) {
            return [
              receipt(
                false,
                `providerAsExecutor(${provider.name}): environment exposes no destroy()`,
                true,
              ),
            ]
          }
          if (environment === undefined) {
            environment = target
            resetWorkspaceState(target)
          }
          // The failure path read this child's session while its box was out of reach: of the 150
          // dispatched children whose slot never closed on the Discovery fleet of 2026-09-23/24,
          // 105 carry `enumeration-failed`. The release is the last moment the box exists, so a
          // box it can reach is read once more before it is destroyed. Only a capture replaces
          // the earlier receipt; a second failure keeps the reason the first one named. One try
          // per executor: the read shares the release's bound, and a retry of a refused destroy
          // must not wait on a box that already failed to answer.
          if (
            options.workspaceRetention === undefined &&
            harnessTranscript.status !== 'captured' &&
            !releaseReadTried
          ) {
            releaseReadTried = true
            const capture = await captureHarnessTranscript(
              target as Parameters<typeof captureHarnessTranscript>[0],
              profile.harness,
              signal,
            )
            if (capture.status === 'captured') harnessTranscript = capture
          }
          // A retained execution this process never streamed, such as one a resumed coordinator
          // reconciles, has no stored copy of its session; its workspace capture below can still
          // fail on size. Copy the session first, attributed by its durable admission.
          if (
            mirrors.nativePort !== undefined &&
            harnessTranscript.status !== 'retained' &&
            !releaseNativeTried
          ) {
            releaseNativeTried = true
            const admitted = retained?.controlRef ?? admittedControlRef(retention)
            await awaitAbortable(
              mirrors.captureNative(
                target,
                'interrupted',
                admitted === undefined ? undefined : freezeControlRef(admitted),
              ),
              signal,
            ).catch(() => undefined)
          }
          const result = await destroyEnvironment(signal)
          if (!result.destroyed) return [receipt(false, result.detail, result.permanent)]
          pending = false
          return [receipt(true)]
        } catch (error) {
          return [
            receipt(
              false,
              `providerAsExecutor(${provider.name}): environment.destroy() failed — ${error instanceof Error ? error.message : String(error)}`,
            ),
          ]
        }
      })()
      let releaseReference!: Promise<ReadonlyArray<EnvironmentTeardownReceipt>>
      releaseReference = releasePromise.then((receipts) => {
        if (
          retainedReleasePromise === releaseReference &&
          !receipts.every((receipt) => receipt.destroyed) &&
          !workspacePreservationRequired &&
          workspaceCaptureFailure === undefined
        ) {
          retainedReleasePromise = undefined
        }
        return receipts
      })
      retainedReleasePromise = releaseReference
      return await releaseReference
    }),
    resultArtifact(): ExecutorResult<unknown> {
      if (!artifact) {
        throw new ValidationError(
          `providerAsExecutor(${provider.name}): resultArtifact() read before stream drained`,
        )
      }
      return artifact
    },
    traceSource: (): TraceSource => trace.source,
    harnessTranscript: (): HarnessTranscriptCapture | undefined => harnessTranscript,
    harnessTranscriptSettled: (): Promise<void> => transcriptSettled,
  }
  return attestRuntimeOwnedPendingExecutor(executor, runtime, plannedDeclaration, plannedBinding)
}

/** The environment id the latest durable admission names, when creation got that far. */
function admittedEnvironmentId(retention: RetainedExecutorContext | undefined): string | undefined {
  for (const admission of [...(retention?.admissions ?? [])].reverse()) {
    if (admission.phase === 'dispatched') return admission.controlRef.environmentId
    if (admission.phase === 'environment') return admission.environmentId
  }
  return undefined
}

/** What a leaf is told when it continues after a refused turn. The session carries its
 *  conversation and the environment its files, so the instruction names neither the provider nor
 *  the refusal: a director told the details of a provider failure spent its children probing the
 *  infrastructure (discovery-lab AGENTS.md, measured 2026-09-11). */
export const LEAF_CONTINUATION_TASK =
  'Your previous turn was interrupted before it finished. This is the same task in the same ' +
  'session: your conversation so far and the files in your workspace are where you left them. ' +
  'Continue from where you stopped. Do not start over.'

export type TeardownAnswer = { destroyed: boolean; detail?: string; permanent?: boolean }
