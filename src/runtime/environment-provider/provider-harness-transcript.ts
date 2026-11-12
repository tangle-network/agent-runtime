import {
  AgentExactRunControlRefSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
  sameAgentRunControlRef,
  workspaceCwdPathForBase,
} from '@tangle-network/agent-interface'
import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import { agentHarness } from '../harness-role'
import {
  captureHarnessTranscript,
  HARNESS_TRANSCRIPT_SETTLE_TIMEOUT_MS,
  type HarnessTranscriptCapture,
} from '../harness-transcript'
import { runAbortable } from '../supervise/abortable'
import type { RetainedExecutorContext } from '../supervise/retained-executor'
import { detachedSnapshot } from '../supervise/snapshot'
import type { ExecutorResult } from '../supervise/types'
import type { ProviderExecutorScope } from './provider-executor-state'

/** Select the existing reader or trusted host port; Scope alone persists its result. */
async function readProviderHarnessTranscript(
  scope: ProviderExecutorScope,
  environment: AgentEnvironment,
  sourceSignal?: AbortSignal,
): Promise<HarnessTranscriptCapture> {
  const capture = scope.options.harnessTranscript
  if (!capture)
    return captureHarnessTranscript(
      environment as Parameters<typeof captureHarnessTranscript>[0],
      scope.profile.harness,
      sourceSignal,
    )
  const refused = (reason: string): HarnessTranscriptCapture => ({
    status: 'unavailable',
    reason: 'capture-failed',
    skipped: [{ path: scope.executionId, reason }],
  })
  const handle = scope.state.retained
  const control = AgentExactRunControlRefSchema.safeParse(handle?.controlRef)
  const expected = scope.state.workspaceControlRef
  const harness = agentHarness(scope.createProfile.harness)
  if (
    !handle ||
    !control.success ||
    !expected ||
    !scope.node ||
    !harness ||
    control.data.provider !== scope.provider.name ||
    environment.provider !== scope.provider.name ||
    control.data.environmentId !== environment.id ||
    control.data.sessionId !== scope.state.providerSessionId ||
    canonicalCandidateDigest(control.data) !== canonicalCandidateDigest(expected)
  )
    return refused(
      'Native capture requires the exact admitted provider, session, execution and Scope identity',
    )
  // A stopped source signal must not discard an already-ended native process's evidence.
  const signal = AbortSignal.timeout(HARNESS_TRANSCRIPT_SETTLE_TIMEOUT_MS)
  try {
    return await runAbortable(
      async () => {
        const terminal = await handle.status({ signal })
        if (
          !['completed', 'failed', 'cancelled'].includes(terminal.status ?? '') ||
          canonicalCandidateDigest(terminal.controlRef) !== canonicalCandidateDigest(control.data)
        )
          return refused('Native capture requires exact terminal provider proof')
        const cwd = workspaceCwdPathForBase(
          scope.options.defaults?.workspace?.cwd,
          'host',
          'provider native capture',
        )
        if (!cwd) return refused('Native capture requires the admitted host working directory')
        const identity = detachedSnapshot(
          {
            sessionId: control.data.sessionId,
            harness,
            profileDigest: canonicalAgentProfileDigest(scope.createProfile),
            cwd,
            node: scope.node,
            runs: [{ runId: control.data.runId, requestDigest: control.data.requestDigest }],
            controlRef: control.data,
          },
          'provider native capture identity',
        )
        const request = Object.freeze({ ...identity, signal })
        const result = await capture(request)
        if (result.status === 'unavailable') return result
        const artifact = result.status === 'captured' ? result.artifact : undefined
        const binding = artifact?.binding
        if (
          !artifact ||
          artifact.harness !== harness ||
          !binding ||
          (binding.kind !== 'bridge' && binding.kind !== 'provider') ||
          (binding.controlRef !== undefined &&
            !sameAgentRunControlRef(binding.controlRef, control.data)) ||
          binding.sessionId !== request.sessionId ||
          binding.profileDigest !== request.profileDigest ||
          canonicalCandidateDigest(binding.node ?? null) !==
            canonicalCandidateDigest(request.node) ||
          canonicalCandidateDigest(binding.runs) !== canonicalCandidateDigest(request.runs)
        )
          return refused('Native capture returned a different or unsupported execution binding')
        return detachedSnapshot(
          {
            ...result,
            artifact: {
              ...artifact,
              binding: { ...binding, kind: 'provider' as const, controlRef: control.data },
            },
          },
          'provider native capture',
        )
      },
      signal,
      'Provider native capture stopped',
    )
  } catch {
    // A trusted port can close over credentials; its exception text is not public evidence.
    return refused('Trusted provider native capture failed or exceeded its bound')
  }
}

/** Retain failed capture as evidence debt until an exact repair has been persisted. */
export async function captureProviderHarnessTranscript(
  scope: ProviderExecutorScope,
  environment: AgentEnvironment,
  signal?: AbortSignal,
): Promise<HarnessTranscriptCapture> {
  const capture = await readProviderHarnessTranscript(scope, environment, signal)
  if (scope.options.harnessTranscript) {
    scope.state.transcriptPreservationRequired =
      capture.status === 'unavailable' ||
      (capture.status === 'captured'
        ? capture.coverageComplete !== true || capture.skippedCount > 0 || !!capture.missing?.length
        : !capture.descriptor.source.coverageComplete ||
          capture.descriptor.skipped.length > 0 ||
          capture.descriptor.missing.length > 0)
  }
  return capture
}

/** A repaired read repays evidence debt only after its exact invocation receipt is durable. */
export async function persistProviderHarnessTranscript(
  scope: ProviderExecutorScope,
  task: unknown,
  result: ExecutorResult<unknown> | undefined,
  retention: RetainedExecutorContext | undefined = scope.retention,
): Promise<void> {
  scope.state.transcriptResult = result
  try {
    await retention?.onHarnessTranscript?.(task, scope.state.harnessTranscript, result)
    if (retention?.onHarnessTranscript) {
      scope.state.transcriptPersistenceFailed = false
      // A prior cleanup cached its evidence-custody refusal. Only durable repair can reopen it.
      if (!scope.state.transcriptPreservationRequired && !scope.state.workspacePreservationRequired)
        scope.state.workspaceCleanupPromise = undefined
    }
  } catch (error) {
    scope.state.transcriptPersistenceFailed = true
    throw error
  }
}
