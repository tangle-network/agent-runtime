/** Historical capture receipts remain readable after client-side capture writers retire. */
import type {
  AgentCandidateWorkspaceSnapshotEvidence,
  AgentExactRunControlRef,
} from '@tangle-network/agent-interface'
import type { ExecutorNodeContext } from './supervise/types'

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

/** One Sidecar execution attempt; retries remain separate evidence. */
export interface ProviderWorkspaceAttemptProvenance {
  readonly executionId: string
  readonly ordinal: number
  readonly providerSessionId: string
  readonly nativeSessionIds: ReadonlyArray<string>
  readonly processIds: ReadonlyArray<string>
  readonly outcome: 'succeeded' | 'failed' | 'cancelled' | 'unknown'
  readonly missingReasons: ReadonlyArray<string>
}

/** Source-reported coverage retained with the verified archive reference. */
export interface ProviderWorkspaceCaptureProvenance {
  readonly status: 'reported' | 'unavailable'
  readonly provider?: string
  readonly environmentId?: string
  readonly executionId?: string
  /** Exact admitted provider execution; executionId above remains the Runtime artifact identity. */
  readonly controlRef?: AgentExactRunControlRef
  /** `none` marks a native-only capture: no workspace was scanned. */
  readonly workspaceScope?: 'environment' | 'none'
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
  /** Sidecar attempts join sessions through executionIds, not the Runtime node ID. */
  readonly attempts?: ReadonlyArray<ProviderWorkspaceAttemptProvenance>
  readonly sessions?: ReadonlyArray<{
    readonly id: string
    readonly executionId: string
    readonly transportEvents: string
    readonly eventCount: number
    readonly messageCount: number
    readonly messageScope?: string
    readonly backendType?: string
    readonly executionIds?: ReadonlyArray<string>
    readonly eventCountsByExecutionId?: Readonly<Record<string, number>>
    readonly nativeSessionId?: string | null
    readonly nativeReason?: string | null
    readonly sidecarImageDigest?: string | null
    readonly sidecarBundleRevision?: string | null
    readonly nativeStore?: {
      readonly scope: 'session'
      readonly roots: ReadonlyArray<{
        readonly scope: 'session-home' | 'workspace-session'
        readonly path: string
      }>
      readonly inventory: {
        readonly scannedFiles: number
        readonly reportedFiles: number
        readonly scannedDirectories: number
        readonly reportedDirectories: number
        readonly scannedSymlinks: number
        readonly reportedSymlinks: number
        readonly skippedEntries: number
      } | null
      readonly complete: boolean
      readonly entries: ReadonlyArray<{
        readonly sourceId?: string
        readonly rootScope: 'session-home' | 'workspace-session'
        readonly path: string
        readonly kind: 'file' | 'directory' | 'symlink'
        readonly mode: number
        readonly sizeBytes: number
        readonly sha256: string | null
        readonly linkTarget: string | null
      }>
      readonly excludedPaths: ReadonlyArray<{
        readonly sourceId?: string
        readonly rootScope: 'session-home' | 'workspace-session'
        readonly path: string
        readonly kind: 'file' | 'directory' | 'symlink'
        readonly mode: number
        readonly sizeBytes: number
        readonly reason: 'credential'
      }>
    }
    readonly processStreams?: {
      readonly complete: boolean
      readonly streamCount: number
      readonly stdinBytes: number
      readonly stdoutBytes: number
      readonly stderrBytes: number
      readonly protocolBytes: number
    }
    readonly nativeEvents?: { readonly complete: boolean; readonly count: number }
  }>
  readonly missing: ReadonlyArray<string>
}

export interface ProviderWorkspaceCaptureResult {
  readonly snapshot: AgentCandidateWorkspaceSnapshotEvidence
  readonly provenance: ProviderWorkspaceCaptureProvenance
  readonly coverageComplete?: boolean
  readonly incompleteReason?: string
  /** Where the port's own capture spent its time, in the port's names and units (ms, bytes),
   *  copied verbatim onto the `workspace-capture` journal event. Runtime sees only the call's
   *  total; on canary test-acceptance-canary-20261019q the split was in the port alone. */
  readonly stages?: Readonly<Record<string, number>>
}

/**
 * Where one workspace capture's time went: the wait for a slot of the port's queue, which every
 * recursive environment shares, and the capture itself. Reported once per workspace capture, on
 * success and on failure, so a run records the split instead of leaving it to inference: on
 * Discovery Lab run terraform-economics-20261005f a turn's result arrived 4 to 28 minutes after its
 * stream ended, and nothing said how much of that was queue.
 */
export interface ProviderWorkspaceCaptureTiming {
  /** Captures of this port holding or waiting for a slot when this one was requested. */
  readonly ahead: number
  /** From the request to the slot being granted, or to the failure when none was granted. */
  readonly queuedMs: number
  /** From the slot being granted to the verified archive, or to the failure. Absent when the
   *  capture never held a slot. */
  readonly captureMs?: number
  /** Bytes of the verified workspace archive. */
  readonly archiveBytes?: number
  readonly outcome: 'captured' | 'failed'
  /** Why a failed capture failed, bounded. */
  readonly error?: string
  /** The port's own split of `captureMs` ({@link ProviderWorkspaceCaptureResult.stages}). */
  readonly stages?: Readonly<Record<string, number>>
}

export interface ProviderWorkspaceCaptureReceipt {
  readonly executionId: string
  /** Durable provider-native identity, separate from the Runtime invocation identity. */
  readonly controlRef?: AgentExactRunControlRef
  readonly node?: ExecutorNodeContext
  readonly environmentId: string
  /** Exact provider-create profile identity; materialization receipts bind it to the authored profile. */
  readonly profileDigest: string
  readonly providerSessionId: string | null
  readonly nativeSessionId: string | null
  readonly snapshot: AgentCandidateWorkspaceSnapshotEvidence
  readonly provenance: ProviderWorkspaceCaptureProvenance
  readonly coverageComplete: boolean
  readonly incompleteReason?: string
}
