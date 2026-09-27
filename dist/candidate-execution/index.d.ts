import { A as AgentCandidateWorkspacePort, B as ResolvedAgentCandidateContainer, C as AgentCandidateProtectedModelSettlement, D as AgentCandidateRunFinalization, E as AgentCandidateRepositoryPort, F as PreparedAgentCandidateExecution, H as VerifiedAgentCandidateTaskOutcome, I as PreparedAgentCandidateInstruction, L as PreparedAgentCandidateKnowledge, M as CANDIDATE_TRACE_TAGS, N as CanonicalCandidateDocument, O as AgentCandidateTaskExecution, P as PersistedTaskOutcomeEvidence, R as PreparedAgentCandidateLaunch, S as AgentCandidateProtectedModelReservation, T as AgentCandidateProtectedRunCapture, U as AgentCandidateExecutionRoots, V as VerifiedAgentCandidate, _ as AgentCandidateModelLimits, a as AgentCandidateExecutionPorts, b as AgentCandidateOutputPurpose, c as AgentCandidateExecutorPort, d as AgentCandidateExecutorStopRequest, f as AgentCandidateExecutorTaskOutcomeCapture, g as AgentCandidateMemoryResetResult, h as AgentCandidateMemoryPort, i as AgentCandidateContainerPort, j as CANDIDATE_TRACE_ENV, k as AgentCandidateVerificationPorts, l as AgentCandidateExecutorProfileFile, m as AgentCandidateExecutorWorkspaceInput, n as AgentCandidateBenchmarkGraderIdentity, o as AgentCandidateExecutorFinalCapture, p as AgentCandidateExecutorWorkspaceFile, r as AgentCandidateBenchmarkGraderPort, s as AgentCandidateExecutorMemoryCapture, t as AgentCandidateArtifactPort, u as AgentCandidateExecutorRequest, v as AgentCandidateModelPort, w as AgentCandidateProtectedModelSettlementCall, x as AgentCandidateProtectedModelActivation, y as AgentCandidateOutputArtifactPort, z as PreparedAgentCandidateTrace } from "../types-CuXu5zuS.js";
import { A as AgentCandidateExecutionPhase, B as AgentCandidatePreparationEvidence, C as AgentCandidateExecutionClaim, D as AgentCandidateExecutionFailureClass, E as AgentCandidateExecutionCleanupHandles, F as AgentCandidateExecutionTerminalResult, I as AgentCandidateRetryRejection, L as InMemoryAgentCandidateExecutionClaimStore, M as AgentCandidateExecutionRecoveryEvidence, N as AgentCandidateExecutionStageResult, O as AgentCandidateExecutionFinishResult, P as AgentCandidateExecutionTerminalRecord, R as InMemoryAgentCandidateExecutionClaimStoreOptions, S as AgentCandidateExecutionAttemptRef, T as AgentCandidateExecutionClaimStore, _ as PrepareAgentCandidateExecutionOptions, a as AgentCandidateModelGrantSettleInput, b as executePreparedAgentCandidate, c as agentCandidateProfileAsAgentProfile, d as freezeGenericAgentCandidateProfile, f as omitUndefinedObjectFields, g as parseExactCandidateProfile, h as parseExactAgentProfileDiff, i as AgentCandidateModelGrantReserveInput, j as AgentCandidateExecutionPhaseResult, k as AgentCandidateExecutionLease, l as applyExactAgentProfileDiff, m as parseExactAgentProfile, n as AgentCandidateModelGrantClient, o as CreateProtectedAgentCandidateModelPortOptions, r as AgentCandidateModelGrantReservation, s as createProtectedAgentCandidateModelPort, t as AgentCandidateModelGrantActivateInput, u as assertCandidateProfileBinding, v as prepareAgentCandidateExecution, w as AgentCandidateExecutionClaimResult, x as AgentCandidateExecutionAttemptRecord, y as ExecutePreparedAgentCandidateOptions, z as candidateExecutionClaim } from "../protected-model-port-BlLP8ja6.js";
import { AgentCandidateArtifactRef, AgentCandidateBundle, AgentCandidateCapturedArtifact, AgentCandidateCodeDisabled, AgentCandidateCodeNoOp, AgentCandidateExecution, AgentCandidateGitHubRepository, AgentCandidateKnowledge, AgentCandidateMemoryPolicy, AgentCandidateProfile, AgentCandidateResolvedModel, AgentCandidateRunCell, AgentCandidateWorkspaceManifestMaterial, AgentCandidateWorkspaceSnapshotEvidence, AgentProfile, AgentProfileDiff, Sha256Digest } from "@tangle-network/agent-interface";
import { TraceStore } from "@tangle-network/agent-eval";
import { CodeSurface } from "@tangle-network/agent-eval/campaign";
import { AgentEnvironmentProvider, AgentExactProcessResources } from "@tangle-network/agent-interface/environment-provider";
//#region src/candidate-execution/artifacts.d.ts
/** The per-scan caps a bounded capture applies. */
interface WorkspaceScanLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalFileBytes: number;
}
/** What a workspace scan reads and how it records a file's permission bits. */
interface WorkspaceScanOptions {
  readonly ignoredProtectedRootEntries?: readonly ('.git' | '.sidecar')[];
  readonly limits?: WorkspaceScanLimits;
  /**
   * Record Git's two file modes instead of the filesystem's exact permission bits: `0o755` when
   * any execute bit is set, `0o644` otherwise. A checkout umask then cannot move a manifest
   * digest, while a real permission change still does.
   *
   * This is the normalization `readCandidateGitTreeFiles` already applies to a Git tree
   * (`100644`/`100755`), so one tree scanned from disk and the same tree read out of Git produce
   * the same manifest. Off by default: the flag changes the digest, so a capture and the verify
   * that checks it must agree on it.
   */
  readonly portableTree?: boolean;
}
/**
 * Refuse a materialized workspace whose files, modes, or bytes are not the signed manifest.
 *
 * The scan streams, so the size of the largest file does not decide whether the check can run, and
 * the refusal names the one mismatch a caller can produce on its own: a capture and a verify that
 * disagree about `portableTree`.
 */
declare function verifyMaterializedWorkspace(root: string, expected: AgentCandidateWorkspaceManifestMaterial, options?: Omit<WorkspaceScanOptions, 'limits'>): Promise<void>;
/**
 * The canonical manifest of one materialized workspace, read without holding any file.
 *
 * Every file is digested by streaming, so the size of the largest file does not decide whether the
 * workspace can be described. `FileHandle.readFile` refuses anything above 2 GiB with
 * `ERR_FS_FILE_TOO_LARGE`, which made a workspace holding one such artifact impossible to verify
 * against a manifest it already matched. The digest is sha-256 over the same bytes either way, so
 * a manifest a buffered read produced is reproduced exactly.
 */
declare function scanMaterializedWorkspaceManifest(root: string, options?: WorkspaceScanOptions): Promise<AgentCandidateWorkspaceManifestMaterial>;
/**
 * Build the canonical manifest for files a caller already holds — the shape a remote executor
 * returns. Pass `portableTree` to record Git's two file modes instead of exact permission bits, and
 * pass the same flag to every verify that reads the result.
 */
declare function candidateWorkspaceManifest(files: ReadonlyArray<{
  path: string;
  mode: number;
  bytes: Uint8Array;
}>, options?: {
  portableTree?: boolean;
}): AgentCandidateWorkspaceManifestMaterial;
//#endregion
//#region src/candidate-execution/bundle.d.ts
/** Exact candidate wire shape before the runtime computes its canonical digest. */
type AgentCandidateBundleInput = Omit<AgentCandidateBundle, 'digest'>;
/** Validate and content-address a candidate bundle before it crosses an approval boundary. */
declare function sealAgentCandidateBundle(input: AgentCandidateBundleInput): AgentCandidateBundle;
//#endregion
//#region src/candidate-execution/builder.d.ts
/** A complete profile that can be frozen without losing behavior. */
type AgentCandidateProfileSource = {
  kind: 'profile';
  profile: AgentProfile;
} | {
  kind: 'profile-diffs';
  base: AgentProfile;
  /** Applied in order before the resulting profile is frozen into the bundle. */
  diffs: readonly AgentProfileDiff[];
} | {
  kind: 'candidate-profile';
  /** Already converted to the closed, secret-free candidate profile contract. */
  profile: AgentCandidateProfile;
};
/** The only accepted path from an agent-eval code candidate to executable bytes. */
interface AgentCandidateCodeSurfaceSource {
  kind: 'code-surface';
  surface: CodeSurface;
  repository: AgentCandidateGitHubRepository;
  /** Optional parent directory used to resolve a relative `surface.worktreeRef`. */
  worktreeDir?: string;
}
/** Explicit control/no-op code or one finalized CodeSurface whose bytes must still verify. */
type AgentCandidateCodeSource = AgentCandidateCodeDisabled | AgentCandidateCodeNoOp | AgentCandidateCodeSurfaceSource;
/** Complete measured surfaces and execution policy compiled into one candidate bundle. */
interface BuildAgentCandidateBundleInput {
  profile: AgentCandidateProfileSource;
  code: AgentCandidateCodeSource;
  execution: AgentCandidateExecution;
  knowledge?: AgentCandidateKnowledge;
  memory: AgentCandidateMemoryPolicy;
}
/**
 * Compile one measured profile/code candidate into the immutable execution
 * contract. Code bytes are re-read and verified by agent-eval before they are
 * embedded. The returned bundle is schema-validated, canonically digested, and
 * deeply immutable; call `verifyAgentCandidateBundle` at the execution boundary
 * to re-read external memory, repository, and workspace artifacts.
 */
declare function buildAgentCandidateBundle(input: BuildAgentCandidateBundleInput): ReturnType<typeof sealAgentCandidateBundle>;
//#endregion
//#region src/candidate-execution/claim-file-store.d.ts
interface FileAgentCandidateExecutionClaimStoreOptions {
  /** Evaluator-owned directory shared by every process allowed to execute candidates. */
  directory: string;
  /** Testable evaluator clock; defaults to `Date.now`. */
  now?: () => number;
}
/** Cross-process lifecycle implemented as fsynced, create-if-absent records. */
declare class FileAgentCandidateExecutionClaimStore implements AgentCandidateExecutionClaimStore {
  private readonly directory;
  private readonly now;
  constructor(options: FileAgentCandidateExecutionClaimStoreOptions);
  tryClaim(requested: AgentCandidateExecutionClaim): Promise<AgentCandidateExecutionClaimResult>;
  getAttempt(requestedAttempt: AgentCandidateExecutionAttemptRef): Promise<AgentCandidateExecutionAttemptRecord | undefined>;
  markCandidateMayRun(requestedLease: AgentCandidateExecutionLease): Promise<AgentCandidateExecutionPhaseResult>;
  stageTerminal(requestedLease: AgentCandidateExecutionLease, result: AgentCandidateExecutionTerminalResult): Promise<AgentCandidateExecutionStageResult>;
  finish(requestedLease: AgentCandidateExecutionLease, requestedTerminalDigest: Sha256Digest): Promise<AgentCandidateExecutionFinishResult>;
  recoverExpired(requestedAttempt: AgentCandidateExecutionAttemptRef, evidence: AgentCandidateExecutionRecoveryEvidence): Promise<AgentCandidateExecutionFinishResult>;
  private storedAttempt;
  private transitionState;
  private retryFailure;
  private ownerPublication;
  private claimPath;
  private terminalPath;
  private transitionPath;
}
//#endregion
//#region src/candidate-execution/dispose.d.ts
interface DisposePreparedAgentCandidateOptions {
  cleanupTimeoutMs?: number;
}
/** Revoke reservations held by a prepared candidate that will not be executed. */
declare function disposePreparedAgentCandidateExecution(prepared: PreparedAgentCandidateExecution, options?: DisposePreparedAgentCandidateOptions): Promise<{
  disposed: true;
}>;
//#endregion
//#region src/candidate-execution/exact-process-executor.d.ts
interface ExactProcessCandidateExecutorOptions {
  provider: AgentEnvironmentProvider;
  resources: AgentExactProcessResources;
  provisionTimeoutMs?: number;
  recoveryRetentionMs?: number;
  providerOptions?: Record<string, unknown>;
}
/** Adapt one neutral exact-process provider to Runtime's trusted candidate boundary. */
declare function exactProcessProviderAsCandidateExecutor(options: ExactProcessCandidateExecutorOptions): AgentCandidateExecutorPort;
//#endregion
//#region src/candidate-execution/knowledge.d.ts
/** Environment variable containing the materialized candidate knowledge root. */
declare const CANDIDATE_KNOWLEDGE_ROOT_ENV = "TANGLE_CANDIDATE_KNOWLEDGE_ROOT";
/** Environment variable containing the materialized retrieval configuration path. */
declare const CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV = "TANGLE_CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG";
/** Deterministic, signed locations used by every candidate executor. */
declare function candidateKnowledgeExecutionPaths(taskRoot: string, hasRetrievalConfig: boolean): {
  root: string;
  retrievalConfig?: string;
};
//#endregion
//#region src/candidate-execution/output-artifacts.d.ts
/** Persist evaluator evidence, read it back, and bind the returned locator to the exact bytes. */
declare function persistCandidateOutputArtifact(port: AgentCandidateOutputArtifactPort, input: {
  executionId: string;
  purpose: AgentCandidateOutputPurpose;
  bytes: Uint8Array;
  signal?: AbortSignal;
}): Promise<AgentCandidateArtifactRef>;
//#endregion
//#region src/candidate-execution/protected-model-grant.d.ts
/** Reservation fields supplied by a caller before Runtime resolves the model. */
type AgentCandidateModelGrantRunReservationInput = Omit<AgentCandidateModelGrantReserveInput, 'resolved'>;
/** Values available only while one protected model grant is active. */
interface ProtectedAgentCandidateModelGrantContext {
  readonly activation: AgentCandidateProtectedModelActivation;
  readonly reservation: AgentCandidateProtectedModelReservation;
  readonly resolved: AgentCandidateResolvedModel;
}
/** Inputs for one protected grant scoped to one bounded caller unit. */
interface RunProtectedAgentCandidateModelGrantOptions<TResult> {
  /** Runtime port that validates and settles the evaluator-owned grant. */
  readonly port: AgentCandidateModelPort;
  /** Provider-neutral model request resolved before any grant is reserved. */
  readonly resolve: Parameters<AgentCandidateModelPort['resolve']>[0];
  /** One bounded unit's immutable identity, attempt, expiry, and limits. */
  readonly reserve: AgentCandidateModelGrantRunReservationInput;
  /** Must be no later than the reservation expiry. */
  readonly deadlineAtMs: AgentCandidateModelGrantActivateInput['deadlineAtMs'];
  /** Execute exactly one bounded unit while the activated environment is valid. */
  readonly execute: (context: ProtectedAgentCandidateModelGrantContext) => Promise<TResult>;
}
/** Result and sealed settlement returned after one protected grant closes. */
interface RunProtectedAgentCandidateModelGrantResult<TResult> {
  readonly value: TResult;
  readonly resolved: AgentCandidateResolvedModel;
  readonly reservation: AgentCandidateProtectedModelReservation;
  readonly settlement: AgentCandidateProtectedModelSettlement;
}
/**
 * Run one bounded unit under a protected model grant.
 *
 * Runtime owns the grant lifecycle; callers own the unit boundary and any
 * durable scheduling or accounting around it. A reserved grant is settled
 * after activation failure or callback failure, and the callback error is
 * preserved when settlement also fails.
 */
declare function runProtectedAgentCandidateModelGrant<TResult>(options: RunProtectedAgentCandidateModelGrantOptions<TResult>): Promise<RunProtectedAgentCandidateModelGrantResult<TResult>>;
//#endregion
//#region src/candidate-execution/recover.d.ts
interface RecoverExpiredAgentCandidateOptions {
  attempt: AgentCandidateExecutionAttemptRef;
  claimStore: AgentCandidateExecutionClaimStore;
  executor: AgentCandidateExecutorPort;
  traceStore: TraceStore;
  ports: Pick<AgentCandidateExecutionPorts, 'models' | 'memory'>;
  outputArtifacts: AgentCandidateOutputArtifactPort;
  cleanupTimeoutMs?: number;
  /** Evaluator clock; must be the same clock used by the claim store. */
  now?: () => number;
}
/** Close an expired crashed attempt from persisted non-secret handles, then record failure. */
declare function recoverExpiredAgentCandidateExecution(options: RecoverExpiredAgentCandidateOptions): Promise<AgentCandidateExecutionFinishResult>;
//#endregion
//#region src/candidate-execution/verify.d.ts
/** Surfaces admitted by Runtime's verifier before an environment adapter is selected. */
declare const AGENT_CANDIDATE_EXECUTION_SUPPORT: Readonly<{
  outcomes: readonly ["workspace", "output"];
  code: readonly ["disabled", "no-op", "git-patch"];
  memory: readonly ["disabled", "isolated"];
  knowledge: true;
  profile: Readonly<{
    mcpTransports: readonly ["stdio"];
    remoteMcp: false;
    tools: false;
    permissions: false;
    modes: false;
    confidential: false;
  }>;
}>;
/** Verifies every digest, resource, workspace, and Git object in a candidate bundle. */
declare function verifyAgentCandidateBundle(input: unknown, ports: AgentCandidateVerificationPorts): Promise<VerifiedAgentCandidate>;
//#endregion
//#region src/candidate-execution/workspace-archive.d.ts
interface AgentCandidateWorkspaceArchiveLimits {
  maxArchiveBytes: number;
  maxEmbeddedArtifactBytes: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalFileBytes: number;
  maxPathBytes: number;
  maxRepositoryBundleBytes: number;
}
interface CaptureAgentCandidateWorkspaceOptions {
  /** Include Git HEAD so task preparation can prove its exact commit and tree. */
  includeRepository?: boolean;
  limits?: Partial<AgentCandidateWorkspaceArchiveLimits>;
  /** Use the evaluator-owned artifact store when manifest or archive bytes should not be embedded. */
  artifactPersistence?: {
    executionId: string;
    outputArtifacts: AgentCandidateOutputArtifactPort;
    signal?: AbortSignal;
  };
}
interface CreateAgentCandidateWorkspacePortOptions {
  limits?: Partial<AgentCandidateWorkspaceArchiveLimits>;
}
interface CapturedAgentCandidateWorkspace {
  readonly snapshot: AgentCandidateWorkspaceSnapshotEvidence;
  /** Caller-owned bytes accepted by createAgentCandidateWorkspacePort. */
  readonly archive: Uint8Array;
}
/** Capture one exact regular-file workspace for immutable candidate execution. */
declare function captureAgentCandidateWorkspace(rootInput: string, options?: CaptureAgentCandidateWorkspaceOptions): Promise<CapturedAgentCandidateWorkspace>;
/** Capture detached files returned by a remote executor into the standard archive. */
declare function captureAgentCandidateWorkspaceFiles(input: readonly AgentCandidateExecutorWorkspaceFile[], options?: Omit<CaptureAgentCandidateWorkspaceOptions, 'includeRepository'>): Promise<CapturedAgentCandidateWorkspace>;
/** Create the standard bounded materializer for candidate execution ports. */
declare function createAgentCandidateWorkspacePort(options?: CreateAgentCandidateWorkspacePortOptions): AgentCandidateWorkspacePort;
//#endregion
//#region src/candidate-execution/workspace-tree.d.ts
/**
 * `'tree-v1'` records a file's exact permission bits. `'portable-tree-v1'` records the two modes
 * Git stores — `755` when any execute bit is set, `644` otherwise, and `755` for a directory — so a
 * digest survives a checkout whose umask differs. Both stamp the algorithm into the digest, so one
 * tree cannot produce the same digest under both.
 */
type WorkspaceTreeAlgorithm = 'tree-v1' | 'portable-tree-v1';
/** What a walk does with an entry it refuses to describe: fail, or record and continue. */
type WorkspaceTreeEntryPolicy = 'refuse' | 'exclude';
/** Why one entry contributed its name instead of its content. */
type WorkspaceTreeExclusionReason = 'absolute-symlink' | 'symlink-escapes-tree' | 'symlink-resolves-outside-tree' | 'unresolved-symlink' | 'entry-disappeared';
/** One entry the walk recorded but did not describe. Reported rather than dropped: a digest that
 *  silently omitted an entry would be a different digest with no way to tell why. */
interface WorkspaceTreeExclusion {
  /** Tree-relative path, `/`-separated. */
  readonly path: string;
  readonly reason: WorkspaceTreeExclusionReason;
  /** The link target exactly as it was written, for a symbolic-link exclusion. */
  readonly target?: string;
}
interface WorkspaceTreeDescriptor {
  readonly algorithm: WorkspaceTreeAlgorithm;
  readonly digest: Sha256Digest;
  readonly files: number;
  readonly directories: number;
  /** Links kept INSIDE the tree. An excluded link is counted in `excluded`, never here. */
  readonly symlinks: number;
  /** Total described regular-file bytes. */
  readonly bytes: number;
  readonly excluded: ReadonlyArray<WorkspaceTreeExclusion>;
}
interface DescribeWorkspaceTreeOptions {
  /** Default `'tree-v1'`. */
  readonly algorithm?: WorkspaceTreeAlgorithm;
  /**
   * A symbolic link that is absolute, leaves the tree lexically, resolves outside it, or does not
   * resolve at all. `'refuse'` (default) is correct for an input seed. `'exclude'` is correct for a
   * close-time walk over a tree a run wrote. The link is NEVER followed in either policy: an
   * escaping link must not contribute bytes from outside the tree to a content address.
   */
  readonly onEscapingLink?: WorkspaceTreeEntryPolicy;
  /**
   * An entry that vanished between the directory read that named it and the walk that reached it.
   * `'refuse'` (default) is correct for a settled tree; `'exclude'` is correct for a workspace a
   * live process still writes to.
   */
  readonly onMissingEntry?: WorkspaceTreeEntryPolicy;
}
interface SeedWorkspaceTreeInput {
  /** The tree to copy FROM. Described, then copied entry by entry. */
  readonly source: string;
  /** The tree to copy INTO. Must exist, and must not lie inside `source`. */
  readonly destination: string;
  /** Default `'tree-v1'`; decides only the digest this returns, never the bytes it writes. */
  readonly algorithm?: WorkspaceTreeAlgorithm;
}
/**
 * Describe one directory tree by content, streaming every file.
 *
 * The digest covers, for every entry in sorted order: its kind, its tree-relative path, its mode
 * under the selected algorithm, and then — for a file, its length and its own sha-256; for a kept
 * link, its target; for an excluded entry, the reason and the target. A file's content therefore
 * never enters the tree hash directly, which is what removes any in-memory size ceiling: the tree
 * hash consumes 32 bytes per file however large the file is.
 *
 * A hard-linked regular file is described like any other regular file. Its content is what the
 * digest is about, and a package manager that links a store into `node_modules` is ordinary
 * content, not a reason to refuse a workspace.
 */
declare function describeWorkspaceTree(directory: string, options?: DescribeWorkspaceTreeOptions): Promise<WorkspaceTreeDescriptor>;
/**
 * Seed a workspace from a directory, one entry at a time, and return the digest of what was
 * seeded.
 *
 * Nothing is packed: `cp` walks and copies file by file, so a multi-gigabyte seed costs one file
 * handle rather than one archive in memory. Existing destination entries are never overwritten —
 * a seed that could replace a file the workspace already holds would make the resulting tree
 * depend on the order two seeds ran in.
 *
 * Links are copied verbatim, exactly as they were written. Following them would copy bytes from
 * outside the seed into the workspace, which is the same rule {@link describeWorkspaceTree}
 * applies to the digest.
 */
declare function seedWorkspaceTree(input: SeedWorkspaceTreeInput): Promise<WorkspaceTreeDescriptor>;
//#endregion
export { AGENT_CANDIDATE_EXECUTION_SUPPORT, type AgentCandidateArtifactPort, type AgentCandidateBenchmarkGraderIdentity, type AgentCandidateBenchmarkGraderPort, type AgentCandidateBundleInput, type AgentCandidateCodeSource, type AgentCandidateCodeSurfaceSource, type AgentCandidateContainerPort, type AgentCandidateExecutionAttemptRecord, type AgentCandidateExecutionAttemptRef, type AgentCandidateExecutionClaim, type AgentCandidateExecutionClaimResult, type AgentCandidateExecutionClaimStore, type AgentCandidateExecutionCleanupHandles, type AgentCandidateExecutionFailureClass, type AgentCandidateExecutionFinishResult, type AgentCandidateExecutionLease, type AgentCandidateExecutionPhase, type AgentCandidateExecutionPhaseResult, type AgentCandidateExecutionPorts, type AgentCandidateExecutionRecoveryEvidence, type AgentCandidateExecutionRoots, type AgentCandidateExecutionStageResult, type AgentCandidateExecutionTerminalRecord, type AgentCandidateExecutionTerminalResult, type AgentCandidateExecutorFinalCapture, type AgentCandidateExecutorMemoryCapture, type AgentCandidateExecutorPort, type AgentCandidateExecutorProfileFile, type AgentCandidateExecutorRequest, type AgentCandidateExecutorStopRequest, type AgentCandidateExecutorTaskOutcomeCapture, type AgentCandidateExecutorWorkspaceFile, type AgentCandidateExecutorWorkspaceInput, type AgentCandidateMemoryPort, type AgentCandidateMemoryResetResult, type AgentCandidateModelGrantActivateInput, type AgentCandidateModelGrantClient, type AgentCandidateModelGrantReservation, type AgentCandidateModelGrantReserveInput, type AgentCandidateModelGrantRunReservationInput, type AgentCandidateModelGrantSettleInput, type AgentCandidateModelLimits, type AgentCandidateModelPort, type AgentCandidateOutputArtifactPort, type AgentCandidateOutputPurpose, type AgentCandidatePreparationEvidence, type AgentCandidateProfileSource, type AgentCandidateProtectedModelActivation, type AgentCandidateProtectedModelReservation, type AgentCandidateProtectedModelSettlement, type AgentCandidateProtectedModelSettlementCall, type AgentCandidateProtectedRunCapture, type AgentCandidateRepositoryPort, type AgentCandidateRetryRejection, type AgentCandidateRunFinalization, type AgentCandidateTaskExecution, type AgentCandidateVerificationPorts, type AgentCandidateWorkspaceArchiveLimits, type AgentCandidateWorkspacePort, type BuildAgentCandidateBundleInput, CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV, CANDIDATE_KNOWLEDGE_ROOT_ENV, CANDIDATE_TRACE_ENV, CANDIDATE_TRACE_TAGS, type CanonicalCandidateDocument, type CaptureAgentCandidateWorkspaceOptions, type CapturedAgentCandidateWorkspace, type CreateAgentCandidateWorkspacePortOptions, type CreateProtectedAgentCandidateModelPortOptions, type DescribeWorkspaceTreeOptions, type DisposePreparedAgentCandidateOptions, type ExactProcessCandidateExecutorOptions, type ExecutePreparedAgentCandidateOptions, FileAgentCandidateExecutionClaimStore, type FileAgentCandidateExecutionClaimStoreOptions, InMemoryAgentCandidateExecutionClaimStore, type InMemoryAgentCandidateExecutionClaimStoreOptions, type PersistedTaskOutcomeEvidence, type PrepareAgentCandidateExecutionOptions, type PreparedAgentCandidateExecution, type PreparedAgentCandidateInstruction, type PreparedAgentCandidateKnowledge, type PreparedAgentCandidateLaunch, type PreparedAgentCandidateTrace, type ProtectedAgentCandidateModelGrantContext, type RecoverExpiredAgentCandidateOptions, type ResolvedAgentCandidateContainer, type RunProtectedAgentCandidateModelGrantOptions, type RunProtectedAgentCandidateModelGrantResult, type SeedWorkspaceTreeInput, type VerifiedAgentCandidate, type VerifiedAgentCandidateTaskOutcome, type WorkspaceScanLimits, type WorkspaceScanOptions, type WorkspaceTreeAlgorithm, type WorkspaceTreeDescriptor, type WorkspaceTreeEntryPolicy, type WorkspaceTreeExclusion, type WorkspaceTreeExclusionReason, agentCandidateProfileAsAgentProfile, applyExactAgentProfileDiff, assertCandidateProfileBinding, buildAgentCandidateBundle, candidateExecutionClaim, candidateKnowledgeExecutionPaths, candidateWorkspaceManifest, captureAgentCandidateWorkspace, captureAgentCandidateWorkspaceFiles, createAgentCandidateWorkspacePort, createProtectedAgentCandidateModelPort, describeWorkspaceTree, disposePreparedAgentCandidateExecution, exactProcessProviderAsCandidateExecutor, executePreparedAgentCandidate, freezeGenericAgentCandidateProfile, omitUndefinedObjectFields, parseExactAgentProfile, parseExactAgentProfileDiff, parseExactCandidateProfile, persistCandidateOutputArtifact, prepareAgentCandidateExecution, recoverExpiredAgentCandidateExecution, runProtectedAgentCandidateModelGrant, scanMaterializedWorkspaceManifest, sealAgentCandidateBundle, seedWorkspaceTree, verifyAgentCandidateBundle, verifyMaterializedWorkspace };
//# sourceMappingURL=index.d.ts.map