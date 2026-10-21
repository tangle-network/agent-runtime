import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import { harnessTranscriptUnavailable } from '../harness-transcript'
import { freezeControlRef } from '../retained-run-binding'
import { linkAbort } from '../supervise/abortable'
import {
  finalizeRuntimeOwnedPendingExecutor,
  runtimeOwnedExecutorMaterialization,
} from '../supervise/materialization'
import type { RetainedExecutorContext } from '../supervise/retained-executor'
import type { Spend, UsageEvent } from '../supervise/types'
import { unavailablePauseMs } from '../supervise/upstream-unavailable'
import { sleep } from '../util'
import { destroyExecutorEnvironment } from './provider-environment-teardown'
import type { ProviderExecutorScope } from './provider-executor-state'
import {
  type ProviderInvocationEnd,
  type StreamProviderExecutorArgs,
  streamProviderExecutor,
} from './provider-invocation'
import { ValidationError } from './provider-validation-error'
import { captureExecutorWorkspace } from './provider-workspace-capture'

interface Invocation {
  task: unknown
  retention: RetainedExecutorContext | undefined
  executionId: string
  recovering: boolean
}

/** A new environment now backs this execution; the identity the provider issued is evidence. */
function adoptEnvironment(scope: ProviderExecutorScope, env: AgentEnvironment): void {
  const { state, materialization } = scope
  state.environment = env
  state.resetWorkspace(env)
  // A box now exists, so `execution-never-started` has stopped being true. Until the
  // capture reports, the honest answer is that nobody read it.
  if (
    state.harnessTranscript.status === 'unavailable' &&
    state.harnessTranscript.reason === 'execution-never-started'
  ) {
    state.harnessTranscript = harnessTranscriptUnavailable('capture-did-not-run')
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
    scope.executor(),
    {
      ...materialization.plannedDeclaration,
      execution: { kind: 'environment', id: env.id },
    },
    materialization.plannedBinding,
  )
}

/** The seams one invocation reports through; `continued` marks a continuation of the execution. */
function invocationArgs(
  scope: ProviderExecutorScope,
  invocation: Invocation,
  signal: AbortSignal,
  carried: Spend | undefined,
  executionStartedAt: number,
  continued: boolean,
): StreamProviderExecutorArgs {
  const { state, options, provider, node, mirrors, nativeControl } = scope
  return {
    provider,
    profile: scope.profile,
    createProfile: scope.createProfile,
    task: invocation.task,
    signal,
    ...(node === undefined ? {} : { node }),
    options,
    retention: invocation.retention,
    executionId: invocation.executionId,
    trace: scope.trace,
    recovering: invocation.recovering,
    ...(carried === undefined ? {} : { carried }),
    executionStartedAt,
    mayContinue:
      options.unavailablePause !== false && invocation.retention?.continueInvocation !== undefined,
    managerStopped: () => scope.managerStop?.aborted === true,
    onRetained: (handle) => {
      state.retained = handle
      state.workspaceControlRef = freezeControlRef(handle.controlRef)
      state.providerSessionId = state.workspaceControlRef.sessionId
      nativeControl.cancelRetainedOnManagerStop(handle)
    },
    onPending: (value) => {
      state.pending = value
    },
    onEnvironment: (env) => {
      if (!continued) return adoptEnvironment(scope, env)
      // A continuation runs in the environment the execution already materialized in; a
      // different one would be a different execution, which the receipt cannot name.
      if (env.id !== state.environment?.id) {
        throw new ValidationError(
          `providerAsExecutor(${provider.name}): a continuation ran in environment ${env.id}, not ${state.environment?.id ?? '<none>'}`,
        )
      }
      state.environment = env
    },
    onArtifact: (next) => {
      state.artifact = next
    },
    onProviderSessionId: (id) => {
      state.providerSessionId = id
    },
    onHarnessTranscript: (next) => {
      state.harnessTranscript = next
    },
    onTranscriptSettled: () => state.settleTranscript(),
    onUnsettledFailure: () => {
      state.workspacePreservationRequired = true
    },
    onPublishedSnapshot: (snapshot) => {
      state.workspacePublishedSnapshot = snapshot
      if (
        continued &&
        snapshot !== undefined &&
        (!options.workspaceRetention?.requireCompleteProvenance || state.workspaceCoverageComplete)
      ) {
        state.workspacePreservationRequired = false
      }
    },
    captureWorkspace: (next, outcome) => captureExecutorWorkspace(scope, next, outcome),
    startNativeMirror: mirrors.startNativeMirror,
    noteProviderEvent: mirrors.noteProviderEvent,
    stopEndedHarness: nativeControl.stopEndedHarness,
    finishNativeMirror: mirrors.finishNativeMirror,
    workspaceControlRef: () => state.workspaceControlRef,
    workspaceProvenance: () => state.workspaceProvenance,
    workspaceCoverage: () => ({
      complete: state.workspaceCoverageComplete,
      incompleteReason: state.workspaceIncompleteReason,
    }),
    destroyEnvironment: (cleanupSignal) => destroyExecutorEnvironment(scope, cleanupSignal),
    onHeld: () => {
      state.holdingForContinuation = true
    },
  }
}

/**
 * A new capture generation, even when a provider reuses its environment id; otherwise the prior
 * turn's archive could authorize deleting a workspace whose files changed during the retry. A
 * failed generation stays fail-closed until the caller constructs a fresh executor after
 * resolving its unreceipted source.
 */
function beginWorkspaceExecution(scope: ProviderExecutorScope): void {
  const { state, options, provider } = scope
  if (state.workspaceRunActive) {
    throw new ValidationError(`providerAsExecutor(${provider.name}): executor is already running`)
  }
  if (options.workspaceRetention !== undefined) {
    if (state.workspacePreservationRequired) {
      throw new ValidationError(
        `providerAsExecutor(${provider.name}): a prior failed execution has no retrievable workspace receipt; source remains preserved and this executor cannot be reused`,
      )
    }
    if (state.environment !== undefined && !state.destroyed) {
      throw new ValidationError(
        `providerAsExecutor(${provider.name}): the prior workspace environment is still live; teardown must release it before this executor can be reused`,
      )
    }
  }
  if (runtimeOwnedExecutorMaterialization(scope.executor()) !== undefined) {
    throw new ValidationError(
      `providerAsExecutor(${provider.name}): this executor has already materialized; create a new executor for another run`,
    )
  }
  if (state.environment !== undefined && state.destroyed) {
    // Do not leave a confirmed-destroyed handle in the next generation. If the new create fails
    // before onEnvironment runs, a later teardown must not retry deletion of the old source.
    state.environment = undefined
    state.workspaceEnvironmentId = undefined
  }
  state.workspaceRunActive = true
  state.workspaceControlRef = undefined
  state.providerSessionId = null
  state.clearWorkspaceCapture()
}

/**
 * One execution is one or more invocations: the first runs `task`; a later one continues it in the
 * same environment after the upstream refused a turn for capacity.
 */
export async function* runProviderExecution(
  scope: ProviderExecutorScope,
  task: unknown,
  signal: AbortSignal,
  recovering = false,
): AsyncIterable<UsageEvent> {
  const { state, options, retention } = scope
  beginWorkspaceExecution(scope)
  const linked = linkAbort(scope.ctx.signal, signal, scope.controller.signal)
  state.runSignal = linked.signal
  state.harnessStopped = false
  state.transcriptSettled = new Promise<void>((resolve) => {
    state.settleTranscript = resolve
  })
  try {
    const executionStartedAt = Date.now() - (retention?.priorSpent?.ms ?? 0)
    let invocation: Invocation = { task, retention, executionId: scope.executionId, recovering }
    let carried: Spend | undefined = retention?.priorSpent
    let refusalsInARow = 0
    for (let attempt = 1; ; attempt += 1) {
      const continued = attempt > 1
      if (continued && state.environment !== undefined) {
        // A resumed turn can change this same workspace. Its predecessor's receipt cannot
        // authorize cleanup, including when dispatch fails before returning a new handle.
        state.resetWorkspace(state.environment, invocation.executionId)
        state.workspaceControlRef = undefined
        state.providerSessionId = null
        state.workspacePreservationRequired = options.workspaceRetention !== undefined
      }
      const ended = yield* streamProviderExecutor(
        invocationArgs(scope, invocation, linked.signal, carried, executionStartedAt, continued),
      )
      const next = await pauseForContinuation(
        scope,
        invocation,
        ended,
        attempt,
        refusalsInARow,
        linked.signal,
      )
      if (next === undefined) return
      refusalsInARow = next.refusalsInARow
      carried = ended.spent
      invocation = next.invocation
    }
  } finally {
    linked.release()
    state.workspaceRunActive = false
    state.settleTranscript()
  }
}

/** After a refused turn, wait out the pause and open the continuation; undefined ends the execution. */
async function pauseForContinuation(
  scope: ProviderExecutorScope,
  invocation: Invocation,
  ended: ProviderInvocationEnd,
  attempt: number,
  refusalsBefore: number,
  signal: AbortSignal,
): Promise<{ invocation: Invocation; refusalsInARow: number } | undefined> {
  const { state, options, provider } = scope
  const refusal = ended.unavailable
  const continueInvocation = invocation.retention?.continueInvocation
  if (
    refusal === undefined ||
    continueInvocation === undefined ||
    state.workspacePreservationRequired ||
    state.workspaceCaptureFailure !== undefined
  ) {
    return undefined
  }
  // The same pause rule a driver follows: doubling per refusal in a row, restarting after a
  // refused turn that still did work. Only the deadline, cancellation and budget end it.
  const refusalsInARow = ended.madeProgress ? 1 : refusalsBefore + 1
  const pauseMs = unavailablePauseMs(refusalsInARow, options.unavailablePause || {})
  await invocation.retention?.onPause?.({
    attempt,
    signal: refusal.signal,
    cause: refusal.cause,
    attemptMs: ended.durationMs,
    pauseMs,
    madeProgress: ended.madeProgress,
  })
  await sleep(pauseMs, signal)
  // Cancelled or past its deadline during the pause: the refused turn's committed result is
  // the execution's outcome, and the kept environment is released by teardown.
  signal.throwIfAborted()
  const next = await continueInvocation(scope.continuationTask)
  if (next.executionId === undefined) {
    throw new ValidationError(
      `providerAsExecutor(${provider.name}): a continuation has no execution id of its own`,
    )
  }
  return {
    refusalsInARow,
    invocation: {
      task: scope.continuationTask,
      retention: next,
      executionId: next.executionId,
      recovering: false,
    },
  }
}
