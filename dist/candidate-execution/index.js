import { E as embeddedCandidateArtifact, S as canonicalCandidateBytes$1, _ as scanMaterializedWorkspaceManifest, a as persistCandidateOutputArtifact, b as verifyMaterializedWorkspace, g as readVerifiedArtifact, n as captureAgentCandidateWorkspaceFiles, p as candidateWorkspaceManifest, r as createAgentCandidateWorkspacePort, t as captureAgentCandidateWorkspace } from "../workspace-archive-C9lgf77y.js";
import { A as recoveredTerminalRecord, C as candidateCleanupDeadline, D as assertTerminalAllowedInPhase, E as assertRecoveryMatchesStaged, F as terminalRecord, M as rejectedStage, N as requireStagedTerminal, O as assertTerminalMatchesClaim, P as sealTerminalDigest, S as candidateClaimFileInternals, T as withinCandidateCleanupDeadline, _ as consumePreparedCandidateExecution, a as AGENT_CANDIDATE_EXECUTION_SUPPORT, c as executePreparedAgentCandidate, d as sealAgentCandidateModelSettlement, g as beginPreparedCandidateDisposal, h as assertPreparedCandidateIntegrity, i as candidateKnowledgeExecutionPaths, j as rejectedFinish, k as assertTerminalMatchesStaged, l as RecoveryAgentCandidateTraceStore, m as candidateExecutionClaim, n as CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV, p as sealAgentCandidateExecutorStopAcknowledgement, r as CANDIDATE_KNOWLEDGE_ROOT_ENV, s as verifyAgentCandidateBundle, t as prepareAgentCandidateExecution, u as persistCandidateModelSettlementEvidence, v as CANDIDATE_TRACE_ENV, w as candidateCleanupTimeout, x as InMemoryAgentCandidateExecutionClaimStore, y as CANDIDATE_TRACE_TAGS } from "../prepare-DVlvGP7V.js";
import { a as assertCandidateProfileBinding, d as omitUndefinedObjectFields, h as parseExactCandidateProfile, i as applyExactAgentProfileDiff, l as freezeGenericAgentCandidateProfile, m as parseExactAgentProfileDiff, p as parseExactAgentProfile, r as agentCandidateProfileAsAgentProfile } from "../profile-D3eXNBQV.js";
import { t as sealAgentCandidateBundle } from "../bundle-CvLGRVO-.js";
import { n as exactProcessProviderAsCandidateExecutor, t as createProtectedAgentCandidateModelPort } from "../protected-model-port-BrWgsCnl.js";
import { agentCandidateExecutionPlanMaterialSchema, agentCandidateMaterializationReceiptSchema } from "@tangle-network/agent-interface";
import { createHash, randomUUID } from "node:crypto";
import { constants, linkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { cp, lstat, mkdir, open, readdir, readlink, realpath, unlink } from "node:fs/promises";
import { verifyCodeSurface } from "@tangle-network/agent-eval/campaign";
//#region src/candidate-execution/builder.ts
/**
* Compile one measured profile/code candidate into the immutable execution
* contract. Code bytes are re-read and verified by agent-eval before they are
* embedded. The returned bundle is schema-validated, canonically digested, and
* deeply immutable; call `verifyAgentCandidateBundle` at the execution boundary
* to re-read external memory, repository, and workspace artifacts.
*/
function buildAgentCandidateBundle(input) {
	return sealAgentCandidateBundle({
		kind: "agent-candidate-bundle",
		digestAlgorithm: "rfc8785-sha256",
		profile: compileCandidateProfile(input.profile),
		code: compileCandidateCode(input.code),
		execution: input.execution,
		...input.knowledge !== void 0 ? { knowledge: input.knowledge } : {},
		memory: input.memory
	});
}
function compileCandidateProfile(source) {
	if (source.kind === "candidate-profile") return parseExactCandidateProfile(source.profile);
	if (source.kind === "profile") return freezeGenericAgentCandidateProfile(source.profile);
	if (source.kind !== "profile-diffs") throw new Error(`unsupported candidate profile source: ${String(source.kind)}`);
	if (source.diffs.length === 0) throw new Error("profile-diffs source requires at least one AgentProfileDiff");
	let profile = parseExactAgentProfile(source.base, "base profile");
	for (const [index, inputDiff] of source.diffs.entries()) {
		const diff = parseExactAgentProfileDiff(inputDiff, `profile diff ${index}`);
		profile = applyExactAgentProfileDiff(profile, diff, `profile diff ${index}`);
	}
	return freezeGenericAgentCandidateProfile(profile);
}
function compileCandidateCode(source) {
	if (source.kind === "disabled" || source.kind === "no-op") return source;
	if (source.kind !== "code-surface") throw new Error(`unsupported candidate code source: ${String(source.kind)}`);
	const patch = embeddedCandidateArtifact(verifyCodeSurface(source.surface, source.worktreeDir).patchBytes);
	if (patch.sha256 !== source.surface.patch.sha256 || patch.byteLength !== source.surface.patch.byteLength) throw new Error("verified CodeSurface patch bytes do not match its content identity");
	return {
		kind: "git-patch",
		repository: source.repository,
		baseCommit: source.surface.baseCommit,
		baseTree: source.surface.baseTree,
		candidateTree: source.surface.candidateTree,
		patch: {
			format: "git-diff-binary",
			artifact: patch
		}
	};
}
//#endregion
//#region src/candidate-execution/claim-file-store.ts
const { assertExpiredLease, assertLease, assertSameSlot, assertUnexpiredLease, attemptRecord, claimSlot, leaseDigest, newLease, readClaim, readClaimIfPresent, readTerminal, readTerminalIfPresent, readTransitionIfPresent, rejectedExistingClaim, rejectedRetry, retryRejection, sealAttemptRef, sealClaim, sealLease } = candidateClaimFileInternals;
/** Cross-process lifecycle implemented as fsynced, create-if-absent records. */
var FileAgentCandidateExecutionClaimStore = class {
	directory;
	now;
	constructor(options) {
		if (options.directory.length === 0) throw new Error("candidate execution claim directory must not be empty");
		this.directory = options.directory;
		this.now = options.now ?? Date.now;
	}
	async tryClaim(requested) {
		const claim = sealClaim(requested);
		await mkdir(this.directory, { recursive: true });
		const claimPath = this.claimPath(claim);
		const existing = await readClaimIfPresent(claimPath);
		if (existing) {
			assertSameSlot(existing.claim, claim, claimPath);
			return rejectedExistingClaim(existing.claim, claim);
		}
		assertUnexpiredLease(claim.leaseExpiresAtMs, this.now());
		const retryFailure = await this.retryFailure(claim);
		if (retryFailure) return rejectedRetry(claim, retryFailure);
		const lease = newLease(claim);
		if (await writeRecordIfAbsent(this.directory, claimPath, {
			...claim,
			phase: "claimed",
			leaseDigest: leaseDigest(lease)
		})) return Object.freeze({
			acquired: true,
			claim,
			lease
		});
		const winner = await readClaim(claimPath);
		assertSameSlot(winner.claim, claim, claimPath);
		return rejectedExistingClaim(winner.claim, claim);
	}
	async getAttempt(requestedAttempt) {
		return await this.storedAttempt(sealAttemptRef(requestedAttempt));
	}
	async markCandidateMayRun(requestedLease) {
		const lease = sealLease(requestedLease);
		const claimPath = this.claimPath(lease);
		const stored = await readClaim(claimPath);
		assertSameSlot(stored.claim, lease, claimPath);
		assertLease(stored.leaseDigest, stored.claim.leaseExpiresAtMs, lease);
		const state = await this.transitionState(stored.claim);
		if (state.phase === "candidate-may-run") return Object.freeze({
			marked: false,
			phase: "candidate-may-run"
		});
		if (state.staged) throw new Error("candidate execution terminal was staged before candidate-may-run phase");
		assertUnexpiredLease(stored.claim.leaseExpiresAtMs, this.now());
		if (await writeRecordIfAbsent(this.directory, this.transitionPath(stored.claim, 1), {
			kind: "candidate-execution-phase",
			executionId: stored.claim.executionId,
			attempt: stored.claim.attempt,
			executionPlanDigest: stored.claim.executionPlanDigest,
			phase: "candidate-may-run"
		}, this.ownerPublication(stored.claim))) return Object.freeze({
			marked: true,
			phase: "candidate-may-run"
		});
		if ((await this.transitionState(stored.claim)).phase === "candidate-may-run") return Object.freeze({
			marked: false,
			phase: "candidate-may-run"
		});
		throw new Error("candidate execution terminal was staged before candidate-may-run phase");
	}
	async stageTerminal(requestedLease, result) {
		const lease = sealLease(requestedLease);
		const claimPath = this.claimPath(lease);
		const stored = await readClaim(claimPath);
		assertSameSlot(stored.claim, lease, claimPath);
		assertLease(stored.leaseDigest, stored.claim.leaseExpiresAtMs, lease);
		const terminal = terminalRecord(stored.claim, result);
		const state = await this.transitionState(stored.claim);
		if (state.staged) return rejectedStage(state.staged, terminal);
		assertTerminalAllowedInPhase(state.phase, terminal);
		assertUnexpiredLease(stored.claim.leaseExpiresAtMs, this.now());
		const transition = state.phase === "claimed" ? 1 : 2;
		if (await writeRecordIfAbsent(this.directory, this.transitionPath(stored.claim, transition), {
			kind: "candidate-execution-pending-terminal",
			terminal
		}, this.ownerPublication(stored.claim))) return Object.freeze({
			staged: true,
			terminal
		});
		const winner = await this.transitionState(stored.claim);
		if (!winner.staged) throw new Error("candidate execution phase transition won while staging terminal");
		return rejectedStage(winner.staged, terminal);
	}
	async finish(requestedLease, requestedTerminalDigest) {
		const lease = sealLease(requestedLease);
		const terminalDigest = sealTerminalDigest(requestedTerminalDigest);
		const claimPath = this.claimPath(lease);
		const stored = await readClaim(claimPath);
		assertSameSlot(stored.claim, lease, claimPath);
		assertLease(stored.leaseDigest, stored.claim.leaseExpiresAtMs, lease);
		const staged = requireStagedTerminal((await this.transitionState(stored.claim)).staged, terminalDigest);
		const terminalPath = this.terminalPath(lease);
		const existing = await readTerminalIfPresent(terminalPath);
		if (existing) {
			assertTerminalMatchesClaim(existing, stored.claim, terminalPath);
			assertTerminalMatchesStaged(existing, staged, terminalPath);
			return rejectedFinish(existing, terminalDigest);
		}
		assertUnexpiredLease(stored.claim.leaseExpiresAtMs, this.now());
		if (await writeRecordIfAbsent(this.directory, terminalPath, { terminal: staged }, this.ownerPublication(stored.claim))) return Object.freeze({
			finished: true,
			terminal: staged
		});
		const winner = await readTerminal(terminalPath);
		assertSameSlot(winner, lease, terminalPath);
		assertTerminalMatchesClaim(winner, stored.claim, terminalPath);
		assertTerminalMatchesStaged(winner, staged, terminalPath);
		return rejectedFinish(winner, terminalDigest);
	}
	async recoverExpired(requestedAttempt, evidence) {
		const attempt = sealAttemptRef(requestedAttempt);
		const record = await this.storedAttempt(attempt);
		if (!record) throw new Error("candidate execution recovery does not name an acquired attempt");
		const recovered = recoveredTerminalRecord(record.claim, record.phase, evidence);
		if (record.staged) assertRecoveryMatchesStaged(record.staged, recovered);
		const requestedDigest = record.staged?.terminalDigest ?? recovered.terminalDigest;
		if (record.terminal) return rejectedFinish(record.terminal, requestedDigest);
		assertExpiredLease(record.claim.leaseExpiresAtMs, this.now());
		let staged = record.staged;
		if (!staged) {
			const transition = record.phase === "claimed" ? 1 : 2;
			if (await writeRecordIfAbsent(this.directory, this.transitionPath(record.claim, transition), {
				kind: "candidate-execution-pending-terminal",
				terminal: recovered
			})) staged = recovered;
			else {
				const winner = await this.transitionState(record.claim);
				if (!winner.staged) throw new Error("candidate execution recovery lost terminal staging to a phase transition");
				assertRecoveryMatchesStaged(winner.staged, recovered);
				staged = winner.staged;
			}
		}
		const terminalPath = this.terminalPath(attempt);
		if (await writeRecordIfAbsent(this.directory, terminalPath, { terminal: staged })) return Object.freeze({
			finished: true,
			terminal: staged
		});
		const winner = await readTerminal(terminalPath);
		assertSameSlot(winner, attempt, terminalPath);
		assertTerminalMatchesClaim(winner, record.claim, terminalPath);
		assertTerminalMatchesStaged(winner, staged, terminalPath);
		return rejectedFinish(winner, staged.terminalDigest);
	}
	async storedAttempt(claim) {
		const claimPath = this.claimPath(claim);
		const stored = await readClaimIfPresent(claimPath);
		if (!stored) return void 0;
		assertSameSlot(stored.claim, claim, claimPath);
		const terminalPath = this.terminalPath(claim);
		const terminal = await readTerminalIfPresent(terminalPath);
		const state = await this.transitionState(stored.claim);
		if (terminal) {
			assertTerminalMatchesClaim(terminal, stored.claim, terminalPath);
			if (!state.staged) throw new Error(`candidate execution terminal record at ${terminalPath} has no staged outbox`);
			assertTerminalMatchesStaged(terminal, state.staged, terminalPath);
		}
		return attemptRecord(stored.claim, state.phase, state.staged, terminal);
	}
	async transitionState(claim) {
		const firstPath = this.transitionPath(claim, 1);
		const first = await readTransitionIfPresent(firstPath, claim);
		if (!first) return { phase: "claimed" };
		if (first.kind === "pending") return {
			phase: "claimed",
			staged: first.terminal
		};
		const secondPath = this.transitionPath(claim, 2);
		const second = await readTransitionIfPresent(secondPath, claim);
		if (!second) return { phase: "candidate-may-run" };
		if (second.kind !== "pending") throw new Error(`candidate execution transition at ${secondPath} repeats the phase marker`);
		return {
			phase: "candidate-may-run",
			staged: second.terminal
		};
	}
	async retryFailure(claim) {
		if (claim.attempt === 1) return void 0;
		return retryRejection(claim, await this.storedAttempt({
			executionId: claim.executionId,
			attempt: claim.attempt - 1
		}));
	}
	ownerPublication(claim) {
		return { authorizePublish: () => {
			assertUnexpiredLease(claim.leaseExpiresAtMs, this.now());
			return true;
		} };
	}
	claimPath(claim) {
		return join(this.directory, `${claimSlot(claim)}.claim.json`);
	}
	terminalPath(claim) {
		return join(this.directory, `${claimSlot(claim)}.terminal.json`);
	}
	transitionPath(claim, ordinal) {
		return join(this.directory, `${claimSlot(claim)}.transition-${ordinal}.json`);
	}
};
/**
* Candidate records keep this async writer because lease authorization must run after the
* asynchronous temp-file fsync and immediately before synchronous link publication. The
* supervisor durability helper is synchronous and has no lease hook, so combining them would
* either move authorization earlier or add an async race to the claim boundary.
*/
async function writeRecordIfAbsent(directory, destination, record, options = {}) {
	const temporaryPath = join(directory, `.candidate-execution-${process.pid}-${randomUUID()}.tmp`);
	const handle = await open(temporaryPath, "wx", 384);
	try {
		await handle.writeFile(Buffer.concat([Buffer.from(canonicalCandidateBytes$1(record)), Buffer.from("\n")]));
		await handle.sync();
	} finally {
		await handle.close();
	}
	let written = false;
	try {
		if (options.authorizePublish && options.authorizePublish() !== true) throw new Error("candidate execution record publication was not authorized");
		linkSync(temporaryPath, destination);
		written = true;
		await syncDirectory(directory);
	} catch (error) {
		if (!isNodeError(error, "EEXIST")) throw error;
	} finally {
		await unlink(temporaryPath).catch((error) => {
			if (!isNodeError(error, "ENOENT")) throw error;
		});
	}
	return written;
}
async function syncDirectory(directory) {
	const handle = await open(directory, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}
function isNodeError(error, code) {
	return error !== null && typeof error === "object" && "code" in error && error.code === code;
}
//#endregion
//#region src/candidate-execution/dispose.ts
/** Revoke reservations held by a prepared candidate that will not be executed. */
async function disposePreparedAgentCandidateExecution(prepared, options = {}) {
	const initialState = assertPreparedCandidateIntegrity(prepared);
	const cleanupTimeoutMs = options.cleanupTimeoutMs ?? initialState.cleanupTimeoutMs;
	if (cleanupTimeoutMs > initialState.cleanupTimeoutMs) throw new Error("disposal cleanup timeout exceeds the frozen preparation bound");
	const cleanupDeadlineAtMs = candidateCleanupDeadline(cleanupTimeoutMs);
	const state = beginPreparedCandidateDisposal(prepared);
	const cleanup = [];
	if (state.memory.mode === "isolated") {
		const reservation = state.memoryReservation;
		if (!reservation) throw new Error("isolated memory reservation is missing");
		cleanup.push(withinCandidateCleanupDeadline(async () => {
			const closed = await state.ports.memory.close({
				executionId: state.executionId,
				preparationId: reservation.preparationId,
				accessDigest: reservation.accessDigest,
				effectiveNamespace: reservation.effectiveNamespace,
				reason: "abandoned"
			});
			if (closed.closed !== true || Object.keys(closed).some((key) => key !== "closed")) throw new Error("abandoned isolated memory access did not acknowledge closure");
		}, cleanupDeadlineAtMs, "isolated memory disposal"));
	}
	cleanup.push(withinCandidateCleanupDeadline(async () => {
		if (sealAgentCandidateModelSettlement(await state.ports.models.settleGrant({
			executionId: state.executionId,
			preparationId: state.preparationId,
			grantDigest: state.modelReservation.digest,
			resolved: state.resolvedModel,
			reason: "abandoned"
		}), {
			preparationId: state.preparationId,
			grantDigest: state.modelReservation.digest,
			model: state.resolvedModel.model
		}).usage.modelCalls !== 0) throw new Error("unexecuted model reservation unexpectedly contains calls");
	}, cleanupDeadlineAtMs, "model reservation disposal"));
	const failures = (await Promise.allSettled(cleanup)).filter((result) => result.status === "rejected").map((result) => result.reason);
	if (failures.length > 0) {
		consumePreparedCandidateExecution(prepared, "disposal-failed");
		throw new AggregateError(failures, "candidate preparation disposal failed");
	}
	consumePreparedCandidateExecution(prepared, "disposed");
	return Object.freeze({ disposed: true });
}
//#endregion
//#region src/candidate-execution/protected-model-grant.ts
const SETTLEMENT_RETRY_INITIAL_DELAY_MS = 25;
const SETTLEMENT_RETRY_MAX_DELAY_MS = 1e3;
/**
* Run one bounded unit under a protected model grant.
*
* Runtime owns the grant lifecycle; callers own the unit boundary and any
* durable scheduling or accounting around it. A reserved grant is settled
* after activation failure or callback failure, and the callback error is
* preserved when settlement also fails.
*/
async function runProtectedAgentCandidateModelGrant(options) {
	if (typeof options.execute !== "function") throw new TypeError("protected model grant execute callback is required");
	const resolved = await options.port.resolve(options.resolve);
	const reservation = await options.port.reserveGrant({
		...options.reserve,
		resolved
	});
	let value;
	let executionError;
	let executionFailed = false;
	let activated = false;
	let reason = "preparation-failed";
	try {
		const activation = await options.port.activateGrant({
			executionId: options.reserve.executionId,
			preparationId: options.reserve.preparationId,
			grantDigest: reservation.digest,
			resolved,
			deadlineAtMs: options.deadlineAtMs
		});
		activated = true;
		value = await options.execute({
			activation,
			reservation,
			resolved
		});
		reason = "completed";
	} catch (error) {
		executionError = error;
		executionFailed = true;
		if (activated) reason = "failed";
	}
	let settlement;
	try {
		settlement = await settleProtectedModelGrant(options, {
			executionId: options.reserve.executionId,
			preparationId: options.reserve.preparationId,
			grantDigest: reservation.digest,
			resolved,
			reason
		});
	} catch (settlementError) {
		if (executionFailed) throw new AggregateError([executionError, settlementError], "protected model execution failed and its grant did not settle");
		throw settlementError;
	}
	if (executionFailed) throw executionError;
	return {
		value,
		resolved,
		reservation,
		settlement
	};
}
async function settleProtectedModelGrant(options, input) {
	let delayMs = SETTLEMENT_RETRY_INITIAL_DELAY_MS;
	for (;;) try {
		return await options.port.settleGrant(input);
	} catch (error) {
		if (!isCandidateGrantDrainingError(error)) throw error;
		const remainingMs = options.deadlineAtMs - Date.now();
		if (remainingMs <= 0) throw error;
		await waitForSettlementRetry(Math.min(delayMs, remainingMs));
		if (Date.now() >= options.deadlineAtMs) throw error;
		delayMs = Math.min(delayMs * 2, SETTLEMENT_RETRY_MAX_DELAY_MS);
	}
}
function waitForSettlementRetry(delayMs) {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}
/** Only the gateway's explicit draining state is retryable; auth and ledger errors fail closed. */
function isCandidateGrantDrainingError(error) {
	if (typeof error !== "object" || error === null) return false;
	const candidate = error;
	if (candidate.code === "candidate_grant_draining") return true;
	return typeof candidate.message === "string" && /\bcandidate_grant_draining\b/u.test(candidate.message);
}
//#endregion
//#region src/candidate-execution/recover.ts
/** Close an expired crashed attempt from persisted non-secret handles, then record failure. */
async function recoverExpiredAgentCandidateExecution(options) {
	const record = await options.claimStore.getAttempt(options.attempt);
	if (!record) throw new Error("candidate execution recovery attempt is missing");
	if (record.terminal) return Object.freeze({
		finished: false,
		terminal: record.terminal,
		exactReplay: true
	});
	const cleanupTimeoutMs = candidateCleanupTimeout(options.cleanupTimeoutMs ?? record.claim.cleanup.cleanupTimeoutMs);
	if (cleanupTimeoutMs > record.claim.cleanup.cleanupTimeoutMs) throw new Error("recovery cleanup timeout exceeds the frozen preparation bound");
	if ((options.now ?? Date.now)() < record.claim.leaseExpiresAtMs) throw new Error("candidate execution lease has not expired");
	const cleanupDeadlineAtMs = candidateCleanupDeadline(cleanupTimeoutMs);
	const recoveryTraceStore = new RecoveryAgentCandidateTraceStore(options.traceStore);
	const preparation = withinCandidateCleanupDeadline(() => readRecoveryPreparation(record.claim, options.outputArtifacts), cleanupDeadlineAtMs, "expired candidate preparation evidence read");
	const processClosure = withinCandidateCleanupDeadline(async (cleanupSignal) => {
		sealAgentCandidateExecutorStopAcknowledgement(await options.executor.stop({
			executionId: record.claim.executionId,
			executionPlanDigest: record.claim.executionPlanDigest
		}, {
			traceStore: recoveryTraceStore,
			reason: "failed",
			signal: cleanupSignal,
			deadlineAtMs: cleanupDeadlineAtMs
		}));
		if (options.executor.dispose) {
			const disposed = await options.executor.dispose({
				executionId: record.claim.executionId,
				executionPlanDigest: record.claim.executionPlanDigest
			}, { signal: cleanupSignal });
			if (disposed.disposed !== true || Object.keys(disposed).some((key) => key !== "disposed")) throw new Error("expired candidate executor did not acknowledge resource disposal");
		}
		return { stopped: true };
	}, cleanupDeadlineAtMs, "expired candidate process termination");
	const modelClosure = withinCandidateCleanupDeadline(async () => sealAgentCandidateModelSettlement(await options.ports.models.settleGrant({
		executionId: record.claim.executionId,
		preparationId: record.claim.cleanup.preparationId,
		grantDigest: record.claim.cleanup.modelGrantDigest,
		resolved: record.claim.cleanup.resolvedModel,
		reason: "failed"
	}), {
		preparationId: record.claim.cleanup.preparationId,
		grantDigest: record.claim.cleanup.modelGrantDigest,
		model: record.claim.cleanup.resolvedModel.model
	}), cleanupDeadlineAtMs, "expired candidate model settlement");
	const memoryClosure = record.claim.cleanup.memory ? withinCandidateCleanupDeadline(async () => {
		const memory = record.claim.cleanup.memory;
		if (!memory) throw new Error("expired candidate memory handle is missing");
		const closed = await options.ports.memory.close({
			executionId: record.claim.executionId,
			preparationId: record.claim.cleanup.preparationId,
			accessDigest: memory.accessDigest,
			effectiveNamespace: memory.effectiveNamespace,
			reason: "failed"
		});
		if (closed.closed !== true || Object.keys(closed).some((key) => key !== "closed")) throw new Error("expired candidate memory did not acknowledge closure");
		return { closed: true };
	}, cleanupDeadlineAtMs, "expired candidate memory closure") : void 0;
	const closureOutcomes = Promise.allSettled([modelClosure, memoryClosure ?? Promise.resolve(void 0)]);
	const [preparationOutcome, processOutcome] = await Promise.allSettled([preparation, processClosure]);
	const failures = [preparationOutcome, processOutcome].filter((outcome) => outcome.status === "rejected").map((outcome) => outcome.reason);
	const [modelOutcome, memoryOutcome] = await closureOutcomes;
	for (const outcome of [modelOutcome, memoryOutcome]) if (outcome.status === "rejected") failures.push(outcome.reason);
	if (failures.length > 0) throw new AggregateError(failures, "expired candidate cleanup could not be proven");
	if (modelOutcome.status !== "fulfilled") throw new Error("expired candidate model settlement was not recovered");
	const model = modelOutcome.value;
	const modelSettlement = await withinCandidateCleanupDeadline(() => persistCandidateModelSettlementEvidence({
		executionId: record.claim.executionId,
		executionPlanDigest: record.claim.executionPlanDigest,
		resolvedModel: record.claim.cleanup.resolvedModel
	}, model, options.outputArtifacts), cleanupDeadlineAtMs, "expired candidate model-settlement persistence");
	const failureClass = record.phase === "claimed" && model.usage.modelCalls === 0 ? "pre-model-infrastructure" : "unknown";
	const failureEvidence = await withinCandidateCleanupDeadline(() => persistCandidateOutputArtifact(options.outputArtifacts, {
		executionId: record.claim.executionId,
		purpose: "failure-evidence",
		bytes: canonicalCandidateBytes$1({
			kind: "agent-candidate-recovery-failure",
			executionId: record.claim.executionId,
			attempt: record.claim.attempt,
			bundleDigest: record.claim.bundleDigest,
			executionPlanDigest: record.claim.executionPlanDigest,
			materializationReceiptDigest: record.claim.preparationEvidence.materializationReceipt.sha256,
			failureClass,
			processStopped: true,
			modelSettlementDigest: modelSettlement.digest,
			memoryClosed: record.claim.cleanup.memory !== void 0
		})
	}), cleanupDeadlineAtMs, "expired candidate failure-evidence persistence");
	const memory = record.claim.cleanup.memory;
	return await options.claimStore.recoverExpired(options.attempt, {
		failureClass,
		usage: model.usage,
		modelSettlement: modelSettlement.artifact,
		failureEvidence,
		process: {
			stopped: true,
			executionPlanDigest: record.claim.executionPlanDigest
		},
		model: {
			closed: true,
			preparationId: record.claim.cleanup.preparationId,
			grantDigest: record.claim.cleanup.modelGrantDigest
		},
		...memory ? { memory: {
			closed: true,
			preparationId: record.claim.cleanup.preparationId,
			accessDigest: memory.accessDigest,
			effectiveNamespace: memory.effectiveNamespace
		} } : {}
	});
}
async function readRecoveryPreparation(claim, artifacts) {
	const [planBytes, receiptBytes] = await Promise.all([readVerifiedArtifact(claim.preparationEvidence.executionPlan, artifacts), readVerifiedArtifact(claim.preparationEvidence.materializationReceipt, artifacts)]);
	const plan = agentCandidateExecutionPlanMaterialSchema.parse(parseCanonicalBytes(planBytes, "plan"));
	if (claim.preparationEvidence.executionPlan.sha256 !== claim.executionPlanDigest) throw new Error("recovery execution plan artifact does not match the claimed digest");
	const receiptMaterial = parseCanonicalBytes(receiptBytes, "materialization receipt");
	const receipt = agentCandidateMaterializationReceiptSchema.parse({
		...receiptMaterial,
		digest: claim.preparationEvidence.materializationReceipt.sha256
	});
	if (receipt.bundleDigest !== claim.bundleDigest || receipt.executionPlan.digest !== claim.executionPlanDigest || plan.runCell.bundleDigest !== claim.bundleDigest || plan.executionId !== claim.executionId) throw new Error("recovery preparation evidence does not match the durable claim");
	return {
		plan,
		receipt
	};
}
function parseCanonicalBytes(bytes, label) {
	let parsed;
	try {
		parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
	} catch (error) {
		throw new Error(`candidate recovery ${label} is not JSON`, { cause: error });
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`candidate recovery ${label} must be an object`);
	if (!Buffer.from(canonicalCandidateBytes$1(parsed)).equals(Buffer.from(bytes))) throw new Error(`candidate recovery ${label} bytes are not canonical`);
	return parsed;
}
//#endregion
//#region src/candidate-execution/workspace-tree.ts
/**
* A content digest over a DIRECTORY TREE, and the per-file seed that fills one.
*
* The question this answers is "is this workspace the same workspace" — the question every launch
* and every close of a branchable run has to answer, about a tree that a live process is still
* writing to. That is a different question from the one
* {@link scanMaterializedWorkspaceManifest} answers, and the difference decides the policies here:
*
*  - A candidate manifest describes ONE EXACT regular-file workspace. It refuses a symbolic link
*    outright, because `AgentCandidateWorkspaceManifestMaterial` has no representation for one, and
*    it refuses an entry that disappears, because a signed manifest describes a settled tree.
*  - A tree descriptor describes what a RUN PRODUCED. A python venv writes
*    `bin/python -> /usr/bin/python3` as a matter of course, and a work directory can lose an entry
*    between two directory reads. Refusing on either aborts the close, and a run that never wrote
*    its digest can never be branched from.
*
* So the two policies are the caller's, one for links and one for vanishing entries, and both
* default to `'refuse'` — the strict reading, correct for an INPUT seed, where a link that leaves
* the tree means the seed describes bytes it does not contain. `'exclude'` is the reading a close
* needs: the entry is never followed, it is recorded, and the exclusion itself is hashed, so two
* trees that differ only in an excluded entry cannot share a digest.
*
* NOTHING is held in memory. A file reaches the tree digest as its own streamed sha-256 plus its
* length, so the largest file in the tree does not decide whether the tree can be described:
* `readFile` refuses anything above 2 GiB with `ERR_FS_FILE_TOO_LARGE`, and a single multi-gigabyte
* artifact is exactly what a run leaves behind.
*
* @module
* @experimental
*/
const TREE_ALGORITHMS = /* @__PURE__ */ new Set(["tree-v1", "portable-tree-v1"]);
const ENTRY_POLICIES = /* @__PURE__ */ new Set(["refuse", "exclude"]);
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
async function describeWorkspaceTree(directory, options = {}) {
	const algorithm = options.algorithm ?? "tree-v1";
	const onEscapingLink = options.onEscapingLink ?? "refuse";
	const onMissingEntry = options.onMissingEntry ?? "refuse";
	if (!TREE_ALGORITHMS.has(algorithm)) throw new Error(`unsupported workspace tree algorithm: ${algorithm}`);
	for (const [name, policy] of [["onEscapingLink", onEscapingLink], ["onMissingEntry", onMissingEntry]]) if (!ENTRY_POLICIES.has(policy)) throw new Error(`unsupported workspace tree ${name} policy: ${policy}`);
	const root = resolve(directory);
	const rootStats = await lstatIfPresent(root);
	if (rootStats === null || !rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error(`workspace tree root must be a real directory: ${directory}`);
	const physicalRoot = await realpath(root);
	const hash = createHash("sha256");
	hash.update(`workspace-tree\0${algorithm}\0`);
	const counts = {
		files: 0,
		directories: 0,
		symlinks: 0,
		bytes: 0
	};
	const excluded = [];
	const exclude = (path, reason, target) => {
		const name = treePath(root, path);
		excluded.push(Object.freeze(target === void 0 ? {
			path: name,
			reason
		} : {
			path: name,
			reason,
			target
		}));
		hash.update(`excluded\0${name}\0${reason}\0${target ?? ""}\0`);
	};
	/** True when the caller asked to continue past a vanished entry, and it was not the root. */
	const recordMissing = (path) => {
		if (onMissingEntry === "refuse" || path === root) return false;
		exclude(path, "entry-disappeared");
		return true;
	};
	const visit = async (path) => {
		const info = await lstatIfPresent(path);
		if (info === null) {
			if (recordMissing(path)) return;
			throw new Error(`workspace tree entry disappeared during the walk: ${treePath(root, path)}`);
		}
		const name = treePath(root, path);
		const mode = entryMode(info.mode, algorithm, info.isDirectory(), info.isSymbolicLink());
		if (info.isDirectory()) {
			let entries;
			try {
				entries = await readdir(path);
			} catch (error) {
				if (isMissing(error) && recordMissing(path)) return;
				throw error;
			}
			counts.directories += 1;
			hash.update(`directory\0${name}\0${mode}\0`);
			for (const entry of entries.sort()) await visit(join(path, entry));
			return;
		}
		if (info.isSymbolicLink()) {
			await visitSymbolicLink(path, name, mode);
			return;
		}
		if (!info.isFile()) throw new Error(`workspace tree contains an unsupported entry: ${name}`);
		const read = await digestFile(path);
		if (read === null) {
			if (recordMissing(path)) return;
			throw new Error(`workspace tree entry disappeared during the walk: ${name}`);
		}
		counts.files += 1;
		counts.bytes += read.byteLength;
		hash.update(`file\0${name}\0${mode}\0${read.byteLength}\0${read.sha256}\0`);
	};
	const visitSymbolicLink = async (path, name, mode) => {
		let target;
		try {
			target = await readlink(path);
		} catch (error) {
			if (isMissing(error) && recordMissing(path)) return;
			throw error;
		}
		const refuse = (reason) => {
			if (onEscapingLink === "refuse") throw new Error(`workspace tree contains a link that ${reasonText(reason)}: ${name} -> ${target}`);
			exclude(path, reason, target);
		};
		if (isAbsolute(target)) return refuse("absolute-symlink");
		if (!isWithin(root, resolve(dirname(path), target))) return refuse("symlink-escapes-tree");
		let physicalTarget;
		try {
			physicalTarget = await realpath(path);
		} catch {
			return refuse("unresolved-symlink");
		}
		if (!isWithin(physicalRoot, physicalTarget)) return refuse("symlink-resolves-outside-tree");
		counts.symlinks += 1;
		hash.update(`symlink\0${name}\0${mode}\0${target}\0`);
	};
	await visit(root);
	return Object.freeze({
		algorithm,
		digest: `sha256:${hash.digest("hex")}`,
		files: counts.files,
		directories: counts.directories,
		symlinks: counts.symlinks,
		bytes: counts.bytes,
		excluded: Object.freeze(excluded)
	});
}
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
async function seedWorkspaceTree(input) {
	const source = resolve(input.source);
	const destination = resolve(input.destination);
	if (source === destination || isWithin(source, destination)) throw new Error("workspace seed must not contain its destination");
	const destinationStats = await lstatIfPresent(destination);
	if (destinationStats === null || !destinationStats.isDirectory()) throw new Error(`workspace seed destination must be an existing directory: ${input.destination}`);
	const descriptor = await describeWorkspaceTree(source, { ...input.algorithm === void 0 ? {} : { algorithm: input.algorithm } });
	for (const name of (await readdir(source)).sort()) {
		if (await lstatIfPresent(join(destination, name)) !== null) throw new Error(`workspace seed would overwrite an existing entry: ${name}`);
		await cp(join(source, name), join(destination, name), {
			recursive: true,
			force: false,
			errorOnExist: true,
			verbatimSymlinks: true
		});
	}
	return descriptor;
}
/** Stream one regular file into its own digest, or `null` when it vanished mid-read. */
async function digestFile(path) {
	let descriptor;
	try {
		descriptor = await open(path, constants.O_RDONLY | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0));
	} catch (error) {
		if (isMissing(error)) return null;
		throw error;
	}
	try {
		const hash = createHash("sha256");
		const buffer = Buffer.allocUnsafe(1024 * 1024);
		let total = 0;
		while (true) {
			const { bytesRead } = await descriptor.read(buffer, 0, buffer.byteLength, null);
			if (bytesRead === 0) break;
			total += bytesRead;
			hash.update(buffer.subarray(0, bytesRead));
		}
		return {
			sha256: `sha256:${hash.digest("hex")}`,
			byteLength: total
		};
	} finally {
		await descriptor.close();
	}
}
/** Git records exactly two file modes; a portable tree records the same two, plus 755 for a
*  directory and 777 for a link, which is what every filesystem reports for one. */
function entryMode(mode, algorithm, isDirectory, isSymbolicLink) {
	const bits = Number(mode);
	if (algorithm !== "portable-tree-v1") return String(bits & 511);
	if (isDirectory) return "755";
	if (isSymbolicLink) return "777";
	return (bits & 73) !== 0 ? "755" : "644";
}
function reasonText(reason) {
	switch (reason) {
		case "absolute-symlink": return "is absolute";
		case "symlink-escapes-tree": return "escapes its tree";
		case "symlink-resolves-outside-tree": return "resolves outside its tree";
		default: return "does not resolve";
	}
}
function treePath(root, path) {
	return relative(root, path).split(sep).join("/") || ".";
}
function isWithin(root, path) {
	return path === root || path.startsWith(`${root}${sep}`);
}
function isMissing(error) {
	return error?.code === "ENOENT";
}
async function lstatIfPresent(path) {
	try {
		return await lstat(path);
	} catch (error) {
		if (isMissing(error)) return null;
		throw error;
	}
}
//#endregion
export { AGENT_CANDIDATE_EXECUTION_SUPPORT, CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV, CANDIDATE_KNOWLEDGE_ROOT_ENV, CANDIDATE_TRACE_ENV, CANDIDATE_TRACE_TAGS, FileAgentCandidateExecutionClaimStore, InMemoryAgentCandidateExecutionClaimStore, agentCandidateProfileAsAgentProfile, applyExactAgentProfileDiff, assertCandidateProfileBinding, buildAgentCandidateBundle, candidateExecutionClaim, candidateKnowledgeExecutionPaths, candidateWorkspaceManifest, captureAgentCandidateWorkspace, captureAgentCandidateWorkspaceFiles, createAgentCandidateWorkspacePort, createProtectedAgentCandidateModelPort, describeWorkspaceTree, disposePreparedAgentCandidateExecution, exactProcessProviderAsCandidateExecutor, executePreparedAgentCandidate, freezeGenericAgentCandidateProfile, omitUndefinedObjectFields, parseExactAgentProfile, parseExactAgentProfileDiff, parseExactCandidateProfile, persistCandidateOutputArtifact, prepareAgentCandidateExecution, recoverExpiredAgentCandidateExecution, runProtectedAgentCandidateModelGrant, scanMaterializedWorkspaceManifest, sealAgentCandidateBundle, seedWorkspaceTree, verifyAgentCandidateBundle, verifyMaterializedWorkspace };

//# sourceMappingURL=index.js.map