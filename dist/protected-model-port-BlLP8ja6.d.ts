import { C as AgentCandidateProtectedModelSettlement, D as AgentCandidateRunFinalization, F as PreparedAgentCandidateExecution, O as AgentCandidateTaskExecution, S as AgentCandidateProtectedModelReservation, V as VerifiedAgentCandidate, a as AgentCandidateExecutionPorts, c as AgentCandidateExecutorPort, r as AgentCandidateBenchmarkGraderPort, v as AgentCandidateModelPort, x as AgentCandidateProtectedModelActivation, y as AgentCandidateOutputArtifactPort } from "./types-CuXu5zuS.js";
import { AgentCandidateArtifactRef, AgentCandidateAttemptPolicy, AgentCandidateFixedSpend, AgentCandidateProfile, AgentCandidateProfileActivation, AgentCandidateProfilePlanEvidence, AgentCandidateResolvedModel, AgentProfile, AgentProfileDiff, HarnessType, Sha256Digest } from "@tangle-network/agent-interface";
import { TraceStore } from "@tangle-network/agent-eval";
import "@tangle-network/agent-profile-materialize";
//#region src/candidate-execution/claim-file-formats.d.ts
interface AgentCandidatePreparationEvidence {
  readonly executionPlan: AgentCandidateArtifactRef;
  readonly materializationReceipt: AgentCandidateArtifactRef;
}
//#endregion
//#region src/candidate-execution/claim-plan.d.ts
/** Extract the complete durable claim from a prepared execution. */
declare function candidateExecutionClaim(prepared: PreparedAgentCandidateExecution, preparationEvidence: {
  executionPlan: AgentCandidateArtifactRef;
  materializationReceipt: AgentCandidateArtifactRef;
}): AgentCandidateExecutionClaim;
//#endregion
//#region src/candidate-execution/claim.d.ts
/** Non-secret identities a trusted recovery worker needs to close an abandoned attempt. */
interface AgentCandidateExecutionCleanupHandles {
  readonly preparationId: string;
  readonly modelGrantDigest: Sha256Digest;
  readonly resolvedModel: AgentCandidateResolvedModel;
  readonly traceRunId: string;
  readonly cleanupTimeoutMs: number;
  readonly memory?: {
    readonly accessDigest: Sha256Digest;
    readonly effectiveNamespace: string;
  };
}
/** Immutable signed identity stored for one execution attempt. */
interface AgentCandidateExecutionClaim {
  readonly executionId: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly retryPolicy: AgentCandidateAttemptPolicy['retryPolicy'];
  readonly bundleDigest: Sha256Digest;
  readonly executionPlanDigest: Sha256Digest;
  /** Durable canonical bytes needed to reconstruct the signed preparation. */
  readonly preparationEvidence: AgentCandidatePreparationEvidence;
  /** Frozen plan identity with only attempt number and per-attempt grant identity normalized. */
  readonly retryLineageDigest: Sha256Digest;
  /** The winning lease stops authorizing a new terminal write at this instant. */
  readonly leaseExpiresAtMs: number;
  /** Frozen budget for task verification, executable grading, and receipt construction. */
  readonly resultTimeoutMs: number;
  /** Non-secret handles retained so an expired attempt can be closed and reconciled. */
  readonly cleanup: AgentCandidateExecutionCleanupHandles;
}
/** Secret capability required to finish the acquired attempt. */
interface AgentCandidateExecutionLease {
  readonly executionId: string;
  readonly attempt: number;
  readonly token: string;
  readonly expiresAtMs: number;
}
/** Only the first class is retryable, and only when the closed model ledger has zero calls. */
type AgentCandidateExecutionFailureClass = 'pre-model-infrastructure' | 'execution' | 'post-model-infrastructure' | 'unknown';
/** Evaluator-owned terminal facts staged durably before the terminal CAS. */
type AgentCandidateExecutionTerminalResult = {
  readonly status: 'succeeded';
  readonly usage: AgentCandidateFixedSpend;
  readonly modelSettlement: AgentCandidateArtifactRef;
  readonly taskOutcome: AgentCandidateArtifactRef;
  readonly benchmarkResult: AgentCandidateArtifactRef;
  readonly runReceipt: AgentCandidateArtifactRef;
} | {
  readonly status: 'failed';
  readonly failureClass: AgentCandidateExecutionFailureClass;
  readonly usage: AgentCandidateFixedSpend;
  readonly modelSettlement: AgentCandidateArtifactRef;
  readonly failureEvidence?: AgentCandidateArtifactRef;
};
/** Durable terminal record for one acquired execution attempt. */
type AgentCandidateExecutionTerminalRecord = AgentCandidateExecutionTerminalResult & {
  readonly executionId: string;
  readonly attempt: number;
  readonly bundleDigest: Sha256Digest;
  readonly executionPlanDigest: Sha256Digest;
  readonly preparationEvidence: AgentCandidateExecutionClaim['preparationEvidence'];
  /** RFC 8785 SHA-256 of this record with `terminalDigest` omitted. */
  readonly terminalDigest: Sha256Digest;
};
/** Monotonic durable phase: the second value means candidate code could have started. */
type AgentCandidateExecutionPhase = 'claimed' | 'candidate-may-run';
/** Trusted, independently observed closure facts for one expired winning lease. */
interface AgentCandidateExecutionRecoveryEvidence {
  readonly failureClass: AgentCandidateExecutionFailureClass;
  readonly usage: AgentCandidateFixedSpend;
  readonly modelSettlement: AgentCandidateArtifactRef;
  readonly failureEvidence?: AgentCandidateArtifactRef;
  readonly process: {
    readonly stopped: true;
    readonly executionPlanDigest: Sha256Digest;
  };
  readonly model: {
    readonly closed: true;
    readonly preparationId: string;
    readonly grantDigest: Sha256Digest;
  };
  readonly memory?: {
    readonly closed: true;
    readonly preparationId: string;
    readonly accessDigest: Sha256Digest;
    readonly effectiveNamespace: string;
  };
}
interface AgentCandidateExecutionAttemptRef {
  readonly executionId: string;
  readonly attempt: number;
}
/** Persisted state available to a fresh trusted recovery worker after a crash. */
interface AgentCandidateExecutionAttemptRecord {
  readonly claim: AgentCandidateExecutionClaim;
  readonly phase: AgentCandidateExecutionPhase;
  /** Durable outbox content written before the terminal compare-and-set. */
  readonly staged?: AgentCandidateExecutionTerminalRecord;
  readonly terminal?: AgentCandidateExecutionTerminalRecord;
}
/** Result of atomically claiming one execution attempt. */
type AgentCandidateExecutionClaimResult = {
  readonly acquired: true;
  readonly claim: AgentCandidateExecutionClaim;
  readonly lease: AgentCandidateExecutionLease;
} | {
  readonly acquired: false;
  readonly reason: 'already-claimed';
  /** The durable winner already occupying this execution-attempt slot. */
  readonly claim: AgentCandidateExecutionClaim;
  /** True only when every signed claim field matches the durable winner. */
  readonly exactReplay: boolean;
} | {
  readonly acquired: false;
  readonly reason: 'retry-not-eligible';
  readonly claim: AgentCandidateExecutionClaim;
  readonly detail: AgentCandidateRetryRejection;
};
/** Result of atomically recording an attempt's terminal facts. */
type AgentCandidateExecutionFinishResult = {
  readonly finished: true;
  readonly terminal: AgentCandidateExecutionTerminalRecord;
} | {
  readonly finished: false;
  readonly terminal: AgentCandidateExecutionTerminalRecord;
  /** True when a repeated finish supplied the same terminal digest. */
  readonly exactReplay: boolean;
};
/** Result of durably staging the one immutable terminal outbox entry. */
type AgentCandidateExecutionStageResult = {
  readonly staged: true;
  readonly terminal: AgentCandidateExecutionTerminalRecord;
} | {
  readonly staged: false;
  readonly terminal: AgentCandidateExecutionTerminalRecord;
  readonly exactReplay: boolean;
};
/** Result of crossing the irreversible candidate-may-run boundary. */
type AgentCandidateExecutionPhaseResult = {
  readonly marked: true;
  readonly phase: 'candidate-may-run';
} | {
  readonly marked: false;
  readonly phase: 'candidate-may-run';
};
type AgentCandidateRetryRejection = 'prior-attempt-missing' | 'prior-attempt-running' | 'prior-attempt-succeeded' | 'prior-attempt-spent-model-calls' | 'prior-attempt-not-pre-model-infrastructure' | 'retry-lineage-mismatch';
/**
 * Atomic one-shot store for candidate execution attempts.
 *
 * Implementations must linearize both methods across every process sharing the
 * store. Terminal publication is deliberately two-step: `stageTerminal`
 * fsyncs the complete immutable outbox record, then `finish` publishes exactly
 * those staged bytes by digest. A crash between the two leaves recoverable
 * evidence rather than an ambiguous completed run.
 */
interface AgentCandidateExecutionClaimStore {
  tryClaim(claim: AgentCandidateExecutionClaim): Promise<AgentCandidateExecutionClaimResult>;
  getAttempt(attempt: AgentCandidateExecutionAttemptRef): Promise<AgentCandidateExecutionAttemptRecord | undefined>;
  /** Persist the point after which candidate code may have run. */
  markCandidateMayRun(lease: AgentCandidateExecutionLease): Promise<AgentCandidateExecutionPhaseResult>;
  /** Fsync the complete terminal record into the durable outbox. */
  stageTerminal(lease: AgentCandidateExecutionLease, result: AgentCandidateExecutionTerminalResult): Promise<AgentCandidateExecutionStageResult>;
  /** Publish exactly the staged terminal identified by `terminalDigest`. */
  finish(lease: AgentCandidateExecutionLease, terminalDigest: Sha256Digest): Promise<AgentCandidateExecutionFinishResult>;
  /**
   * Write a failed terminal only after the lease expired and a trusted worker
   * independently proved process death plus model and memory closure.
   */
  recoverExpired(attempt: AgentCandidateExecutionAttemptRef, evidence: AgentCandidateExecutionRecoveryEvidence): Promise<AgentCandidateExecutionFinishResult>;
}
interface InMemoryAgentCandidateExecutionClaimStoreOptions {
  /** Testable evaluator clock; defaults to `Date.now`. */
  now?: () => number;
}
/** Single-process lifecycle implementation. */
declare class InMemoryAgentCandidateExecutionClaimStore implements AgentCandidateExecutionClaimStore {
  private readonly claims;
  private readonly now;
  constructor(options?: InMemoryAgentCandidateExecutionClaimStoreOptions);
  tryClaim(requested: AgentCandidateExecutionClaim): Promise<AgentCandidateExecutionClaimResult>;
  getAttempt(requestedAttempt: AgentCandidateExecutionAttemptRef): Promise<AgentCandidateExecutionAttemptRecord | undefined>;
  markCandidateMayRun(requestedLease: AgentCandidateExecutionLease): Promise<AgentCandidateExecutionPhaseResult>;
  stageTerminal(requestedLease: AgentCandidateExecutionLease, result: AgentCandidateExecutionTerminalResult): Promise<AgentCandidateExecutionStageResult>;
  finish(requestedLease: AgentCandidateExecutionLease, requestedTerminalDigest: Sha256Digest): Promise<AgentCandidateExecutionFinishResult>;
  recoverExpired(requestedAttempt: AgentCandidateExecutionAttemptRef, evidence: AgentCandidateExecutionRecoveryEvidence): Promise<AgentCandidateExecutionFinishResult>;
  private requireClaim;
}
//#endregion
//#region src/candidate-execution/execute.d.ts
interface ExecutePreparedAgentCandidateOptions {
  executor: AgentCandidateExecutorPort;
  grader: AgentCandidateBenchmarkGraderPort;
  outputArtifacts: AgentCandidateOutputArtifactPort;
  traceStore: TraceStore;
  /** Long-lived evaluator-owned store shared by every process that can run this benchmark. */
  claimStore: AgentCandidateExecutionClaimStore;
  /** Maximum time to prove process death and revoke protected access after a run ends. */
  cleanupTimeoutMs?: number;
  /** Maximum time for task verification, executable grading, and receipt construction. */
  resultTimeoutMs?: number;
}
/** Executes and finalizes one durably claimed candidate without exposing an unproven result. */
declare function executePreparedAgentCandidate(prepared: PreparedAgentCandidateExecution, options: ExecutePreparedAgentCandidateOptions): Promise<AgentCandidateRunFinalization>;
//#endregion
//#region src/candidate-execution/prepare.d.ts
interface PrepareAgentCandidateExecutionOptions {
  cleanupTimeoutMs?: number;
  /** Maximum time for task verification, executable grading, and receipt construction. */
  resultTimeoutMs?: number;
}
/** Materializes a verified candidate into one immutable evaluator-owned execution plan. */
declare function prepareAgentCandidateExecution(candidate: VerifiedAgentCandidate, task: AgentCandidateTaskExecution, ports: AgentCandidateExecutionPorts, options?: PrepareAgentCandidateExecutionOptions): Promise<PreparedAgentCandidateExecution>;
//#endregion
//#region src/candidate-execution/profile.d.ts
/** Parse and check every native file hash plus both canonical document digests. */
declare function parseAgentCandidateProfileActivation(input: unknown, expectedProfilePlanDigest?: AgentCandidateProfilePlanEvidence['digest']): AgentCandidateProfileActivation;
/** Convert only behavior-preserving generic profile fields into the closed candidate contract. */
declare function freezeGenericAgentCandidateProfile(input: AgentProfile): AgentCandidateProfile;
/** Prove the measured generic profile and sealed candidate profile describe the same behavior. */
declare function assertCandidateProfileBinding(measuredInput: unknown, bundled: AgentCandidateProfile): void;
/** Parse a complete profile without silently discarding unsupported fields. */
declare function parseExactAgentProfile(input: unknown, label: string): AgentProfile;
/** Parse a profile diff without silently discarding unsupported fields. */
declare function parseExactAgentProfileDiff(input: unknown, label: string): AgentProfileDiff;
/** Apply one exact diff and reject any value that cannot be preserved canonically. */
declare function applyExactAgentProfileDiff(baseInput: unknown, diffInput: unknown, label: string): AgentProfile;
/** Parse a candidate profile without silently discarding unsupported or non-canonical fields. */
declare function parseExactCandidateProfile(input: unknown): AgentCandidateProfile;
/** Convert the candidate profile contract into the portable interface profile it represents. */
declare function agentCandidateProfileAsAgentProfile(candidate: AgentCandidateProfile): AgentProfile;
/** Recursively remove undefined object fields while refusing undefined array entries. */
declare function omitUndefinedObjectFields(value: unknown, path: string): unknown;
//#endregion
//#region src/candidate-execution/protected-model-port.d.ts
type AgentCandidateModelGrantReserveInput = Parameters<AgentCandidateModelPort['reserveGrant']>[0];
type AgentCandidateModelGrantActivateInput = Parameters<AgentCandidateModelPort['activateGrant']>[0];
type AgentCandidateModelGrantSettleInput = Parameters<AgentCandidateModelPort['settleGrant']>[0];
/** Secret-free response from the service's reservation endpoint. */
type AgentCandidateModelGrantReservation = AgentCandidateProtectedModelReservation;
/**
 * Narrow transport contract for a service that owns scoped model credentials
 * and the authoritative per-call usage ledger.
 *
 * An HTTP client can bind these methods to control-plane endpoints. Keeping
 * transport out of the runtime prevents parent credentials, endpoint paths,
 * and retry policy from becoming part of the portable candidate contract.
 */
interface AgentCandidateModelGrantClient {
  reserve(input: AgentCandidateModelGrantReserveInput): Promise<AgentCandidateModelGrantReservation>;
  activate(input: AgentCandidateModelGrantActivateInput): Promise<AgentCandidateProtectedModelActivation>;
  settle(input: AgentCandidateModelGrantSettleInput): Promise<AgentCandidateProtectedModelSettlement>;
}
interface CreateProtectedAgentCandidateModelPortOptions {
  client: AgentCandidateModelGrantClient;
  /** Catalog/snapshot resolution stays separate from credential issuance. */
  resolveModel: AgentCandidateModelPort['resolve'];
  /** The only public DNS name candidate processes may reach for inference. */
  gatewayDomain: string;
  /** Exact environment names the activation endpoint must return, no more or fewer. */
  activationEnvNames: readonly string[];
}
/**
 * Bind a protected model-grant service to the immutable candidate runtime.
 *
 * The service remains the authority for expiry, admission, revocation, and
 * metering. This adapter independently checks every response before allowing
 * it to cross into candidate execution or durable receipt finalization.
 */
declare function createProtectedAgentCandidateModelPort(options: CreateProtectedAgentCandidateModelPortOptions): AgentCandidateModelPort;
//#endregion
export { AgentCandidateExecutionPhase as A, AgentCandidatePreparationEvidence as B, AgentCandidateExecutionClaim as C, AgentCandidateExecutionFailureClass as D, AgentCandidateExecutionCleanupHandles as E, AgentCandidateExecutionTerminalResult as F, AgentCandidateRetryRejection as I, InMemoryAgentCandidateExecutionClaimStore as L, AgentCandidateExecutionRecoveryEvidence as M, AgentCandidateExecutionStageResult as N, AgentCandidateExecutionFinishResult as O, AgentCandidateExecutionTerminalRecord as P, InMemoryAgentCandidateExecutionClaimStoreOptions as R, AgentCandidateExecutionAttemptRef as S, AgentCandidateExecutionClaimStore as T, PrepareAgentCandidateExecutionOptions as _, AgentCandidateModelGrantSettleInput as a, executePreparedAgentCandidate as b, agentCandidateProfileAsAgentProfile as c, freezeGenericAgentCandidateProfile as d, omitUndefinedObjectFields as f, parseExactCandidateProfile as g, parseExactAgentProfileDiff as h, AgentCandidateModelGrantReserveInput as i, AgentCandidateExecutionPhaseResult as j, AgentCandidateExecutionLease as k, applyExactAgentProfileDiff as l, parseExactAgentProfile as m, AgentCandidateModelGrantClient as n, CreateProtectedAgentCandidateModelPortOptions as o, parseAgentCandidateProfileActivation as p, AgentCandidateModelGrantReservation as r, createProtectedAgentCandidateModelPort as s, AgentCandidateModelGrantActivateInput as t, assertCandidateProfileBinding as u, prepareAgentCandidateExecution as v, AgentCandidateExecutionClaimResult as w, AgentCandidateExecutionAttemptRecord as x, ExecutePreparedAgentCandidateOptions as y, candidateExecutionClaim as z };
//# sourceMappingURL=protected-model-port-BlLP8ja6.d.ts.map