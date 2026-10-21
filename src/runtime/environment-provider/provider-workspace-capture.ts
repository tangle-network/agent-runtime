import type { AgentCandidateWorkspaceSnapshotEvidence } from '@tangle-network/agent-interface'
import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import { harnessTranscriptUnavailable, retainHarnessTranscript } from '../harness-transcript'
import {
  captureProviderWorkspaceSnapshot,
  type ProviderWorkspaceCaptureTiming,
} from '../provider-workspace-retention'
import type { ProviderExecutorScope } from './provider-executor-state'
import { providerWorkspaceCaptureReceipt } from './provider-retention-lifecycle'

type WorkspaceRetention = NonNullable<ProviderExecutorScope['options']['workspaceRetention']>
type CapturedWorkspace = Awaited<ReturnType<typeof captureProviderWorkspaceSnapshot>>

/** Capture the environment's workspace once per generation; later callers share that capture. */
export async function captureExecutorWorkspace(
  scope: ProviderExecutorScope,
  next: AgentEnvironment,
  outcome: AgentRunOutcome | undefined,
): Promise<AgentCandidateWorkspaceSnapshotEvidence | undefined> {
  const { state } = scope
  const workspaceRetention = scope.options.workspaceRetention
  if (workspaceRetention === undefined) return undefined
  state.resetWorkspace(next)
  if (state.workspaceSnapshot !== undefined) return state.workspaceSnapshot
  if (state.workspaceCapturePromise === undefined) {
    state.workspaceCapturePromise = startWorkspaceCapture(scope, workspaceRetention, next, outcome)
  }
  return await state.workspaceCapturePromise
}

function startWorkspaceCapture(
  scope: ProviderExecutorScope,
  workspaceRetention: WorkspaceRetention,
  next: AgentEnvironment,
  outcome: AgentRunOutcome | undefined,
): Promise<AgentCandidateWorkspaceSnapshotEvidence> {
  const { state, mirrors, retention, node, createProfile } = scope
  state.workspaceOutcome = outcome
  // A running copy may still be reading this environment. Finish it before the final
  // capture or destruction so the two snapshots have an unambiguous order.
  mirrors.stopLiveMirror()
  // The workspace capture reads the session too; an interval copy must not race it.
  mirrors.stopScheduledNativeCapture()
  const captureContext = {
    environment: next,
    executionId: state.workspaceExecutionId,
    ...(state.workspaceControlRef === undefined ? {} : { controlRef: state.workspaceControlRef }),
    ...(node === undefined ? {} : { node }),
    providerSessionId: state.providerSessionId,
    nativeSessionId: null,
    profile: createProfile,
    ...(outcome === undefined ? {} : { outcome }),
  }
  // Where the capture's time went, journaled on the node before its outcome is used.
  const reportTiming = retention?.onWorkspaceCapture
  let timing: ProviderWorkspaceCaptureTiming | undefined
  const capturedExecutionId = state.workspaceExecutionId
  // Journaled before the capture waits for anything, so a reader sees it in flight; its
  // timing record is written after this one.
  const started =
    retention
      ?.onWorkspaceCaptureStarted?.({ executionId: capturedExecutionId, environmentId: next.id })
      .catch(() => undefined) ?? Promise.resolve()
  // A turn's final session copy runs beside this capture, which holds the session too.
  return Promise.all([mirrors.nativeRunningInFlight, mirrors.liveInFlight])
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
    .then((captured) => {
      recordCapturedWorkspace(scope, workspaceRetention, next, captured)
      return captured.snapshot
    })
    .catch((error: unknown) => {
      state.workspaceCaptureFailure = error
      mirrors.noteCaptureFailure(error)
      throw error
    })
}

/** Keep the capture's snapshot and provenance, and project its transcript for the executor. */
function recordCapturedWorkspace(
  scope: ProviderExecutorScope,
  workspaceRetention: WorkspaceRetention,
  next: AgentEnvironment,
  { snapshot, provenance, coverageComplete, incompleteReason }: CapturedWorkspace,
): void {
  const { state, mirrors, node, createProfile } = scope
  state.workspaceSnapshot = snapshot
  state.workspaceProvenance = provenance
  state.workspaceCoverageComplete = coverageComplete ?? false
  state.workspaceIncompleteReason = incompleteReason
  try {
    state.harnessTranscript =
      createProfile.harness === undefined
        ? harnessTranscriptUnavailable('unknown-harness')
        : retainHarnessTranscript(
            providerWorkspaceCaptureReceipt(
              {
                executionId: state.workspaceExecutionId,
                profile: createProfile,
                ...(node === undefined ? {} : { node }),
                workspaceControlRef: () => state.workspaceControlRef,
                workspaceProvenance: () => provenance,
                workspaceCoverage: () => ({
                  complete: coverageComplete ?? false,
                  incompleteReason,
                }),
              },
              next,
              snapshot,
              state.providerSessionId,
            ),
            createProfile.harness,
          )
    mirrors.holdsTranscript = false
  } catch (error) {
    // A native copy already stored stays the transcript; only its absence is reported.
    if (!mirrors.holdsTranscript) {
      state.harnessTranscript = {
        status: 'unavailable',
        reason: 'retained-projection-failed',
        skipped: [
          {
            path: state.workspaceExecutionId,
            reason: error instanceof Error ? error.message : String(error),
          },
        ],
      }
    }
  }
  if (workspaceRetention.requireCompleteProvenance && !coverageComplete) {
    state.workspacePreservationRequired = true
  }
}
