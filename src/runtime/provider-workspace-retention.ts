import type {
  AgentCandidateCapturedArtifact,
  AgentCandidateWorkspaceSnapshotEvidence,
  AgentProfile,
} from '@tangle-network/agent-interface'
import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import { verifyWorkspaceSnapshotArtifacts } from '../candidate-execution/artifacts'
import type { AgentCandidateArtifactPort } from '../candidate-execution/types'
import { verifyAgentCandidateWorkspaceArchive } from '../candidate-execution/workspace-archive'
import { ValidationError } from '../errors'
import { runAbortable } from './supervise/abortable'
import { armDeadlineTimer } from './supervise/deadline'
import { detachedSnapshot } from './supervise/snapshot'

/** The caller-owned boundary used to retain an executable provider workspace. */
export interface ProviderWorkspaceRetentionPort {
  /** Maximum wall-clock time Runtime gives capture and verification. */
  readonly timeoutMs: number
  /** Reads the durable manifest and archive after capture returns. */
  readonly artifacts: AgentCandidateArtifactPort
  /** Capture the live environment into the standard candidate workspace evidence shape. */
  capture(
    context: ProviderWorkspaceRetentionContext,
  ): Promise<AgentCandidateWorkspaceSnapshotEvidence>
}

/** The exact live execution facts supplied to a retention callback. */
export interface ProviderWorkspaceRetentionContext {
  readonly environment: AgentEnvironment
  readonly executionId: string
  /** The exact profile used to create the provider environment. */
  readonly profile: AgentProfile
  /** The provider-derived outcome, when one was available before cleanup. */
  readonly outcome?: AgentRunOutcome
  /** A fresh signal bounded by {@link ProviderWorkspaceRetentionPort.timeoutMs}. */
  readonly signal: AbortSignal
}

/** Validate the executable retention port at the create boundary. */
export function assertProviderWorkspaceRetentionPort(
  port: ProviderWorkspaceRetentionPort,
  context: string,
): void {
  if (!Number.isSafeInteger(port.timeoutMs) || port.timeoutMs <= 0) {
    throw new ValidationError(
      `${context}: workspaceRetention.timeoutMs must be a positive safe integer`,
    )
  }
  if (port.artifacts === null || typeof port.artifacts?.read !== 'function') {
    throw new ValidationError(`${context}: workspaceRetention.artifacts.read is required`)
  }
  if (typeof port.capture !== 'function') {
    throw new ValidationError(`${context}: workspaceRetention.capture is required`)
  }
}

/** Capture, require durable refs, and verify every returned manifest/archive byte. */
export async function captureProviderWorkspaceSnapshot(
  port: ProviderWorkspaceRetentionPort,
  context: Omit<ProviderWorkspaceRetentionContext, 'signal'>,
): Promise<AgentCandidateWorkspaceSnapshotEvidence> {
  assertProviderWorkspaceRetentionPort(port, 'provider workspace retention')
  const controller = new AbortController()
  const clearDeadline = armDeadlineTimer(
    port.timeoutMs,
    () =>
      controller.abort(
        new Error(`provider workspace retention timed out after ${port.timeoutMs}ms`),
      ),
    true,
  )
  try {
    const snapshot = await runAbortable(
      async () => {
        // Detach before any asynchronous artifact read. The callback owns its return object and
        // could otherwise mutate the manifest or archive references while verification is in flight.
        const result = detachedSnapshot(
          await port.capture({ ...context, signal: controller.signal }),
          'provider workspace retention snapshot',
        )
        requireDurableWorkspaceArtifacts(result)
        const { archive } = await verifyWorkspaceSnapshotArtifacts(result, port.artifacts)
        await verifyAgentCandidateWorkspaceArchive({
          role: 'candidate',
          snapshot: result,
          archive,
        })
        return result
      },
      controller.signal,
      `provider workspace retention timed out after ${port.timeoutMs}ms`,
    )
    return snapshot
  } finally {
    clearDeadline()
  }
}

/** Native checkpoints, embedded bytes, and digest-only values cannot outlive their source. */
function requireDurableWorkspaceArtifacts(snapshot: AgentCandidateWorkspaceSnapshotEvidence): void {
  if (!isDurableArtifact(snapshot.manifest) || !isDurableArtifact(snapshot.archive)) {
    throw new Error(
      'provider workspace retention requires durable manifest and archive artifact references',
    )
  }
}

function isDurableArtifact(artifact: AgentCandidateCapturedArtifact): boolean {
  return 'locator' in artifact
}
