import { C as canonicalCandidateDigest$1, D as immutableCandidateValue, E as embeddedCandidateArtifact, O as omitTopLevelDigest, S as canonicalCandidateBytes$1, T as deepFreezeCandidate, a as persistCandidateOutputArtifact, b as verifyMaterializedWorkspace, c as verifyTaskCheckout, d as isWellFormedUnicode, f as artifactCacheKey, g as readVerifiedArtifact, h as readMaterializedWorkspaceFiles, k as sha256Bytes$1, l as verifyTaskOutcomePatch, o as readCandidateGitHubResource, s as verifyCandidateCode, u as assertExactObjectKeys, v as verifyBytes, w as canonicalCandidateDocument, x as verifyWorkspaceSnapshotArtifacts, y as verifyMaterializedProfileWorkspace } from "./workspace-archive-C9lgf77y.js";
import { i as redactProtectedValue, n as createProtectedRecordRedactor, r as redactProtectedReason, t as assertNoProtectedBytes } from "./protected-redaction-DylCC_ot.js";
import { f as parseAgentCandidateProfileActivation, n as PI_CANDIDATE_SESSION_DIR_ENV, o as assertCandidateProfileExecutionSupport, s as candidateProfileAgentPaths, t as PI_CANDIDATE_AGENT_DIR_ENV, u as materializeAgentCandidateProfilePlan } from "./profile-D3eXNBQV.js";
import { agentCandidateArtifactRefSchema, agentCandidateBenchmarkResultEvidenceSchema, agentCandidateBenchmarkSuiteSchema, agentCandidateBenchmarkTaskSchema, agentCandidateBundleSchema, agentCandidateContainerSchema, agentCandidateExecutionLimitsSchema, agentCandidateExecutionPlanEvidenceSchema, agentCandidateExecutionPlanMaterialSchema, agentCandidateMaterializationReceiptSchema, agentCandidateModelAccessNetworkSchema, agentCandidateModelSettlementEvidenceSchema, agentCandidateProfilePlanEvidenceSchema, agentCandidateResolvedModelSchema, agentCandidateRunCellSchema, agentCandidateRunReceiptSchema, agentCandidateTaskOutcomeEvidenceSchema, agentCandidateTaskOutcomeSpecSchema, agentCandidateTerminationSchema, agentCandidateWorkspaceManifestMaterialSchema, agentCandidateWorkspaceSnapshotEvidenceSchema, sha256DigestSchema } from "@tangle-network/agent-interface";
import { REDACTION_VERSION, isLlmSpan } from "@tangle-network/agent-eval";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { applyAgentCandidateWorkspacePlan } from "@tangle-network/agent-profile-materialize";
import { tmpdir } from "node:os";
import { hashKnowledgeBase } from "@tangle-network/agent-knowledge";
//#region src/candidate-execution/claim-file-formats.ts
function sealCandidatePreparationEvidence(value, executionPlanDigest) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("candidate execution preparation evidence must be an object");
	const record = value;
	assertExactObjectKeys(record, ["executionPlan", "materializationReceipt"], "candidate execution preparation evidence");
	const executionPlan = immutableCandidateValue(agentCandidateArtifactRefSchema.parse(record.executionPlan));
	const materializationReceipt = immutableCandidateValue(agentCandidateArtifactRefSchema.parse(record.materializationReceipt));
	if (executionPlan.sha256 !== executionPlanDigest) throw new Error("candidate execution plan artifact digest does not match its claim");
	return Object.freeze({
		executionPlan,
		materializationReceipt
	});
}
//#endregion
//#region src/candidate-execution/claim-terminal.ts
const SHA256_PATTERN$1 = /^sha256:[a-f0-9]{64}$/;
function terminalRecord(claim, result) {
	const terminal = sealTerminalResult(result);
	const value = {
		executionId: claim.executionId,
		attempt: claim.attempt,
		bundleDigest: claim.bundleDigest,
		executionPlanDigest: claim.executionPlanDigest,
		preparationEvidence: claim.preparationEvidence,
		...terminal
	};
	return immutableCandidateValue({
		...value,
		terminalDigest: canonicalCandidateDigest$1(value)
	});
}
function recoveredTerminalRecord(claim, phase, evidence) {
	const recovered = sealRecoveryEvidence(evidence, claim);
	return terminalRecord(claim, {
		status: "failed",
		failureClass: recovered.failureClass === "pre-model-infrastructure" && phase !== "claimed" ? "unknown" : recovered.failureClass,
		usage: recovered.usage,
		modelSettlement: recovered.modelSettlement,
		...recovered.failureEvidence ? { failureEvidence: recovered.failureEvidence } : {}
	});
}
function assertTerminalAllowedInPhase(phase, terminal) {
	if (phase === "candidate-may-run" && terminal.status === "failed" && terminal.failureClass === "pre-model-infrastructure") throw new Error("candidate execution crossed candidate-may-run before pre-model failure");
	if (phase === "claimed" && (terminal.status === "succeeded" || terminal.status === "failed" && (terminal.failureClass === "execution" || terminal.failureClass === "post-model-infrastructure"))) throw new Error("candidate execution terminal requires candidate-may-run phase");
}
function rejectedFinish(existing, requestedTerminalDigest) {
	return Object.freeze({
		finished: false,
		terminal: existing,
		exactReplay: existing.terminalDigest === requestedTerminalDigest
	});
}
function rejectedStage(existing, requested) {
	return Object.freeze({
		staged: false,
		terminal: existing,
		exactReplay: existing.terminalDigest === requested.terminalDigest
	});
}
function requireStagedTerminal(staged, terminalDigest) {
	if (!staged) throw new Error("candidate execution terminal has not been staged");
	if (staged.terminalDigest !== terminalDigest) throw new Error("candidate execution terminal digest does not match staged outbox");
	return staged;
}
function sealTerminalDigest(value) {
	assertSha256Digest$1(value, "terminalDigest");
	return value;
}
function assertRecoveryMatchesStaged(staged, recovered) {
	if (canonicalCandidateDigest$1(staged.usage) !== canonicalCandidateDigest$1(recovered.usage) || canonicalCandidateDigest$1(staged.modelSettlement) !== canonicalCandidateDigest$1(recovered.modelSettlement)) throw new Error("candidate execution recovery evidence does not match staged model evidence");
}
function sealTerminalRecordValue(value, label) {
	const status = requireTerminalStatus(value.status, label);
	assertExactObjectKeys(value, status === "succeeded" ? [
		"executionId",
		"attempt",
		"bundleDigest",
		"executionPlanDigest",
		"preparationEvidence",
		"terminalDigest",
		"status",
		"usage",
		"modelSettlement",
		"taskOutcome",
		"benchmarkResult",
		"runReceipt"
	] : [
		"executionId",
		"attempt",
		"bundleDigest",
		"executionPlanDigest",
		"preparationEvidence",
		"terminalDigest",
		"status",
		"failureClass",
		"usage",
		"modelSettlement",
		...value.failureEvidence ? ["failureEvidence"] : []
	], label);
	const executionPlanDigest = requireString$1(value.executionPlanDigest, label, "executionPlanDigest");
	const identity = {
		executionId: requireString$1(value.executionId, label, "executionId"),
		attempt: requireNumber$1(value.attempt, label, "attempt"),
		bundleDigest: requireString$1(value.bundleDigest, label, "bundleDigest"),
		executionPlanDigest,
		preparationEvidence: sealCandidatePreparationEvidence(value.preparationEvidence, executionPlanDigest)
	};
	assertExecutionId$1(identity.executionId);
	if (!Number.isSafeInteger(identity.attempt) || identity.attempt < 1) throw new Error(`${label} has invalid attempt`);
	assertSha256Digest$1(identity.bundleDigest, "bundleDigest");
	assertSha256Digest$1(identity.executionPlanDigest, "executionPlanDigest");
	if (identity.preparationEvidence.executionPlan.sha256 !== identity.executionPlanDigest) throw new Error(`${label} execution plan artifact does not match executionPlanDigest`);
	const result = sealTerminalResult(status === "succeeded" ? {
		status,
		usage: requireObject$1(value.usage, label, "usage"),
		modelSettlement: requireArtifactRef(value.modelSettlement, label, "modelSettlement"),
		taskOutcome: requireArtifactRef(value.taskOutcome, label, "taskOutcome"),
		benchmarkResult: requireArtifactRef(value.benchmarkResult, label, "benchmarkResult"),
		runReceipt: requireArtifactRef(value.runReceipt, label, "runReceipt")
	} : {
		status,
		failureClass: requireFailureClass(value.failureClass, label),
		usage: requireObject$1(value.usage, label, "usage"),
		modelSettlement: requireArtifactRef(value.modelSettlement, label, "modelSettlement"),
		...value.failureEvidence ? { failureEvidence: requireArtifactRef(value.failureEvidence, label, "failureEvidence") } : {}
	});
	const material = {
		...identity,
		...result
	};
	const terminalDigest = requireString$1(value.terminalDigest, label, "terminalDigest");
	assertSha256Digest$1(terminalDigest, "terminalDigest");
	if (terminalDigest !== canonicalCandidateDigest$1(material)) throw new Error(`${label} has invalid terminalDigest`);
	return immutableCandidateValue({
		...material,
		terminalDigest
	});
}
function assertTerminalMatchesClaim(terminal, claim, path) {
	if (terminal.executionId !== claim.executionId || terminal.attempt !== claim.attempt || terminal.bundleDigest !== claim.bundleDigest || terminal.executionPlanDigest !== claim.executionPlanDigest || canonicalCandidateDigest$1(terminal.preparationEvidence) !== canonicalCandidateDigest$1(claim.preparationEvidence)) throw new Error(`candidate execution terminal record at ${path} does not match its claim`);
}
function assertTerminalMatchesStaged(terminal, staged, path) {
	if (terminal.terminalDigest !== staged.terminalDigest || canonicalCandidateDigest$1(terminal) !== canonicalCandidateDigest$1(staged)) throw new Error(`candidate execution terminal record at ${path} differs from staged outbox`);
}
function sealRecoveryEvidence(evidence, claim) {
	assertExactObjectKeys(evidence, [
		"failureClass",
		"usage",
		"modelSettlement",
		"process",
		"model",
		...evidence.failureEvidence ? ["failureEvidence"] : [],
		...evidence.memory ? ["memory"] : []
	], "candidate execution recovery evidence");
	assertFailureClass(evidence.failureClass);
	const usage = sealUsage(evidence.usage);
	if (evidence.failureClass === "pre-model-infrastructure" && usage.modelCalls !== 0) throw new Error("pre-model infrastructure failure cannot contain model calls");
	const modelSettlement = sealArtifactRef(evidence.modelSettlement, "modelSettlement");
	const failureEvidence = evidence.failureEvidence ? sealArtifactRef(evidence.failureEvidence, "failureEvidence") : void 0;
	assertExactObjectKeys(evidence.process, ["stopped", "executionPlanDigest"], "candidate execution process closure evidence");
	if (evidence.process.stopped !== true || evidence.process.executionPlanDigest !== claim.executionPlanDigest) throw new Error("candidate execution recovery does not prove the claimed process stopped");
	assertExactObjectKeys(evidence.model, [
		"closed",
		"preparationId",
		"grantDigest"
	], "candidate execution model closure evidence");
	if (evidence.model.closed !== true || evidence.model.preparationId !== claim.cleanup.preparationId || evidence.model.grantDigest !== claim.cleanup.modelGrantDigest) throw new Error("candidate execution recovery does not prove the claimed model grant closed");
	if (claim.cleanup.memory) {
		if (!evidence.memory) throw new Error("candidate execution recovery is missing memory closure evidence");
		assertExactObjectKeys(evidence.memory, [
			"closed",
			"preparationId",
			"accessDigest",
			"effectiveNamespace"
		], "candidate execution memory closure evidence");
		if (evidence.memory.closed !== true || evidence.memory.preparationId !== claim.cleanup.preparationId || evidence.memory.accessDigest !== claim.cleanup.memory.accessDigest || evidence.memory.effectiveNamespace !== claim.cleanup.memory.effectiveNamespace) throw new Error("candidate execution recovery does not prove the claimed memory access closed");
	} else if (evidence.memory !== void 0) throw new Error("candidate execution recovery has unexpected memory closure evidence");
	return Object.freeze({
		failureClass: evidence.failureClass,
		usage,
		modelSettlement,
		...failureEvidence ? { failureEvidence } : {},
		process: Object.freeze({ ...evidence.process }),
		model: Object.freeze({ ...evidence.model }),
		...evidence.memory ? { memory: Object.freeze({ ...evidence.memory }) } : {}
	});
}
function sealTerminalResult(result) {
	if (result.status !== "succeeded" && result.status !== "failed") throw new Error("candidate execution terminal status is invalid");
	assertExactObjectKeys(result, result.status === "succeeded" ? [
		"status",
		"usage",
		"modelSettlement",
		"taskOutcome",
		"benchmarkResult",
		"runReceipt"
	] : [
		"status",
		"failureClass",
		"usage",
		"modelSettlement",
		...result.failureEvidence ? ["failureEvidence"] : []
	], "candidate execution terminal result");
	const usage = sealUsage(result.usage);
	const modelSettlement = sealArtifactRef(result.modelSettlement, "modelSettlement");
	if (result.status === "succeeded") return Object.freeze({
		status: "succeeded",
		usage,
		modelSettlement,
		taskOutcome: sealArtifactRef(result.taskOutcome, "taskOutcome"),
		benchmarkResult: sealArtifactRef(result.benchmarkResult, "benchmarkResult"),
		runReceipt: sealArtifactRef(result.runReceipt, "runReceipt")
	});
	assertFailureClass(result.failureClass);
	if (result.failureClass === "pre-model-infrastructure" && usage.modelCalls !== 0) throw new Error("pre-model infrastructure failure cannot contain model calls");
	return Object.freeze({
		status: "failed",
		failureClass: result.failureClass,
		usage,
		modelSettlement,
		...result.failureEvidence ? { failureEvidence: sealArtifactRef(result.failureEvidence, "failureEvidence") } : {}
	});
}
function sealUsage(usage) {
	assertExactObjectKeys(usage, [
		"costUsdNanos",
		"inputTokens",
		"outputTokens",
		"cachedInputTokens",
		"reasoningTokens",
		"modelCalls",
		"costProvenance"
	], "candidate execution terminal usage");
	for (const field of [
		"costUsdNanos",
		"inputTokens",
		"outputTokens",
		"cachedInputTokens",
		"reasoningTokens",
		"modelCalls"
	]) assertCount$1(usage[field], `terminal usage ${field}`);
	if (usage.costProvenance !== "observed" && usage.costProvenance !== "estimated") throw new Error("terminal usage costProvenance must be observed or estimated");
	return Object.freeze({
		costUsdNanos: usage.costUsdNanos,
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		cachedInputTokens: usage.cachedInputTokens,
		reasoningTokens: usage.reasoningTokens,
		modelCalls: usage.modelCalls,
		costProvenance: usage.costProvenance
	});
}
function sealArtifactRef(ref, label) {
	const parsed = agentCandidateArtifactRefSchema.parse(ref);
	if (!Number.isSafeInteger(parsed.byteLength)) throw new Error(`candidate execution terminal ${label} byteLength exceeds safe integer range`);
	return immutableCandidateValue(parsed);
}
function requireArtifactRef(value, path, field) {
	return requireObject$1(value, path, field);
}
function requireString$1(value, path, field) {
	if (typeof value !== "string") throw new Error(`candidate execution record at ${path} has invalid ${field}`);
	return value;
}
function requireNumber$1(value, path, field) {
	if (typeof value !== "number") throw new Error(`candidate execution record at ${path} has invalid ${field}`);
	return value;
}
function requireObject$1(value, path, field) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`candidate execution record at ${path} has invalid ${field}`);
	return value;
}
function requireTerminalStatus(value, path) {
	if (value !== "succeeded" && value !== "failed") throw new Error(`candidate execution terminal record at ${path} has invalid status`);
	return value;
}
function requireFailureClass(value, path) {
	try {
		assertFailureClass(value);
		return value;
	} catch (error) {
		throw new Error(`candidate execution terminal record at ${path} has invalid failureClass`, { cause: error });
	}
}
function assertFailureClass(value) {
	if (value !== "pre-model-infrastructure" && value !== "execution" && value !== "post-model-infrastructure" && value !== "unknown") throw new Error("candidate execution failureClass is invalid");
}
function assertExecutionId$1(value) {
	if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) throw new Error("candidate execution claim executionId is invalid");
}
function assertSha256Digest$1(value, field) {
	if (!SHA256_PATTERN$1.test(value)) throw new Error(`candidate execution claim ${field} must be a lowercase sha256 digest`);
}
function assertCount$1(value, label) {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`candidate execution ${label} must be a non-negative safe integer`);
}
function candidateCleanupTimeout(timeoutMs) {
	const effective = timeoutMs ?? 3e4;
	if (!Number.isSafeInteger(effective) || effective <= 0 || effective > 2147483647) throw new Error("candidate cleanup timeout is outside the supported timer range");
	return effective;
}
function candidateCleanupDeadline(timeoutMs) {
	return Date.now() + candidateCleanupTimeout(timeoutMs);
}
/** Freeze a separate result-construction budget; defaults to the task wall limit. */
function candidateResultTimeout(timeoutMs, taskTimeoutMs) {
	const effective = timeoutMs ?? taskTimeoutMs;
	if (!Number.isSafeInteger(effective) || effective <= 0 || effective > 2147483647) throw new Error("candidate result timeout is outside the supported timer range");
	return effective;
}
/** Bound an evaluator cleanup call and cancel the underlying port at expiry. */
async function withinCandidateCleanupDeadline(operation, deadlineAtMs, label) {
	return withinCandidateDeadline(operation, deadlineAtMs, new CandidateCleanupTimeoutError(label));
}
/**
* Bound cancellable scoring/result work. Every side-effecting port called by
* `operation` must honor the supplied signal before durable publication.
*/
async function withinCandidateResultDeadline(operation, deadlineAtMs, label) {
	return withinCandidateDeadline(operation, deadlineAtMs, new CandidateResultTimeoutError(label));
}
async function withinCandidateDeadline(operation, deadlineAtMs, timeoutError) {
	const remainingMs = deadlineAtMs - Date.now();
	if (remainingMs <= 0) throw timeoutError;
	const controller = new AbortController();
	const pending = Promise.resolve().then(() => operation(controller.signal));
	pending.catch(() => void 0);
	let timer;
	try {
		const result = await Promise.race([pending, new Promise((_resolve, reject) => {
			timer = setTimeout(() => {
				controller.abort(timeoutError);
				reject(timeoutError);
			}, remainingMs);
		})]);
		if (Date.now() >= deadlineAtMs) {
			controller.abort(timeoutError);
			throw timeoutError;
		}
		return result;
	} finally {
		if (timer) clearTimeout(timer);
	}
}
var CandidateCleanupTimeoutError = class extends Error {
	constructor(label) {
		super(`${label} did not complete before the evaluator cleanup deadline`);
		this.name = "CandidateCleanupTimeoutError";
	}
};
var CandidateResultTimeoutError = class extends Error {
	constructor(label) {
		super(`${label} did not complete before the evaluator result deadline`);
		this.name = "CandidateResultTimeoutError";
	}
};
//#endregion
//#region src/candidate-execution/claim.ts
/** Durable one-shot lifecycle for candidate execution attempts. */
function attemptRecord(claim, phase, staged, terminal) {
	return Object.freeze({
		claim,
		phase,
		...staged ? { staged } : {},
		...terminal ? { terminal } : {}
	});
}
/** Single-process lifecycle implementation. */
var InMemoryAgentCandidateExecutionClaimStore = class {
	claims = /* @__PURE__ */ new Map();
	now;
	constructor(options = {}) {
		this.now = options.now ?? Date.now;
	}
	async tryClaim(requested) {
		const claim = sealClaim(requested);
		const slot = claimSlot(claim);
		const existing = this.claims.get(slot);
		if (existing) return rejectedExistingClaim(existing.claim, claim);
		assertUnexpiredLease(claim.leaseExpiresAtMs, this.now());
		const retryRejection = retryRejectionFromMemory(this.claims, claim);
		if (retryRejection) return rejectedRetry(claim, retryRejection);
		const lease = newLease(claim);
		this.claims.set(slot, {
			claim,
			leaseDigest: leaseDigest(lease),
			phase: "claimed"
		});
		return Object.freeze({
			acquired: true,
			claim,
			lease
		});
	}
	async getAttempt(requestedAttempt) {
		const attempt = sealAttemptRef(requestedAttempt);
		const stored = this.claims.get(claimSlot(attempt));
		return stored ? attemptRecord(stored.claim, stored.phase, stored.staged, stored.terminal) : void 0;
	}
	async markCandidateMayRun(requestedLease) {
		const lease = sealLease(requestedLease);
		const stored = this.requireClaim(lease);
		assertLease(stored.leaseDigest, stored.claim.leaseExpiresAtMs, lease);
		if (stored.phase === "candidate-may-run") return Object.freeze({
			marked: false,
			phase: "candidate-may-run"
		});
		if (stored.staged || stored.terminal) throw new Error("candidate execution terminal was staged before candidate-may-run phase");
		assertUnexpiredLease(stored.claim.leaseExpiresAtMs, this.now());
		stored.phase = "candidate-may-run";
		return Object.freeze({
			marked: true,
			phase: "candidate-may-run"
		});
	}
	async stageTerminal(requestedLease, result) {
		const lease = sealLease(requestedLease);
		const stored = this.requireClaim(lease);
		assertLease(stored.leaseDigest, stored.claim.leaseExpiresAtMs, lease);
		const terminal = terminalRecord(stored.claim, result);
		if (stored.staged) return rejectedStage(stored.staged, terminal);
		assertTerminalAllowedInPhase(stored.phase, terminal);
		assertUnexpiredLease(stored.claim.leaseExpiresAtMs, this.now());
		stored.staged = terminal;
		return Object.freeze({
			staged: true,
			terminal
		});
	}
	async finish(requestedLease, requestedTerminalDigest) {
		const lease = sealLease(requestedLease);
		const terminalDigest = sealTerminalDigest(requestedTerminalDigest);
		const stored = this.requireClaim(lease);
		assertLease(stored.leaseDigest, stored.claim.leaseExpiresAtMs, lease);
		const staged = requireStagedTerminal(stored.staged, terminalDigest);
		if (stored.terminal) return rejectedFinish(stored.terminal, terminalDigest);
		assertUnexpiredLease(stored.claim.leaseExpiresAtMs, this.now());
		stored.terminal = staged;
		return Object.freeze({
			finished: true,
			terminal: staged
		});
	}
	async recoverExpired(requestedAttempt, evidence) {
		const attempt = sealAttemptRef(requestedAttempt);
		const stored = this.requireClaim(attempt, "candidate execution recovery");
		const recovered = recoveredTerminalRecord(stored.claim, stored.phase, evidence);
		if (stored.staged) assertRecoveryMatchesStaged(stored.staged, recovered);
		const requestedDigest = stored.staged?.terminalDigest ?? recovered.terminalDigest;
		if (stored.terminal) return rejectedFinish(stored.terminal, requestedDigest);
		assertExpiredLease(stored.claim.leaseExpiresAtMs, this.now());
		const terminal = stored.staged ?? recovered;
		assertRecoveryMatchesStaged(terminal, recovered);
		stored.staged ??= terminal;
		stored.terminal = terminal;
		return Object.freeze({
			finished: true,
			terminal
		});
	}
	requireClaim(attempt, operation = "candidate execution lease") {
		const stored = this.claims.get(claimSlot(attempt));
		if (!stored) throw new Error(`${operation} does not name an acquired attempt`);
		return stored;
	}
};
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const LEASE_TOKEN_PATTERN = /^candidate-execution-lease\.[A-Za-z0-9_-]{43}$/;
const PREPARATION_ID_PATTERN = /^candidate-preparation\.[A-Za-z0-9_-]{43}$/;
function sealClaim(claim) {
	assertExactObjectKeys(claim, [
		"executionId",
		"attempt",
		"maxAttempts",
		"retryPolicy",
		"bundleDigest",
		"executionPlanDigest",
		"preparationEvidence",
		"retryLineageDigest",
		"leaseExpiresAtMs",
		"resultTimeoutMs",
		"cleanup"
	], "candidate execution claim");
	assertExecutionId(claim.executionId);
	if (!Number.isSafeInteger(claim.attempt) || claim.attempt < 1) throw new Error("candidate execution claim attempt must be a positive safe integer");
	if (!Number.isSafeInteger(claim.maxAttempts) || claim.maxAttempts < 1) throw new Error("candidate execution claim maxAttempts must be a positive safe integer");
	if (claim.attempt > claim.maxAttempts) throw new Error("candidate execution claim attempt exceeds maxAttempts");
	if (!["none", "pre-model-infrastructure-only"].includes(claim.retryPolicy)) throw new Error("candidate execution claim retryPolicy is invalid");
	if (claim.retryPolicy === "none" && claim.maxAttempts !== 1) throw new Error("candidate execution claim retryPolicy none requires maxAttempts 1");
	assertSha256Digest(claim.bundleDigest, "bundleDigest");
	assertSha256Digest(claim.executionPlanDigest, "executionPlanDigest");
	const preparationEvidence = sealCandidatePreparationEvidence(claim.preparationEvidence, claim.executionPlanDigest);
	assertSha256Digest(claim.retryLineageDigest, "retryLineageDigest");
	assertPositiveTimestamp(claim.leaseExpiresAtMs, "leaseExpiresAtMs");
	candidateResultTimeout(claim.resultTimeoutMs, claim.resultTimeoutMs);
	const cleanup = sealCleanupHandles(claim.cleanup);
	return Object.freeze({
		executionId: claim.executionId,
		attempt: claim.attempt,
		maxAttempts: claim.maxAttempts,
		retryPolicy: claim.retryPolicy,
		bundleDigest: claim.bundleDigest,
		executionPlanDigest: claim.executionPlanDigest,
		preparationEvidence,
		retryLineageDigest: claim.retryLineageDigest,
		leaseExpiresAtMs: claim.leaseExpiresAtMs,
		resultTimeoutMs: claim.resultTimeoutMs,
		cleanup
	});
}
function sealCleanupHandles(cleanup) {
	assertExactObjectKeys(cleanup, cleanup.memory ? [
		"preparationId",
		"modelGrantDigest",
		"resolvedModel",
		"traceRunId",
		"cleanupTimeoutMs",
		"memory"
	] : [
		"preparationId",
		"modelGrantDigest",
		"resolvedModel",
		"traceRunId",
		"cleanupTimeoutMs"
	], "candidate execution cleanup handles");
	if (!PREPARATION_ID_PATTERN.test(cleanup.preparationId)) throw new Error("candidate execution cleanup preparationId is invalid");
	assertSha256Digest(cleanup.modelGrantDigest, "cleanup modelGrantDigest");
	const resolvedModel = immutableCandidateValue(agentCandidateResolvedModelSchema.parse(cleanup.resolvedModel));
	assertBoundedIdentifier(cleanup.traceRunId, "cleanup traceRunId", 512);
	const cleanupTimeoutMs = candidateCleanupTimeout(cleanup.cleanupTimeoutMs);
	const memory = cleanup.memory ? sealMemoryCleanupHandle(cleanup.memory) : void 0;
	return Object.freeze({
		preparationId: cleanup.preparationId,
		modelGrantDigest: cleanup.modelGrantDigest,
		resolvedModel,
		traceRunId: cleanup.traceRunId,
		cleanupTimeoutMs,
		...memory ? { memory } : {}
	});
}
function sealMemoryCleanupHandle(memory) {
	assertExactObjectKeys(memory, ["accessDigest", "effectiveNamespace"], "candidate execution memory cleanup handle");
	assertSha256Digest(memory.accessDigest, "memory accessDigest");
	assertBoundedIdentifier(memory.effectiveNamespace, "memory effectiveNamespace", 1024);
	return Object.freeze({
		accessDigest: memory.accessDigest,
		effectiveNamespace: memory.effectiveNamespace
	});
}
function sealAttemptRef(attempt) {
	assertExactObjectKeys(attempt, ["executionId", "attempt"], "candidate execution attempt reference");
	assertExecutionId(attempt.executionId);
	if (!Number.isSafeInteger(attempt.attempt) || attempt.attempt < 1) throw new Error("candidate execution attempt reference must have a positive safe attempt");
	return Object.freeze({
		executionId: attempt.executionId,
		attempt: attempt.attempt
	});
}
function sealLease(lease) {
	assertExactObjectKeys(lease, [
		"executionId",
		"attempt",
		"token",
		"expiresAtMs"
	], "candidate execution lease");
	if (lease.executionId.length === 0 || !Number.isSafeInteger(lease.attempt) || lease.attempt < 1) throw new Error("candidate execution lease identity is invalid");
	if (!LEASE_TOKEN_PATTERN.test(lease.token)) throw new Error("candidate execution lease token is invalid");
	assertPositiveTimestamp(lease.expiresAtMs, "lease expiresAtMs");
	return Object.freeze({
		executionId: lease.executionId,
		attempt: lease.attempt,
		token: lease.token,
		expiresAtMs: lease.expiresAtMs
	});
}
function newLease(claim) {
	return Object.freeze({
		executionId: claim.executionId,
		attempt: claim.attempt,
		token: `candidate-execution-lease.${randomBytes(32).toString("base64url")}`,
		expiresAtMs: claim.leaseExpiresAtMs
	});
}
function leaseDigest(lease) {
	return sha256(lease.token);
}
function assertLease(expectedDigest, expectedExpiresAtMs, lease) {
	const expected = Buffer.from(expectedDigest);
	const actual = Buffer.from(leaseDigest(lease));
	if (expected.length !== actual.length || !timingSafeEqual(expected, actual) || lease.expiresAtMs !== expectedExpiresAtMs) throw new Error("candidate execution lease is invalid");
}
function claimSlot(claim) {
	return createHash("sha256").update(JSON.stringify([claim.executionId, claim.attempt]), "utf8").digest("hex");
}
function retryRejectionFromMemory(claims, claim) {
	if (claim.attempt === 1) return void 0;
	return retryRejection(claim, claims.get(claimSlot({
		executionId: claim.executionId,
		attempt: claim.attempt - 1
	})));
}
function retryRejection(claim, prior) {
	if (!prior) return "prior-attempt-missing";
	if (claim.retryPolicy !== "pre-model-infrastructure-only" || prior.claim.retryPolicy !== claim.retryPolicy || prior.claim.maxAttempts !== claim.maxAttempts || prior.claim.bundleDigest !== claim.bundleDigest || prior.claim.retryLineageDigest !== claim.retryLineageDigest) return "retry-lineage-mismatch";
	if (!prior.terminal) return "prior-attempt-running";
	if (prior.terminal.status === "succeeded") return "prior-attempt-succeeded";
	if (prior.terminal.usage.modelCalls !== 0) return "prior-attempt-spent-model-calls";
	if (prior.terminal.failureClass !== "pre-model-infrastructure") return "prior-attempt-not-pre-model-infrastructure";
}
function rejectedExistingClaim(existing, requested) {
	return Object.freeze({
		acquired: false,
		reason: "already-claimed",
		claim: existing,
		exactReplay: canonicalCandidateDigest$1(existing) === canonicalCandidateDigest$1(requested)
	});
}
function rejectedRetry(claim, detail) {
	return Object.freeze({
		acquired: false,
		reason: "retry-not-eligible",
		claim,
		detail
	});
}
async function readClaim(path) {
	const parsed = await readJsonObject(path, "claim");
	const record = parsed;
	assertExactObjectKeys(parsed, [
		"executionId",
		"attempt",
		"maxAttempts",
		"retryPolicy",
		"bundleDigest",
		"executionPlanDigest",
		"preparationEvidence",
		"retryLineageDigest",
		"leaseExpiresAtMs",
		"resultTimeoutMs",
		"cleanup",
		"phase",
		"leaseDigest"
	], `candidate execution claim at ${path}`);
	const claim = sealClaim({
		executionId: requireString(record.executionId, path, "executionId"),
		attempt: requireNumber(record.attempt, path, "attempt"),
		maxAttempts: requireNumber(record.maxAttempts, path, "maxAttempts"),
		retryPolicy: requireRetryPolicy(record.retryPolicy, path),
		bundleDigest: requireString(record.bundleDigest, path, "bundleDigest"),
		executionPlanDigest: requireString(record.executionPlanDigest, path, "executionPlanDigest"),
		preparationEvidence: requireObject(record.preparationEvidence, path, "preparationEvidence"),
		retryLineageDigest: requireString(record.retryLineageDigest, path, "retryLineageDigest"),
		leaseExpiresAtMs: requireNumber(record.leaseExpiresAtMs, path, "leaseExpiresAtMs"),
		resultTimeoutMs: requireNumber(record.resultTimeoutMs, path, "resultTimeoutMs"),
		cleanup: requireObject(record.cleanup, path, "cleanup")
	});
	const persistedLeaseDigest = requireString(record.leaseDigest, path, "leaseDigest");
	assertSha256Digest(persistedLeaseDigest, "leaseDigest");
	if (record.phase !== "claimed") throw new Error(`candidate execution claim at ${path} has invalid initial phase`);
	return {
		claim,
		leaseDigest: persistedLeaseDigest,
		phase: "claimed"
	};
}
async function readClaimIfPresent(path) {
	try {
		return await readClaim(path);
	} catch (error) {
		if (isMissingError(error)) return void 0;
		throw error;
	}
}
async function readTerminal(path) {
	const parsed = await readJsonObject(path, "terminal record");
	const record = parsed;
	assertExactObjectKeys(parsed, ["terminal"], `candidate execution terminal record at ${path}`);
	return sealTerminalRecordValue(requireObject(record.terminal, path, "terminal"), `candidate execution terminal record at ${path}`);
}
async function readTerminalIfPresent(path) {
	try {
		return await readTerminal(path);
	} catch (error) {
		if (isMissingError(error)) return void 0;
		throw error;
	}
}
async function readTransitionIfPresent(path, claim) {
	let parsed;
	try {
		parsed = await readJsonObject(path, "transition record");
	} catch (error) {
		if (isMissingError(error)) return void 0;
		throw error;
	}
	if (parsed.kind === "candidate-execution-phase") {
		const record = parsed;
		assertExactObjectKeys(parsed, [
			"kind",
			"executionId",
			"attempt",
			"executionPlanDigest",
			"phase"
		], `candidate execution phase record at ${path}`);
		if (record.executionId !== claim.executionId || record.attempt !== claim.attempt || record.executionPlanDigest !== claim.executionPlanDigest || record.phase !== "candidate-may-run") throw new Error(`candidate execution phase record at ${path} does not match its claim`);
		return { kind: "phase" };
	}
	if (parsed.kind === "candidate-execution-pending-terminal") {
		const record = parsed;
		assertExactObjectKeys(parsed, ["kind", "terminal"], `candidate execution pending record at ${path}`);
		const terminal = sealTerminalRecordValue(requireObject(record.terminal, path, "terminal"), `candidate execution pending record at ${path}`);
		assertTerminalMatchesClaim(terminal, claim, path);
		return {
			kind: "pending",
			terminal
		};
	}
	throw new Error(`candidate execution transition record at ${path} has invalid kind`);
}
async function readJsonObject(path, kind) {
	let parsed;
	try {
		parsed = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if (isMissingError(error)) throw error;
		throw new Error(`candidate execution ${kind} at ${path} is unreadable`, { cause: error });
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`candidate execution ${kind} at ${path} is not an object`);
	return parsed;
}
function assertSameSlot(existing, requested, path) {
	if (existing.executionId !== requested.executionId || existing.attempt !== requested.attempt) throw new Error(`candidate execution record at ${path} does not match its claim slot`);
}
function assertSha256Digest(value, field) {
	if (!SHA256_PATTERN.test(value)) throw new Error(`candidate execution claim ${field} must be a lowercase sha256 digest`);
}
function requireString(value, path, field) {
	if (typeof value !== "string") throw new Error(`candidate execution record at ${path} has invalid ${field}`);
	return value;
}
function requireNumber(value, path, field) {
	if (typeof value !== "number") throw new Error(`candidate execution record at ${path} has invalid ${field}`);
	return value;
}
function requireObject(value, path, field) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`candidate execution record at ${path} has invalid ${field}`);
	return value;
}
function requireRetryPolicy(value, path) {
	if (value !== "none" && value !== "pre-model-infrastructure-only") throw new Error(`candidate execution record at ${path} has invalid retryPolicy`);
	return value;
}
function assertExecutionId(value) {
	if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) throw new Error("candidate execution claim executionId is invalid");
}
function assertBoundedIdentifier(value, label, maxLength) {
	if (typeof value !== "string" || value.length === 0 || value.length > maxLength || hasControlCharacter(value)) throw new Error(`candidate execution ${label} is invalid`);
}
function hasControlCharacter(value) {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code < 32 || code === 127) return true;
	}
	return false;
}
function assertPositiveTimestamp(value, label) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`candidate execution ${label} must be a positive safe timestamp`);
}
function assertClock(value) {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error("candidate execution claim-store clock returned an invalid timestamp");
}
function assertUnexpiredLease(expiresAtMs, nowMs) {
	assertClock(nowMs);
	if (nowMs >= expiresAtMs) throw new Error("candidate execution lease has expired");
}
function assertExpiredLease(expiresAtMs, nowMs) {
	assertClock(nowMs);
	if (nowMs < expiresAtMs) throw new Error("candidate execution lease has not expired");
}
function sha256(value) {
	return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
function isMissingError(error) {
	return isNodeError(error, "ENOENT");
}
function isNodeError(error, code) {
	return error !== null && typeof error === "object" && "code" in error && error.code === code;
}
const candidateClaimFileInternals = Object.freeze({
	assertExpiredLease,
	assertLease,
	assertSameSlot,
	assertUnexpiredLease,
	attemptRecord,
	claimSlot,
	leaseDigest,
	newLease,
	readClaim,
	readClaimIfPresent,
	readTerminal,
	readTerminalIfPresent,
	readTransitionIfPresent,
	rejectedExistingClaim,
	rejectedRetry,
	retryRejection,
	sealAttemptRef,
	sealClaim,
	sealLease
});
//#endregion
//#region src/candidate-execution/execution-window.ts
const CANDIDATE_TERMINAL_PERSISTENCE_MARGIN_MS = 1e4;
const CANDIDATE_POST_RUN_CLEANUP_PHASES = 4;
/** Process stop, access closure, model evidence, and task/result evidence. */
function candidatePostRunWindowMs(cleanupTimeoutMs, resultTimeoutMs) {
	const windowMs = cleanupTimeoutMs * CANDIDATE_POST_RUN_CLEANUP_PHASES + resultTimeoutMs + CANDIDATE_TERMINAL_PERSISTENCE_MARGIN_MS;
	if (!Number.isSafeInteger(windowMs) || windowMs > 2147483647) throw new Error("candidate post-run window exceeds the supported timer range");
	return windowMs;
}
/** Maximum owner lifetime from claim through process stop, access closure, and terminal write. */
function candidateExecutionOwnerWindowMs(timeoutMs, cleanupTimeoutMs, resultTimeoutMs) {
	const windowMs = timeoutMs + candidatePostRunWindowMs(cleanupTimeoutMs, resultTimeoutMs);
	if (!Number.isSafeInteger(windowMs) || windowMs > 2147483647) throw new Error("candidate execution and cleanup window exceeds the supported timer range");
	return windowMs;
}
/** Time reserved after scoring for failure evidence plus terminal publication. */
function candidateTerminalWindowMs(cleanupTimeoutMs) {
	const windowMs = cleanupTimeoutMs + CANDIDATE_TERMINAL_PERSISTENCE_MARGIN_MS;
	if (!Number.isSafeInteger(windowMs) || windowMs > 2147483647) throw new Error("candidate terminal window exceeds the supported timer range");
	return windowMs;
}
//#endregion
//#region src/candidate-execution/execution-roots.ts
/** Validate the canonical identity and isolation boundary for execution roots. */
function assertAgentCandidateExecutionRoots(roots) {
	const entries = [
		["task", roots.taskRoot],
		["candidate", roots.candidateRoot],
		["profile", roots.profileRoot]
	];
	for (const [name, root] of entries) {
		if (root === void 0) continue;
		if (!posix.isAbsolute(root) || posix.normalize(root) !== root) throw new Error(`execution ${name} root must be a canonical absolute path`);
	}
	for (let left = 0; left < entries.length; left++) {
		const entry = entries[left];
		if (!entry) continue;
		const [leftName, leftRoot] = entry;
		if (leftRoot === void 0) continue;
		for (let right = left + 1; right < entries.length; right++) {
			const rightEntry = entries[right];
			if (!rightEntry) continue;
			const [rightName, rightRoot] = rightEntry;
			if (rightRoot !== void 0 && executionPathsOverlap(leftRoot, rightRoot)) throw new Error(`execution ${leftName} and ${rightName} roots must be distinct and non-overlapping`);
		}
	}
}
function executionPathsOverlap(left, right) {
	const a = posix.normalize(left);
	const b = posix.normalize(right);
	return a === b || b.startsWith(a === "/" ? "/" : `${a}/`) || a.startsWith(b === "/" ? "/" : `${b}/`);
}
//#endregion
//#region src/candidate-execution/types.ts
const verifiedCandidateBrand = Symbol("verifiedAgentCandidate");
const preparedCandidateBrand = Symbol("preparedAgentCandidate");
const verifiedTaskOutcomeBrand = Symbol("verifiedTaskOutcome");
/** Protected trace tags that bind a run to one prepared candidate execution. */
const CANDIDATE_TRACE_TAGS = {
	executionId: "tangle.candidate.execution_id",
	bundleDigest: "tangle.candidate.bundle_digest",
	executionPlanDigest: "tangle.candidate.execution_plan_digest",
	materializationReceiptDigest: "tangle.candidate.materialization_receipt_digest"
};
/** Environment keys used to propagate immutable candidate trace identity. */
const CANDIDATE_TRACE_ENV = {
	executionId: "TANGLE_CANDIDATE_EXECUTION_ID",
	bundleDigest: "TANGLE_CANDIDATE_BUNDLE_DIGEST",
	executionPlanDigest: "TANGLE_CANDIDATE_EXECUTION_PLAN_DIGEST",
	materializationReceiptDigest: "TANGLE_CANDIDATE_MATERIALIZATION_RECEIPT_DIGEST",
	traceRunId: "TANGLE_TRACE_RUN_ID"
};
//#endregion
//#region src/candidate-execution/prepared-state.ts
const stateByExecution = /* @__PURE__ */ new WeakMap();
const lifecycleByExecution = /* @__PURE__ */ new WeakMap();
function createPreparedCandidateExecution(input) {
	const state = detachPreparedCandidateState(input);
	assertPrivateCandidateIntegrity(state);
	const prepared = Object.freeze({
		bundle: state.bundle,
		benchmark: Object.freeze({
			suite: state.benchmarkSuite,
			task: state.benchmarkTask
		}),
		executionId: state.executionId,
		roots: state.roots,
		profilePlan: evidenceView(state.profilePlan),
		profileActivation: state.profileActivation,
		executionPlan: evidenceView(state.executionPlan),
		materializationReceipt: state.materializationReceipt,
		launch: state.launch,
		instruction: bytesView(state.instruction, "bytes"),
		resolvedModel: state.resolvedModel,
		...state.knowledge ? { knowledge: knowledgeView(state.knowledge) } : {},
		trace: state.trace,
		memory: state.memory,
		[preparedCandidateBrand]: true
	});
	stateByExecution.set(prepared, state);
	lifecycleByExecution.set(prepared, { status: "prepared" });
	return prepared;
}
function getPreparedCandidateState(prepared) {
	const state = stateByExecution.get(prepared);
	if (!state || prepared[preparedCandidateBrand] !== true) throw new Error("execution must come from prepareAgentCandidateExecution");
	return state;
}
/** Revalidates the exact private bytes immediately before execution or finalization. */
function assertPreparedCandidateIntegrity(prepared) {
	const state = getPreparedCandidateState(prepared);
	assertPrivateCandidateIntegrity(state);
	return state;
}
/** Atomically reserves this in-memory prepared value before the first await. */
function beginPreparedCandidateClaim(prepared) {
	const state = assertPreparedCandidateIntegrity(prepared);
	transitionLifecycle(prepared, ["prepared"], "claiming");
	return state;
}
/** Claim an unexecuted preparation for explicit resource disposal. */
function beginPreparedCandidateDisposal(prepared) {
	const state = assertPreparedCandidateIntegrity(prepared);
	transitionLifecycle(prepared, [
		"prepared",
		"disposal-failed",
		"cleanup-failed"
	], "disposing");
	return state;
}
function markPreparedCandidateClaimed(prepared) {
	transitionLifecycle(prepared, ["claiming"], "claimed");
}
/** Reveal protected values only after the durable claim and workspace checks succeed. */
function beginPreparedCandidateRun(prepared, modelAccess, memoryAccess) {
	const state = assertPreparedCandidateIntegrity(prepared);
	assertProtectedEnvironment(state, modelAccess.env, memoryAccess?.env);
	transitionLifecycle(prepared, ["claimed"], "running");
	const completeEnvironment = immutableCandidateValue({
		...state.launch.env,
		...modelAccess.env,
		...memoryAccess?.env ?? {},
		...state.trace.env
	});
	const material = state.executionPlan.value.material;
	return {
		state,
		request: Object.freeze({
			executionId: state.executionId,
			benchmark: preparedBenchmark(state),
			inputs: Object.freeze({
				task: workspaceInputView(state.benchmarkTask.workspace, state.executorInputs.taskFiles),
				...material.candidateWorkspace && state.executorInputs.candidateFiles ? { candidate: workspaceInputView(material.candidateWorkspace, state.executorInputs.candidateFiles) } : {},
				profile: Object.freeze({ files: Object.freeze(state.executorInputs.profileFiles.map((file) => profileFileView(file))) })
			}),
			roots: state.roots.execution,
			profilePlan: evidenceView(state.profilePlan),
			profileActivation: state.profileActivation,
			executionPlan: evidenceView(state.executionPlan),
			materializationReceipt: state.materializationReceipt,
			launch: immutableCandidateValue({
				...state.launch,
				env: completeEnvironment
			}),
			instruction: bytesView(state.instruction, "bytes"),
			resolvedModel: state.resolvedModel,
			hardLimits: Object.freeze({ timeoutMs: state.executionPlan.value.material.limits.timeoutMs }),
			observedLimits: Object.freeze({ maxSteps: state.executionPlan.value.material.limits.maxSteps }),
			...state.knowledge ? { knowledge: knowledgeView(state.knowledge) } : {},
			trace: state.trace,
			memory: state.memory
		})
	};
}
function preparedBenchmark(state) {
	return Object.freeze({
		suite: state.benchmarkSuite,
		task: state.benchmarkTask
	});
}
function consumePreparedCandidateExecution(prepared, outcome) {
	transitionLifecycle(prepared, outcome === "disposed" || outcome === "disposal-failed" ? ["disposing"] : ["settling"], outcome);
}
function beginPreparedCandidateSettlement(prepared) {
	transitionLifecycle(prepared, [
		"claiming",
		"claimed",
		"running"
	], "settling");
}
/** Rechecks every mutable staging byte immediately before handing control to an executor. */
async function assertPreparedCandidateWorkspaces(state) {
	const plan = state.executionPlan.value.material;
	await verifyMaterializedWorkspace(state.roots.staging.taskRoot, state.benchmarkTask.workspace.material, { ignoredProtectedRootEntries: [".git", ".sidecar"] });
	if (state.benchmarkTask.repository) await verifyTaskCheckout(state.roots.staging.taskRoot, state.benchmarkTask.repository);
	await verifyMaterializedProfileWorkspace(state.roots.staging.profileRoot, state.profilePlan.value.material);
	if (plan.candidateWorkspace) {
		const candidateRoot = state.roots.staging.candidateRoot;
		if (!candidateRoot) throw new Error("prepared candidate staging root is missing");
		await verifyMaterializedWorkspace(candidateRoot, plan.candidateWorkspace.material);
	} else if (state.roots.staging.candidateRoot !== void 0) throw new Error("disabled candidate unexpectedly has a staging root");
}
function detachPreparedCandidateState(input) {
	const benchmarkSuite = immutableCandidateValue(agentCandidateBenchmarkSuiteSchema.parse(input.benchmarkSuite));
	const benchmarkTask = immutableCandidateValue(agentCandidateBenchmarkTaskSchema.parse(input.benchmarkTask));
	const profilePlan = immutableCandidateValue(agentCandidateProfilePlanEvidenceSchema.parse(input.profilePlan.value));
	const profileActivation = parseAgentCandidateProfileActivation(input.profileActivation, profilePlan.digest);
	const executionPlan = immutableCandidateValue(agentCandidateExecutionPlanEvidenceSchema.parse(input.executionPlan.value));
	const materializationReceipt = canonicalCandidateDocument(omitTopLevelDigest(immutableCandidateValue(agentCandidateMaterializationReceiptSchema.parse(input.materializationReceipt.value))));
	if (materializationReceipt.digest !== input.materializationReceipt.digest) throw new Error("materialization receipt digest changed while sealing prepared execution");
	return Object.freeze({
		ports: input.ports,
		bundle: input.bundle,
		benchmarkSuite,
		benchmarkTask,
		executionId: input.executionId,
		roots: immutableCandidateValue(input.roots),
		profilePlan: Object.freeze({
			value: profilePlan,
			bytes: Uint8Array.from(input.profilePlan.bytes),
			written: Object.freeze([...input.profilePlan.written])
		}),
		profileActivation,
		executionPlan: Object.freeze({
			value: executionPlan,
			bytes: Uint8Array.from(input.executionPlan.bytes)
		}),
		materializationReceipt,
		launch: immutableCandidateValue(input.launch),
		instruction: Object.freeze({
			bytes: Uint8Array.from(input.instruction.bytes),
			delivery: immutableCandidateValue(input.instruction.delivery)
		}),
		resolvedModel: immutableCandidateValue(input.resolvedModel),
		preparationId: input.preparationId,
		reservationExpiresAtMs: input.reservationExpiresAtMs,
		cleanupTimeoutMs: input.cleanupTimeoutMs,
		resultTimeoutMs: input.resultTimeoutMs,
		modelReservation: immutableCandidateValue(input.modelReservation),
		executorInputs: Object.freeze({
			taskFiles: immutableExecutorFiles(input.executorInputs.taskFiles),
			...input.executorInputs.candidateFiles ? { candidateFiles: immutableExecutorFiles(input.executorInputs.candidateFiles) } : {},
			profileFiles: immutableExecutorFiles(input.executorInputs.profileFiles)
		}),
		...input.memoryReservation ? { memoryReservation: immutableCandidateValue(input.memoryReservation) } : {},
		...input.knowledge ? { knowledge: Object.freeze({
			candidate: immutableCandidateValue(input.knowledge.candidate),
			...input.knowledge.stateScope ? { stateScope: immutableCandidateValue(input.knowledge.stateScope) } : {},
			snapshot: immutableCandidateValue(input.knowledge.snapshot),
			files: immutableExecutorFiles(input.knowledge.files),
			...input.knowledge.retrievalConfig ? { retrievalConfig: Uint8Array.from(input.knowledge.retrievalConfig) } : {}
		}) } : {},
		trace: immutableCandidateValue(input.trace),
		memory: immutableCandidateValue(input.memory)
	});
}
function assertPrivateCandidateIntegrity(state) {
	assertAgentCandidateExecutionRoots(state.roots.execution);
	if (canonicalCandidateDigest$1(omitTopLevelDigest(state.bundle)) !== state.bundle.digest) throw new Error("prepared candidate bundle no longer matches its digest");
	assertPlanEvidence(state.profilePlan.value, state.profilePlan.bytes, "profile plan");
	parseAgentCandidateProfileActivation(state.profileActivation, state.profilePlan.value.digest);
	assertPlanEvidence(state.executionPlan.value, state.executionPlan.bytes, "execution plan");
	agentCandidateExecutionPlanEvidenceSchema.parse(state.executionPlan.value);
	const receipt = agentCandidateMaterializationReceiptSchema.parse(state.materializationReceipt.value);
	const receiptBytes = canonicalCandidateBytes$1(omitTopLevelDigest(receipt));
	if (canonicalCandidateDigest$1(omitTopLevelDigest(receipt)) !== state.materializationReceipt.digest || !Buffer.from(receiptBytes).equals(Buffer.from(state.materializationReceipt.bytes))) throw new Error("prepared materialization receipt no longer matches its canonical bytes");
	assertSignedBenchmarkInput(state);
	const instruction = Buffer.from(state.benchmarkTask.instruction, "utf8");
	if (!Buffer.from(state.instruction.bytes).equals(instruction) || JSON.stringify(state.instruction.delivery) !== JSON.stringify(state.executionPlan.value.material.instructionDelivery)) throw new Error("prepared instruction no longer matches the signed execution plan");
	if (!/^candidate-preparation\.[A-Za-z0-9_-]{43}$/.test(state.preparationId) || !Number.isSafeInteger(state.reservationExpiresAtMs) || state.reservationExpiresAtMs <= 0 || !Number.isSafeInteger(state.cleanupTimeoutMs) || state.cleanupTimeoutMs <= 0 || !Number.isSafeInteger(state.resultTimeoutMs) || state.resultTimeoutMs <= 0 || JSON.stringify(state.resolvedModel) !== JSON.stringify(state.executionPlan.value.material.model.resolved) || state.modelReservation.digest !== state.executionPlan.value.material.model.access.grantDigest || state.modelReservation.preparationId !== state.preparationId || state.modelReservation.expiresAtMs !== state.reservationExpiresAtMs || canonicalCandidateDigest$1(state.modelReservation.network) !== canonicalCandidateDigest$1(state.executionPlan.value.material.model.access.network) || canonicalCandidateDigest$1(state.modelReservation.enforcedLimits) !== canonicalCandidateDigest$1(modelLimits$1(state.executionPlan.value.material.limits))) throw new Error("prepared model access no longer matches the signed execution plan");
	assertExecutorInputs(state);
	assertPreparedKnowledge(state);
	if (state.memory.mode === "isolated" && !state.memoryReservation || state.memory.mode === "disabled" && state.memoryReservation) throw new Error("prepared memory reservation does not match the signed execution plan");
	if (state.memory.mode === "isolated" && state.memoryReservation && (state.memoryReservation.preparationId !== state.preparationId || state.memoryReservation.expiresAtMs !== state.reservationExpiresAtMs || state.memoryReservation.effectiveNamespace !== state.memory.effectiveNamespace)) throw new Error("prepared memory reservation identity no longer matches the execution");
	if (JSON.stringify(state.memory) !== JSON.stringify(state.executionPlan.value.material.memory)) throw new Error("prepared memory no longer matches the signed execution plan");
	const expectedTags = {
		[CANDIDATE_TRACE_TAGS.executionId]: state.executionId,
		[CANDIDATE_TRACE_TAGS.bundleDigest]: state.bundle.digest,
		[CANDIDATE_TRACE_TAGS.executionPlanDigest]: state.executionPlan.value.digest,
		[CANDIDATE_TRACE_TAGS.materializationReceiptDigest]: state.materializationReceipt.digest
	};
	const expectedTraceEnvironment = {
		[CANDIDATE_TRACE_ENV.executionId]: state.executionId,
		[CANDIDATE_TRACE_ENV.bundleDigest]: state.bundle.digest,
		[CANDIDATE_TRACE_ENV.executionPlanDigest]: state.executionPlan.value.digest,
		[CANDIDATE_TRACE_ENV.materializationReceiptDigest]: state.materializationReceipt.digest,
		[CANDIDATE_TRACE_ENV.traceRunId]: state.trace.runId
	};
	if (!state.trace.runId.startsWith(`${state.executionId}:attempt-${state.executionPlan.value.material.runCell.attempt}:`) || canonicalCandidateDigest$1(state.trace.tags) !== canonicalCandidateDigest$1(expectedTags) || canonicalCandidateDigest$1(state.trace.env) !== canonicalCandidateDigest$1(expectedTraceEnvironment)) throw new Error("prepared trace identity no longer matches the signed execution");
}
function assertPlanEvidence(evidence, bytes, label) {
	const expected = canonicalCandidateBytes$1(evidence.material);
	if (sha256Bytes$1(expected) !== evidence.digest || !Buffer.from(expected).equals(Buffer.from(bytes)) || evidence.artifact.sha256 !== evidence.digest || evidence.artifact.byteLength !== bytes.byteLength || !("content" in evidence.artifact) || !Buffer.from(evidence.artifact.content, "base64").equals(Buffer.from(bytes))) throw new Error(`prepared ${label} no longer matches its canonical bytes`);
}
function evidenceView(evidence) {
	const bytes = Uint8Array.from(evidence.bytes);
	return Object.freeze({
		...evidence,
		get bytes() {
			return Uint8Array.from(bytes);
		}
	});
}
function bytesView(value, key) {
	const bytes = Uint8Array.from(value.bytes);
	return Object.freeze({
		...value,
		get [key]() {
			return Uint8Array.from(bytes);
		}
	});
}
function knowledgeView(knowledge) {
	const retrievalConfig = knowledge.retrievalConfig ? Uint8Array.from(knowledge.retrievalConfig) : void 0;
	return Object.freeze({
		candidate: knowledge.candidate,
		...knowledge.stateScope ? { stateScope: immutableCandidateValue(knowledge.stateScope) } : {},
		snapshot: knowledge.snapshot,
		files: Object.freeze(knowledge.files.map((file) => profileFileView(file))),
		...retrievalConfig ? { get retrievalConfig() {
			return Uint8Array.from(retrievalConfig);
		} } : {}
	});
}
function workspaceInputView(snapshot, sourceFiles) {
	return Object.freeze({
		snapshot,
		files: Object.freeze(sourceFiles.map((file) => executorFileView(file)))
	});
}
function profileFileView(source) {
	const bytes = Uint8Array.from(source.bytes);
	return Object.freeze({
		path: source.path,
		mode: source.mode,
		...source.root === "agent" ? { root: "agent" } : {},
		get bytes() {
			return Uint8Array.from(bytes);
		}
	});
}
function executorFileView(source) {
	const bytes = Uint8Array.from(source.bytes);
	return Object.freeze({
		path: source.path,
		mode: source.mode,
		get bytes() {
			return Uint8Array.from(bytes);
		}
	});
}
function assertExecutorInputs(state) {
	const material = state.executionPlan.value.material;
	assertWorkspaceExecutorFiles(state.executorInputs.taskFiles, state.benchmarkTask.workspace.material);
	if (material.candidateWorkspace) {
		if (!state.executorInputs.candidateFiles) throw new Error("prepared candidate executor files are missing");
		assertWorkspaceExecutorFiles(state.executorInputs.candidateFiles, material.candidateWorkspace.material);
	} else if (state.executorInputs.candidateFiles) throw new Error("disabled candidate has executor files");
	const expectedFiles = state.profilePlan.value.material.files;
	if (state.executorInputs.profileFiles.length !== expectedFiles.length) throw new Error("prepared profile executor files do not match the signed profile plan");
	for (let index = 0; index < expectedFiles.length; index++) {
		const expected = expectedFiles[index];
		const actual = state.executorInputs.profileFiles[index];
		if (!expected || !actual || actual.path !== expected.relPath || (actual.root ?? "workspace") !== (expected.root ?? "workspace") || actual.mode !== expected.mode || sha256Bytes$1(actual.bytes) !== expected.contentSha256) throw new Error("prepared profile executor files do not match the signed profile plan");
	}
}
function assertPreparedKnowledge(state) {
	const expected = state.bundle.knowledge;
	const actual = state.knowledge;
	if (!expected || !actual) {
		if (expected || actual) throw new Error("prepared knowledge does not match the candidate bundle");
		return;
	}
	if (canonicalCandidateDigest$1(actual.candidate) !== canonicalCandidateDigest$1(expected.candidate) || canonicalCandidateDigest$1(actual.stateScope ?? null) !== canonicalCandidateDigest$1(expected.stateScope ?? null) || canonicalCandidateDigest$1(actual.snapshot) !== canonicalCandidateDigest$1(expected.snapshot) || state.executionPlan.value.material.knowledgeManifestDigest !== expected.snapshot.digest) throw new Error("prepared knowledge identity does not match the candidate bundle");
	assertWorkspaceExecutorFiles(actual.files, expected.snapshot.material);
	if (!expected.retrievalConfig || !actual.retrievalConfig) {
		if (expected.retrievalConfig || actual.retrievalConfig) throw new Error("prepared knowledge retrieval config does not match the candidate bundle");
		return;
	}
	if (actual.retrievalConfig.byteLength !== expected.retrievalConfig.byteLength || sha256Bytes$1(actual.retrievalConfig) !== expected.retrievalConfig.sha256) throw new Error("prepared knowledge retrieval config does not match the candidate bundle");
}
function assertWorkspaceExecutorFiles(actualFiles, expected) {
	if (actualFiles.length !== expected.files.length) throw new Error("prepared workspace executor files do not match the signed manifest");
	for (let index = 0; index < expected.files.length; index++) {
		const actual = actualFiles[index];
		const planned = expected.files[index];
		if (!actual || !planned || actual.path !== planned.path || actual.mode !== planned.mode || actual.bytes.byteLength !== planned.byteLength || sha256Bytes$1(actual.bytes) !== planned.sha256) throw new Error("prepared workspace executor files do not match the signed manifest");
	}
}
function assertSignedBenchmarkInput(state) {
	const cell = state.executionPlan.value.material.runCell;
	const suite = state.benchmarkSuite;
	const task = state.benchmarkTask;
	const receipt = state.materializationReceipt.value;
	const cellIndex = cell.taskIndex * suite.reps + cell.repetition;
	if (canonicalCandidateDigest$1(omitTopLevelDigest(suite)) !== suite.digest || canonicalCandidateDigest$1(omitTopLevelDigest(task)) !== task.digest || canonicalCandidateDigest$1(omitTopLevelDigest(cell)) !== cell.digest || cell.bundleDigest !== state.bundle.digest || cell.suiteDigest !== suite.digest || cell.taskDigest !== task.digest || suite.taskDigests[cell.taskIndex] !== task.digest || suite.seeds[cellIndex] !== cell.seed || cell.repetition >= suite.reps || cell.attempt < 1 || cell.attempt > task.attempt.maxAttempts) throw new Error("prepared candidate no longer matches its signed experiment cell");
	const suiteBytes = canonicalCandidateBytes$1(omitTopLevelDigest(suite));
	const taskBytes = canonicalCandidateBytes$1(omitTopLevelDigest(task));
	if (receipt.benchmark.suite.digest !== suite.digest || receipt.benchmark.suite.material.sha256 !== sha256Bytes$1(suiteBytes) || receipt.benchmark.suite.material.byteLength !== suiteBytes.byteLength || receipt.benchmark.task.digest !== task.digest || receipt.benchmark.task.material.sha256 !== sha256Bytes$1(taskBytes) || receipt.benchmark.task.material.byteLength !== taskBytes.byteLength) throw new Error("materialization receipt no longer matches its signed benchmark input");
}
function immutableExecutorFiles(files) {
	return Object.freeze(files.map((file) => Object.freeze({
		...file,
		bytes: Uint8Array.from(file.bytes)
	})));
}
function modelLimits$1(limits) {
	return {
		maxModelCalls: limits.maxModelCalls,
		maxInputTokens: limits.maxInputTokens,
		maxOutputTokens: limits.maxOutputTokens,
		maxCostUsd: limits.maxCostUsd
	};
}
function transitionLifecycle(prepared, expected, next) {
	const lifecycle = lifecycleByExecution.get(prepared);
	if (!lifecycle || !expected.includes(lifecycle.status)) throw new Error(`prepared candidate execution is already ${lifecycle?.status ?? "unknown"}`);
	lifecycle.status = next;
}
function assertProtectedEnvironment(state, modelEnvironment, memoryEnvironment) {
	const seen = /* @__PURE__ */ new Set([...Object.keys(state.launch.env), ...Object.keys(state.trace.env)]);
	for (const [name, value] of [...Object.entries(modelEnvironment), ...Object.entries(memoryEnvironment ?? {})]) {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== "string" || value.length < 8) throw new Error("protected model activation contains an invalid environment binding");
		if (seen.has(name)) throw new Error(`protected model activation collides with environment binding ${name}`);
		seen.add(name);
	}
}
//#endregion
//#region src/candidate-execution/claim-plan.ts
/** Extract the complete durable claim from a prepared execution. */
function candidateExecutionClaim(prepared, preparationEvidence) {
	const state = assertPreparedCandidateIntegrity(prepared);
	const material = prepared.executionPlan.value.material;
	const attempt = {
		number: material.runCell.attempt,
		maxAttempts: state.benchmarkTask.attempt.maxAttempts,
		retryPolicy: state.benchmarkTask.attempt.retryPolicy
	};
	const nowMs = Date.now();
	if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("candidate execution claim-store clock returned an invalid timestamp");
	const leaseExpiresAtMs = nowMs + candidateExecutionOwnerWindowMs(material.limits.timeoutMs, state.cleanupTimeoutMs, state.resultTimeoutMs);
	if (!Number.isSafeInteger(leaseExpiresAtMs) || leaseExpiresAtMs <= 0) throw new Error("candidate execution leaseExpiresAtMs must be a positive safe timestamp");
	if (leaseExpiresAtMs > state.reservationExpiresAtMs) throw new Error("candidate preparation expires before its full execution and cleanup owner window");
	if (preparationEvidence.executionPlan.sha256 !== prepared.executionPlan.value.digest || preparationEvidence.executionPlan.byteLength !== state.executionPlan.bytes.byteLength) throw new Error("persisted execution plan does not match its canonical preparation bytes");
	if (preparationEvidence.materializationReceipt.sha256 !== state.materializationReceipt.digest || preparationEvidence.materializationReceipt.byteLength !== state.materializationReceipt.bytes.byteLength) throw new Error("persisted materialization receipt does not match its canonical preparation bytes");
	return candidateClaimFileInternals.sealClaim({
		executionId: prepared.executionId,
		attempt: attempt.number,
		maxAttempts: attempt.maxAttempts,
		retryPolicy: attempt.retryPolicy,
		bundleDigest: prepared.bundle.digest,
		executionPlanDigest: prepared.executionPlan.value.digest,
		preparationEvidence,
		retryLineageDigest: retryLineageDigest(prepared, state.resultTimeoutMs),
		leaseExpiresAtMs,
		resultTimeoutMs: state.resultTimeoutMs,
		cleanup: {
			preparationId: state.preparationId,
			modelGrantDigest: state.modelReservation.digest,
			resolvedModel: state.resolvedModel,
			traceRunId: state.trace.runId,
			cleanupTimeoutMs: state.cleanupTimeoutMs,
			...state.memoryReservation ? { memory: {
				accessDigest: state.memoryReservation.accessDigest,
				effectiveNamespace: state.memoryReservation.effectiveNamespace
			} } : {}
		}
	});
}
function retryLineageDigest(prepared, resultTimeoutMs) {
	const material = prepared.executionPlan.value.material;
	return canonicalCandidateDigest$1({
		resultTimeoutMs,
		executionPlan: {
			...material,
			runCell: {
				...material.runCell,
				attempt: 0,
				digest: `sha256:${"0".repeat(64)}`
			},
			model: {
				...material.model,
				access: {
					...material.model.access,
					grantDigest: `sha256:${"0".repeat(64)}`
				}
			},
			memory: material.memory.mode === "disabled" ? material.memory : {
				mode: "isolated",
				scope: "task",
				effectiveNamespace: "candidate/retry-lineage-normalized",
				reset: {
					kind: "fresh",
					emptyStateDigest: material.memory.reset.emptyStateDigest
				},
				beforeState: {
					digest: material.memory.beforeState.digest,
					material: material.memory.beforeState.material,
					manifest: {
						sha256: material.memory.beforeState.manifest.sha256,
						byteLength: material.memory.beforeState.manifest.byteLength
					},
					archive: {
						sha256: material.memory.beforeState.archive.sha256,
						byteLength: material.memory.beforeState.archive.byteLength
					}
				},
				...material.memory.seedDigest ? { seedDigest: material.memory.seedDigest } : {}
			}
		}
	});
}
//#endregion
//#region src/candidate-execution/executor-capture.ts
const sealedFinalCaptureBrand = Symbol("sealedAgentCandidateExecutorFinalCapture");
/** Validate and detach the only candidate-authored fields accepted from execution. */
function sealAgentCandidateProtectedRunCapture(value) {
	const capture = requireRecord(value, "candidate execution capture");
	assertExactObjectKeys(capture, ["executionId", "termination"], "candidate execution capture");
	if (typeof capture.executionId !== "string" || capture.executionId.length === 0) throw new Error("candidate execution capture has an invalid executionId");
	return Object.freeze({
		executionId: capture.executionId,
		termination: Object.freeze(agentCandidateTerminationSchema.parse(capture.termination))
	});
}
/** Validate, detach, and freeze evaluator-owned evidence captured after process death. */
function sealAgentCandidateExecutorFinalCapture(value, expectedOutcome) {
	const capture = requireRecord(value, "candidate final capture");
	assertExactObjectKeys(capture, [], "candidate final capture", [
		"taskOutcome",
		"memoryAfter",
		"evidence"
	]);
	const taskOutcome = capture.taskOutcome ? sealTaskOutcomeCapture(capture.taskOutcome, expectedOutcome) : void 0;
	const memoryAfter = capture.memoryAfter ? sealMemoryCapture(capture.memoryAfter) : void 0;
	if (capture.evidence !== void 0 && !(capture.evidence instanceof Uint8Array)) throw new Error("candidate executor evidence must be a byte array");
	const evidence = capture.evidence ? Uint8Array.from(capture.evidence) : void 0;
	return Object.freeze({
		...taskOutcome ? { taskOutcome } : {},
		...memoryAfter ? { memoryAfter: Object.freeze(memoryAfter) } : {},
		...evidence ? { evidence } : {},
		[sealedFinalCaptureBrand]: true
	});
}
/** Prove exact process death before any final evidence capture. */
function sealAgentCandidateExecutorStopAcknowledgement(value) {
	const capture = requireRecord(value, "candidate stop acknowledgement");
	assertExactObjectKeys(capture, ["stopped"], "candidate stop acknowledgement");
	if (capture.stopped !== true) throw new Error("candidate stop acknowledgement does not prove process death");
}
function sealMemoryCapture(value) {
	const capture = requireRecord(value, "candidate memory capture");
	assertExactObjectKeys(capture, ["afterState", "archive"], "candidate memory capture");
	if (!(capture.archive instanceof Uint8Array)) throw new Error("candidate memory capture archive must be a byte array");
	return Object.freeze({
		afterState: Object.freeze(agentCandidateWorkspaceManifestMaterialSchema.parse(capture.afterState)),
		archive: Uint8Array.from(capture.archive)
	});
}
function sealTaskOutcomeCapture(value, expected) {
	const capture = requireRecord(value, "candidate task capture");
	if (capture.kind === "output") {
		assertExactObjectKeys(capture, ["kind", "bytes"], "candidate task output capture");
		if (expected.kind !== "output") throw new Error("candidate task output capture does not match the signed outcome kind");
		if (!(capture.bytes instanceof Uint8Array)) throw new Error("candidate task output capture must contain a byte array");
		if (capture.bytes.byteLength > expected.maxBytes) throw new Error(`candidate task output exceeds the frozen ${expected.maxBytes}-byte maximum`);
		return Object.freeze({
			kind: "output",
			bytes: Uint8Array.from(capture.bytes)
		});
	}
	assertExactObjectKeys(capture, [
		"kind",
		"resultTree",
		"afterState",
		"archive",
		"gitDiff"
	], "candidate task capture");
	if (capture.kind !== "workspace") throw new Error("candidate task capture has an invalid outcome kind");
	if (expected.kind !== "workspace") throw new Error("candidate workspace capture does not match the signed outcome kind");
	if (typeof capture.resultTree !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(capture.resultTree)) throw new Error("candidate task capture resultTree is not a Git object id");
	if (!(capture.archive instanceof Uint8Array) || !(capture.gitDiff instanceof Uint8Array)) throw new Error("candidate task capture archive and gitDiff must be byte arrays");
	const afterState = agentCandidateWorkspaceManifestMaterialSchema.parse(capture.afterState);
	return Object.freeze({
		kind: "workspace",
		resultTree: capture.resultTree,
		afterState: Object.freeze(afterState),
		archive: Uint8Array.from(capture.archive),
		gitDiff: Uint8Array.from(capture.gitDiff)
	});
}
function requireRecord(value, label) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value;
}
//#endregion
//#region src/candidate-execution/model-settlement.ts
const USD_NANOS = 1e9;
/** Validate and detach the evaluator gateway's terminal, revoked call ledger. */
function sealAgentCandidateModelSettlement(settlement, expected) {
	assertExactObjectKeys(settlement, [
		"preparationId",
		"grantDigest",
		"closed",
		"usageWithinLimits",
		"calls"
	], "model settlement");
	if (settlement.closed !== true) throw new Error("protected model grant is not closed");
	if (settlement.usageWithinLimits !== true) throw new Error("protected model settlement reports usage outside frozen limits");
	if (settlement.grantDigest !== expected.grantDigest) throw new Error("protected model settlement grant digest does not match the reservation");
	if (settlement.preparationId !== expected.preparationId) throw new Error("protected model settlement preparation does not match the reservation");
	if (!Array.isArray(settlement.calls)) throw new Error("protected model settlement calls must be an array");
	const callIds = /* @__PURE__ */ new Set();
	const spanIds = /* @__PURE__ */ new Set();
	let accountedInputTokens = 0;
	let outputTokens = 0;
	let cachedInputTokens = 0;
	let reasoningTokens = 0;
	let costUsdNanos = 0;
	let costProvenance = "observed";
	const calls = settlement.calls.map((source, index) => {
		assertExactObjectKeys(source, [
			"callId",
			"generationId",
			"traceSpanId",
			"status",
			"model",
			"startedAtMs",
			"endedAtMs",
			"inputTokens",
			"accountedInputTokens",
			"outputTokens",
			"cachedInputTokens",
			"reasoningTokens",
			"costUsdNanos",
			"costProvenance"
		], `model settlement call ${index}`);
		assertIdentifier(source.callId, `model settlement call ${index} callId`);
		assertIdentifier(source.generationId, `model settlement call ${index} generationId`);
		assertIdentifier(source.traceSpanId, `model settlement call ${index} traceSpanId`);
		if (source.traceSpanId !== source.generationId) throw new Error(`model settlement call ${index} traceSpanId is not its router generationId`);
		if (source.status !== "succeeded" && source.status !== "failed") throw new Error(`model settlement call ${index} has an invalid status`);
		if (callIds.has(source.callId)) throw new Error("protected model settlement has duplicate call ids");
		if (spanIds.has(source.traceSpanId)) throw new Error("protected model settlement has duplicate trace span ids");
		callIds.add(source.callId);
		spanIds.add(source.traceSpanId);
		if (source.model !== expected.model) throw new Error(`protected model settlement call ${index} has an unexpected model`);
		assertTimestamp(source.startedAtMs, `model settlement call ${index} startedAtMs`);
		assertTimestamp(source.endedAtMs, `model settlement call ${index} endedAtMs`);
		if (source.endedAtMs < source.startedAtMs) throw new Error(`model settlement call ${index} ended before it started`);
		assertCount(source.inputTokens, `model settlement call ${index} inputTokens`);
		assertCount(source.accountedInputTokens, `model settlement call ${index} accountedInputTokens`);
		if (source.accountedInputTokens < source.inputTokens) throw new Error(`model settlement call ${index} accountedInputTokens cannot be less than inputTokens`);
		assertCount(source.outputTokens, `model settlement call ${index} outputTokens`);
		assertCount(source.cachedInputTokens, `model settlement call ${index} cachedInputTokens`);
		cachedInputTokens = safeAdd(cachedInputTokens, source.cachedInputTokens, "cached input token total");
		assertCount(source.reasoningTokens, `model settlement call ${index} reasoningTokens`);
		reasoningTokens = safeAdd(reasoningTokens, source.reasoningTokens, "reasoning token total");
		assertCount(source.costUsdNanos, `model settlement call ${index} costUsdNanos`);
		if (source.costProvenance !== "observed" && source.costProvenance !== "estimated") throw new Error(`model settlement call ${index} has an invalid cost provenance`);
		if (source.costProvenance === "estimated") costProvenance = "estimated";
		accountedInputTokens = safeAdd(accountedInputTokens, source.accountedInputTokens, "accounted input token total");
		outputTokens = safeAdd(outputTokens, source.outputTokens, "output token total");
		costUsdNanos = safeAdd(costUsdNanos, source.costUsdNanos, "cost total");
		return Object.freeze({ ...source });
	});
	const usage = Object.freeze({
		costUsdNanos,
		inputTokens: accountedInputTokens,
		outputTokens,
		cachedInputTokens,
		reasoningTokens,
		modelCalls: calls.length,
		costProvenance
	});
	return Object.freeze({
		value: Object.freeze({
			preparationId: settlement.preparationId,
			grantDigest: settlement.grantDigest,
			closed: true,
			usageWithinLimits: true,
			calls: Object.freeze(calls)
		}),
		usage
	});
}
/**
* Append the only accepted LLM spans from the router's closed ledger.
* Candidate and executor code may write tool/process spans, but never model usage.
*/
async function appendAuthoritativeModelSettlementSpans(traceStore, runId, settlement) {
	const run = await traceStore.getRun(runId);
	if (!run) throw new Error(`protected trace run is missing before model settlement: ${runId}`);
	if (run.status === "running" || run.endedAt === void 0) throw new Error("protected trace run must be terminal before model spans are appended");
	const existing = await traceStore.spans({ runId });
	if (existing.some(isLlmSpan)) throw new Error("protected trace contains a model span not authored from the closed router ledger");
	const occupiedIds = new Set(existing.map((span) => span.spanId));
	for (const call of settlement.value.calls) {
		if (occupiedIds.has(call.traceSpanId)) throw new Error(`protected trace span identity collides with router generation ${call.generationId}`);
		await traceStore.appendSpan({
			runId,
			spanId: call.traceSpanId,
			kind: "llm",
			name: "protected model call",
			model: call.model,
			messages: [],
			startedAt: call.startedAtMs,
			endedAt: call.endedAtMs,
			status: call.status === "succeeded" ? "ok" : "error",
			inputTokens: call.inputTokens,
			outputTokens: call.outputTokens,
			cachedTokens: call.cachedInputTokens,
			reasoningTokens: call.reasoningTokens,
			costUsd: call.costUsdNanos / USD_NANOS,
			attributes: {
				"tangle.protected_model.source": "router-settlement",
				"tangle.router.call_id": call.callId,
				"tangle.router.generation_id": call.generationId
			}
		});
	}
}
/** Match every protected trace span one-for-one against gateway call evidence. */
function assertTraceMatchesModelSettlement(spans, settlement) {
	if (spans.length !== settlement.value.calls.length) throw new Error(`protected trace model calls ${spans.length} do not match model ledger ${settlement.value.calls.length}`);
	const byId = new Map(spans.map((span) => [span.spanId, span]));
	if (byId.size !== spans.length) throw new Error("protected trace has duplicate model span ids");
	for (const call of settlement.value.calls) {
		const span = byId.get(call.traceSpanId);
		if (!span) throw new Error(`protected trace is missing model ledger span ${call.traceSpanId}`);
		assertTraceCall(span, call);
	}
}
function usdToNanos(value, label) {
	if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be nonnegative`);
	const nanos = Math.round(value * USD_NANOS);
	if (!Number.isSafeInteger(nanos)) throw new Error(`${label} exceeds fixed-point range`);
	return nanos;
}
function assertTraceCall(span, call) {
	if (span.model !== call.model) throw new Error(`protected trace span ${span.spanId} model does not match model ledger`);
	if (span.startedAt !== call.startedAtMs || span.endedAt !== call.endedAtMs || span.status !== (call.status === "succeeded" ? "ok" : "error")) throw new Error(`protected trace span ${span.spanId} timing or status does not match model ledger`);
	if (span.attributes?.["tangle.protected_model.source"] !== "router-settlement" || span.attributes?.["tangle.router.call_id"] !== call.callId || span.attributes?.["tangle.router.generation_id"] !== call.generationId) throw new Error(`protected trace span ${span.spanId} lacks router settlement provenance`);
	for (const [name, traced, settled] of [
		[
			"inputTokens",
			span.inputTokens,
			call.inputTokens
		],
		[
			"outputTokens",
			span.outputTokens,
			call.outputTokens
		],
		[
			"cachedInputTokens",
			span.cachedTokens ?? 0,
			call.cachedInputTokens
		],
		[
			"reasoningTokens",
			span.reasoningTokens ?? 0,
			call.reasoningTokens
		]
	]) if (traced === void 0 || traced !== settled) throw new Error(`protected trace span ${span.spanId} ${name} ${traced} does not match model ledger ${settled}`);
	if (span.costUsd === void 0) throw new Error(`protected trace span ${span.spanId} is missing costUsd`);
	const tracedCost = usdToNanos(span.costUsd, `protected trace span ${span.spanId} costUsd`);
	if (tracedCost !== call.costUsdNanos) throw new Error(`protected trace span ${span.spanId} costUsdNanos ${tracedCost} does not match model ledger ${call.costUsdNanos}`);
}
function assertIdentifier(value, label) {
	if (typeof value !== "string" || value.length === 0 || value.length > 256) throw new Error(`${label} must be a non-empty bounded string`);
}
function assertCount(value, label) {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative safe integer`);
}
function assertTimestamp(value, label) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
}
function safeAdd(left, right, label) {
	const total = left + right;
	if (!Number.isSafeInteger(total)) throw new Error(`${label} exceeds safe integer range`);
	return total;
}
//#endregion
//#region src/candidate-execution/finalize.ts
/** Builds a candidate run receipt exclusively from protected trace and memory evidence. */
async function finalizeAgentCandidateRun(state, capture, traceStore, traceIdentity, settlement, evidence, protectedValues, writeRedactionReport, signal) {
	let termination;
	try {
		signal?.throwIfAborted();
		if (capture.executionId !== state.executionId) throw new Error("protected capture execution id does not match the prepared execution");
		termination = capture.termination;
		if (termination.kind === "timeout" && termination.timeoutMs !== state.executionPlan.value.material.limits.timeoutMs) throw new Error("timeout termination does not match the frozen execution limit");
		const run = await traceStore.getRun(traceIdentity.runId);
		if (!run) throw new Error(`protected trace run is missing: ${traceIdentity.runId}`);
		if (run.status === "running" || run.endedAt === void 0) throw new Error("protected trace run is not terminal");
		assertTraceBindings(run.tags, traceIdentity.tags);
		const [spans, events, budget, artifacts] = await Promise.all([
			traceStore.spans({ runId: run.runId }),
			traceStore.events({ runId: run.runId }),
			traceStore.budget(run.runId),
			traceStore.artifacts(run.runId)
		]);
		const orderedSpans = [...spans].sort((a, b) => a.startedAt - b.startedAt || compareStrings(a.spanId, b.spanId));
		const orderedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp || compareStrings(a.eventId, b.eventId));
		const orderedBudget = [...budget].sort((a, b) => a.timestamp - b.timestamp || compareStrings(a.dimension, b.dimension));
		const orderedArtifacts = [...artifacts].sort((a, b) => compareStrings(a.artifactId, b.artifactId));
		const modelSpans = orderedSpans.filter(isLlmSpan);
		assertTraceMatchesModelSettlement(modelSpans, settlement);
		const steps = enforceLimits(state, run.startedAt, run.endedAt, orderedSpans, settlement);
		const memory = await memoryReceipt(state, evidence.finalCapture, evidence.persistedCapture.memoryAfter, signal);
		const redacted = redactProtectedValue({
			run: {
				...run,
				redactionVersion: REDACTION_VERSION
			},
			spans: orderedSpans,
			events: orderedEvents,
			budget: orderedBudget,
			artifacts: orderedArtifacts
		}, protectedValues);
		const combinedByRule = { ...writeRedactionReport?.byRule ?? {} };
		for (const [rule, count] of Object.entries(redacted.report.byRule)) combinedByRule[rule] = (combinedByRule[rule] ?? 0) + count;
		const traceBytes = canonicalCandidateBytes$1({
			...redacted.value,
			evaluatorLimits: { resultTimeoutMs: state.resultTimeoutMs },
			redaction: {
				version: REDACTION_VERSION,
				redactionCount: (writeRedactionReport?.redactionCount ?? 0) + redacted.report.redactionCount,
				byRule: combinedByRule
			}
		});
		assertNoProtectedBytes(traceBytes, protectedValues);
		const trace = {
			artifact: await persistCandidateOutputArtifact(evidence.outputArtifacts, {
				executionId: state.executionId,
				purpose: "trace",
				bytes: traceBytes,
				signal
			}),
			eventCount: 1 + orderedSpans.length + orderedEvents.length + orderedBudget.length + orderedArtifacts.length,
			modelCallCount: modelSpans.length
		};
		const document = canonicalCandidateDocument({
			kind: "agent-candidate-run",
			digestAlgorithm: "rfc8785-sha256",
			bundleDigest: state.bundle.digest,
			runCellDigest: state.executionPlan.value.material.runCell.digest,
			materializationReceiptDigest: state.materializationReceipt.digest,
			executionPlanDigest: state.executionPlan.value.digest,
			timing: {
				startedAtMs: run.startedAt,
				endedAtMs: run.endedAt,
				durationMs: run.endedAt - run.startedAt
			},
			steps,
			memory,
			trace,
			termination,
			executorCapture: evidence.persistedCapture.evidence,
			modelSettlement: evidence.modelSettlement,
			taskOutcome: evidence.taskOutcome.evidence,
			benchmarkResult: evidence.benchmarkResult
		});
		agentCandidateRunReceiptSchema.parse(document.value);
		const runReceipt = await persistCandidateOutputArtifact(evidence.outputArtifacts, {
			executionId: state.executionId,
			purpose: "run-receipt",
			bytes: document.bytes,
			signal
		});
		return {
			succeeded: true,
			receipt: document,
			artifacts: {
				modelSettlement: evidence.modelSettlement.artifact,
				executorCapture: evidence.persistedCapture.evidence,
				taskOutcome: evidence.taskOutcome.evidence.artifact,
				benchmarkResult: evidence.benchmarkResult.artifact,
				runReceipt
			}
		};
	} catch (error) {
		return { ...failedAgentCandidateRun(state, redactProtectedReason(error instanceof Error ? error.message : String(error), protectedValues), termination, settlement.usage) };
	}
}
function assertTraceBindings(tags, expected) {
	for (const name of Object.values(CANDIDATE_TRACE_TAGS)) if (tags?.[name] !== expected[name]) throw new Error(`protected trace is not bound to prepared execution tag ${name}`);
}
function enforceLimits(state, startedAt, endedAt, spans, settlement) {
	const limits = state.executionPlan.value.material.limits;
	const usage = settlement.usage;
	const wallMs = endedAt - startedAt;
	if (!Number.isFinite(wallMs) || wallMs < 0 || wallMs > limits.timeoutMs) throw new Error(`protected trace wall time ${wallMs} exceeds ${limits.timeoutMs}`);
	const steps = spans.filter((span) => span.kind === "tool").length;
	const checks = [
		[
			steps,
			limits.maxSteps,
			"tool steps"
		],
		[
			usage.modelCalls,
			limits.maxModelCalls,
			"model calls"
		],
		[
			usage.inputTokens,
			limits.maxInputTokens,
			"input tokens"
		],
		[
			usage.outputTokens,
			limits.maxOutputTokens,
			"output tokens"
		]
	];
	for (const [actual, limit, label] of checks) if (actual > limit) throw new Error(`protected ${label} ${actual} exceeds ${limit}`);
	if (usage.costUsdNanos > usdToNanos(limits.maxCostUsd, "frozen maxCostUsd")) throw new Error(`protected cost USD ${usage.costUsdNanos / 1e9} exceeds ${limits.maxCostUsd}`);
	return steps;
}
async function memoryReceipt(state, capture, persisted, signal) {
	signal?.throwIfAborted();
	if (state.memory.mode === "disabled") {
		if (capture.memoryAfter !== void 0 || persisted !== void 0) throw new Error("disabled memory cannot return an after-state");
		return { mode: "disabled" };
	}
	if (!capture.memoryAfter) throw new Error("isolated memory is missing its protected after-state");
	if (!persisted) throw new Error("isolated memory is missing persisted capture evidence");
	const afterState = capture.memoryAfter.afterState;
	const manifestBytes = canonicalCandidateBytes$1(afterState);
	const snapshot = agentCandidateWorkspaceSnapshotEvidenceSchema.parse({
		kind: "agent-candidate-workspace-snapshot",
		digest: sha256Bytes$1(manifestBytes),
		material: afterState,
		manifest: persisted.manifest,
		archive: persisted.archive
	});
	return {
		mode: "isolated",
		scope: "task",
		effectiveNamespace: state.memory.effectiveNamespace,
		resetEvidenceDigest: state.memory.reset.evidence.sha256,
		beforeStateDigest: state.memory.beforeState.digest,
		afterState: snapshot
	};
}
function failedAgentCandidateRun(state, reason, termination, usage = null) {
	return {
		succeeded: false,
		reason,
		partial: {
			executionId: state.executionId,
			bundleDigest: state.bundle.digest,
			executionPlanDigest: state.executionPlan.value.digest,
			materializationReceiptDigest: state.materializationReceipt.digest,
			...termination ? { termination } : {}
		},
		usage
	};
}
function compareStrings(a, b) {
	return a < b ? -1 : a > b ? 1 : 0;
}
//#endregion
//#region src/candidate-execution/benchmark-grader.ts
/**
* Admit verified grader bytes to the evaluator runner and reject any result
* that is not bound to those bytes, the exact task outcome, and its raw output.
*/
async function runBoundCandidateBenchmarkGrader(input) {
	input.signal?.throwIfAborted();
	const descriptor = snapshotGraderDescriptor(input.grader, input.expectedGrader);
	const implementationBytes = await readVerifiedArtifact(descriptor.artifact, input.artifacts);
	if (implementationBytes.byteLength === 0) throw new Error("candidate benchmark grader implementation cannot be empty");
	const expectedImplementationDigest = sha256Bytes$1(implementationBytes);
	const termination = immutableCandidateValue(input.termination);
	const run = input.grader.run;
	const startedAtMs = Date.now();
	const result = await run(Object.freeze({
		executionId: input.executionId,
		termination,
		outcome: input.outcome,
		implementation: detachedImplementation(implementationBytes),
		signal: input.signal ?? new AbortController().signal
	}));
	const endedAtMs = Math.max(startedAtMs, Date.now());
	input.signal?.throwIfAborted();
	assertExactRunnerResult(result);
	const evidence = Uint8Array.from(result.evidence);
	const outputDigest = sha256Bytes$1(evidence);
	if (result.binding.implementationDigest !== expectedImplementationDigest) throw new Error("candidate benchmark grader executed implementation digest does not match its verified artifact");
	if (result.binding.taskOutcomeDigest !== input.outcome.evidence.digest) throw new Error("candidate benchmark grader task outcome digest does not match verified outcome");
	if (result.binding.outputDigest !== outputDigest) throw new Error("candidate benchmark grader raw output digest does not match returned evidence");
	return Object.freeze({
		grader: descriptor,
		grading: immutableCandidateValue({
			usage: emptyFixedSpend(),
			timing: {
				startedAtMs,
				endedAtMs,
				durationMs: endedAtMs - startedAtMs
			}
		}),
		evaluation: result.evaluation,
		evidence
	});
}
function snapshotGraderDescriptor(grader, expected) {
	if (!grader.name || !grader.version) throw new Error("candidate benchmark grader name and version must be non-empty");
	if (canonicalCandidateDigest$1({
		name: grader.name,
		version: grader.version,
		format: "tangle-grader",
		artifact: grader.artifact
	}) !== canonicalCandidateDigest$1(expected)) throw new Error("candidate benchmark grader does not match the signed task grader");
	return immutableCandidateValue(expected);
}
function emptyFixedSpend() {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cachedInputTokens: 0,
		reasoningTokens: 0,
		modelCalls: 0,
		costUsdNanos: 0,
		costProvenance: "observed"
	};
}
function detachedImplementation(bytes) {
	const stored = Uint8Array.from(bytes);
	return Object.freeze({
		byteLength: stored.byteLength,
		get bytes() {
			return Uint8Array.from(stored);
		}
	});
}
function assertExactRunnerResult(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("candidate benchmark grader result must be an object");
	const result = value;
	const keys = Object.keys(result).sort();
	if (keys.length !== 3 || keys[0] !== "binding" || keys[1] !== "evaluation" || keys[2] !== "evidence") throw new Error("candidate benchmark grader returned unknown or missing fields");
	if (!(result.evidence instanceof Uint8Array)) throw new Error("candidate benchmark grader evidence must be bytes");
	if (result.binding === null || typeof result.binding !== "object" || Array.isArray(result.binding)) throw new Error("candidate benchmark grader binding must be an object");
	const bindingKeys = Object.keys(result.binding).sort();
	if (bindingKeys.length !== 3 || bindingKeys[0] !== "implementationDigest" || bindingKeys[1] !== "outputDigest" || bindingKeys[2] !== "taskOutcomeDigest") throw new Error("candidate benchmark grader binding returned unknown or missing fields");
}
//#endregion
//#region src/candidate-execution/executor-capture-evidence.ts
/** Persist structurally valid post-stop bytes without claiming they passed outcome verification. */
async function persistAgentCandidateExecutorCapture(identity, expected, capture, outputArtifacts, signal) {
	const executorEvidence = capture.evidence ? await persistCandidateOutputArtifact(outputArtifacts, {
		executionId: identity.executionId,
		purpose: "executor-native-evidence",
		bytes: capture.evidence,
		signal
	}) : void 0;
	const taskOutcome = capture.taskOutcome ? await persistTaskCapture(identity.executionId, expected, capture.taskOutcome, outputArtifacts, signal) : void 0;
	const memoryAfter = capture.memoryAfter ? await persistWorkspaceCapture(identity.executionId, "memory-after-manifest", "memory-after-archive", capture.memoryAfter.afterState, capture.memoryAfter.archive, outputArtifacts, signal) : void 0;
	const bytes = canonicalCandidateBytes$1({
		kind: "agent-candidate-executor-capture",
		executionPlanDigest: identity.executionPlanDigest,
		...executorEvidence ? { executorEvidence } : {},
		...taskOutcome ? { taskOutcome } : {},
		...memoryAfter ? { memoryAfter } : {}
	});
	const evidence = await persistCandidateOutputArtifact(outputArtifacts, {
		executionId: identity.executionId,
		purpose: "executor-capture",
		bytes,
		signal
	});
	return Object.freeze({
		evidence,
		...taskOutcome ? { taskOutcome: Object.freeze(taskOutcome) } : {},
		...memoryAfter ? { memoryAfter: Object.freeze(memoryAfter) } : {}
	});
}
async function persistTaskCapture(executionId, expected, capture, outputArtifacts, signal) {
	if (capture.kind === "output") {
		if (expected.kind !== "output") throw new Error("captured output does not match the signed task");
		const artifact = await persistCandidateOutputArtifact(outputArtifacts, {
			executionId,
			purpose: "task-output",
			bytes: capture.bytes,
			signal
		});
		return {
			kind: "output",
			spec: {
				mediaType: expected.mediaType,
				maxBytes: expected.maxBytes
			},
			artifact
		};
	}
	if (expected.kind !== "workspace") throw new Error("captured workspace does not match the signed task");
	const workspace = await persistWorkspaceCapture(executionId, "task-manifest", "task-archive", capture.afterState, capture.archive, outputArtifacts, signal);
	const gitDiff = await persistCandidateOutputArtifact(outputArtifacts, {
		executionId,
		purpose: "task-patch",
		bytes: capture.gitDiff,
		signal
	});
	return {
		kind: "workspace",
		resultTree: capture.resultTree,
		...workspace,
		gitDiff
	};
}
async function persistWorkspaceCapture(executionId, manifestPurpose, archivePurpose, afterState, archiveBytes, outputArtifacts, signal) {
	const manifestBytes = canonicalCandidateBytes$1(afterState);
	const [manifest, archive] = await Promise.all([persistCandidateOutputArtifact(outputArtifacts, {
		executionId,
		purpose: manifestPurpose,
		bytes: manifestBytes,
		signal
	}), persistCandidateOutputArtifact(outputArtifacts, {
		executionId,
		purpose: archivePurpose,
		bytes: archiveBytes,
		signal
	})]);
	return {
		afterState,
		manifest,
		archive
	};
}
//#endregion
//#region src/candidate-execution/outcome-evidence.ts
/** Persist the closed evaluator model ledger as canonical receipt evidence. */
async function persistCandidateModelSettlement(state, settlement, outputArtifacts) {
	return await persistCandidateModelSettlementEvidence({
		executionId: state.executionId,
		executionPlanDigest: state.executionPlan.value.digest,
		resolvedModel: state.resolvedModel
	}, settlement, outputArtifacts);
}
/** Persist a closed model ledger when only durable recovery identity remains. */
async function persistCandidateModelSettlementEvidence(identity, settlement, outputArtifacts) {
	const material = {
		kind: "agent-candidate-model-settlement-material",
		executionPlanDigest: identity.executionPlanDigest,
		preparationId: settlement.value.preparationId,
		grantDigest: settlement.value.grantDigest,
		closed: true,
		usageWithinLimits: settlement.value.usageWithinLimits,
		resolved: identity.resolvedModel,
		calls: settlement.value.calls.map((call) => ({
			callId: call.callId,
			generationId: call.generationId,
			traceSpanId: call.traceSpanId,
			status: call.status,
			model: call.model,
			startedAtMs: call.startedAtMs,
			endedAtMs: call.endedAtMs,
			inputTokens: call.inputTokens,
			accountedInputTokens: call.accountedInputTokens,
			outputTokens: call.outputTokens,
			cachedInputTokens: call.cachedInputTokens ?? 0,
			reasoningTokens: call.reasoningTokens ?? 0,
			costUsdNanos: call.costUsdNanos,
			costProvenance: call.costProvenance
		})),
		usage: settlement.usage
	};
	const bytes = canonicalCandidateBytes$1(material);
	const digest = sha256Bytes$1(bytes);
	const artifact = await persistCandidateOutputArtifact(outputArtifacts, {
		executionId: identity.executionId,
		purpose: "model-settlement",
		bytes
	});
	return immutableCandidateValue(agentCandidateModelSettlementEvidenceSchema.parse({
		kind: "agent-candidate-model-settlement",
		digest,
		material,
		artifact
	}));
}
/** Verify once, persist the sealed capture once, and bind the resulting task evidence. */
async function persistVerifiedAgentCandidateExecutorCapture(state, capture, outputArtifacts, protectedValues, signal) {
	signal?.throwIfAborted();
	const taskCapture = capture.taskOutcome;
	if (!taskCapture) throw new Error("candidate final capture is missing the task outcome");
	if (capture.evidence) assertNoProtectedBytes(capture.evidence, protectedValues);
	const expected = state.benchmarkTask.outcome;
	if (taskCapture.kind !== expected.kind) throw new Error(`candidate captured ${taskCapture.kind} outcome does not match expected ${expected.kind} outcome`);
	const verified = taskCapture.kind === "output" && expected.kind === "output" ? verifyOutputTaskCapture(taskCapture.bytes, expected, protectedValues) : taskCapture.kind === "workspace" && expected.kind === "workspace" ? await verifyWorkspaceTaskCapture(state, taskCapture, protectedValues, signal) : void 0;
	if (!verified) throw new Error("candidate task outcome kind could not be narrowed");
	await verifyMemoryCapture(state, capture, protectedValues, signal);
	const persistedCapture = await persistAgentCandidateExecutorCapture({
		executionId: state.executionId,
		executionPlanDigest: state.executionPlan.value.digest
	}, expected, capture, outputArtifacts, signal);
	const persisted = persistedCapture.taskOutcome;
	if (!persisted || persisted.kind !== verified.kind) throw new Error("persisted task capture kind changed");
	const taskOutcome = verified.kind === "output" && persisted.kind === "output" ? await persistVerifiedOutputTaskOutcome(state, verified, persisted, outputArtifacts, signal) : verified.kind === "workspace" && persisted.kind === "workspace" ? await persistVerifiedWorkspaceTaskOutcome(state, verified, persisted, outputArtifacts, signal) : void 0;
	if (!taskOutcome) throw new Error("persisted task outcome kind could not be narrowed");
	return Object.freeze({
		persistedCapture,
		taskOutcome
	});
}
async function verifyWorkspaceTaskCapture(state, capture, protectedValues, signal) {
	const repository = state.benchmarkTask.repository;
	if (!repository) throw new Error("workspace task outcome is missing repository identity");
	const patch = Uint8Array.from(capture.gitDiff);
	const archive = Uint8Array.from(capture.archive);
	if (archive.byteLength === 0) throw new Error("candidate task archive cannot be empty");
	assertNoProtectedBytes(patch, protectedValues);
	assertNoProtectedBytes(archive, protectedValues);
	const afterState = immutableCandidateValue(capture.afterState);
	const verified = await verifyTaskOutcomePatch({
		repositoryRoot: state.roots.staging.taskRoot,
		baseCommit: repository.baseCommit,
		baseTree: repository.baseTree,
		resultTree: capture.resultTree,
		patch,
		afterState
	});
	signal?.throwIfAborted();
	const manifestBytes = canonicalCandidateBytes$1(afterState);
	assertNoProtectedBytes(manifestBytes, protectedValues);
	await verifyTaskOutcomeArchive(state, agentCandidateWorkspaceSnapshotEvidenceSchema.parse({
		kind: "agent-candidate-workspace-snapshot",
		digest: sha256Bytes$1(manifestBytes),
		material: afterState,
		manifest: embeddedCandidateArtifact(manifestBytes),
		archive: embeddedCandidateArtifact(archive)
	}), archive, protectedValues);
	signal?.throwIfAborted();
	return {
		kind: "workspace",
		patch,
		archive,
		afterState,
		manifestBytes,
		resultCommit: verified.resultCommit,
		resultTree: verified.resultTree,
		repository
	};
}
async function persistVerifiedWorkspaceTaskOutcome(state, verified, persisted, outputArtifacts, signal) {
	const { afterState, manifestBytes, patch, repository } = verified;
	const snapshot = agentCandidateWorkspaceSnapshotEvidenceSchema.parse({
		kind: "agent-candidate-workspace-snapshot",
		digest: sha256Bytes$1(manifestBytes),
		material: afterState,
		manifest: persisted.manifest,
		archive: persisted.archive
	});
	const evidence = await persistTaskOutcomeEvidence(state, {
		kind: "agent-candidate-task-outcome-material",
		executionPlanDigest: state.executionPlan.value.digest,
		outcome: {
			kind: "workspace",
			baseRepository: {
				identity: repository.identity,
				rootIdentity: repository.rootIdentity,
				commit: repository.baseCommit,
				tree: repository.baseTree
			},
			resultRepository: {
				identity: repository.identity,
				rootIdentity: repository.rootIdentity,
				commit: verified.resultCommit,
				tree: verified.resultTree
			},
			afterState: snapshot,
			gitDiff: {
				format: "git-diff-binary",
				artifact: persisted.gitDiff
			}
		}
	}, outputArtifacts, signal);
	const storedPatch = Uint8Array.from(patch);
	return Object.freeze({
		kind: "workspace",
		evidence,
		get patch() {
			return Uint8Array.from(storedPatch);
		},
		[verifiedTaskOutcomeBrand]: true
	});
}
function verifyOutputTaskCapture(capturedBytes, expected, protectedValues) {
	if (capturedBytes.byteLength === 0) throw new Error("candidate task output cannot be empty");
	if (capturedBytes.byteLength > expected.maxBytes) throw new Error(`candidate task output exceeds the frozen ${expected.maxBytes}-byte maximum`);
	const output = Uint8Array.from(capturedBytes);
	assertNoProtectedBytes(output, protectedValues);
	return {
		kind: "output",
		bytes: output,
		spec: {
			mediaType: expected.mediaType,
			maxBytes: expected.maxBytes
		}
	};
}
async function persistVerifiedOutputTaskOutcome(state, verified, persisted, outputArtifacts, signal) {
	if (persisted.spec.mediaType !== verified.spec.mediaType || persisted.spec.maxBytes !== verified.spec.maxBytes) throw new Error("persisted task output changed the signed media constraints");
	const evidence = await persistTaskOutcomeEvidence(state, {
		kind: "agent-candidate-task-outcome-material",
		executionPlanDigest: state.executionPlan.value.digest,
		outcome: {
			kind: "output",
			spec: verified.spec,
			artifact: persisted.artifact
		}
	}, outputArtifacts, signal);
	const storedOutput = Uint8Array.from(verified.bytes);
	return Object.freeze({
		kind: "output",
		evidence,
		spec: immutableCandidateValue(verified.spec),
		get bytes() {
			return Uint8Array.from(storedOutput);
		},
		[verifiedTaskOutcomeBrand]: true
	});
}
async function persistTaskOutcomeEvidence(state, material, outputArtifacts, signal) {
	const bytes = canonicalCandidateBytes$1(material);
	const digest = sha256Bytes$1(bytes);
	const artifact = await persistCandidateOutputArtifact(outputArtifacts, {
		executionId: state.executionId,
		purpose: "task-outcome",
		bytes,
		signal
	});
	return immutableCandidateValue(agentCandidateTaskOutcomeEvidenceSchema.parse({
		kind: "agent-candidate-task-outcome",
		digest,
		material,
		artifact
	}));
}
/** Grade only a runtime-verified outcome and persist both raw and normalized evidence. */
async function persistCandidateBenchmarkResult(state, termination, outcome, grader, outputArtifacts, protectedValues, signal) {
	signal?.throwIfAborted();
	const frozenTermination = immutableCandidateValue(termination);
	const graded = await runBoundCandidateBenchmarkGrader({
		executionId: state.executionId,
		termination: frozenTermination,
		outcome,
		expectedGrader: state.benchmarkTask.grader,
		grader,
		artifacts: outputArtifacts,
		signal
	});
	signal?.throwIfAborted();
	const evaluation = normalizeEvaluation(graded.evaluation, frozenTermination);
	const rawEvidence = Uint8Array.from(graded.evidence);
	if (rawEvidence.byteLength === 0) throw new Error("candidate benchmark evidence cannot be empty");
	assertNoProtectedBytes(rawEvidence, protectedValues);
	const evidenceRef = await persistCandidateOutputArtifact(outputArtifacts, {
		executionId: state.executionId,
		purpose: "grader-evidence",
		bytes: rawEvidence,
		signal
	});
	const material = {
		kind: "agent-candidate-benchmark-result-material",
		executionPlanDigest: state.executionPlan.value.digest,
		taskOutcomeDigest: outcome.evidence.digest,
		grader: graded.grader,
		evidence: evidenceRef,
		grading: graded.grading,
		score: evaluation.score,
		passed: evaluation.passed,
		dimensions: evaluation.dimensions
	};
	const bytes = canonicalCandidateBytes$1(material);
	const digest = sha256Bytes$1(bytes);
	const artifact = await persistCandidateOutputArtifact(outputArtifacts, {
		executionId: state.executionId,
		purpose: "benchmark-result",
		bytes,
		signal
	});
	return immutableCandidateValue(agentCandidateBenchmarkResultEvidenceSchema.parse({
		kind: "agent-candidate-benchmark-result",
		digest,
		material,
		artifact
	}));
}
async function verifyTaskOutcomeArchive(state, snapshot, archive, protectedValues) {
	const root = await mkdtemp(join(tmpdir(), "agent-candidate-task-archive-"));
	try {
		await state.ports.workspaces.materialize({
			role: "task",
			snapshot,
			archive: Uint8Array.from(archive),
			destination: root
		});
		const files = await readMaterializedWorkspaceFiles(root, snapshot.material);
		for (const file of files) assertNoProtectedBytes(file.bytes, protectedValues);
	} finally {
		await rm(root, {
			recursive: true,
			force: true
		});
	}
}
async function verifyMemoryCapture(state, capture, protectedValues, signal) {
	if (state.memory.mode === "disabled") {
		if (capture.memoryAfter) throw new Error("disabled memory cannot return an after-state");
		return;
	}
	const memory = capture.memoryAfter;
	if (!memory) throw new Error("isolated memory is missing its protected after-state");
	if (memory.archive.byteLength === 0) throw new Error("isolated memory archive cannot be empty");
	const manifestBytes = canonicalCandidateBytes$1(memory.afterState);
	assertNoProtectedBytes(manifestBytes, protectedValues);
	assertNoProtectedBytes(memory.archive, protectedValues);
	const snapshot = agentCandidateWorkspaceSnapshotEvidenceSchema.parse({
		kind: "agent-candidate-workspace-snapshot",
		digest: sha256Bytes$1(manifestBytes),
		material: memory.afterState,
		manifest: embeddedCandidateArtifact(manifestBytes),
		archive: embeddedCandidateArtifact(memory.archive)
	});
	const root = await mkdtemp(join(tmpdir(), "agent-candidate-memory-after-"));
	try {
		await state.ports.workspaces.materialize({
			role: "memory",
			snapshot,
			archive: Uint8Array.from(memory.archive),
			destination: root
		});
		const files = await readMaterializedWorkspaceFiles(root, memory.afterState);
		for (const file of files) assertNoProtectedBytes(file.bytes, protectedValues);
		signal?.throwIfAborted();
	} finally {
		await rm(root, {
			recursive: true,
			force: true
		});
	}
}
function normalizeEvaluation(evaluation, termination) {
	if (!evaluation || typeof evaluation !== "object" || Array.isArray(evaluation)) throw new Error("candidate benchmark evaluation must be an object");
	assertUnitScore(evaluation.score, "candidate benchmark score");
	if (evaluation.passed !== void 0 && typeof evaluation.passed !== "boolean") throw new Error("candidate benchmark passed must be boolean");
	const cleanExit = termination.kind === "exit" && termination.exitCode === 0;
	const dimensions = Object.entries(evaluation.dimensions ?? {}).map(([name, score]) => {
		if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(name)) throw new Error(`candidate benchmark dimension is not normalized: ${name}`);
		assertUnitScore(score, `candidate benchmark dimension ${name}`);
		return {
			name,
			score: cleanExit ? score : 0
		};
	}).sort((left, right) => left.name.localeCompare(right.name));
	return {
		score: cleanExit ? evaluation.score : 0,
		passed: cleanExit && (evaluation.passed ?? evaluation.score > 0),
		dimensions
	};
}
function assertUnitScore(value, label) {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be finite and within [0, 1]`);
}
//#endregion
//#region src/candidate-execution/protected-trace-store.ts
/** Keep the identity key in evaluator-owned closures and expose only the redacting store to code. */
function createProtectedAgentCandidateTraceAccess(inner, protectedValues) {
	const redactor = createProtectedRecordRedactor(protectedValues);
	const pendingWrites = /* @__PURE__ */ new Set();
	let acceptsWrites = true;
	const write = (operation) => {
		if (!acceptsWrites) return Promise.reject(/* @__PURE__ */ new Error("candidate trace writes are closed"));
		let started;
		try {
			started = operation();
		} catch (error) {
			return Promise.reject(error);
		}
		let tracked;
		tracked = started.finally(() => pendingWrites.delete(tracked));
		pendingWrites.add(tracked);
		return tracked;
	};
	const store = Object.freeze({
		appendRun: (run) => write(() => inner.appendRun(redactor.record(run))),
		updateRun: (runId, patch) => write(() => inner.updateRun(redactor.identifier(runId), redactor.record(patch))),
		appendSpan: (span) => write(async () => {
			if (span.kind === "llm") throw new Error("candidate executors cannot author protected model spans");
			await inner.appendSpan(redactor.record(span));
		}),
		updateSpan: (spanId, patch) => write(async () => {
			if (patch.kind === "llm") throw new Error("candidate executors cannot author protected model spans");
			await inner.updateSpan(redactor.identifier(spanId), redactor.record(patch));
		}),
		appendEvent: (event) => write(() => inner.appendEvent(redactor.record(event))),
		appendArtifact: (artifact) => write(() => inner.appendArtifact(redactor.record(artifact))),
		appendBudgetEntry: (entry) => write(() => inner.appendBudgetEntry(redactor.record(entry))),
		getRun: async (runId) => inner.getRun(redactor.identifier(runId)),
		listRuns: async (filter) => inner.listRuns(filter ? redactor.query(filter) : void 0),
		spans: async (filter) => inner.spans(filter ? redactor.query(filter) : void 0),
		events: async (filter) => inner.events(filter ? redactor.query(filter) : void 0),
		budget: async (runId) => inner.budget(redactor.identifier(runId)),
		artifacts: async (runId) => inner.artifacts(redactor.identifier(runId))
	});
	return Object.freeze({
		store,
		closeWrites: async () => {
			acceptsWrites = false;
			await Promise.all([...pendingWrites]);
		},
		identity: (trace) => redactor.traceIdentity(trace),
		report: () => redactor.report()
	});
}
/** Recovery can read existing trace state but must never accept new unredactable writes. */
var RecoveryAgentCandidateTraceStore = class {
	inner;
	constructor(inner) {
		this.inner = inner;
	}
	appendRun() {
		return this.rejectWrite();
	}
	updateRun() {
		return this.rejectWrite();
	}
	appendSpan() {
		return this.rejectWrite();
	}
	updateSpan() {
		return this.rejectWrite();
	}
	appendEvent() {
		return this.rejectWrite();
	}
	appendArtifact() {
		return this.rejectWrite();
	}
	appendBudgetEntry() {
		return this.rejectWrite();
	}
	getRun(...args) {
		return this.inner.getRun(...args);
	}
	listRuns(...args) {
		return this.inner.listRuns(...args);
	}
	spans(...args) {
		return this.inner.spans(...args);
	}
	events(...args) {
		return this.inner.events(...args);
	}
	budget(...args) {
		return this.inner.budget(...args);
	}
	artifacts(...args) {
		return this.inner.artifacts(...args);
	}
	rejectWrite() {
		return Promise.reject(/* @__PURE__ */ new Error("expired candidate recovery cannot append trace evidence"));
	}
};
//#endregion
//#region src/candidate-execution/execute.ts
/** Executes and finalizes one durably claimed candidate without exposing an unproven result. */
async function executePreparedAgentCandidate(prepared, options) {
	const initialState = assertPreparedCandidateIntegrity(prepared);
	const cleanupTimeoutMs = candidateCleanupTimeout(options.cleanupTimeoutMs ?? initialState.cleanupTimeoutMs);
	if (cleanupTimeoutMs > initialState.cleanupTimeoutMs) throw new Error("execution cleanup timeout exceeds the frozen preparation bound");
	const resultTimeoutMs = candidateResultTimeout(options.resultTimeoutMs ?? initialState.resultTimeoutMs, initialState.resultTimeoutMs);
	if (resultTimeoutMs > initialState.resultTimeoutMs) throw new Error("execution result timeout exceeds the frozen preparation bound");
	let state;
	try {
		state = beginPreparedCandidateClaim(prepared);
	} catch (error) {
		return failedAgentCandidateRun(initialState, errorMessage$1(error));
	}
	try {
		await assertPreparedCandidateWorkspaces(state);
	} catch (error) {
		return await failBeforeActivation(prepared, state, error, "failed", cleanupTimeoutMs);
	}
	let preparationEvidence;
	try {
		const [executionPlan, materializationReceipt] = await Promise.all([persistCandidateOutputArtifact(options.outputArtifacts, {
			executionId: state.executionId,
			purpose: "execution-plan",
			bytes: state.executionPlan.bytes
		}), persistCandidateOutputArtifact(options.outputArtifacts, {
			executionId: state.executionId,
			purpose: "materialization-receipt",
			bytes: state.materializationReceipt.bytes
		})]);
		preparationEvidence = Object.freeze({
			executionPlan,
			materializationReceipt
		});
	} catch (error) {
		return await failBeforeActivation(prepared, state, error, "failed", cleanupTimeoutMs);
	}
	let acquired;
	try {
		acquired = await options.claimStore.tryClaim(candidateExecutionClaim(prepared, preparationEvidence));
	} catch (error) {
		return await failBeforeActivation(prepared, state, error, "failed", cleanupTimeoutMs);
	}
	if (!acquired.acquired) return await failBeforeActivation(prepared, state, /* @__PURE__ */ new Error(acquired.reason === "retry-not-eligible" ? `candidate execution retry is not eligible: ${acquired.detail}` : "candidate execution attempt is already claimed"), "replayed", cleanupTimeoutMs);
	markPreparedCandidateClaimed(prepared);
	const postRunWindowMs = candidatePostRunWindowMs(cleanupTimeoutMs, resultTimeoutMs);
	const deadlineAtMs = acquired.claim.leaseExpiresAtMs - candidatePostRunWindowMs(state.cleanupTimeoutMs, state.resultTimeoutMs);
	const requiredLeaseExpiry = deadlineAtMs + postRunWindowMs;
	if (Date.now() >= deadlineAtMs || deadlineAtMs > state.reservationExpiresAtMs || requiredLeaseExpiry > acquired.lease.expiresAtMs) return await failClaimedExecution(prepared, state, acquired.lease, options.claimStore, options.outputArtifacts, /* @__PURE__ */ new Error("candidate claim no longer covers its full execution and cleanup window"), "failed", cleanupTimeoutMs, "pre-model-infrastructure");
	let activation;
	try {
		const activated = await withinCandidateCleanupDeadline(() => state.ports.models.activateGrant({
			executionId: state.executionId,
			preparationId: state.preparationId,
			grantDigest: state.modelReservation.digest,
			resolved: state.resolvedModel,
			deadlineAtMs
		}), Math.min(deadlineAtMs, candidateCleanupDeadline(cleanupTimeoutMs)), "protected model activation");
		activation = Object.freeze({ env: Object.freeze({ ...activated.env }) });
	} catch (error) {
		return await failClaimedExecution(prepared, state, acquired.lease, options.claimStore, options.outputArtifacts, new Error("protected model activation failed", { cause: error }), "failed", cleanupTimeoutMs, "pre-model-infrastructure");
	}
	let memoryActivation;
	if (state.memory.mode === "isolated") try {
		const reservation = state.memoryReservation;
		if (!reservation) throw new Error("isolated memory reservation is missing");
		const activated = await withinCandidateCleanupDeadline(() => state.ports.memory.activate({
			executionId: state.executionId,
			preparationId: reservation.preparationId,
			accessDigest: reservation.accessDigest,
			effectiveNamespace: reservation.effectiveNamespace,
			deadlineAtMs
		}), Math.min(deadlineAtMs, candidateCleanupDeadline(cleanupTimeoutMs)), "isolated memory activation");
		memoryActivation = Object.freeze({ env: Object.freeze({ ...activated.env }) });
	} catch (error) {
		return await failClaimedExecution(prepared, state, acquired.lease, options.claimStore, options.outputArtifacts, new Error("isolated memory activation failed", { cause: error }), "failed", cleanupTimeoutMs, "pre-model-infrastructure", activation);
	}
	let request;
	try {
		request = beginPreparedCandidateRun(prepared, activation, memoryActivation).request;
	} catch (error) {
		return await failClaimedExecution(prepared, state, acquired.lease, options.claimStore, options.outputArtifacts, error, "failed", cleanupTimeoutMs, "pre-model-infrastructure", activation, memoryActivation);
	}
	try {
		if ((await options.claimStore.markCandidateMayRun(acquired.lease)).phase !== "candidate-may-run") throw new Error("candidate claim did not persist the candidate-may-run phase");
	} catch (error) {
		return await failClaimedExecution(prepared, state, acquired.lease, options.claimStore, options.outputArtifacts, new Error("candidate execution phase persistence failed", { cause: error }), "failed", cleanupTimeoutMs, "pre-model-infrastructure", activation, memoryActivation);
	}
	if (Date.now() >= deadlineAtMs) return await failClaimedExecution(prepared, state, acquired.lease, options.claimStore, options.outputArtifacts, /* @__PURE__ */ new Error("candidate execution deadline elapsed while persisting its launch phase"), "failed", cleanupTimeoutMs, "unknown", activation, memoryActivation);
	const protectedValues = protectedEnvironmentValues(activation, memoryActivation);
	const protectedTrace = createProtectedAgentCandidateTraceAccess(options.traceStore, protectedValues);
	const persistedTrace = protectedTrace.identity(state.trace);
	const execution = await runAndStopExecutor(options.executor, request, state.benchmarkTask.outcome, protectedTrace.store, deadlineAtMs, cleanupTimeoutMs);
	beginPreparedCandidateSettlement(prepared);
	const cleanupDeadlineAtMs = candidateCleanupDeadline(cleanupTimeoutMs);
	const accessReason = execution.kind === "timeout" || execution.termination?.kind === "timeout" ? "timeout" : execution.kind === "capture" ? "completed" : "failed";
	const traceClosure = withinCandidateCleanupDeadline(() => protectedTrace.closeWrites(), cleanupDeadlineAtMs, "candidate trace write closure").then(() => ({
		closed: true,
		error: void 0
	}), (error) => ({
		closed: false,
		error
	}));
	const [traceClose, memoryClose, settlementResult] = await Promise.all([
		traceClosure,
		closeMemoryAccess(state, accessReason, cleanupDeadlineAtMs),
		settleModelGrant(state, accessReason, cleanupDeadlineAtMs)
	]);
	if (!execution.processStopped || !traceClose.closed || !settlementResult.settlement || !memoryClose.closed) {
		consumePreparedCandidateExecution(prepared, "failed");
		return failedAgentCandidateRun(state, redactProtectedReason(joinErrors(execution.error, !execution.processStopped ? /* @__PURE__ */ new Error("candidate process termination is not proven") : void 0, traceClose.error, memoryClose.error, settlementResult.error ?? (!settlementResult.settlement ? /* @__PURE__ */ new Error("model settlement failed") : void 0), /* @__PURE__ */ new Error("candidate claim remains recoverable until protected cleanup is proven")), protectedValues), execution.termination, settlementResult.settlement?.usage ?? null);
	}
	let modelSettlement;
	try {
		modelSettlement = await withinCandidateCleanupDeadline(() => persistCandidateModelSettlement(state, settlementResult.settlement, options.outputArtifacts), candidateCleanupDeadline(cleanupTimeoutMs), "candidate model settlement persistence");
	} catch (error) {
		consumePreparedCandidateExecution(prepared, "failed");
		return failedAgentCandidateRun(state, redactProtectedReason(joinErrors(error, /* @__PURE__ */ new Error("candidate claim remains recoverable until settlement evidence is durable")), protectedValues), execution.termination, settlementResult.settlement.usage);
	}
	let result;
	const failureClass = execution.kind === "error" ? "execution" : "post-model-infrastructure";
	if (execution.kind === "error") result = failedAgentCandidateRun(state, redactProtectedReason(errorMessage$1(execution.error), protectedValues), execution.termination, settlementResult.settlement.usage);
	else if (!execution.finalCapture.taskOutcome) result = failedAgentCandidateRun(state, "candidate executor stopped without a captured task outcome", execution.termination, settlementResult.settlement.usage);
	else {
		const capture = execution.kind === "capture" ? execution.capture : {
			executionId: state.executionId,
			termination: execution.termination
		};
		try {
			result = await withinCandidateResultDeadline(async (signal) => {
				await appendAuthoritativeModelSettlementSpans(options.traceStore, persistedTrace.runId, settlementResult.settlement);
				const { persistedCapture, taskOutcome } = await persistVerifiedAgentCandidateExecutorCapture(state, execution.finalCapture, options.outputArtifacts, protectedValues, signal);
				const benchmarkResult = await persistCandidateBenchmarkResult(state, capture.termination, taskOutcome, options.grader, options.outputArtifacts, protectedValues, signal);
				return await finalizeAgentCandidateRun(state, capture, options.traceStore, persistedTrace, settlementResult.settlement, {
					finalCapture: execution.finalCapture,
					persistedCapture,
					modelSettlement,
					taskOutcome,
					benchmarkResult,
					outputArtifacts: options.outputArtifacts
				}, protectedValues, protectedTrace.report(), signal);
			}, Math.min(Date.now() + resultTimeoutMs, acquired.lease.expiresAtMs - candidateTerminalWindowMs(cleanupTimeoutMs)), "candidate evidence finalization");
		} catch (error) {
			result = failedAgentCandidateRun(state, redactProtectedReason(errorMessage$1(error), protectedValues), execution.termination, settlementResult.settlement.usage);
		}
	}
	let terminal;
	try {
		terminal = result.succeeded ? {
			status: "succeeded",
			usage: settlementResult.settlement.usage,
			modelSettlement: result.artifacts.modelSettlement,
			taskOutcome: result.artifacts.taskOutcome,
			benchmarkResult: result.artifacts.benchmarkResult,
			runReceipt: result.artifacts.runReceipt
		} : {
			status: "failed",
			failureClass,
			usage: settlementResult.settlement.usage,
			modelSettlement: modelSettlement.artifact,
			failureEvidence: await withinCandidateCleanupDeadline(() => persistFailureEvidence(state, result.reason, failureClass, execution.termination, options.outputArtifacts), acquired.lease.expiresAtMs, "candidate failure-evidence persistence")
		};
	} catch (error) {
		consumePreparedCandidateExecution(prepared, "failed");
		return failedAgentCandidateRun(state, redactProtectedReason(joinErrors(error, /* @__PURE__ */ new Error("candidate claim remains recoverable until terminal evidence is durable")), protectedValues), execution.termination, settlementResult.settlement.usage);
	}
	if (await finishClaim(options.claimStore, acquired.lease, terminal, acquired.lease.expiresAtMs)) {
		consumePreparedCandidateExecution(prepared, result.succeeded ? "succeeded" : "failed");
		return result;
	}
	consumePreparedCandidateExecution(prepared, "failed");
	return failedAgentCandidateRun(state, "candidate execution terminal record could not be persisted", execution.termination, settlementResult.settlement.usage);
}
async function runAndStopExecutor(executor, request, expectedOutcome, traceStore, deadlineAtMs, cleanupTimeoutMs) {
	const timeoutMs = request.hardLimits.timeoutMs;
	const timeoutError = new CandidateExecutionDeadlineError(timeoutMs);
	if (Date.now() >= deadlineAtMs) return {
		kind: "error",
		error: timeoutError,
		termination: {
			kind: "timeout",
			timeoutMs
		},
		processStopped: true
	};
	const controller = new AbortController();
	let timer;
	let timedOut = false;
	let capture;
	let executionError;
	const executionPromise = Promise.resolve().then(() => executor.execute(request, {
		traceStore,
		signal: controller.signal,
		deadlineAtMs
	}));
	executionPromise.catch(() => void 0);
	const deadlinePromise = new Promise((_resolve, reject) => {
		timer = setTimeout(() => {
			timedOut = true;
			controller.abort(timeoutError);
			reject(timeoutError);
		}, Math.max(0, deadlineAtMs - Date.now()));
	});
	deadlinePromise.catch(() => void 0);
	try {
		capture = sealAgentCandidateProtectedRunCapture(await Promise.race([executionPromise, deadlinePromise]));
	} catch (error) {
		executionError = error;
	}
	if (!timedOut && capture && capture.executionId !== request.executionId) {
		executionError = /* @__PURE__ */ new Error("candidate execution capture id does not match the request");
		capture = void 0;
	} else if (!timedOut && capture && Date.now() >= deadlineAtMs) {
		timedOut = true;
		executionError = timeoutError;
		capture = void 0;
	} else if (!timedOut && capture?.termination.kind === "timeout") {
		executionError = /* @__PURE__ */ new Error("candidate executor cannot declare the runtime-owned timeout");
		capture = void 0;
	}
	if (!capture || timedOut) controller.abort(executionError);
	const stopReason = timedOut ? "timeout" : capture ? "completed" : "failed";
	const cleanupDeadlineAtMs = Date.now() + cleanupTimeoutMs;
	try {
		sealAgentCandidateExecutorStopAcknowledgement(await withinCandidateCleanupDeadline((cleanupSignal) => executor.stop({
			executionId: request.executionId,
			executionPlanDigest: request.executionPlan.value.digest
		}, {
			traceStore,
			reason: stopReason,
			signal: cleanupSignal,
			deadlineAtMs: cleanupDeadlineAtMs
		}), cleanupDeadlineAtMs, "candidate process termination"));
	} catch (stopError) {
		let disposalError;
		try {
			await disposeExecutor(executor, request, cleanupDeadlineAtMs);
		} catch (error) {
			disposalError = error;
		}
		if (timer) clearTimeout(timer);
		controller.abort(stopError);
		return {
			kind: "error",
			error: new Error(joinErrors(executionError, stopError, disposalError)),
			...timedOut ? { termination: {
				kind: "timeout",
				timeoutMs
			} } : {},
			processStopped: false
		};
	}
	let finalCapture;
	let finalCaptureError;
	try {
		finalCapture = sealAgentCandidateExecutorFinalCapture(await withinCandidateCleanupDeadline((cleanupSignal) => executor.capture({
			executionId: request.executionId,
			executionPlanDigest: request.executionPlan.value.digest
		}, {
			traceStore,
			signal: cleanupSignal
		}), cleanupDeadlineAtMs, "candidate final evidence capture"), expectedOutcome);
	} catch (captureError) {
		finalCaptureError = captureError;
	}
	let disposalError;
	try {
		await disposeExecutor(executor, request, cleanupDeadlineAtMs);
	} catch (disposeError) {
		disposalError = disposeError;
	}
	if (finalCaptureError || disposalError || !finalCapture) {
		if (timer) clearTimeout(timer);
		controller.abort(finalCaptureError ?? disposalError);
		return {
			kind: "error",
			error: new Error(joinErrors(executionError, finalCaptureError, disposalError)),
			...timedOut ? { termination: {
				kind: "timeout",
				timeoutMs
			} } : {},
			processStopped: true
		};
	}
	if (Date.now() >= deadlineAtMs) {
		timedOut = true;
		executionError = timeoutError;
		capture = void 0;
		controller.abort(timeoutError);
	}
	if (timer) clearTimeout(timer);
	if (timedOut) return {
		kind: "timeout",
		termination: {
			kind: "timeout",
			timeoutMs
		},
		finalCapture,
		processStopped: true
	};
	if (executionError || !capture) return {
		kind: "error",
		error: executionError ?? /* @__PURE__ */ new Error("candidate executor returned no capture"),
		finalCapture,
		processStopped: true
	};
	return {
		kind: "capture",
		capture,
		termination: capture.termination,
		finalCapture,
		processStopped: true
	};
}
async function disposeExecutor(executor, request, cleanupDeadlineAtMs) {
	const dispose = executor.dispose;
	if (!dispose) return;
	const disposed = await withinCandidateCleanupDeadline((cleanupSignal) => dispose.call(executor, {
		executionId: request.executionId,
		executionPlanDigest: request.executionPlan.value.digest
	}, { signal: cleanupSignal }), cleanupDeadlineAtMs, "candidate execution resource disposal");
	if (disposed?.disposed !== true || Object.keys(disposed).some((key) => key !== "disposed")) throw new Error("candidate executor did not acknowledge resource disposal");
}
async function failBeforeActivation(prepared, state, error, reason, cleanupTimeoutMs) {
	beginPreparedCandidateSettlement(prepared);
	const cleanupDeadlineAtMs = candidateCleanupDeadline(cleanupTimeoutMs);
	const [memoryClose, settled] = await Promise.all([closeMemoryAccess(state, reason, cleanupDeadlineAtMs), settleModelGrant(state, reason, cleanupDeadlineAtMs)]);
	const cleanupProven = memoryClose.closed && settled.settlement !== void 0;
	consumePreparedCandidateExecution(prepared, cleanupProven ? "failed" : "cleanup-failed");
	return failedAgentCandidateRun(state, redactProtectedReason(joinErrors(error, memoryClose.error, settled.error, !cleanupProven ? /* @__PURE__ */ new Error("prepared access cleanup remains incomplete and may be retried by disposal") : void 0), []), void 0, settled.settlement?.usage ?? null);
}
async function failClaimedExecution(prepared, state, lease, claimStore, outputArtifacts, error, reason, cleanupTimeoutMs, failureClass, activation, memoryActivation) {
	beginPreparedCandidateSettlement(prepared);
	const cleanupDeadlineAtMs = candidateCleanupDeadline(cleanupTimeoutMs);
	const [memoryClose, settled] = await Promise.all([closeMemoryAccess(state, reason, cleanupDeadlineAtMs), settleModelGrant(state, reason, cleanupDeadlineAtMs)]);
	const protectedValues = protectedEnvironmentValues(activation, memoryActivation);
	const safeReason = redactProtectedReason(joinErrors(error, memoryClose.error, settled.error), protectedValues);
	let finishFailed = false;
	let persistenceFailure;
	if (settled.settlement && memoryClose.closed) try {
		const modelSettlement = await withinCandidateCleanupDeadline(() => persistCandidateModelSettlement(state, settled.settlement, outputArtifacts), lease.expiresAtMs, "candidate pre-run model-settlement persistence");
		const failureEvidence = await withinCandidateCleanupDeadline(() => persistFailureEvidence(state, safeReason, failureClass, void 0, outputArtifacts), lease.expiresAtMs, "candidate pre-run failure-evidence persistence");
		finishFailed = !await finishClaim(claimStore, lease, {
			status: "failed",
			failureClass,
			usage: settled.settlement.usage,
			modelSettlement: modelSettlement.artifact,
			failureEvidence
		}, lease.expiresAtMs);
	} catch (persistenceError) {
		finishFailed = true;
		persistenceFailure = persistenceError;
	}
	consumePreparedCandidateExecution(prepared, "failed");
	return failedAgentCandidateRun(state, redactProtectedReason(joinErrors(safeReason, persistenceFailure, memoryClose.error, settled.error, !memoryClose.closed || !settled.settlement ? /* @__PURE__ */ new Error("candidate claim remains recoverable until protected cleanup is proven") : void 0, finishFailed ? /* @__PURE__ */ new Error("candidate execution terminal record could not be persisted") : void 0), protectedValues), void 0, settled.settlement?.usage ?? null);
}
async function closeMemoryAccess(state, reason, cleanupDeadlineAtMs) {
	if (state.memory.mode === "disabled") return { closed: true };
	try {
		const reservation = state.memoryReservation;
		if (!reservation) throw new Error("isolated memory reservation is missing");
		const closed = await withinCandidateCleanupDeadline(() => state.ports.memory.close({
			executionId: state.executionId,
			preparationId: reservation.preparationId,
			accessDigest: reservation.accessDigest,
			effectiveNamespace: reservation.effectiveNamespace,
			reason
		}), cleanupDeadlineAtMs, "isolated memory closure");
		if (closed.closed !== true || Object.keys(closed).some((key) => key !== "closed")) throw new Error("isolated memory access did not acknowledge closure");
		return { closed: true };
	} catch (error) {
		return {
			closed: false,
			error
		};
	}
}
async function settleModelGrant(state, reason, cleanupDeadlineAtMs) {
	try {
		return { settlement: sealAgentCandidateModelSettlement(await withinCandidateCleanupDeadline(() => state.ports.models.settleGrant({
			executionId: state.executionId,
			preparationId: state.preparationId,
			grantDigest: state.modelReservation.digest,
			resolved: state.resolvedModel,
			reason
		}), cleanupDeadlineAtMs, "protected model settlement"), {
			preparationId: state.preparationId,
			grantDigest: state.modelReservation.digest,
			model: state.resolvedModel.model
		}) };
	} catch (error) {
		return { error: new Error("protected model settlement failed", { cause: error }) };
	}
}
async function finishClaim(store, lease, terminal, deadlineAtMs) {
	try {
		const staged = await withinCandidateCleanupDeadline(() => store.stageTerminal(lease, terminal), deadlineAtMs ?? lease.expiresAtMs, "candidate terminal staging");
		if (!staged.staged && !staged.exactReplay) return false;
		const result = await withinCandidateCleanupDeadline(() => store.finish(lease, staged.terminal.terminalDigest), deadlineAtMs ?? lease.expiresAtMs, "candidate terminal publication");
		return result.finished || result.exactReplay;
	} catch {
		return false;
	}
}
async function persistFailureEvidence(state, reason, failureClass, termination, outputArtifacts) {
	const bytes = canonicalCandidateBytes$1({
		kind: "agent-candidate-execution-failure",
		executionId: state.executionId,
		bundleDigest: state.bundle.digest,
		executionPlanDigest: state.executionPlan.value.digest,
		failureClass,
		reason,
		...termination ? { termination } : {}
	});
	return await persistCandidateOutputArtifact(outputArtifacts, {
		executionId: state.executionId,
		purpose: "failure-evidence",
		bytes
	});
}
function protectedEnvironmentValues(activation, memoryActivation) {
	return [...Object.values(activation?.env ?? {}), ...Object.values(memoryActivation?.env ?? {})];
}
function joinErrors(...errors) {
	return errors.filter((error) => error !== void 0).map(errorMessage$1).join("; ");
}
function errorMessage$1(error) {
	return error instanceof Error ? error.message : String(error);
}
var CandidateExecutionDeadlineError = class extends Error {
	constructor(timeoutMs) {
		super(`candidate execution reached its frozen ${timeoutMs}ms deadline`);
		this.name = "CandidateExecutionDeadlineError";
	}
};
//#endregion
//#region src/candidate-execution/verify.ts
const verifiedCandidateState = /* @__PURE__ */ new WeakMap();
/** Surfaces admitted by Runtime's verifier before an environment adapter is selected. */
const AGENT_CANDIDATE_EXECUTION_SUPPORT = Object.freeze({
	outcomes: Object.freeze(["workspace", "output"]),
	code: Object.freeze([
		"disabled",
		"no-op",
		"git-patch"
	]),
	memory: Object.freeze(["disabled", "isolated"]),
	knowledge: true,
	profile: Object.freeze({
		mcpTransports: Object.freeze(["stdio"]),
		remoteMcp: false,
		tools: false,
		permissions: false,
		modes: false,
		confidential: false
	})
});
/** Verifies every digest, resource, workspace, and Git object in a candidate bundle. */
async function verifyAgentCandidateBundle(input, ports) {
	const parsed = agentCandidateBundleSchema.parse(input);
	const withoutDigest = omitTopLevelDigest(parsed);
	const actualDigest = canonicalCandidateDigest$1(withoutDigest);
	if (actualDigest !== parsed.digest) throw new Error(`candidate bundle digest ${parsed.digest} does not match ${actualDigest}`);
	const canonicalBytes = canonicalCandidateBytes$1(withoutDigest);
	verifyBytes(canonicalBytes, parsed.digest, canonicalBytes.byteLength, "candidate bundle");
	assertCandidateProfileExecutionSupport(parsed.profile);
	const artifactBytes = /* @__PURE__ */ new Map();
	const readArtifact = async (artifact) => {
		const key = artifactCacheKey(artifact);
		const existing = artifactBytes.get(key);
		if (existing) return Uint8Array.from(existing);
		const bytes = await readVerifiedArtifact(artifact, ports.artifacts);
		artifactBytes.set(key, Uint8Array.from(bytes));
		return bytes;
	};
	let patchBytes;
	if (parsed.code.kind === "git-patch") patchBytes = await readArtifact(parsed.code.patch.artifact);
	const materializedTree = await verifyCandidateCode(parsed.code, ports.repositories, patchBytes);
	const resourceBytes = /* @__PURE__ */ new Map();
	for (const resource of candidateResources(parsed)) {
		const bytes = resource.kind === "inline" ? Buffer.from(resource.content, "utf8") : await readCandidateGitHubResource(resource, ports.repositories);
		verifyBytes(bytes, resource.sha256, resource.byteLength, `candidate resource ${resource.name ?? (resource.kind === "github" ? resource.path : "<unnamed>")}`);
		resourceBytes.set(resourceKey(resource), Uint8Array.from(bytes));
		resourceBytes.set(resource.sha256, Uint8Array.from(bytes));
	}
	if (parsed.execution.workspace) {
		const workspace = await verifyWorkspaceSnapshotArtifacts(parsed.execution.workspace, ports.artifacts);
		artifactBytes.set(artifactCacheKey(parsed.execution.workspace.manifest), workspace.manifest);
		artifactBytes.set(artifactCacheKey(parsed.execution.workspace.archive), workspace.archive);
	}
	if (parsed.knowledge) {
		const knowledge = await verifyWorkspaceSnapshotArtifacts(parsed.knowledge.snapshot, ports.artifacts);
		artifactBytes.set(artifactCacheKey(parsed.knowledge.snapshot.manifest), knowledge.manifest);
		artifactBytes.set(artifactCacheKey(parsed.knowledge.snapshot.archive), knowledge.archive);
		if (parsed.knowledge.retrievalConfig) await readArtifact(parsed.knowledge.retrievalConfig);
		await readArtifact(parsed.knowledge.evaluation);
	}
	if (parsed.memory.mode === "isolated" && parsed.memory.seed) await readArtifact(parsed.memory.seed);
	deepFreezeCandidate(parsed);
	const verified = Object.freeze({
		bundle: parsed,
		...materializedTree === void 0 ? {} : { materializedTree },
		[verifiedCandidateBrand]: true
	});
	verifiedCandidateState.set(verified, {
		ports,
		artifactBytes,
		resourceBytes
	});
	return verified;
}
function getVerifiedCandidateState(candidate) {
	const state = verifiedCandidateState.get(candidate);
	if (!state || candidate[verifiedCandidateBrand] !== true) throw new Error("candidate must come from verifyAgentCandidateBundle");
	return state;
}
async function verifiedArtifactBytes(candidate, artifact) {
	const state = getVerifiedCandidateState(candidate);
	const key = artifactCacheKey(artifact);
	const existing = state.artifactBytes.get(key);
	if (existing) return Uint8Array.from(existing);
	const bytes = await readVerifiedArtifact(artifact, state.ports.artifacts);
	state.artifactBytes.set(key, Uint8Array.from(bytes));
	return bytes;
}
function verifiedResourceTextByDigest(candidate) {
	const output = /* @__PURE__ */ new Map();
	for (const resource of candidateResources(candidate.bundle)) {
		const bytes = getVerifiedCandidateState(candidate).resourceBytes.get(resource.sha256);
		if (!bytes) throw new Error(`candidate resource digest was not verified: ${resource.sha256}`);
		output.set(resource.sha256, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	}
	return output;
}
function candidateResources(bundle) {
	const resources = bundle.profile.resources;
	if (!resources) return [];
	const output = [];
	for (const mount of resources.files ?? []) output.push(mount.resource);
	output.push(...resources.tools ?? []);
	output.push(...resources.skills ?? []);
	output.push(...resources.agents ?? []);
	output.push(...resources.commands ?? []);
	if (typeof resources.instructions === "object") output.push(resources.instructions);
	return output;
}
function resourceKey(resource) {
	return canonicalCandidateDigest$1(resource);
}
//#endregion
//#region src/candidate-execution/knowledge.ts
/** Environment variable containing the materialized candidate knowledge root. */
const CANDIDATE_KNOWLEDGE_ROOT_ENV = "TANGLE_CANDIDATE_KNOWLEDGE_ROOT";
/** Environment variable containing the materialized retrieval configuration path. */
const CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV = "TANGLE_CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG";
/** Deterministic, signed locations used by every candidate executor. */
function candidateKnowledgeExecutionPaths(taskRoot, hasRetrievalConfig) {
	if (!posix.isAbsolute(taskRoot) || posix.normalize(taskRoot) !== taskRoot) throw new Error("candidate knowledge requires a normalized absolute task root");
	const parent = posix.join(taskRoot, ".tangle");
	return {
		root: posix.join(parent, "knowledge"),
		...hasRetrievalConfig ? { retrievalConfig: posix.join(parent, "knowledge-retrieval-config.json") } : {}
	};
}
/** Verify and detach the exact file-backed knowledge admitted by the bundle. */
async function prepareAgentCandidateKnowledge(candidate, ports, arm) {
	const knowledge = candidate.bundle.knowledge;
	if (!knowledge) return void 0;
	const archive = await verifiedArtifactBytes(candidate, knowledge.snapshot.archive);
	const retrievalConfig = knowledge.retrievalConfig ? await verifiedArtifactBytes(candidate, knowledge.retrievalConfig) : void 0;
	const root = await mkdtemp(join(tmpdir(), "agent-candidate-knowledge-"));
	try {
		await ports.workspaces.materialize({
			role: "knowledge",
			snapshot: knowledge.snapshot,
			archive,
			destination: root
		});
		const expectedHash = arm === "baseline" ? knowledge.candidate.baseHash : knowledge.candidate.candidateHash;
		const actualHash = `sha256:${await hashKnowledgeBase(root, knowledge.stateScope)}`;
		if (actualHash !== expectedHash) throw new Error(`materialized ${arm} knowledge does not match its measured content: expected ${expectedHash}, got ${actualHash}`);
		const files = await readMaterializedWorkspaceFiles(root, knowledge.snapshot.material);
		return Object.freeze({
			candidate: knowledge.candidate,
			...knowledge.stateScope ? { stateScope: Object.freeze({ ...knowledge.stateScope }) } : {},
			snapshot: knowledge.snapshot,
			files: Object.freeze(files.map((file) => Object.freeze({
				path: file.path,
				mode: file.mode,
				bytes: Uint8Array.from(file.bytes)
			}))),
			...retrievalConfig ? { retrievalConfig: Uint8Array.from(retrievalConfig) } : {}
		});
	} finally {
		await rm(root, {
			recursive: true,
			force: true
		});
	}
}
//#endregion
//#region src/candidate-execution/prepare.ts
const MIN_RESERVATION_TTL_MS = 15 * 6e4;
const PREPARED_HOLD_MARGIN_MS = 5 * 6e4;
/** Materializes a verified candidate into one immutable evaluator-owned execution plan. */
async function prepareAgentCandidateExecution(candidate, task, ports, options = {}) {
	const cleanupTimeoutMs = candidateCleanupTimeout(options.cleanupTimeoutMs);
	assertSameVerificationPorts(getVerifiedCandidateState(candidate).ports, ports);
	const bundle = candidate.bundle;
	if (task.runCell.bundleDigest !== bundle.digest) throw new Error("candidate experiment cell does not bind the verified bundle");
	const benchmarkTask = task.task;
	const attempt = {
		number: task.runCell.attempt,
		maxAttempts: benchmarkTask.attempt.maxAttempts,
		retryPolicy: benchmarkTask.attempt.retryPolicy
	};
	assertTaskInput(task, bundle.execution.instructionDelivery);
	const resultTimeoutMs = candidateResultTimeout(options.resultTimeoutMs, benchmarkTask.limits.timeoutMs);
	const reservationWindowMs = candidateExecutionOwnerWindowMs(benchmarkTask.limits.timeoutMs, cleanupTimeoutMs, resultTimeoutMs) + PREPARED_HOLD_MARGIN_MS;
	if (reservationWindowMs > 2147483647) throw new Error("candidate reservation window exceeds the supported timer range");
	assertDisjointHostStagingRoots(task);
	const instructionBytes = Buffer.from(benchmarkTask.instruction, "utf8");
	const taskArtifacts = await verifyWorkspaceSnapshotArtifacts(benchmarkTask.workspace, ports.artifacts);
	await ports.workspaces.materialize({
		role: "task",
		snapshot: benchmarkTask.workspace,
		archive: taskArtifacts.archive,
		destination: task.stagingRoots.taskRoot
	});
	await verifyMaterializedWorkspace(task.stagingRoots.taskRoot, benchmarkTask.workspace.material, { ignoredProtectedRootEntries: [".git", ".sidecar"] });
	if (benchmarkTask.repository) await verifyTaskCheckout(task.stagingRoots.taskRoot, benchmarkTask.repository);
	const taskExecutorFiles = await readMaterializedWorkspaceFiles(task.stagingRoots.taskRoot, benchmarkTask.workspace.material, { ignoredProtectedRootEntries: [".git", ".sidecar"] });
	let candidateArchive;
	let candidateExecutorFiles;
	if (bundle.execution.workspace) {
		if (!task.stagingRoots.candidateRoot || !task.executionRoots.candidateRoot) throw new Error("active candidate execution requires host and container candidate roots");
		candidateArchive = await verifiedArtifactBytes(candidate, bundle.execution.workspace.archive);
		await ports.workspaces.materialize({
			role: "candidate",
			snapshot: bundle.execution.workspace,
			archive: candidateArchive,
			destination: task.stagingRoots.candidateRoot
		});
		await verifyMaterializedWorkspace(task.stagingRoots.candidateRoot, bundle.execution.workspace.material);
		candidateExecutorFiles = await readMaterializedWorkspaceFiles(task.stagingRoots.candidateRoot, bundle.execution.workspace.material);
	} else if (task.stagingRoots.candidateRoot || task.executionRoots.candidateRoot) throw new Error("disabled code cannot receive a candidate workspace root");
	await assertEmptyDirectory(task.stagingRoots.profileRoot);
	const profileWorkspacePlan = materializeAgentCandidateProfilePlan({
		profile: bundle.profile,
		harness: bundle.execution.harness,
		launch: bundle.execution.launch,
		workspace: bundle.execution.cwd.workspace,
		workspaces: {
			taskRoot: task.executionRoots.taskRoot,
			...task.executionRoots.candidateRoot ? { candidateRoot: task.executionRoots.candidateRoot } : {}
		},
		resolvedResources: verifiedResourceTextByDigest(candidate)
	});
	const profileAgentPaths = candidateProfileAgentPaths(profileWorkspacePlan, task.executionRoots.profileRoot);
	const profileAgentStagingRoot = profileWorkspacePlan.files.some((file) => file.root === "agent") ? await mkdtemp(join(tmpdir(), "tangle-candidate-profile-agent-")) : void 0;
	let profileApplication;
	try {
		profileApplication = applyAgentCandidateWorkspacePlan(profileWorkspacePlan, task.stagingRoots.profileRoot, bundle.execution.cwd.workspace, profileAgentStagingRoot ? { agentDir: profileAgentStagingRoot } : void 0);
		await verifyMaterializedProfileWorkspace(task.stagingRoots.profileRoot, profileApplication.profileActivation.profilePlan.material);
		if (profileAgentStagingRoot) await verifyMaterializedProfileWorkspace(profileAgentStagingRoot, profileApplication.profileActivation.profilePlan.material, "agent");
	} finally {
		if (profileAgentStagingRoot) await rm(profileAgentStagingRoot, {
			recursive: true,
			force: true
		});
	}
	const profilePlanBytes = await readVerifiedArtifact(profileApplication.profileActivation.profilePlan.artifact, ports.artifacts);
	if (!Buffer.from(profilePlanBytes).equals(Buffer.from(canonicalCandidateBytes$1(profileApplication.profileActivation.profilePlan.material)))) throw new Error("profile materializer did not capture exact canonical plan bytes");
	const profileActivation = profileApplication.profileActivation;
	const container = await resolveContainer(candidate, task, ports);
	const resolvedModel = await resolveModel(candidate, task, ports);
	const preparationId = `candidate-preparation.${randomBytes(32).toString("base64url")}`;
	const reservationExpiresAtMs = Date.now() + Math.max(MIN_RESERVATION_TTL_MS, reservationWindowMs);
	const modelReservation = await withinCandidateCleanupDeadline(() => ports.models.reserveGrant({
		executionId: task.executionId,
		preparationId,
		expiresAtMs: reservationExpiresAtMs,
		attempt,
		bundleDigest: bundle.digest,
		resolved: resolvedModel,
		limits: modelLimits(benchmarkTask.limits)
	}), candidateCleanupDeadline(cleanupTimeoutMs), "protected model reservation");
	let preparedMemory;
	try {
		validateProtectedModelReservation(modelReservation, benchmarkTask.limits, preparationId, reservationExpiresAtMs);
		preparedMemory = await prepareMemory(candidate, task, ports, preparationId, reservationExpiresAtMs, cleanupTimeoutMs);
		const memory = preparedMemory.value;
		const knowledge = await prepareAgentCandidateKnowledge(candidate, ports, task.runCell.arm);
		const knowledgePaths = knowledge ? candidateKnowledgeExecutionPaths(task.executionRoots.taskRoot, knowledge.retrievalConfig !== void 0) : void 0;
		const baseLaunch = buildLaunch(candidate, task, profileApplication.flags);
		const publicEnv = mergePublicEnvironment(bundle.execution.env ?? {}, profileApplication.env, profileAgentPaths ? {
			[PI_CANDIDATE_AGENT_DIR_ENV]: {
				kind: "public",
				value: profileAgentPaths.agentDir
			},
			[PI_CANDIDATE_SESSION_DIR_ENV]: {
				kind: "public",
				value: profileAgentPaths.sessionDir
			}
		} : {}, bundle.execution.instructionDelivery.kind === "utf8-file" ? { [bundle.execution.instructionDelivery.env]: {
			kind: "public",
			value: bundle.execution.instructionDelivery.path
		} } : {}, knowledgePaths ? {
			[CANDIDATE_KNOWLEDGE_ROOT_ENV]: {
				kind: "public",
				value: knowledgePaths.root
			},
			...knowledgePaths.retrievalConfig ? { [CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV]: {
				kind: "public",
				value: knowledgePaths.retrievalConfig
			} } : {}
		} : {});
		const routes = modelRoutes(bundle.profile, benchmarkTask.model.requested);
		const executionMaterial = {
			kind: "agent-candidate-execution-plan-material",
			runCell: task.runCell,
			executionId: task.executionId,
			workspaces: {
				taskRoot: task.executionRoots.taskRoot,
				...task.executionRoots.candidateRoot ? { candidateRoot: task.executionRoots.candidateRoot } : {}
			},
			codeKind: bundle.code.kind,
			...bundle.execution.workspace ? { candidateWorkspace: bundle.execution.workspace } : {},
			profile: profileApplication.application,
			harness: bundle.execution.harness,
			harnessVersion: bundle.execution.harnessVersion,
			instructionDelivery: bundle.execution.instructionDelivery,
			limits: benchmarkTask.limits,
			container,
			model: {
				policy: "single",
				resolved: resolvedModel,
				access: {
					kind: "evaluator-mediated",
					grantDigest: modelReservation.digest,
					network: modelReservation.network
				},
				routes
			},
			launch: {
				executable: baseLaunch.executable,
				args: baseLaunch.args,
				env: publicEnv,
				cwd: bundle.execution.cwd
			},
			...bundle.knowledge ? { knowledgeManifestDigest: bundle.knowledge.snapshot.digest } : {},
			memory,
			network: { mode: "disabled" }
		};
		agentCandidateExecutionPlanMaterialSchema.parse(executionMaterial);
		const executionBytes = canonicalCandidateBytes$1(executionMaterial);
		const executionDigest = canonicalCandidateDigest$1(executionMaterial);
		if (sha256Bytes$1(executionBytes) !== executionDigest) throw new Error("execution plan canonical serializers disagree");
		const executionPlan = agentCandidateExecutionPlanEvidenceSchema.parse({
			kind: "agent-candidate-execution-plan",
			digest: executionDigest,
			material: executionMaterial,
			artifact: embeddedCandidateArtifact(executionBytes)
		});
		const entrypoint = candidateEntrypointReceipt(candidate);
		const materializationReceipt = canonicalCandidateDocument({
			kind: "agent-candidate-materialization",
			digestAlgorithm: "rfc8785-sha256",
			bundleDigest: bundle.digest,
			benchmark: {
				suite: {
					digest: task.benchmarkSuite.digest,
					material: embeddedCandidateArtifact(canonicalCandidateBytes$1(omitTopLevelDigest(task.benchmarkSuite)))
				},
				task: {
					digest: benchmarkTask.digest,
					material: embeddedCandidateArtifact(canonicalCandidateBytes$1(omitTopLevelDigest(benchmarkTask)))
				}
			},
			profileActivation,
			executionPlan,
			...bundle.execution.workspace ? { candidateWorkspace: bundle.execution.workspace } : {},
			codeKind: bundle.code.kind,
			...candidate.materializedTree ? { materializedTree: candidate.materializedTree } : {},
			harness: bundle.execution.harness,
			harnessVersion: bundle.execution.harnessVersion,
			container,
			resolvedModel,
			...bundle.knowledge ? { knowledgeManifestDigest: bundle.knowledge.snapshot.digest } : {},
			...entrypoint ? { entrypoint } : {}
		});
		agentCandidateMaterializationReceiptSchema.parse(materializationReceipt.value);
		const traceRunId = `${task.executionId}:attempt-${attempt.number}:${canonicalCandidateDigest$1({ preparationId }).slice(7, 23)}`;
		const traceTags = {
			[CANDIDATE_TRACE_TAGS.executionId]: task.executionId,
			[CANDIDATE_TRACE_TAGS.bundleDigest]: bundle.digest,
			[CANDIDATE_TRACE_TAGS.executionPlanDigest]: executionPlan.digest,
			[CANDIDATE_TRACE_TAGS.materializationReceiptDigest]: materializationReceipt.digest
		};
		const traceEnv = {
			[CANDIDATE_TRACE_ENV.executionId]: task.executionId,
			[CANDIDATE_TRACE_ENV.bundleDigest]: bundle.digest,
			[CANDIDATE_TRACE_ENV.executionPlanDigest]: executionPlan.digest,
			[CANDIDATE_TRACE_ENV.materializationReceiptDigest]: materializationReceipt.digest,
			[CANDIDATE_TRACE_ENV.traceRunId]: traceRunId
		};
		assertEnvironmentDisjoint(publicEnv, traceEnv);
		return createPreparedCandidateExecution({
			ports,
			bundle,
			benchmarkSuite: task.benchmarkSuite,
			benchmarkTask,
			executionId: task.executionId,
			roots: {
				execution: { ...task.executionRoots },
				staging: { ...task.stagingRoots }
			},
			profilePlan: {
				value: profileApplication.profileActivation.profilePlan,
				bytes: profilePlanBytes,
				written: [...profileApplication.application.mountPaths]
			},
			profileActivation,
			executionPlan: {
				value: executionPlan,
				bytes: executionBytes
			},
			materializationReceipt,
			launch: {
				executable: baseLaunch.executable,
				args: baseLaunch.args.map((value) => value.value),
				env: unwrapPublicEnvironment(publicEnv),
				flags: profileApplication.flags.map((value) => value.value),
				cwd: absoluteExecutionCwd(bundle.execution.cwd, task.executionRoots)
			},
			instruction: {
				bytes: Uint8Array.from(instructionBytes),
				delivery: bundle.execution.instructionDelivery
			},
			resolvedModel,
			preparationId,
			reservationExpiresAtMs,
			cleanupTimeoutMs,
			resultTimeoutMs,
			modelReservation: {
				preparationId: modelReservation.preparationId,
				digest: modelReservation.digest,
				expiresAtMs: modelReservation.expiresAtMs,
				enforcedLimits: modelReservation.enforcedLimits,
				network: modelReservation.network
			},
			executorInputs: {
				taskFiles: taskExecutorFiles,
				...candidateExecutorFiles ? { candidateFiles: candidateExecutorFiles } : {},
				profileFiles: exactProfileExecutorFiles(profileWorkspacePlan.files, profileApplication.profileActivation.profilePlan.material.files)
			},
			...preparedMemory.accessDigest && preparedMemory.value.mode === "isolated" ? { memoryReservation: {
				preparationId,
				accessDigest: preparedMemory.accessDigest,
				expiresAtMs: reservationExpiresAtMs,
				effectiveNamespace: preparedMemory.value.effectiveNamespace
			} } : {},
			...knowledge ? { knowledge } : {},
			trace: {
				runId: traceRunId,
				tags: traceTags,
				env: traceEnv
			},
			memory
		});
	} catch (error) {
		const cleanupDeadlineAtMs = candidateCleanupDeadline(cleanupTimeoutMs);
		const cleanup = [];
		if (preparedMemory?.value.mode === "isolated") {
			const accessDigest = preparedMemory.accessDigest;
			const effectiveNamespace = preparedMemory.value.effectiveNamespace;
			if (!accessDigest) throw new Error("isolated memory preparation is missing access identity");
			cleanup.push(withinCandidateCleanupDeadline(async () => {
				const closed = await ports.memory.close({
					executionId: task.executionId,
					preparationId,
					accessDigest,
					effectiveNamespace,
					reason: "preparation-failed"
				});
				if (closed.closed !== true || Object.keys(closed).some((key) => key !== "closed")) throw new Error("failed preparation did not close isolated memory access");
			}, cleanupDeadlineAtMs, "failed preparation memory cleanup"));
		}
		cleanup.push(withinCandidateCleanupDeadline(async () => {
			if (sealAgentCandidateModelSettlement(await ports.models.settleGrant({
				executionId: task.executionId,
				preparationId,
				grantDigest: modelReservation.digest,
				resolved: resolvedModel,
				reason: "preparation-failed"
			}), {
				preparationId,
				grantDigest: modelReservation.digest,
				model: resolvedModel.model
			}).usage.modelCalls !== 0) throw new Error("failed preparation unexpectedly contains model calls");
		}, cleanupDeadlineAtMs, "failed preparation model cleanup"));
		const cleanupErrors = (await Promise.allSettled(cleanup)).filter((result) => result.status === "rejected").map((result) => result.reason);
		if (cleanupErrors.length > 0) throw new Error(`candidate preparation failed and protected access cleanup failed: ${cleanupErrors.map(errorMessage).join("; ")}`, { cause: error });
		throw error;
	}
}
function assertSameVerificationPorts(verified, execution) {
	if (verified.artifacts !== execution.artifacts || verified.repositories !== execution.repositories) throw new Error("prepare must use the same artifact and repository ports that verified the bundle");
}
function assertTaskInput(task, delivery) {
	const benchmarkTask = agentCandidateBenchmarkTaskSchema.parse(task.task);
	const benchmarkSuite = agentCandidateBenchmarkSuiteSchema.parse(task.benchmarkSuite);
	const runCell = agentCandidateRunCellSchema.parse(task.runCell);
	const requiredStrings = [
		["executionId", task.executionId],
		["benchmark", benchmarkTask.benchmark.name],
		["benchmarkVersion", benchmarkTask.benchmark.version],
		["taskId", benchmarkTask.scenario.id]
	];
	if (benchmarkTask.outcome.kind === "workspace" && !benchmarkTask.repository) throw new Error("workspace task outcome requires repository identity");
	if (benchmarkTask.repository) requiredStrings.push(["repository identity", benchmarkTask.repository.identity], ["repository root identity", benchmarkTask.repository.rootIdentity]);
	for (const [name, value] of requiredStrings) if (!value.trim()) throw new Error(`${name} must be non-empty`);
	if (!/^[A-Za-z0-9._:-]{1,200}$/.test(task.executionId)) throw new Error("executionId must be a stable filesystem-neutral identifier");
	if (!benchmarkTask.instruction || !isWellFormedUnicode(benchmarkTask.instruction)) throw new Error("task instruction must be non-empty well-formed Unicode");
	if (canonicalCandidateDigest$1(omitTopLevelDigest(benchmarkTask)) !== benchmarkTask.digest || canonicalCandidateDigest$1(omitTopLevelDigest(benchmarkSuite)) !== benchmarkSuite.digest || canonicalCandidateDigest$1(omitTopLevelDigest(runCell)) !== runCell.digest) throw new Error("candidate experiment cell contains an invalid content digest");
	const cellIndex = runCell.taskIndex * benchmarkSuite.reps + runCell.repetition;
	if (runCell.suiteDigest !== benchmarkSuite.digest || runCell.taskDigest !== benchmarkTask.digest || benchmarkSuite.taskDigests[runCell.taskIndex] !== benchmarkTask.digest || runCell.repetition >= benchmarkSuite.reps || benchmarkSuite.seeds[cellIndex] !== runCell.seed || runCell.attempt > benchmarkTask.attempt.maxAttempts) throw new Error("candidate experiment cell does not match its signed suite and task");
	sha256DigestSchema.parse(benchmarkTask.benchmark.splitDigest);
	agentCandidateTaskOutcomeSpecSchema.parse(benchmarkTask.outcome);
	agentCandidateWorkspaceSnapshotEvidenceSchema.parse(benchmarkTask.workspace);
	agentCandidateExecutionLimitsSchema.parse(benchmarkTask.limits);
	if (benchmarkTask.repository) {
		if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(benchmarkTask.repository.baseCommit)) throw new Error("task repository base commit is not a full Git object id");
		if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(benchmarkTask.repository.baseTree)) throw new Error("task repository base tree is not a full Git object id");
		if (benchmarkTask.repository.baseCommit.length !== benchmarkTask.repository.baseTree.length) throw new Error("task repository Git object formats disagree");
	}
	assertAgentCandidateExecutionRoots(task.executionRoots);
	for (const [name, root] of [
		["staging task root", task.stagingRoots.taskRoot],
		["staging candidate root", task.stagingRoots.candidateRoot],
		["staging profile root", task.stagingRoots.profileRoot]
	]) {
		if (root === void 0) continue;
		if (!(isAbsolute(root) && resolve(root) === root)) throw new Error(`${name} must be a canonical absolute path`);
	}
	if (!Number.isInteger(runCell.attempt) || !Number.isInteger(benchmarkTask.attempt.maxAttempts) || runCell.attempt < 1 || runCell.attempt > benchmarkTask.attempt.maxAttempts || benchmarkTask.attempt.retryPolicy === "none" && benchmarkTask.attempt.maxAttempts !== 1) throw new Error("task attempt policy is invalid");
	const limits = benchmarkTask.limits;
	if (!Number.isInteger(limits.timeoutMs) || limits.timeoutMs <= 0 || limits.timeoutMs > 2147483647 || !Number.isInteger(limits.maxSteps) || limits.maxSteps <= 0 || !Number.isInteger(limits.maxModelCalls) || limits.maxModelCalls < 0 || !Number.isInteger(limits.maxInputTokens) || limits.maxInputTokens < 0 || !Number.isInteger(limits.maxOutputTokens) || limits.maxOutputTokens < 0 || !Number.isFinite(limits.maxCostUsd) || limits.maxCostUsd < 0) throw new Error("task execution limits are invalid");
	usdToNanos(limits.maxCostUsd, "task maxCostUsd");
	if (!benchmarkTask.model.requested.trim()) throw new Error("evaluator model request must be non-empty");
	if (!benchmarkTask.grader.name.trim() || !benchmarkTask.grader.version.trim()) throw new Error("evaluator benchmark grader identity must be non-empty");
	if (!Number.isInteger(benchmarkTask.grader.artifact.byteLength) || benchmarkTask.grader.artifact.byteLength <= 0) throw new Error("evaluator benchmark grader artifact must be non-empty");
	sha256DigestSchema.parse(benchmarkTask.grader.artifact.sha256);
	if (benchmarkTask.evaluatorTaskContainer) {
		if (benchmarkTask.evaluatorTaskContainer.source !== "evaluator-task-container" || !benchmarkTask.evaluatorTaskContainer.image.trim() || !benchmarkTask.evaluatorTaskContainer.platform.os.trim() || !benchmarkTask.evaluatorTaskContainer.platform.architecture.trim()) throw new Error("evaluator task container evidence is incomplete");
		sha256DigestSchema.parse(benchmarkTask.evaluatorTaskContainer.indexDigest);
		sha256DigestSchema.parse(benchmarkTask.evaluatorTaskContainer.manifestDigest);
		agentCandidateContainerSchema.parse({
			image: benchmarkTask.evaluatorTaskContainer.image,
			indexDigest: benchmarkTask.evaluatorTaskContainer.indexDigest
		});
	}
	if (delivery.kind === "utf8-file") {
		if ([
			task.executionRoots.taskRoot,
			task.executionRoots.candidateRoot,
			task.executionRoots.profileRoot
		].some((root) => root !== void 0 && executionPathsOverlap(root, delivery.path))) throw new Error("task instruction file must remain outside execution workspaces");
	}
}
function assertDisjointHostStagingRoots(task) {
	const roots = [
		task.stagingRoots.taskRoot,
		task.stagingRoots.candidateRoot,
		task.stagingRoots.profileRoot
	].filter((value) => value !== void 0).map((value) => resolve(value));
	for (let left = 0; left < roots.length; left++) for (let right = left + 1; right < roots.length; right++) {
		const a = roots[left];
		const b = roots[right];
		if (a && b && (a === b || isContainedPath(a, b) || isContainedPath(b, a))) throw new Error("host task, candidate, and profile staging roots must be disjoint");
	}
}
function isContainedPath(parent, child) {
	const path = relative(parent, child);
	return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}
async function assertEmptyDirectory(path) {
	const stats = await lstat(path);
	if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("profile staging root must be a real directory");
	if ((await readdir(path)).length !== 0) throw new Error("profile staging root must be empty before materialization");
}
async function resolveContainer(candidate, task, ports) {
	const environment = candidate.bundle.execution.environment;
	const evaluatorTaskContainer = task.task.evaluatorTaskContainer;
	const pinned = environment.kind === "pinned-container" ? environment.container : void 0;
	if (environment.kind === "evaluator-task-container" && !evaluatorTaskContainer) throw new Error("evaluator-task-container candidate requires an evaluator-owned task image");
	if (environment.kind === "pinned-container" && evaluatorTaskContainer) throw new Error("pinned candidate containers cannot be replaced by a task image");
	const resolved = await ports.containers.resolve({
		candidate: pinned,
		evaluatorTaskContainer
	});
	if (resolved.source !== environment.kind) throw new Error("resolved container source drifted");
	if (pinned && (resolved.image !== pinned.image || resolved.indexDigest !== pinned.indexDigest)) throw new Error("resolved pinned container does not match the candidate image index");
	if (evaluatorTaskContainer && canonicalCandidateDigest$1(resolved) !== canonicalCandidateDigest$1(evaluatorTaskContainer)) throw new Error("resolved task container does not match evaluator-owned image evidence");
	return resolved;
}
async function resolveModel(candidate, task, ports) {
	const hints = candidate.bundle.profile.model;
	const expected = task.task.model;
	if (hints?.default !== void 0 && hints.default !== expected.requested) throw new Error("candidate model preference conflicts with the evaluator-owned model");
	if (hints?.reasoningEffort !== void 0 && hints.reasoningEffort !== expected.reasoningEffort) throw new Error("candidate reasoning effort conflicts with the evaluator-owned effort");
	const resolved = await ports.models.resolve({
		requested: expected.requested,
		harness: candidate.bundle.execution.harness,
		reasoningEffort: expected.reasoningEffort
	});
	if (canonicalCandidateDigest$1(resolved) !== canonicalCandidateDigest$1(expected)) throw new Error("model resolver drifted from the signed benchmark model");
	return resolved;
}
async function prepareMemory(candidate, task, ports, preparationId, expiresAtMs, cleanupTimeoutMs) {
	const policy = candidate.bundle.memory;
	if (policy.mode === "disabled") return { value: { mode: "disabled" } };
	const seed = policy.seed ? await verifiedArtifactBytes(candidate, policy.seed) : void 0;
	const executionSegment = canonicalCandidateDigest$1({ executionId: task.executionId }).slice(7);
	const taskSegment = canonicalCandidateDigest$1({ taskDigest: task.task.digest }).slice(7);
	const preparationSegment = canonicalCandidateDigest$1({ preparationId }).slice(7, 23);
	const effectiveNamespace = `candidate/${candidate.bundle.digest.slice(7, 23)}/${executionSegment}/${taskSegment}/${preparationSegment}`;
	const reset = await withinCandidateCleanupDeadline(() => ports.memory.reset({
		executionId: task.executionId,
		preparationId,
		expiresAtMs,
		effectiveNamespace,
		...seed ? { seed } : {},
		...policy.seed ? { seedDigest: policy.seed.sha256 } : {}
	}), candidateCleanupDeadline(cleanupTimeoutMs), "isolated memory reset");
	try {
		if (reset.preparationId !== preparationId || reset.expiresAtMs !== expiresAtMs || !/^sha256:[a-f0-9]{64}$/.test(reset.accessDigest)) throw new Error("isolated memory reservation is not scoped to this preparation");
		await readVerifiedArtifact(reset.evidence, ports.artifacts);
		await verifyWorkspaceSnapshotArtifacts(reset.beforeState, ports.artifacts);
		return {
			value: {
				mode: "isolated",
				scope: "task",
				effectiveNamespace,
				reset: {
					kind: "fresh",
					evidence: reset.evidence,
					emptyStateDigest: reset.emptyStateDigest
				},
				beforeState: reset.beforeState,
				...policy.seed ? { seedDigest: policy.seed.sha256 } : {}
			},
			accessDigest: reset.accessDigest
		};
	} catch (error) {
		try {
			const closed = await withinCandidateCleanupDeadline(() => ports.memory.close({
				executionId: task.executionId,
				preparationId,
				accessDigest: reset.accessDigest,
				effectiveNamespace,
				reason: "preparation-failed"
			}), candidateCleanupDeadline(cleanupTimeoutMs), "invalid isolated memory reset cleanup");
			if (closed.closed !== true || Object.keys(closed).some((key) => key !== "closed")) throw new Error("invalid isolated memory reset did not acknowledge closure");
		} catch (closeError) {
			throw new Error("isolated memory preparation and cleanup both failed", { cause: new AggregateError([error, closeError]) });
		}
		throw error;
	}
}
function buildLaunch(candidate, task, profileFlags) {
	const launch = candidate.bundle.execution.launch;
	if (launch.kind === "container-command") return {
		executable: launch.executable,
		args: [...launch.args ?? [], ...profileFlags]
	};
	const candidateRoot = task.executionRoots.candidateRoot;
	if (!candidateRoot) throw new Error("candidate entrypoint requires a container candidate root");
	const entrypoint = posix.join(candidateRoot, launch.entrypoint);
	const candidateArgs = launch.args ?? [];
	if (launch.interpreter) return {
		executable: launch.interpreter,
		args: [
			{
				kind: "public",
				value: entrypoint
			},
			...candidateArgs,
			...profileFlags
		]
	};
	return {
		executable: entrypoint,
		args: [...candidateArgs, ...profileFlags]
	};
}
function mergePublicEnvironment(...records) {
	const output = {};
	for (const record of records) for (const [name, value] of Object.entries(record)) {
		const previous = output[name];
		if (previous && previous.value !== value.value) throw new Error(`candidate and profile environment disagree on ${name}`);
		output[name] = value;
	}
	return output;
}
function unwrapPublicEnvironment(values) {
	return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value.value]));
}
function modelRoutes(profile, requested) {
	const routes = [{
		kind: "primary",
		requested
	}];
	if (profile.model?.small) routes.push({
		kind: "small",
		requested
	});
	for (const name of Object.keys(profile.modes ?? {}).sort()) if (profile.modes?.[name]?.model) routes.push({
		kind: "mode",
		name,
		requested
	});
	for (const name of Object.keys(profile.subagents ?? {}).sort()) if (profile.subagents?.[name]?.model) routes.push({
		kind: "subagent",
		name,
		requested
	});
	return routes;
}
function candidateEntrypointReceipt(candidate) {
	const launch = candidate.bundle.execution.launch;
	const workspace = candidate.bundle.execution.workspace;
	if (launch.kind !== "candidate-entrypoint" || !workspace) return void 0;
	const file = workspace.material.files.find((entry) => entry.path === launch.entrypoint);
	if (!file) throw new Error("candidate entrypoint is absent from the verified workspace");
	return {
		path: file.path,
		sha256: file.sha256,
		byteLength: file.byteLength
	};
}
function absoluteExecutionCwd(cwd, roots) {
	const root = workspaceExecutionRoot(cwd.workspace, roots);
	const absolute = cwd.path === "." ? root : posix.join(root, cwd.path);
	if (absolute !== root && !absolute.startsWith(`${root}/`)) throw new Error("candidate cwd escapes its execution workspace");
	return absolute;
}
function workspaceExecutionRoot(workspace, roots) {
	const root = workspace === "task" ? roots.taskRoot : roots.candidateRoot;
	if (!root) throw new Error(`candidate ${workspace} workspace root is missing`);
	return root;
}
function validateProtectedModelReservation(reservation, expectedLimits, preparationId, expiresAtMs) {
	if (!/^sha256:[a-f0-9]{64}$/.test(reservation.digest)) throw new Error("protected model reservation has an invalid identity digest");
	if (reservation.preparationId !== preparationId || reservation.expiresAtMs !== expiresAtMs) throw new Error("protected model reservation is not scoped to this preparation");
	const limits = modelLimits(expectedLimits);
	if (canonicalCandidateDigest$1(reservation.enforcedLimits) !== canonicalCandidateDigest$1(limits)) throw new Error("protected model reservation does not enforce the frozen model limits");
	const expectedNetworkMode = limits.maxModelCalls === 0 ? "disabled" : "gateway-only";
	if (agentCandidateModelAccessNetworkSchema.parse(reservation.network).mode !== expectedNetworkMode) throw new Error("protected model reservation has the wrong network policy for its call limit");
}
function assertEnvironmentDisjoint(publicEnv, traceEnv) {
	const seen = new Set(Object.keys(publicEnv));
	for (const name of Object.keys(traceEnv)) {
		if (seen.has(name)) throw new Error(`evaluator environment binding collides with ${name}`);
		seen.add(name);
	}
}
function modelLimits(limits) {
	return {
		maxModelCalls: limits.maxModelCalls,
		maxInputTokens: limits.maxInputTokens,
		maxOutputTokens: limits.maxOutputTokens,
		maxCostUsd: limits.maxCostUsd
	};
}
function exactProfileExecutorFiles(sourceFiles, expectedFiles) {
	const byIdentity = new Map(sourceFiles.map((file) => [profileFileIdentity(file.root, file.relPath), file]));
	if (byIdentity.size !== sourceFiles.length || sourceFiles.length !== expectedFiles.length) throw new Error("profile source files do not match the signed profile plan");
	return expectedFiles.map((expected) => {
		const source = byIdentity.get(profileFileIdentity(expected.root, expected.relPath));
		const mode = source?.mode ?? 420;
		const bytes = Buffer.from(source?.content ?? "", "utf8");
		if (!source || !Number.isInteger(mode) || mode < 0 || mode > 511 || mode !== expected.mode || sha256Bytes$1(bytes) !== expected.contentSha256) throw new Error("profile source files do not match the signed profile plan");
		return {
			path: expected.relPath,
			mode,
			...expected.root === "agent" ? { root: "agent" } : {},
			bytes: Uint8Array.from(bytes)
		};
	});
}
function profileFileIdentity(root, relPath) {
	return `${root ?? "workspace"}\0${relPath}`;
}
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
export { recoveredTerminalRecord as A, candidateCleanupDeadline as C, assertTerminalAllowedInPhase as D, assertRecoveryMatchesStaged as E, terminalRecord as F, rejectedStage as M, requireStagedTerminal as N, assertTerminalMatchesClaim as O, sealTerminalDigest as P, candidateClaimFileInternals as S, withinCandidateCleanupDeadline as T, consumePreparedCandidateExecution as _, AGENT_CANDIDATE_EXECUTION_SUPPORT as a, assertAgentCandidateExecutionRoots as b, executePreparedAgentCandidate as c, sealAgentCandidateModelSettlement as d, usdToNanos as f, beginPreparedCandidateDisposal as g, assertPreparedCandidateIntegrity as h, candidateKnowledgeExecutionPaths as i, rejectedFinish as j, assertTerminalMatchesStaged as k, RecoveryAgentCandidateTraceStore as l, candidateExecutionClaim as m, CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV as n, verifiedResourceTextByDigest as o, sealAgentCandidateExecutorStopAcknowledgement as p, CANDIDATE_KNOWLEDGE_ROOT_ENV as r, verifyAgentCandidateBundle as s, prepareAgentCandidateExecution as t, persistCandidateModelSettlementEvidence as u, CANDIDATE_TRACE_ENV as v, candidateCleanupTimeout as w, InMemoryAgentCandidateExecutionClaimStore as x, CANDIDATE_TRACE_TAGS as y };

//# sourceMappingURL=prepare-DVlvGP7V.js.map