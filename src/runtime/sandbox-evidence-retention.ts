import type { AgentCandidateWorkspaceSnapshotEvidence } from '@tangle-network/agent-interface'
import type { ProviderWorkspaceCaptureProvenance } from './provider-workspace-retention'

/** Historical receipt written by the retired client capture port. */
export interface SandboxEvidenceReceipt {
  readonly boxId: string
  readonly executionId: string
  /** Exact authored profile identity without copying credentials into the receipt. */
  readonly profileDigest: string
  readonly scope: 'box'
  readonly sandboxSessionIds: ReadonlyArray<string>
  readonly nativeSessionIds?: ReadonlyArray<string>
  readonly sessionExecutionIds: Readonly<Record<string, ReadonlyArray<string>>>
  readonly snapshot: AgentCandidateWorkspaceSnapshotEvidence
  readonly provenance: ProviderWorkspaceCaptureProvenance
  readonly coverageComplete: boolean
  readonly incompleteReason?: string
}
