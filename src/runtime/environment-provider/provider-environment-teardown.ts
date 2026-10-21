import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import { captureHarnessTranscript } from '../harness-transcript'
import { environmentGone } from '../retained-interactive-lifecycle'
import { awaitAbortable, freezeControlRef } from '../retained-run-binding'
import type { TeardownAnswer } from '../supervise/deadline'
import type { RetainedExecutorContext } from '../supervise/retained-executor'
import type { EnvironmentTeardownReceipt } from '../supervise/types'
import type { ProviderExecutorScope } from './provider-executor-state'
import { admittedControlRef } from './provider-retention-lifecycle'
import { captureExecutorWorkspace } from './provider-workspace-capture'

/** The environment id the latest durable admission names, when creation got that far. */
export function admittedEnvironmentId(
  retention: RetainedExecutorContext | undefined,
): string | undefined {
  for (const admission of [...(retention?.admissions ?? [])].reverse()) {
    if (admission.phase === 'dispatched') return admission.controlRef.environmentId
    if (admission.phase === 'environment') return admission.environmentId
  }
  return undefined
}

const destroyFailed = (scope: ProviderExecutorScope, error: unknown): string =>
  `providerAsExecutor(${scope.provider.name}): environment.destroy() failed — ${error instanceof Error ? error.message : String(error)}`

function workspaceFailureDetail(scope: ProviderExecutorScope): string {
  const { workspaceCaptureFailure } = scope.state
  const reason =
    workspaceCaptureFailure instanceof Error
      ? workspaceCaptureFailure.message
      : String(workspaceCaptureFailure ?? 'capture was not accepted')
  return `providerAsExecutor(${scope.provider.name}): workspace retention failed — ${reason}; source environment preserved`
}

/** Destroy the environment once, however many callers ask; a failed attempt may be retried. */
export async function destroyExecutorEnvironment(
  scope: ProviderExecutorScope,
  cleanupSignal?: AbortSignal,
): Promise<TeardownAnswer> {
  const { state, options } = scope
  if (state.workspaceCleanupPromise !== undefined) return await state.workspaceCleanupPromise
  const cleanupPromise = attemptDestroy(scope, cleanupSignal)
  let cleanupReference!: Promise<TeardownAnswer>
  cleanupReference = cleanupPromise.then((result) => {
    // A provider destroy can fail transiently after a verified capture. Keep the snapshot
    // single-flight, but allow a later caller to retry the release. Capture failures and
    // unsettled execution failures stay cached so retries cannot bypass preservation.
    if (
      !result.destroyed &&
      state.workspaceCleanupPromise === cleanupReference &&
      !state.workspacePreservationRequired &&
      state.workspaceCaptureFailure === undefined
    ) {
      // The live workspace may have changed while the provider rejected the delete. A retry
      // must capture the current bytes instead of reusing the prior receipt as authority.
      if (options.workspaceRetention !== undefined) {
        state.workspaceSnapshot = undefined
        state.workspaceCapturePromise = undefined
      }
      state.workspaceCleanupPromise = undefined
    }
    return result
  })
  state.workspaceCleanupPromise = cleanupReference
  return await cleanupReference
}

async function attemptDestroy(
  scope: ProviderExecutorScope,
  cleanupSignal: AbortSignal | undefined,
): Promise<TeardownAnswer> {
  const { state, options, provider } = scope
  const target = state.environment
  if (target === undefined) return { destroyed: true }
  if (state.workspacePreservationRequired) {
    return {
      destroyed: false,
      detail:
        state.workspaceIncompleteReason ??
        'provider workspace retention: source preserved because execution failed before a retrievable settled workspace receipt existed',
      permanent: true,
    }
  }
  if (options.workspaceRetention !== undefined) {
    try {
      const currentSnapshot = await captureExecutorWorkspace(scope, target, state.workspaceOutcome)
      if (
        state.workspacePublishedSnapshot !== undefined &&
        currentSnapshot !== undefined &&
        currentSnapshot.digest !== state.workspacePublishedSnapshot.digest
      ) {
        state.workspacePreservationRequired = true
        return {
          destroyed: false,
          detail:
            'provider workspace retention: live workspace changed after the published receipt; source preserved',
          permanent: true,
        }
      }
    } catch {
      return { destroyed: false, detail: workspaceFailureDetail(scope), permanent: true }
    }
  }
  if (state.destroyed) return { destroyed: true }
  try {
    await awaitAbortable(Promise.resolve(target.destroy?.()), cleanupSignal)
    state.destroyed = true
    return { destroyed: true }
  } catch (error) {
    // An earlier delete may have run on the server with its answer lost; every later delete
    // then fails not-found, so the provider's own lookup is what confirms the environment gone.
    if (await environmentGone(provider, target.id, cleanupSignal)) {
      state.destroyed = true
      return { destroyed: true }
    }
    return { destroyed: false, detail: destroyFailed(scope, error) }
  }
}

/** Release the environment of a retained execution once no process will reconcile it. */
export async function releaseRetainedExecution(
  scope: ProviderExecutorScope,
  signal: AbortSignal | undefined,
): Promise<ReadonlyArray<EnvironmentTeardownReceipt>> {
  const { state, options, provider, retention } = scope
  scope.controller.abort()
  // `teardown` keeps a pending retained execution alive so a resumed process can reconcile the
  // paid work inside it. The supervisor calls this once no process will: the root has settled.
  if (!state.pending) return []
  const environmentId =
    state.retained?.controlRef.environmentId ??
    state.environment?.id ??
    admittedEnvironmentId(retention)
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
  if (options.workspaceRetention !== undefined && state.workspaceRunActive) {
    return [
      receipt(
        false,
        'provider workspace retention: source preserved while execution is still active',
      ),
    ]
  }
  if (state.retainedReleasePromise !== undefined) return await state.retainedReleasePromise
  const releasePromise = releaseReceipts(scope, environmentId, signal, receipt)
  let releaseReference!: Promise<ReadonlyArray<EnvironmentTeardownReceipt>>
  releaseReference = releasePromise.then((receipts) => {
    if (
      state.retainedReleasePromise === releaseReference &&
      !receipts.every((entry) => entry.destroyed) &&
      !state.workspacePreservationRequired &&
      state.workspaceCaptureFailure === undefined
    ) {
      state.retainedReleasePromise = undefined
    }
    return receipts
  })
  state.retainedReleasePromise = releaseReference
  return await releaseReference
}

async function releaseReceipts(
  scope: ProviderExecutorScope,
  environmentId: string,
  signal: AbortSignal | undefined,
  receipt: (destroyed: boolean, detail?: string, permanent?: boolean) => EnvironmentTeardownReceipt,
): Promise<ReadonlyArray<EnvironmentTeardownReceipt>> {
  const { state, provider } = scope
  try {
    const target =
      state.environment ??
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
      state.pending = false
      state.destroyed = true
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
    if (state.environment === undefined) {
      state.environment = target
      state.resetWorkspace(target)
    }
    await captureBeforeDestroy(scope, target, signal)
    const result = await destroyExecutorEnvironment(scope, signal)
    if (!result.destroyed) return [receipt(false, result.detail, result.permanent)]
    state.pending = false
    return [receipt(true)]
  } catch (error) {
    return [receipt(false, destroyFailed(scope, error))]
  }
}

/**
 * The release is the last moment the box exists. The failure path read this child's session while
 * its box was out of reach: of the 150 dispatched children whose slot never closed on the
 * Discovery fleet of 2026-09-23/24, 105 carry `enumeration-failed`. A box the release can reach
 * is read once more before it is destroyed.
 */
async function captureBeforeDestroy(
  scope: ProviderExecutorScope,
  target: AgentEnvironment,
  signal: AbortSignal | undefined,
): Promise<void> {
  const { state, options, mirrors, retention } = scope
  // Only a capture replaces the earlier receipt; a second failure keeps the reason the first one
  // named. One try per executor: the read shares the release's bound, and a retry of a refused
  // destroy must not wait on a box that already failed to answer.
  if (
    options.workspaceRetention === undefined &&
    state.harnessTranscript.status !== 'captured' &&
    !state.releaseReadTried
  ) {
    state.releaseReadTried = true
    const capture = await captureHarnessTranscript(
      target as Parameters<typeof captureHarnessTranscript>[0],
      scope.profile.harness,
      signal,
    )
    if (capture.status === 'captured') state.harnessTranscript = capture
  }
  // A retained execution this process never streamed, such as one a resumed coordinator
  // reconciles, has no stored copy of its session; its workspace capture below can still
  // fail on size. Copy the session first, attributed by its durable admission.
  if (
    mirrors.nativePort !== undefined &&
    state.harnessTranscript.status !== 'retained' &&
    !state.releaseNativeTried
  ) {
    state.releaseNativeTried = true
    const admitted = state.retained?.controlRef ?? admittedControlRef(retention)
    await awaitAbortable(
      mirrors.captureNative(
        target,
        'interrupted',
        admitted === undefined ? undefined : freezeControlRef(admitted),
      ),
      signal,
    ).catch(() => undefined)
  }
}
