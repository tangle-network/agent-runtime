import type {
  AgentCandidateCapturedArtifact,
  AgentCandidateWorkspaceSnapshotEvidence,
  AgentProfile,
} from '@tangle-network/agent-interface'
import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import { verifyWorkspaceSnapshotArtifacts } from '../candidate-execution/artifacts'
import type { AgentCandidateArtifactPort } from '../candidate-execution/types'
import {
  type AgentCandidateWorkspaceArchiveLimits,
  verifyAgentCandidateWorkspaceArchive,
} from '../candidate-execution/workspace-archive'
import { ValidationError } from '../errors'
import { runAbortable } from './supervise/abortable'
import { armDeadlineTimer } from './supervise/deadline'
import { detachedSnapshot } from './supervise/snapshot'
import type { ExecutorNodeContext } from './supervise/types'

/** The caller-owned boundary used to retain an executable provider workspace. */
export interface ProviderWorkspaceRetentionPort {
  /** Maximum wall-clock time Runtime gives capture and verification. */
  readonly timeoutMs: number
  /** Same explicit archive bounds used by the capture callback. */
  readonly limits?: Partial<AgentCandidateWorkspaceArchiveLimits>
  /** Refuse cleanup while any native session or workspace coverage remains missing. */
  readonly requireCompleteProvenance?: boolean
  /** Reads the durable manifest and archive after capture returns. */
  readonly artifacts: AgentCandidateArtifactPort
  /** Capture the live environment into the standard candidate workspace evidence shape. */
  capture(
    context: ProviderWorkspaceRetentionContext,
  ): Promise<AgentCandidateWorkspaceSnapshotEvidence | ProviderWorkspaceCaptureResult>
}

/** Source inventory metadata for a workspace entry. */
export interface ProviderWorkspaceEntryMetadata {
  readonly path: string
  readonly type: 'file' | 'directory' | 'symlink'
  readonly sizeBytes: number
  readonly mode: number
  readonly owner?: string | null
  readonly group?: string | null
  readonly modifiedAt?: string | null
  readonly accessedAt?: string | null
  readonly symlinkTarget?: string | null
}

/** Source-reported coverage retained with the verified archive reference. */
export interface ProviderWorkspaceCaptureProvenance {
  readonly status: 'reported' | 'unavailable'
  readonly provider?: string
  readonly environmentId?: string
  readonly executionId?: string
  readonly workspaceScope?: 'environment'
  readonly workspaceRoot?: string
  readonly capturedAt?: string
  readonly entries?: ReadonlyArray<ProviderWorkspaceEntryMetadata>
  readonly excludedPaths?: ReadonlyArray<
    ProviderWorkspaceEntryMetadata & { readonly reason: string }
  >
  readonly workspace?: {
    readonly scannedFiles: number
    readonly scannedDirectories: number
    readonly reportedFiles: number
    readonly reportedDirectories: number
    readonly complete: boolean
  }
  readonly sessions?: ReadonlyArray<{
    readonly id: string
    readonly executionId: string
    readonly transportEvents: string
    readonly eventCount: number
    readonly messageCount: number
    readonly messageScope?: string
    readonly nativeRollout: string
    readonly nativeSessionId?: string | null
    readonly nativeReason?: string | null
    readonly nativeSha256?: string | null
    readonly nativeBytes?: number | null
  }>
  readonly missing: ReadonlyArray<string>
}

export interface ProviderWorkspaceCaptureResult {
  readonly snapshot: AgentCandidateWorkspaceSnapshotEvidence
  readonly provenance: ProviderWorkspaceCaptureProvenance
  readonly coverageComplete?: boolean
  readonly incompleteReason?: string
}

/** The exact live execution facts supplied to a retention callback. */
export interface ProviderWorkspaceRetentionContext {
  readonly environment: AgentEnvironment
  readonly executionId: string
  /** Exact supervised tree identity, when a supervisor created this execution. */
  readonly node?: ExecutorNodeContext
  /** Sandbox/provider session used for this turn; null means no session id was observed. */
  readonly providerSessionId?: string | null
  /** The harness's own session identity is unknown until a provider reports it. */
  readonly nativeSessionId?: string | null
  /** The exact profile used to create the provider environment. */
  readonly profile: AgentProfile
  /** The provider-derived outcome, when one was available before cleanup. */
  readonly outcome?: AgentRunOutcome
  /** A fresh signal bounded by {@link ProviderWorkspaceRetentionPort.timeoutMs}. */
  readonly signal: AbortSignal
}

/** Durable join from one provider box to the verified bytes retained before cleanup. */
export interface ProviderWorkspaceCaptureReceipt {
  readonly executionId: string
  readonly node?: ExecutorNodeContext
  readonly environmentId: string
  readonly providerSessionId: string | null
  readonly nativeSessionId: string | null
  readonly snapshot: AgentCandidateWorkspaceSnapshotEvidence
  readonly provenance: ProviderWorkspaceCaptureProvenance
  readonly coverageComplete: boolean
  readonly incompleteReason?: string
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
): Promise<ProviderWorkspaceCaptureResult> {
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
        const snapshot = 'snapshot' in result ? result.snapshot : result
        const provenance =
          'snapshot' in result
            ? detachedSnapshot(result.provenance, 'provider workspace retention provenance')
            : {
                status: 'unavailable' as const,
                missing: ['Capture callback returned no coverage metadata'],
              }
        if (
          !Array.isArray(provenance.missing) ||
          !['reported', 'unavailable'].includes(provenance.status)
        ) {
          throw new Error('provider workspace retention provenance is malformed')
        }
        if (
          provenance.status === 'reported' &&
          provenance.environmentId !== context.environment.id
        ) {
          throw new Error('provider workspace retention provenance names another environment')
        }
        if (
          provenance.executionId !== undefined &&
          provenance.executionId !== context.executionId
        ) {
          throw new Error('provider workspace retention provenance names another execution')
        }
        const coverageComplete = !(
          provenance.status !== 'reported' ||
          provenance.workspace?.complete !== true ||
          provenance.missing.length > 0 ||
          provenance.sessions?.some(
            (session) =>
              session.transportEvents !== 'complete' || session.nativeRollout !== 'complete',
          ) !== false
        )
        requireDurableWorkspaceArtifacts(snapshot)
        const { archive } = await verifyWorkspaceSnapshotArtifacts(snapshot, port.artifacts)
        await verifyAgentCandidateWorkspaceArchive({
          role: 'candidate',
          snapshot,
          archive,
          ...(port.limits === undefined ? {} : { limits: port.limits }),
        })
        return {
          snapshot,
          provenance,
          coverageComplete,
          ...(coverageComplete
            ? {}
            : {
                incompleteReason: `provider workspace retention coverage incomplete: ${provenance.missing.join('; ') || 'native session or workspace export missing'}`,
              }),
        }
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
