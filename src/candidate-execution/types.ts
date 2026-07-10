import type {
  AgentCandidateArtifactRef,
  AgentCandidateAttemptPolicy,
  AgentCandidateBundle,
  AgentCandidateCapturedArtifact,
  AgentCandidateContainer,
  AgentCandidateEffectiveMemory,
  AgentCandidateExecutionLimits,
  AgentCandidateExecutionPlanEvidence,
  AgentCandidateGitHubRepository,
  AgentCandidateInstructionDelivery,
  AgentCandidateMaterializationReceipt,
  AgentCandidateMemoryReceipt,
  AgentCandidateOciPlatform,
  AgentCandidateProfilePlanEvidence,
  AgentCandidateResolvedModel,
  AgentCandidateRunReceipt,
  AgentCandidateTermination,
  AgentCandidateWorkspaceSnapshotEvidence,
  ReasoningEffort,
  Sha256Digest,
} from '@tangle-network/agent-interface'

export const verifiedCandidateBrand: unique symbol = Symbol('verifiedAgentCandidate')
export const preparedCandidateBrand: unique symbol = Symbol('preparedAgentCandidate')

/** Reads one content-addressed object from the closed S3/IPFS locator set. */
export interface AgentCandidateArtifactPort {
  read(ref: AgentCandidateArtifactRef): Promise<Uint8Array>
}

/** Resolves a declared GitHub repository to an already-present local Git object store. */
export interface AgentCandidateRepositoryPort {
  resolve(repository: AgentCandidateGitHubRepository): Promise<string>
}

export interface AgentCandidateVerificationPorts {
  artifacts: AgentCandidateArtifactPort
  repositories: AgentCandidateRepositoryPort
}

/**
 * Materializes an already-verified workspace archive.
 *
 * The runtime independently scans every resulting byte, mode, and path against
 * the signed manifest after this returns. Implementations may therefore unpack
 * any archive encoding, or no-op when the exact workspace is already present.
 */
export interface AgentCandidateWorkspacePort {
  materialize(input: {
    role: 'task' | 'candidate'
    snapshot: AgentCandidateWorkspaceSnapshotEvidence
    archive: Uint8Array
    destination: string
  }): Promise<void>
}

export interface ResolvedAgentCandidateContainer {
  source: 'pinned-container' | 'evaluator-task-container'
  image: string
  indexDigest: Sha256Digest
  manifestDigest: Sha256Digest
  platform: AgentCandidateOciPlatform
}

export interface AgentCandidateContainerPort {
  resolve(input: {
    candidate: AgentCandidateContainer | undefined
    evaluatorTaskContainer: ResolvedAgentCandidateContainer | undefined
  }): Promise<ResolvedAgentCandidateContainer>
}

export interface AgentCandidateModelPort {
  resolve(input: {
    requested: string
    harness: AgentCandidateBundle['execution']['harness']
    reasoningEffort: NonNullable<AgentCandidateBundle['profile']['model']>['reasoningEffort']
  }): Promise<AgentCandidateResolvedModel>
  grant(input: {
    executionId: string
    resolved: AgentCandidateResolvedModel
    limits: AgentCandidateExecutionLimits
  }): Promise<AgentCandidateProtectedModelGrant>
}

export interface AgentCandidateProtectedModelGrant {
  digest: Sha256Digest
  /** Injected by the evaluator after public plan verification; never persisted. */
  env: Readonly<Record<string, string>>
}

export interface AgentCandidateMemoryResetResult {
  evidence: AgentCandidateCapturedArtifact
  emptyStateDigest: Sha256Digest
  beforeState: AgentCandidateWorkspaceSnapshotEvidence
  /** Evaluator-owned access injected after plan verification; never persisted. */
  env: Readonly<Record<string, string>>
}

export interface AgentCandidateMemoryPort {
  reset(input: {
    executionId: string
    effectiveNamespace: string
    seed?: Uint8Array
    seedDigest?: Sha256Digest
  }): Promise<AgentCandidateMemoryResetResult>
}

export interface AgentCandidateExecutionPorts extends AgentCandidateVerificationPorts {
  workspaces: AgentCandidateWorkspacePort
  containers: AgentCandidateContainerPort
  models: AgentCandidateModelPort
  memory: AgentCandidateMemoryPort
}

export interface AgentCandidateTaskExecution {
  executionId: string
  benchmark: string
  benchmarkVersion: string
  taskId: string
  splitDigest: Sha256Digest
  /** Exact agent-visible task instruction. The runtime rejects malformed Unicode. */
  instruction: string
  repository: {
    identity: string
    rootIdentity: string
    baseCommit: string
    baseTree: string
  }
  attempt: AgentCandidateAttemptPolicy
  model: {
    requested: string
    reasoningEffort: ReasoningEffort
  }
  /** Absolute paths inside the evaluator-owned execution environment. */
  executionRoots: {
    taskRoot: string
    candidateRoot?: string
  }
  /** Host-side staging roots. These are verified but never signed as container paths. */
  stagingRoots: {
    taskRoot: string
    candidateRoot?: string
    profileRoot: string
  }
  workspace: AgentCandidateWorkspaceSnapshotEvidence
  evaluatorTaskContainer?: ResolvedAgentCandidateContainer
  limits: AgentCandidateExecutionLimits
}

export interface VerifiedAgentCandidate {
  readonly bundle: AgentCandidateBundle
  readonly materializedTree?: string
  readonly [verifiedCandidateBrand]: true
}

export interface CanonicalCandidateDocument<T> {
  readonly value: T
  /** Canonical UTF-8 bytes of `value` with its top-level digest omitted. */
  readonly bytes: Uint8Array
  readonly digest: Sha256Digest
}

export interface PreparedAgentCandidateLaunch {
  executable: string
  /** Complete fixed argv, including profile materializer flags but excluding task delivery. */
  args: string[]
  env: Record<string, string>
  /** Informational subset already present at the tail of `args`; executors must not append twice. */
  flags: string[]
  cwd: string
}

export interface PreparedAgentCandidateInstruction {
  bytes: Uint8Array
  delivery: AgentCandidateInstructionDelivery
}

export interface PreparedAgentCandidateTrace {
  runId: string
  tags: Record<string, string>
  env: Record<string, string>
}

export interface PreparedAgentCandidateExecution {
  readonly bundle: AgentCandidateBundle
  readonly executionId: string
  readonly roots: {
    execution: {
      taskRoot: string
      candidateRoot?: string
    }
    staging: {
      taskRoot: string
      candidateRoot?: string
      profileRoot: string
    }
  }
  readonly profilePlan: {
    value: AgentCandidateProfilePlanEvidence
    bytes: Uint8Array
    written: string[]
  }
  readonly executionPlan: {
    value: AgentCandidateExecutionPlanEvidence
    bytes: Uint8Array
  }
  readonly materializationReceipt: CanonicalCandidateDocument<AgentCandidateMaterializationReceipt>
  readonly launch: PreparedAgentCandidateLaunch
  readonly instruction: PreparedAgentCandidateInstruction
  readonly resolvedModel: AgentCandidateResolvedModel
  /** Evaluator-owned authorization handle. Never serialized into a plan, receipt, or trace. */
  readonly protectedModelAccess: AgentCandidateProtectedModelGrant
  /** Present only for isolated memory. Never serialized into a plan, receipt, or trace. */
  readonly protectedMemoryAccess?: Readonly<Record<string, string>>
  readonly knowledge?: {
    snapshotId: string
    manifestDigest: Sha256Digest
    manifest: Uint8Array
  }
  readonly trace: PreparedAgentCandidateTrace
  readonly memory: AgentCandidateEffectiveMemory
  readonly [preparedCandidateBrand]: true
}

export interface AgentCandidateProtectedRunCapture {
  executionId: string
  termination: AgentCandidateTermination
  /** Required only when the prepared candidate uses isolated task memory. */
  memoryAfter?: AgentCandidateWorkspaceSnapshotEvidence
}

export type AgentCandidateRunFinalization =
  | {
      succeeded: true
      receipt: CanonicalCandidateDocument<AgentCandidateRunReceipt>
    }
  | {
      succeeded: false
      reason: string
      partial: {
        executionId: string
        bundleDigest: Sha256Digest
        executionPlanDigest: Sha256Digest
        materializationReceiptDigest: Sha256Digest
        termination?: AgentCandidateTermination
      }
    }

/** Protected trace tags that bind a run to one prepared candidate execution. */
export const CANDIDATE_TRACE_TAGS = {
  executionId: 'tangle.candidate.execution_id',
  bundleDigest: 'tangle.candidate.bundle_digest',
  executionPlanDigest: 'tangle.candidate.execution_plan_digest',
  materializationReceiptDigest: 'tangle.candidate.materialization_receipt_digest',
} as const

/** Environment keys used to propagate immutable candidate trace identity. */
export const CANDIDATE_TRACE_ENV = {
  executionId: 'TANGLE_CANDIDATE_EXECUTION_ID',
  bundleDigest: 'TANGLE_CANDIDATE_BUNDLE_DIGEST',
  executionPlanDigest: 'TANGLE_CANDIDATE_EXECUTION_PLAN_DIGEST',
  materializationReceiptDigest: 'TANGLE_CANDIDATE_MATERIALIZATION_RECEIPT_DIGEST',
  traceRunId: 'TANGLE_TRACE_RUN_ID',
} as const

export type PreparedMemoryReceipt = AgentCandidateMemoryReceipt
