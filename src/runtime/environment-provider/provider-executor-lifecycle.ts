import { randomUUID } from 'node:crypto'
import { type AgentProfile, canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import type { HarnessTranscriptCapture } from '../harness-transcript'
import { assertProviderWorkspaceRetentionPort } from '../provider-workspace-retention'
import { bridgeStopSignalKey } from '../supervise/bridge-config'
import type { TeardownAnswer } from '../supervise/deadline'
import { readOptionalAbortSignal } from '../supervise/executor-seams'
import { attestRuntimeOwnedPendingExecutor } from '../supervise/materialization'
import { retainedExecutorContext } from '../supervise/retained-executor'
import { detachedSnapshot } from '../supervise/snapshot'
import { createPushTraceSource, type TraceSource } from '../supervise/trace-source'
import type {
  Executor,
  ExecutorCancellation,
  ExecutorCancellationRequest,
  ExecutorContext,
  ExecutorResult,
  HeldEnvironment,
  HeldForContinuation,
  Runtime,
} from '../supervise/types'
import {
  admittedEnvironmentId,
  destroyExecutorEnvironment,
  releaseRetainedExecution,
} from './provider-environment-teardown'
import { runProviderExecution } from './provider-execution-loop'
import type { ProviderExecutorOptions } from './provider-executor-admission'
import { type ProviderExecutorScope, ProviderExecutorState } from './provider-executor-state'
import { providerMaterialization } from './provider-materialization'
import {
  createProviderCaptureMirrors,
  createProviderNativeControl,
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
  const node =
    ctx.node === undefined ? undefined : detachedSnapshot(ctx.node, 'provider executor node')
  const retention = retainedExecutorContext(ctx)
  // A manager's stop (an accepted `submit_result`, `stop`, a stop rule) ends its turn. The bridge
  // executor reads this seam at its turn boundary; a retained run asks its backend to cancel the
  // turn, so the stream ends and the harness session and the turn's usage are still read. Before,
  // a provider-placed director ran its harness on after acceptance: measured 2026-10-05, accepted
  // directors settled 13 to 29 minutes after their submissions. A run with no retained control
  // could only abort locally, which skips those reads, so it keeps running to the end of its turn.
  const managerStop = readOptionalAbortSignal(ctx, bridgeStopSignalKey, 'provider')
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
  const state = new ProviderExecutorState(ctx.signal, executionId)
  let executor!: Executor<unknown>
  const scope: ProviderExecutorScope = {
    provider,
    profile,
    createProfile,
    options,
    ctx,
    retention,
    node,
    executionId,
    state,
    controller: new AbortController(),
    nativeControl: createProviderNativeControl(provider, retention, managerStop, state),
    mirrors: createProviderCaptureMirrors(options, createProfile, node, state),
    trace: createPushTraceSource({ runId: executionId }),
    materialization: providerMaterialization(
      provider,
      createProfile,
      node,
      executionId,
      retention,
      options,
      placement,
    ),
    continuationTask: LEAF_CONTINUATION_TASK,
    executor: () => executor,
  }
  const { materialization } = scope
  const run = (task: unknown, signal: AbortSignal, recovering = false) =>
    runProviderExecution(scope, task, signal, recovering)
  executor = {
    runtime: options.runtime ?? (provider.name as Runtime),
    execute: run,
    recover: (task, signal) => run(task, signal, true),
    cancel: (request) => cancelExecution(scope, request),
    teardown: (_grace) => teardownExecution(scope),
    heldEnvironments: () => heldEnvironments(scope),
    heldForContinuation: () => heldForContinuation(scope),
    releaseRetained: scope.nativeControl.withoutRunningHarness((signal) =>
      releaseRetainedExecution(scope, signal),
    ),
    resultArtifact(): ExecutorResult<unknown> {
      if (!state.artifact) {
        throw new ValidationError(
          `providerAsExecutor(${provider.name}): resultArtifact() read before stream drained`,
        )
      }
      return state.artifact
    },
    traceSource: (): TraceSource => scope.trace.source,
    harnessTranscript: (): HarnessTranscriptCapture | undefined => state.harnessTranscript,
    harnessTranscriptSettled: (): Promise<void> => state.transcriptSettled,
  }
  return attestRuntimeOwnedPendingExecutor(
    executor,
    executor.runtime,
    materialization.plannedDeclaration,
    materialization.plannedBinding,
  )
}

async function cancelExecution(
  scope: ProviderExecutorScope,
  request: ExecutorCancellationRequest,
): Promise<ExecutorCancellation> {
  const { state, provider } = scope
  const retained = state.retained
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
  scope.controller.abort()
  return {
    status: 'unknown',
    effect: 'cancel_requested',
    observedAt: new Date().toISOString(),
    detail: `providerAsExecutor(${provider.name}): the streamed turn carries no durable run reference, so the provider acknowledged nothing`,
    evidence: {
      operationId: request.operationId,
      ...(state.environment ? { environmentId: state.environment.id } : {}),
    },
  }
}

async function teardownExecution(scope: ProviderExecutorScope): Promise<TeardownAnswer> {
  const { state, options } = scope
  scope.controller.abort()
  // Held for a continuation: the scope releases it (hold ceiling, cancel_worker, join barrier)
  // or hands it to the successor; an ordinary teardown must not destroy it underneath them.
  if (state.holdingForContinuation) {
    return {
      destroyed: false,
      detail: 'environment held for a keyed continuation after a budget stop',
    }
  }
  // A cancelled execution is not kept for a resume to reconcile, so its harness stops now
  // rather than at root release. Not awaited: teardown acknowledges within a short window,
  // and the release awaits this same stop before it records what it kept.
  if (state.pending && state.cancelledExplicitly()) void scope.nativeControl.stopNativeExecution()
  if (options.workspaceRetention !== undefined && state.workspaceRunActive) {
    return {
      destroyed: false,
      detail: state.harnessStopped
        ? 'provider workspace retention: source preserved while the stopped execution writes its failure capture'
        : 'provider workspace retention: source preserved while the execution is still active',
    }
  }
  if (state.pending) {
    return {
      destroyed: false,
      detail: 'retained execution requires reconciliation',
      permanent: true,
    }
  }
  // A failed or timed-out capture keeps the source alive. The shared cleanup promise also
  // means a stream-finally teardown and a caller teardown cannot race two provider deletes.
  return await destroyExecutorEnvironment(scope)
}

function heldEnvironments(scope: ProviderExecutorScope): ReadonlyArray<HeldEnvironment> {
  const { state } = scope
  if (state.destroyed) return []
  // The live handle first; a retained execution whose handle this process never received is
  // still named by its durable admission, which is the id a sweeper deletes.
  const environmentId =
    state.environment?.id ??
    state.retained?.controlRef.environmentId ??
    admittedEnvironmentId(scope.retention)
  if (environmentId === undefined) return []
  // A source that workspace retention preserved is evidence, kept on purpose.
  const preserved =
    state.workspacePreservationRequired || state.workspaceCaptureFailure !== undefined
  return [
    {
      provider: scope.provider.name,
      environmentId,
      ...(preserved
        ? { keptFor: 'evidence' as const }
        : state.holdingForContinuation
          ? { keptFor: 'continuation' as const }
          : {}),
    },
  ]
}

function heldForContinuation(scope: ProviderExecutorScope): HeldForContinuation | undefined {
  const { state } = scope
  const held = state.environment
  if (!state.holdingForContinuation || held === undefined || state.destroyed) return undefined
  return {
    provider: scope.provider.name,
    environmentId: held.id,
    release: async (signal) => {
      if (!state.holdingForContinuation) return { destroyed: true }
      state.holdingForContinuation = false
      return await destroyExecutorEnvironment(scope, signal)
    },
    handOver: () => {
      // The successor's executor owns the environment now; this one never destroys it.
      state.holdingForContinuation = false
      state.environment = undefined
      state.destroyed = true
    },
  }
}

/** What a leaf is told when it continues after a refused turn. The session carries its
 *  conversation and the environment its files, so the instruction names neither the provider nor
 *  the refusal: a director told the details of a provider failure spent its children probing the
 *  infrastructure (discovery-lab AGENTS.md, measured 2026-09-11). */
export const LEAF_CONTINUATION_TASK =
  'Your previous turn was interrupted before it finished. This is the same task in the same ' +
  'session: your conversation so far and the files in your workspace are where you left them. ' +
  'Continue from where you stopped. Do not start over.'
