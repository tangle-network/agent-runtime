import type { BenchmarkEvaluation, TraceStore } from '@tangle-network/agent-eval'
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
  AgentCandidateModelAccessNetwork,
  AgentCandidateOciPlatform,
  AgentCandidateProfilePlanEvidence,
  AgentCandidateResolvedModel,
  AgentCandidateRunReceiptV2,
  AgentCandidateSpend,
  AgentCandidateTaskOutcomeEvidence,
  AgentCandidateTermination,
  AgentCandidateWorkspaceManifestMaterialV1,
  AgentCandidateWorkspaceSnapshotEvidence,
  ReasoningEffort,
  Sha256Digest,
} from '@tangle-network/agent-interface'

export const verifiedCandidateBrand: unique symbol = Symbol('verifiedAgentCandidate')
export const preparedCandidateBrand: unique symbol = Symbol('preparedAgentCandidate')
export const verifiedTaskOutcomeBrand: unique symbol = Symbol('verifiedTaskOutcome')

/** Reads one content-addressed object from the closed S3/IPFS locator set. */
export interface AgentCandidateArtifactPort {
  read(ref: AgentCandidateArtifactRef): Promise<Uint8Array>
}

export type AgentCandidateOutputPurpose =
  | 'task-manifest'
  | 'task-archive'
  | 'task-patch'
  | 'task-outcome'
  | 'memory-after-manifest'
  | 'memory-after-archive'
  | 'grader-evidence'
  | 'benchmark-result'
  | 'model-settlement'
  | 'trace'
  | 'run-receipt'
  | 'failure-evidence'

/** Durable content-addressed evidence store controlled only by the evaluator. */
export interface AgentCandidateOutputArtifactPort extends AgentCandidateArtifactPort {
  /** Must be idempotent for identical bytes and return only a durable S3/IPFS locator. */
  put(input: {
    executionId: string
    purpose: AgentCandidateOutputPurpose
    bytes: Uint8Array
    /** Abort must prevent durable publication when it happens before resolution. */
    signal?: AbortSignal
  }): Promise<AgentCandidateArtifactRef>
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
    role: 'task' | 'candidate' | 'memory'
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
  /**
   * Reserve a stable access identity without creating a live credential.
   * The reservation is scoped to `preparationId` and must automatically expire
   * at `expiresAtMs`, even if this call returns ambiguously to the runtime.
   */
  reserveGrant(input: {
    executionId: string
    preparationId: string
    expiresAtMs: number
    attempt: AgentCandidateAttemptPolicy
    bundleDigest: Sha256Digest
    resolved: AgentCandidateResolvedModel
    limits: AgentCandidateModelLimits
  }): Promise<AgentCandidateProtectedModelReservation>
  /** Create the live scoped credential only after the execution attempt is durably claimed. */
  activateGrant(input: {
    executionId: string
    preparationId: string
    grantDigest: Sha256Digest
    resolved: AgentCandidateResolvedModel
    deadlineAtMs: number
  }): Promise<AgentCandidateProtectedModelActivation>
  /**
   * Atomically revoke the grant, drain in-flight calls, and return its immutable final ledger.
   * This operation must be idempotent for the exact preparation and must also
   * settle a reservation that was never activated. It must never affect a
   * different preparation, even when both reservations report the same digest.
   */
  settleGrant(input: {
    executionId: string
    preparationId: string
    grantDigest: Sha256Digest
    resolved: AgentCandidateResolvedModel
    reason: 'completed' | 'failed' | 'timeout' | 'replayed' | 'preparation-failed' | 'abandoned'
  }): Promise<AgentCandidateProtectedModelSettlement>
}

/** Limits mechanically enforced by the evaluator-owned model gateway. */
export type AgentCandidateModelLimits = Pick<
  AgentCandidateExecutionLimits,
  'maxModelCalls' | 'maxInputTokens' | 'maxOutputTokens' | 'maxCostUsd'
>

export interface AgentCandidateProtectedModelReservation {
  preparationId: string
  digest: Sha256Digest
  /** Evaluator service must expire and revoke this reservation at this epoch millisecond. */
  expiresAtMs: number
  /** The gateway must stop calls before any one of these limits is exceeded. */
  enforcedLimits: AgentCandidateModelLimits
  /** Exact public endpoint exception; every other candidate destination stays blocked. */
  network: AgentCandidateModelAccessNetwork
}

export interface AgentCandidateProtectedModelActivation {
  /** Injected only into the trusted executor after all pre-launch checks pass. */
  env: Readonly<Record<string, string>>
}

/** One evaluator-gateway call in the final, revoked model-access ledger. */
export interface AgentCandidateProtectedModelCall {
  callId: string
  /** Router-generated public response identity. */
  generationId: string
  /** Exact protected agent-eval LLM span produced from the router ledger. */
  traceSpanId: string
  status: 'succeeded' | 'failed'
  model: string
  startedAtMs: number
  endedAtMs: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  reasoningTokens: number
  /** Integer billionths of one US dollar; avoids floating-point ledger drift. */
  costUsdNanos: number
}

export interface AgentCandidateProtectedModelSettlement {
  preparationId: string
  grantDigest: Sha256Digest
  closed: true
  calls: readonly AgentCandidateProtectedModelCall[]
}

export interface AgentCandidateMemoryResetResult {
  preparationId: string
  accessDigest: Sha256Digest
  expiresAtMs: number
  evidence: AgentCandidateCapturedArtifact
  emptyStateDigest: Sha256Digest
  beforeState: AgentCandidateWorkspaceSnapshotEvidence
}

export interface AgentCandidateMemoryPort {
  /**
   * Reset and reserve exact task memory without returning live access.
   * The service must scope the reservation to `preparationId`, automatically
   * revoke it at `expiresAtMs`, and never reuse it for another preparation.
   */
  reset(input: {
    executionId: string
    preparationId: string
    expiresAtMs: number
    effectiveNamespace: string
    seed?: Uint8Array
    seedDigest?: Sha256Digest
  }): Promise<AgentCandidateMemoryResetResult>
  /**
   * Create live scoped access only after the execution attempt is durably claimed.
   * Activation must match the exact preparation/access pair and may not extend expiry.
   */
  activate(input: {
    executionId: string
    preparationId: string
    accessDigest: Sha256Digest
    effectiveNamespace: string
    deadlineAtMs: number
  }): Promise<{ env: Readonly<Record<string, string>> }>
  /**
   * Revoke evaluator-owned access after process death or a failed preparation.
   * Must be idempotent and concurrency-safe for the exact preparation/access
   * pair and must never close a different preparation.
   */
  close(input: {
    executionId: string
    preparationId: string
    accessDigest: Sha256Digest
    effectiveNamespace: string
    reason: 'completed' | 'failed' | 'timeout' | 'replayed' | 'preparation-failed' | 'abandoned'
  }): Promise<{ closed: true }>
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
  args: readonly string[]
  env: Readonly<Record<string, string>>
  /** Informational subset already present at the tail of `args`; executors must not append twice. */
  flags: readonly string[]
  cwd: string
}

export interface PreparedAgentCandidateInstruction {
  bytes: Uint8Array
  delivery: AgentCandidateInstructionDelivery
}

export interface PreparedAgentCandidateTrace {
  runId: string
  tags: Readonly<Record<string, string>>
  env: Readonly<Record<string, string>>
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
    written: readonly string[]
  }
  readonly executionPlan: {
    value: AgentCandidateExecutionPlanEvidence
    bytes: Uint8Array
  }
  readonly materializationReceipt: CanonicalCandidateDocument<AgentCandidateMaterializationReceipt>
  readonly launch: PreparedAgentCandidateLaunch
  readonly instruction: PreparedAgentCandidateInstruction
  readonly resolvedModel: AgentCandidateResolvedModel
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
}

/** Raw evaluator capture made only after the candidate process is dead. */
export interface AgentCandidateExecutorTaskOutcomeCapture {
  /** Claimed final tree. The runtime recomputes it independently from `gitDiff`. */
  resultTree: string
  /** Complete evaluator-captured workspace description after candidate execution. */
  afterState: AgentCandidateWorkspaceManifestMaterialV1
  /** Reproducible workspace archive corresponding to `afterState`. */
  archive: Uint8Array
  /** Exact binary patch from the signed task base to `afterState`. */
  gitDiff: Uint8Array
}

/** Raw isolated-memory capture made only after access has been revoked. */
export interface AgentCandidateExecutorMemoryCapture {
  readonly afterState: AgentCandidateWorkspaceManifestMaterialV1
  readonly archive: Uint8Array
}

/** Idempotent executor result after process death and trace drain. */
export interface AgentCandidateExecutorFinalCapture {
  readonly stopped: true
  readonly taskOutcome?: AgentCandidateExecutorTaskOutcomeCapture
  /** Required only when the prepared candidate uses isolated task memory. */
  readonly memoryAfter?: AgentCandidateExecutorMemoryCapture
}

/** Branded task outcome that has survived independent patch and tree verification. */
export interface VerifiedAgentCandidateTaskOutcome {
  readonly evidence: AgentCandidateTaskOutcomeEvidence & {
    readonly artifact: AgentCandidateArtifactRef
  }
  readonly patch: Uint8Array
  readonly [verifiedTaskOutcomeBrand]: true
}

/**
 * Evaluator-owned executable grader, pinned by immutable implementation bytes.
 *
 * `run` is an isolation boundary, not an arbitrary scoring callback. The
 * implementation admitted to that boundary is supplied by the runtime after
 * artifact verification. Implementations must derive every returned binding
 * digest from the bytes and task outcome they actually admitted, rather than
 * copying an expected digest from ambient configuration.
 */
export interface AgentCandidateBenchmarkGraderPort {
  readonly name: string
  readonly version: string
  readonly artifact: AgentCandidateArtifactRef
  run(input: {
    readonly executionId: string
    readonly termination: AgentCandidateTermination
    readonly outcome: VerifiedAgentCandidateTaskOutcome
    /** Exact verified artifact bytes. Each read returns a detached copy. */
    readonly implementation: {
      readonly byteLength: number
      readonly bytes: Uint8Array
    }
    /** Frozen result deadline; runners must stop work and side effects when aborted. */
    readonly signal: AbortSignal
  }): Promise<{
    readonly evaluation: BenchmarkEvaluation
    /** Raw grader output needed to audit or reproduce the normalized result. */
    readonly evidence: Uint8Array
    /** Runtime-checked binding between admitted code, task input, and raw output. */
    readonly binding: {
      /** Digest computed from the implementation bytes admitted to execution. */
      readonly implementationDigest: Sha256Digest
      /** Digest of the exact runtime-verified task outcome graded by this run. */
      readonly taskOutcomeDigest: Sha256Digest
      /** Digest computed from `evidence` before it leaves the execution boundary. */
      readonly outputDigest: Sha256Digest
    }
  }>
}

/** One detached request passed to the trusted environment-specific executor. */
export interface AgentCandidateExecutorRequest {
  readonly executionId: string
  /** Immutable bytes from which the executor creates fresh isolated workspaces. */
  readonly inputs: {
    readonly task: AgentCandidateExecutorWorkspaceInput
    readonly candidate?: AgentCandidateExecutorWorkspaceInput
    readonly profile: {
      readonly files: readonly AgentCandidateExecutorProfileFile[]
    }
  }
  readonly roots: PreparedAgentCandidateExecution['roots']['execution']
  readonly profilePlan: PreparedAgentCandidateExecution['profilePlan']
  readonly executionPlan: PreparedAgentCandidateExecution['executionPlan']
  readonly materializationReceipt: CanonicalCandidateDocument<AgentCandidateMaterializationReceipt>
  readonly launch: PreparedAgentCandidateLaunch
  readonly instruction: PreparedAgentCandidateInstruction
  readonly resolvedModel: AgentCandidateResolvedModel
  /** Mechanically enforced by the runtime plus executor process-death acknowledgement. */
  readonly hardLimits: Pick<AgentCandidateExecutionLimits, 'timeoutMs'>
  /** Validity bound checked against protected traces; generic black-box executors cannot preempt it. */
  readonly observedLimits: Pick<AgentCandidateExecutionLimits, 'maxSteps'>
  readonly knowledge?: PreparedAgentCandidateExecution['knowledge']
  readonly trace: PreparedAgentCandidateTrace
  readonly memory: AgentCandidateEffectiveMemory
}

/**
 * Executes one prepared request inside an evaluator-owned isolation boundary.
 *
 * `request.launch.env` is the complete allowlisted environment, including
 * protected model, memory, and trace bindings. Implementations must not merge
 * ambient host variables into it. The returned capture deliberately contains
 * no candidate-authored usage or score fields.
 */
export interface AgentCandidateExecutorPort {
  execute(
    request: AgentCandidateExecutorRequest,
    context: {
      traceStore: TraceStore
      /** Aborted by the runtime at the exact frozen wall-time deadline. */
      signal: AbortSignal
      /** Absolute epoch-millisecond deadline owned by the runtime. */
      deadlineAtMs: number
    },
  ): Promise<AgentCandidateProtectedRunCapture>
  /**
   * Kill any process/container still associated with the request, drain trace
   * writes, and capture the final task workspace before teardown.
   * The runtime calls this on success, failure, and timeout before model settlement.
   * Implementations must be idempotent and concurrency-safe for this exact
   * execution/plan pair because a fresh worker may repeat crash recovery.
   */
  stopAndCapture(
    request: AgentCandidateExecutorStopRequest,
    context: {
      traceStore: TraceStore
      reason: 'completed' | 'failed' | 'timeout'
      /** Aborted at the frozen execution deadline or evaluator cleanup deadline. */
      signal: AbortSignal
      /** Absolute execution deadline; a later stop acknowledgement cannot produce success. */
      deadlineAtMs: number
    },
  ): Promise<AgentCandidateExecutorFinalCapture>
}

/** Opaque process identity used for termination without re-exposing launch credentials. */
export interface AgentCandidateExecutorStopRequest {
  readonly executionId: string
  readonly executionPlanDigest: Sha256Digest
}

export interface AgentCandidateExecutorWorkspaceInput {
  readonly snapshot: AgentCandidateWorkspaceSnapshotEvidence
  readonly files: readonly AgentCandidateExecutorWorkspaceFile[]
}

export interface AgentCandidateExecutorWorkspaceFile {
  readonly path: string
  readonly mode: 0o644 | 0o755
  readonly bytes: Uint8Array
}

export interface AgentCandidateExecutorProfileFile {
  readonly path: string
  readonly mode: 0o644 | 0o755
  readonly bytes: Uint8Array
}

export type AgentCandidateRunFinalization =
  | {
      succeeded: true
      receipt: CanonicalCandidateDocument<AgentCandidateRunReceiptV2>
      artifacts: {
        modelSettlement: AgentCandidateArtifactRef
        taskOutcome: AgentCandidateArtifactRef
        benchmarkResult: AgentCandidateArtifactRef
        runReceipt: AgentCandidateArtifactRef
      }
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
      /** Independent evaluator-gateway usage, even when execution or trace capture failed. */
      usage: AgentCandidateSpend | null
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
