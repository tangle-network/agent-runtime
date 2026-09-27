import { $i as detachedSnapshot, At as createExecutor, Cr as runAbortable, Ia as armDeadlineTimer, Qr as runSettledCommand, Sr as linkAbort, ui as terminateProcessTreeAndConfirm } from "./supervisor-DtlPj9me.js";
import { i as ConfigError } from "./errors-DodWX-cb.js";
import { A as collectAgentTurn, O as optimizerMethod, a as defaultStructuralRolloutPolicy, j as streamAgentTurn } from "./structural-rollout-D-0X6lsU.js";
import { a as concreteProfileModel, t as assertExecutableAgentProfile } from "./model-policy-BbSCSak0.js";
import { A as verifyCanonicalCandidateDocument, C as canonicalCandidateDigest$1, D as immutableCandidateValue, O as omitTopLevelDigest, S as canonicalCandidateBytes$1, k as sha256Bytes$1, w as canonicalCandidateDocument } from "./workspace-archive-C9lgf77y.js";
import { i as syncDurableDirectory, r as publishExclusiveDurableFile } from "./durable-file-DWQA4ooo.js";
import { t as runAnalystLoop } from "./analyst-loop-DZw5QWT9.js";
import { c as executePreparedAgentCandidate, o as verifiedResourceTextByDigest, s as verifyAgentCandidateBundle, t as prepareAgentCandidateExecution } from "./prepare-DVlvGP7V.js";
import { a as assertCandidateProfileBinding, c as createAgentCandidateProfileActivation, d as omitUndefinedObjectFields, f as parseAgentCandidateProfileActivation, i as applyExactAgentProfileDiff, p as parseExactAgentProfile, r as agentCandidateProfileAsAgentProfile, u as materializeAgentCandidateProfilePlan } from "./profile-D3eXNBQV.js";
import { AGENT_IMPROVEMENT_SOURCE_METADATA_KEY, agentCandidateMaterializationReceiptSchema, agentCandidateRunReceiptSchema, agentImprovementActivationSchema, agentImprovementProposalSchema, agentImprovementReviewSchema, agentImprovementSourceMetadata, agentImprovementSourceSchema, agentProfileDiffSchema, agentProfileEnvironmentSchema, agentProfileImprovementArmSchema, agentProfileImprovementExecutionRefSchema, agentProfileModelHintsSchema, agentProfileSchema, agentProfileTrainingSchema, agentTrainingDatasetIdentitySchema, agentTrainingParametersSchema, agentTrainingReceiptSchema, agentTrainingTaskKey, agentTrainingTaskSchema, applyAgentProfileDiff, candidateExecutionEvidenceSchema, canonicalAgentProfileDigest, canonicalCandidateBytes, changedProfileImprovementSurfaces, defineAgentProfileDiff, diffAgentProfiles, numbersApproximatelyEqual, sha256DigestSchema, snapshotAgentProfile, trainedModelIdForArtifact } from "@tangle-network/agent-interface";
import { CostLedger, canonicalJson, makeProposalFinding } from "@tangle-network/agent-eval";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { constants, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { chmod, mkdir, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { redact } from "@tangle-network/agent-eval/traces";
import { assertProposalFindings } from "@tangle-network/agent-eval/analyst";
import { SearchRecorder, campaignCellSearchResult, campaignScenarioIdentity, campaignSplitDigestFromIdentities, compareOptimizationMethods, createRunCostLedger, fsCampaignStorage, gitWorktreeAdapter, incumbent, isProposedCandidate, openSearchLedger, renderSearchSummary, resolveRunDir, runCampaign, runSearch, searchClaimReserveUsd, searchProposalExecution, searchProposerView, searchReceiptAccounting, uniform, verifyCodeSurface, verifySearchHistoryArtifact } from "@tangle-network/agent-eval/campaign";
import { measuredComparisonFromAgentProfileImprovementExperiment, measuredComparisonFromCandidateExperiment, runAgentProfileImprovementExperiment, runCandidateExperiment, sealAgentProfileImprovementExperiment, sealAgentProfileImprovementSuite, sealAgentProfileImprovementTask, sealCandidateExperiment, selfImprove, verifyAgentProfileImprovementExperimentComparison, verifyCandidateExperiment, verifyCandidateExperimentComparison } from "@tangle-network/agent-eval/contract";
import { defineEvaluationClaim, summarizeEvaluationUnits } from "@tangle-network/agent-eval/experiment";
//#region src/improvement/worktree-tree.ts
/**
* The exact content of a candidate worktree, as a Git tree object.
*
* A multi-shot candidate edits ONE directory in place, so the tree a shot
* produced is gone as soon as the next shot writes over it. Writing that
* content into the object store is what makes an earlier tree recoverable:
* `agenticGenerator` snapshots a tree that verified, and puts it back when a
* later shot ends the budget on a worse one.
*
* The snapshot stages into a PRIVATE index file, so the index the driver later
* commits from is untouched.
*/
/** Write the worktree's current content into the object store and return its tree id. */
function snapshotWorktreeTree(worktreePath) {
	const scratch = mkdtempSync(join(tmpdir(), "agentic-generator-tree-"));
	const indexFile = join(scratch, "index");
	try {
		git(worktreePath, ["read-tree", "HEAD"], indexFile);
		git(worktreePath, ["add", "--all"], indexFile);
		return git(worktreePath, ["write-tree"], indexFile);
	} finally {
		rmSync(scratch, {
			recursive: true,
			force: true
		});
	}
}
/**
* Put a snapshotted tree back into the worktree, then prove the directory
* holds exactly that tree.
*
* The proof is not ceremony: a restore that lands the wrong bytes ships the
* wrong candidate, and every artifact downstream still reads as though the
* best tree shipped.
*/
function restoreWorktreeTree(worktreePath, tree) {
	git(worktreePath, [
		"read-tree",
		"-u",
		"--reset",
		tree
	]);
	git(worktreePath, [
		"clean",
		"--force",
		"-d",
		"--quiet"
	]);
	const restored = snapshotWorktreeTree(worktreePath);
	if (restored !== tree) throw new Error(`agenticGenerator: restoring tree ${tree} into ${worktreePath} produced ${restored}`);
}
function git(cwd, args, indexFile) {
	const env = { ...process.env };
	if (indexFile) env.GIT_INDEX_FILE = indexFile;
	else delete env.GIT_INDEX_FILE;
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf-8",
		env
	});
	if (result.error) throw new Error(`agenticGenerator: git ${args[0]} failed to spawn in ${cwd}: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`agenticGenerator: git ${args[0]} exited ${result.status} in ${cwd}: ${result.stderr.trim()}`);
	return result.stdout.trim();
}
//#endregion
//#region src/improvement/agentic-generator.ts
/**
*
* `agenticGenerator` — the full-agentic `CandidateGenerator`. It runs a real
* authored profile inside the candidate worktree the driver already created,
* letting the agent read the codebase + the research proposal findings and
* make the change in place. The driver then commits the worktree into a
* `CodeSurface`.
*
* Every paid shot enters Runtime through `createExecutor` + `streamAgentTurn`.
* The caller supplies the exact `AgentProfile` and a worktree-aware executor
* placement; Runtime validates and records the profile that actually ran. Two
* built-in placements edit the supplied worktree itself: `{ backend:'cli-in-place',
* workspacePath: worktreePath }` runs a local coding CLI (claude-code / codex /
* opencode / pi) in that directory, and `{ backend:'bridge', cwd: worktreePath }`
* runs a cli-bridge session there. `cli-worktree` is NOT one of them — it cuts a
* worktree of its own, so every shot would read as an empty tree.
*
* `maxShots` is the DEPTH dial — a multi-shot verify-in-session loop, NOT the
* kernel `runAgentRounds`. Each shot runs one full harness session in the (persistent)
* worktree; between shots the loop refines based on what the last shot produced:
*   - empty tree   → "you changed nothing, make the edits" → retry
*   - dirty + `verify` fails → feed the verifier's failure into the next shot
*       (the worktree persists, so the harness RESUMES atop its own failing
*       edits with the error in hand — no session-specific retry path needed)
*   - dirty + `verify` ok (or no verifier configured) → return the candidate
*   - dirty + `verify` ok + `keepGoing` → bank the tree and spend the next shot
* A candidate that never verifies within `maxShots` is discarded (`applied:
* false`), never shipped — if you configured a verifier, a non-passing tree is
* not a candidate. With no verifier, the first dirty shot is the candidate.
*
* BEST-OF-N is the `keepGoing` path, and the loop owns it end to end. A
* verifier that passes a tree and asks for another shot has its tree
* snapshotted as a Git tree object; when the budget ends, the highest-`score`
* tree is RESTORED into the worktree and returned as the candidate. So the
* caller ranks and the loop moves the bytes — a caller never has to write a
* passing tree back itself. The budget ends on the last shot, or earlier on a
* `keepGoing`-less pass, and a last shot that broke or reverted the change does
* not cost the candidate the verified tree an earlier shot produced.
*
* @stable
*/
const RAW_TRACE_ANALYST_ID = "raw-trace-distiller";
const RAW_TRACE_AREA = "raw-trace-context";
const RAW_TRACE_DIAGNOSIS_PATH = ".improve/raw-trace-diagnosis.md";
/** Full-agentic `CandidateGenerator`: run an exact profiled author inside the existing candidate worktree. */
function agenticGenerator(opts) {
	const profile = detachedSnapshot(agentProfileSchema.parse(opts.profile), "agenticGenerator profile");
	assertExecutableAgentProfile(profile, "agenticGenerator");
	const harness = profile.harness;
	const provider = profile.model.provider.trim();
	const model = concreteProfileModel(profile);
	const profileDigest = canonicalAgentProfileDigest(profile);
	const dirty = opts.isDirty ?? worktreeDirty;
	const verify = opts.verify;
	return {
		kind: `agentic:${harness}`,
		proposesWithoutFindings: true,
		async generate({ worktreePath, findings, maxShots, signal, generation, candidateIndex, costLedger, costPhase }) {
			signal.throwIfAborted();
			if (opts.maximumCharge && !costLedger) throw new Error("agenticGenerator: maximumCharge requires the run-wide CostLedger supplied by agent-eval");
			const basePrompt = opts.buildPrompt({ findings });
			if (typeof basePrompt !== "string" || basePrompt.trim().length === 0) throw new Error("agenticGenerator: buildPrompt must return a non-empty string");
			const executorConfig = opts.executorForWorktree(worktreePath);
			if (executorConfig.backend === "bridge" && !samePath(executorConfig.cwd, worktreePath)) throw new Error("agenticGenerator: bridge executor cwd must equal the candidate worktree path");
			if (executorConfig.backend === "cli-in-place" && !samePath(executorConfig.workspacePath, worktreePath)) throw new Error("agenticGenerator: cli-in-place executor workspacePath must equal the candidate worktree path");
			const factory = createExecutor(executorConfig);
			const needsRawTraceEvidence = requiresRawTraceEvidence(findings);
			const shots = Math.max(1, maxShots);
			let attemptNote = "";
			let best = null;
			let scored = null;
			let lastReceipt = null;
			/** Ship the best tree this candidate produced, restoring it when a later
			*  shot wrote over it. */
			const shipBankedTree = async (receipt, banked) => {
				const restoredFromShot = banked.onDisk ? null : banked.shot;
				if (!banked.onDisk) {
					if (banked.tree === null) throw new Error(`agenticGenerator: shot ${banked.shot} produced the best tree but it was never snapshotted`);
					restoreWorktreeTree(worktreePath, banked.tree);
					banked.onDisk = true;
				}
				signal.throwIfAborted();
				await emitShotDisposition(opts.onShotDisposition, receipt, {
					kind: "accepted",
					worktreePath,
					verified: true,
					restoredFromShot
				});
				signal.throwIfAborted();
				return acceptedCandidate(findings);
			};
			for (let shot = 0; shot < shots; shot++) {
				signal.throwIfAborted();
				if (best) best.onDisk = false;
				const taskPrompt = attemptNote ? `${basePrompt}\n\n${attemptNote}` : basePrompt;
				const startedAt = /* @__PURE__ */ new Date();
				let turn = null;
				let costReceipt = null;
				let costCallId = null;
				let shotError = null;
				try {
					const execute = async (executionSignal, callId) => {
						turn = await collectAgentTurn(streamAgentTurn({
							kind: "executor",
							profile,
							factory
						}, { prompt: taskPrompt }, {
							signal: executionSignal,
							...opts.timeoutMs !== void 0 ? { timeoutMs: opts.timeoutMs } : {},
							...callId ? { callId } : {}
						}));
						const failure = shotFailure(turn);
						if (failure) throw failure;
						return turn;
					};
					if (costLedger) {
						const paid = await costLedger.runPaidCall({
							channel: "driver",
							phase: costPhase ?? "search.proposal",
							actor: `agentic-generator:${harness}`,
							model,
							tags: {
								generation: String(generation ?? -1),
								candidateIndex: String(candidateIndex ?? -1),
								shot: String(shot + 1)
							},
							signal,
							...opts.maximumCharge ? { maximumCharge: opts.maximumCharge } : {},
							execute: (executionSignal, callId) => execute(executionSignal, callId),
							receipt: (result) => costReceiptFromTurn(result, model),
							receiptFromError: () => turn ? costReceiptFromTurn(turn, model) : void 0
						});
						costCallId = paid.callId ?? null;
						costReceipt = paid.receipt ?? null;
						if (!paid.succeeded) throw paid.error;
						turn = paid.value;
					} else turn = await execute(signal);
				} catch (cause) {
					shotError = cause instanceof Error ? cause : new Error(String(cause));
				}
				const execution = turn ? detachedSnapshot(turn, "agenticGenerator shot execution") : null;
				const receipt = shotReceipt({
					generation,
					candidateIndex,
					shot,
					maxShots: shots,
					harness,
					provider,
					model,
					profile,
					profileDigest,
					prompt: taskPrompt,
					startedAt,
					completedAt: /* @__PURE__ */ new Date(),
					result: execution,
					costCallId,
					costReceipt,
					error: shotError
				});
				lastReceipt = receipt;
				await emitShotReceipt(opts.onShotCompleted, receipt, execution, shotError);
				signal.throwIfAborted();
				if (!execution) throw new Error("agenticGenerator: author shot completed without a Runtime turn");
				let worktreeChanged;
				try {
					worktreeChanged = dirty(worktreePath);
				} catch (cause) {
					signal.throwIfAborted();
					return rethrowShotSetupError(opts.onShotDisposition, receipt, worktreePath, "worktree-inspection", cause);
				}
				if (!worktreeChanged) {
					signal.throwIfAborted();
					await emitShotDisposition(opts.onShotDisposition, receipt, {
						kind: "clean",
						worktreePath
					});
					signal.throwIfAborted();
					attemptNote = EMPTY_TREE_NOTE;
					continue;
				}
				if (needsRawTraceEvidence) {
					let problem;
					try {
						problem = rawTraceEvidenceProblem(worktreePath, findings);
					} catch (cause) {
						signal.throwIfAborted();
						return rethrowShotSetupError(opts.onShotDisposition, receipt, worktreePath, "raw-trace-evidence", cause);
					}
					if (problem) {
						signal.throwIfAborted();
						await emitShotDisposition(opts.onShotDisposition, receipt, {
							kind: "rejected",
							worktreePath,
							stage: "raw-trace-evidence",
							feedback: problem
						});
						signal.throwIfAborted();
						attemptNote = problem;
						continue;
					}
				}
				if (!verify) {
					signal.throwIfAborted();
					await emitShotDisposition(opts.onShotDisposition, receipt, {
						kind: "accepted",
						worktreePath,
						verified: false,
						restoredFromShot: null
					});
					signal.throwIfAborted();
					return acceptedCandidate(findings);
				}
				let result;
				try {
					signal.throwIfAborted();
					result = await verify(worktreePath, signal);
					signal.throwIfAborted();
				} catch (cause) {
					signal.throwIfAborted();
					return rethrowShotSetupError(opts.onShotDisposition, receipt, worktreePath, "verification", cause);
				}
				if (result.ok) {
					const score = admittedScore(result, scored, shot);
					scored = score !== null;
					const previousBest = best;
					let banked;
					if (previousBest === null || (score ?? 0) >= (previousBest.score ?? 0)) banked = {
						shot: shot + 1,
						score,
						tree: null,
						onDisk: true
					};
					else banked = previousBest;
					const becomesBest = banked !== previousBest;
					best = banked;
					if (result.keepGoing !== true) {
						signal.throwIfAborted();
						return await shipBankedTree(receipt, banked);
					}
					if (becomesBest && shot < shots - 1) banked.tree = snapshotWorktreeTree(worktreePath);
					signal.throwIfAborted();
					await emitShotDisposition(opts.onShotDisposition, receipt, {
						kind: "kept",
						worktreePath,
						score,
						best: becomesBest,
						feedback: result.feedback ?? null
					});
					signal.throwIfAborted();
					attemptNote = keptNote(result.feedback);
					continue;
				}
				signal.throwIfAborted();
				await emitShotDisposition(opts.onShotDisposition, receipt, {
					kind: "rejected",
					worktreePath,
					stage: "verification",
					feedback: result.feedback ?? null
				});
				signal.throwIfAborted();
				attemptNote = failureNote(result.feedback);
			}
			if (best !== null) {
				if (!lastReceipt) throw new Error("agenticGenerator: a tree was banked without a shot receipt");
				return await shipBankedTree(lastReceipt, best);
			}
			return {
				applied: false,
				summary: ""
			};
		}
	};
}
/** The rank a passing tree carries, refusing a set of trees that cannot be ordered. */
function admittedScore(result, scored, shot) {
	const has = result.score !== void 0;
	if (scored !== null && has !== scored) throw new Error(`agenticGenerator: verify ${has ? "scored" : "did not score"} the tree from shot ${shot + 1} and ${scored ? "scored" : "did not score"} an earlier passing tree; a scored tree cannot be ranked against an unscored one`);
	if (!has) return null;
	if (typeof result.score !== "number" || !Number.isFinite(result.score)) throw new Error(`agenticGenerator: verify returned a non-finite score (${String(result.score)}) for shot ${shot + 1}`);
	return result.score;
}
async function emitShotReceipt(callback, receipt, execution, primaryError) {
	try {
		await callback?.(receipt, execution);
	} catch (callbackError) {
		if (primaryError !== null) throw new AggregateError([primaryError, callbackError], "agenticGenerator: author shot failed and its receipt could not be persisted");
		throw callbackError;
	}
	if (primaryError !== null) throw primaryError;
}
async function emitShotDisposition(callback, receipt, disposition) {
	await callback?.(receipt, disposition);
}
async function rethrowShotSetupError(callback, receipt, worktreePath, stage, cause) {
	const error = cause instanceof Error ? cause : new Error(String(cause));
	try {
		await emitShotDisposition(callback, receipt, {
			kind: "setup-error",
			worktreePath,
			stage,
			error: {
				name: error.name,
				message: error.message
			}
		});
	} catch (callbackError) {
		throw new AggregateError([cause, callbackError], "agenticGenerator: shot processing failed and its worktree disposition could not be persisted");
	}
	throw cause;
}
function shotReceipt(input) {
	const error = input.error ? {
		name: input.error instanceof Error ? input.error.name : "Error",
		message: input.error instanceof Error ? input.error.message : String(input.error)
	} : null;
	const result = input.result;
	const costBasis = costBasisFor(input.costReceipt, result);
	const costUsd = input.costReceipt?.costUsd ?? result?.usage.costUsd ?? result?.usage.estimatedCostUsd ?? null;
	return {
		generation: input.generation ?? null,
		candidateIndex: input.candidateIndex ?? null,
		shot: input.shot + 1,
		maxShots: input.maxShots,
		profileDigest: input.profileDigest,
		harness: input.harness,
		provider: input.provider,
		model: input.model,
		reasoningEffort: input.profile.model?.reasoningEffort ?? null,
		promptSha256: sha256(input.prompt),
		startedAt: input.startedAt.toISOString(),
		completedAt: input.completedAt.toISOString(),
		durationMs: input.completedAt.getTime() - input.startedAt.getTime(),
		status: result?.status ?? null,
		usage: result ? { ...result.usage } : null,
		transportAttempts: result?.transportAttempts ?? null,
		costCallId: input.costCallId,
		costBasis,
		costUsd: costBasis === "unknown" ? null : costUsd,
		costUsdKnown: costBasis === "provider-reported",
		error
	};
}
function costBasisFor(receipt, turn) {
	if (receipt) {
		if (receipt.costUnknown) return "unknown";
		return receipt.actualCostUsd === void 0 ? "estimated-pricing" : "provider-reported";
	}
	if (turn?.usage.usdKnown !== false && turn?.usage.costUsd !== void 0) return "provider-reported";
	return turn?.usage.estimatedCostUsd !== void 0 ? "estimated-pricing" : "unknown";
}
function shotFailure(result) {
	if (result.status === "completed") return null;
	if (result.status === "aborted") return /* @__PURE__ */ new Error("agenticGenerator: author shot was cancelled by the caller");
	return /* @__PURE__ */ new Error(`agenticGenerator: author shot failed${result.error?.message ? `: ${result.error.message}` : ""}`);
}
function costReceiptFromTurn(result, model) {
	const tokensKnown = result.usage.tokensKnown !== false;
	const actualCostUsd = result.usage.usdKnown === false ? void 0 : result.usage.costUsd;
	const cachedTokens = promptCacheReadTokens(result.usage);
	return {
		model,
		inputTokens: tokensKnown ? Math.max(0, result.usage.input - (cachedTokens ?? 0)) : 0,
		outputTokens: tokensKnown ? result.usage.output : 0,
		...tokensKnown ? {} : { usageUnknown: true },
		...cachedTokens !== void 0 ? { cachedTokens } : {},
		...result.usage.reasoningTokens !== void 0 ? { reasoningTokens: result.usage.reasoningTokens } : {},
		...actualCostUsd !== void 0 ? { actualCostUsd } : result.usage.estimatedCostUsd !== void 0 ? { estimatedCostUsd: result.usage.estimatedCostUsd } : { costUnknown: true }
	};
}
function promptCacheReadTokens(usage) {
	const cache = usage.promptCache;
	if (!cache) return void 0;
	for (const field of [
		"readTokens",
		"cachedInputTokens",
		"cacheReadInputTokens"
	]) {
		const value = cache[field];
		if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
	}
}
function sha256(value) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
/** Turn proposal findings into a concrete coder task —
*  the senior scientific-method framing shared with the tool/MCP build prompts. */
function defaultBuildPrompt(args) {
	const lines = [
		"You are improving this codebase based on an evaluation analysis: real runs failed, an",
		"analyst distilled the findings below, and your change will be measured on held-out tasks",
		"against the unchanged baseline — only a real lift promotes it.",
		"",
		optimizerMethod,
		"",
		"THE SURFACE — what a deliverable change looks like here:",
		"- edit this codebase in place: the smallest coherent change set that fully tests your",
		"  hypothesis about the dominant failure mode (see the method above — no unrelated edits,",
		"  they confound the measurement),",
		"- keep the diff reviewable: a reviewer should be able to trace every hunk back to a finding,",
		"- do not commit — leave changes in the working tree.",
		"",
		"FINDINGS — ranked evidence from real failed runs:"
	];
	for (const f of args.findings) {
		const where = f.subject ? ` [${f.subject}]` : "";
		lines.push(`- (${f.severity})${where} ${f.claim}`);
		if (f.recommended_action) lines.push(`    → ${f.recommended_action}`);
	}
	if (requiresRawTraceEvidence(args.findings)) lines.push("", "Raw trace evidence requirement:", `- Inspect at least one raw trace path named above before editing.`, `- Write ${RAW_TRACE_DIAGNOSIS_PATH} in this worktree.`, "- Include the exact trace path(s) inspected, the failure mechanism, and the code change made.", "- A candidate without this file, or with only this file changed, is discarded.");
	return lines.join("\n");
}
const EMPTY_TREE_NOTE = "NOTE: your previous attempt left the working tree unchanged. Make the concrete file edits now.";
/** Next-shot feedback when the worktree is dirty but failed verification. The
*  edits persist on disk, so the harness resumes atop them — tell it to fix in
*  place, not start over. Verifier detail is truncated to keep the prompt bounded. */
function failureNote(feedback) {
	const detail = feedback?.trim();
	return [
		"NOTE: your edits are in the working tree but verification FAILED.",
		"Fix the problem in place — build on your existing edits, do not revert them.",
		detail ? `Verifier output:\n${truncate$1(detail, 4e3)}` : "No verifier detail was captured."
	].join("\n");
}
/** Next-shot feedback when the worktree PASSED and the verifier asked for
*  another shot. The passing tree is banked, so the author is told to improve
*  it rather than protect it — a worse tree cannot cost it the candidate. */
function keptNote(feedback) {
	const detail = feedback?.trim();
	return [
		"NOTE: your edits are in the working tree and verification PASSED.",
		"Shots remain in this budget — keep improving the change in place, do not revert it.",
		"The best version you produce is the one that ships.",
		detail ? `Verifier output:\n${truncate$1(detail, 4e3)}` : "No verifier detail was captured."
	].join("\n");
}
function rawTraceEvidenceProblem(worktreePath, findings) {
	if (worktreeChangedPaths(worktreePath).filter((path) => path !== RAW_TRACE_DIAGNOSIS_PATH).length === 0) return [`NOTE: raw-trace mode requires a real code/config edit in addition to ${RAW_TRACE_DIAGNOSIS_PATH}.`, "Your previous attempt only changed the diagnosis artifact. Inspect the cited traces and make the causal code change."].join("\n");
	const diagnosisPath = join(worktreePath, RAW_TRACE_DIAGNOSIS_PATH);
	if (!existsSync(diagnosisPath)) return [`NOTE: raw-trace mode requires ${RAW_TRACE_DIAGNOSIS_PATH}.`, "Before retrying, inspect at least one cited spans.jsonl/cached-result.json/artifact path, then write the diagnosis file with the exact path, failure mechanism, and code change."].join("\n");
	const body = readFileSync(diagnosisPath, "utf8");
	const evidencePaths = traceEvidencePaths(findings);
	if (evidencePaths.length > 0 && !evidencePaths.some((path) => body.includes(path))) return [`${RAW_TRACE_DIAGNOSIS_PATH} exists, but it does not cite any exact raw trace path from the findings.`, `Cite at least one of these inspected paths exactly: ${evidencePaths.slice(0, 5).join(", ")}`].join("\n");
	return null;
}
function requiresRawTraceEvidence(findings) {
	return findings.some((finding) => {
		const f = finding;
		return f.analyst_id === RAW_TRACE_ANALYST_ID || f.area === RAW_TRACE_AREA;
	});
}
function traceEvidencePaths(findings) {
	const out = [];
	for (const finding of findings) {
		const refs = finding.evidence_refs;
		if (!Array.isArray(refs)) continue;
		for (const ref of refs) {
			if (!ref || typeof ref !== "object") continue;
			const uri = ref.uri;
			if (typeof uri === "string" && uri.length > 0) out.push(uri);
		}
	}
	return [...new Set(out)];
}
/** A `Verifier` that runs a command in the worktree: exit 0 ⇒ ok, any other
*  exit ⇒ failed with stdout+stderr as feedback. The common case — verify by
*  `tsc --noEmit`, `pnpm build`, or a test command. A timeout is treated as a
*  FAILED candidate (a change that hangs the build is a bad change); a missing
*  binary or spawn fault throws (a setup bug, not a failed candidate — no
*  silent fallback). */
function commandVerifier(command, args = [], timeoutMs = 3e5) {
	return async (worktreePath, signal) => {
		let result;
		try {
			result = await runSettledCommand({
				command,
				args,
				cwd: worktreePath,
				timeoutMs,
				...signal ? { signal } : {}
			});
		} catch (err) {
			signal?.throwIfAborted();
			if (err.code === "ENOENT") throw new Error(`commandVerifier: '${command}' not found in PATH (setup bug, not a failed candidate)`);
			const reason = err instanceof Error ? err.message : String(err);
			throw new Error(`commandVerifier: '${command}' failed to spawn: ${reason}`);
		}
		if (result.timedOut || result.killedBySignal) return {
			ok: false,
			feedback: `verifier '${command}' ${result.killedBySignal ? `killed by ${result.killedBySignal}` : "timed out"} after ${timeoutMs}ms`
		};
		if (result.exitCode === 0) return { ok: true };
		const out = `${result.stdout}${result.stderr}`.trim();
		return {
			ok: false,
			feedback: out.length > 0 ? out : `exit ${result.exitCode}`
		};
	};
}
/** A one-line summary for the commit message, derived from the findings. */
function summarizeFindings(findings) {
	if (findings.length === 0) return "agentic improvement";
	if (findings.length === 1) return `agentic: ${truncate$1(findings[0].claim, 64)}`;
	return `agentic: ${findings.length} findings addressed`;
}
/**
* The accepted-shot result: summary (commit message) + the attribution pair
* the driver wraps into a `ProposedCandidate`, so the candidate stays
* attributable through `GenerationRecord` and the emitted provenance instead
* of landing as an anonymous surface.
*/
function acceptedCandidate(findings) {
	const summary = summarizeFindings(findings);
	return {
		applied: true,
		summary,
		label: slugify(summary.split("\n", 1)[0] ?? summary),
		rationale: boundedRationale(summary, findings)
	};
}
/** Short slug from the summary's first line — the candidate's human label. */
function slugify(line) {
	return truncate$1(line.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "agentic-improvement", 48);
}
/** Bounded "because Z" for the candidate: the findings it addressed, or the
*  summary itself when the change was proposed from raw repo/trace context. */
function boundedRationale(summary, findings) {
	if (findings.length === 0) return summary;
	return truncate$1(findings.map((finding) => `(${finding.severity}) ${finding.claim}`).join("; "), 400);
}
function truncate$1(s, n) {
	return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
/** Non-empty `git status --porcelain` ⇒ the harness changed the worktree.
*  Fails loud: the worktree is a fresh checkout, so a git error here means
*  something is genuinely broken (git missing, corrupt index, killed mid-run).
*  Folding that into `false` would silently discard a candidate and mask the
*  real failure — forbidden by the no-silent-fallbacks doctrine. */
/** Do two names address the same directory? An in-place placement is only in-place if it names the
*  worktree the driver created, and a byte comparison answers that wrongly on a platform whose
*  temporary directory is a symlink: macOS reports `/var/folders/...` where the resolved path is
*  `/private/var/folders/...`, and both are the same directory. */
function samePath(candidate, worktreePath) {
	if (typeof candidate !== "string" || candidate.length === 0) return false;
	if (candidate === worktreePath) return true;
	return canonicalPath(candidate) === canonicalPath(worktreePath);
}
/** The resolved path, or the lexically absolute one when the name does not exist — a name that
*  cannot be resolved is a mismatch the caller is told about, not an error to swallow. */
function canonicalPath(path) {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}
function worktreeDirty(worktreePath) {
	return worktreeChangedPaths(worktreePath).length > 0;
}
function worktreeChangedPaths(worktreePath) {
	const result = spawnSync("git", [
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=all"
	], {
		cwd: worktreePath,
		encoding: "utf-8"
	});
	if (result.error) throw new Error(`agenticGenerator: git status failed to spawn in ${worktreePath}: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`agenticGenerator: git status exited ${result.status} in ${worktreePath}: ${result.stderr.trim()}`);
	const records = result.stdout.split("\0");
	const paths = [];
	for (let i = 0; i < records.length; i += 1) {
		const record = records[i];
		if (!record) continue;
		paths.push(record.slice(3));
		if (record[0] === "R" || record[1] === "R" || record[0] === "C" || record[1] === "C") {
			const source = records[++i];
			if (!source) throw new Error(`agenticGenerator: git status omitted a rename/copy path in ${worktreePath}`);
			paths.push(source);
		}
	}
	return paths;
}
//#endregion
//#region src/improvement/cleanup.ts
async function rethrowAfterCleanup(cause, cleanup, context) {
	const cleanupErrors = [];
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			await cleanup();
		} catch (cleanupCause) {
			cleanupErrors.push(cleanupCause);
			continue;
		}
		if (cleanupErrors.length === 0) throw cause;
		throw new AggregateError([cause, ...cleanupErrors], `${context}; cleanup retry succeeded`);
	}
	throw new AggregateError([cause, ...cleanupErrors], `${context}; cleanup failed`);
}
//#endregion
//#region src/improvement/improve-result.ts
function copyImproveCost(cost) {
	return {
		totalCostUsd: cost.totalCostUsd,
		accountingComplete: cost.accountingComplete,
		incompleteReasons: [...cost.incompleteReasons]
	};
}
//#endregion
//#region src/improvement/improvement-driver.ts
/**
* Code-only candidate driver for Runtime-owned git worktrees.
*
* A `CandidateGenerator` edits an isolated checkout. This driver finalizes each
* accepted edit as a `CodeSurface` and disposes rejected worktrees.
*
* @stable
*/
/** Build the code-only proposer used internally by `improve({ surface: 'code' })`. */
function improvementDriver(opts) {
	const baseRef = opts.baseRef ?? "main";
	const owned = /* @__PURE__ */ new Map();
	return {
		kind: `improvement:${opts.generator.kind}`,
		async propose(ctx) {
			const findings = ctx.findings;
			if (findings.length === 0 && !opts.generator.proposesWithoutFindings) return [];
			const surfaces = [];
			const incumbent = verifiedCodeIncumbent(ctx.currentSurface);
			const proposalBaseRef = incumbent?.baseCommit ?? baseRef;
			for (let i = 0; i < ctx.populationSize; i++) {
				if (ctx.signal.aborted) break;
				const wt = await opts.worktree.create({
					baseRef: proposalBaseRef,
					label: `${opts.generator.kind}-gen${ctx.generation}-cand${i}`
				});
				owned.set(wt.path, wt);
				try {
					if (incumbent) advanceToIncumbent(wt, incumbent);
					const { applied, summary, label, rationale } = await opts.generator.generate({
						worktreePath: wt.path,
						findings,
						maxShots: ctx.maxImprovementShots ?? 1,
						signal: ctx.signal,
						generation: ctx.generation,
						candidateIndex: i,
						...ctx.costLedger ? { costLedger: ctx.costLedger } : {},
						...ctx.costPhase ? { costPhase: ctx.costPhase } : {}
					});
					if (!applied) {
						await opts.worktree.discard(wt);
						owned.delete(wt.path);
						continue;
					}
					const surface = await opts.worktree.finalize(wt, summary);
					surfaces.push(label || rationale ? {
						surface,
						label: label ?? "",
						rationale: rationale ?? ""
					} : surface);
					owned.delete(wt.path);
					owned.set(surface.worktreeRef, wt);
				} catch (err) {
					return rethrowAfterCleanup(err, async () => {
						await opts.worktree.discard(wt);
						owned.delete(wt.path);
					}, `improvementDriver: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
			return surfaces;
		},
		async cleanup(retainWorktreeRefs = []) {
			const retained = new Set(retainWorktreeRefs);
			const errors = [];
			for (const [worktreeRef, worktree] of owned) {
				if (retained.has(worktreeRef)) continue;
				try {
					await opts.worktree.discard(worktree);
					owned.delete(worktreeRef);
				} catch (cause) {
					errors.push(cause);
				}
			}
			if (errors.length > 0) throw new AggregateError(errors, "improvementDriver: failed to discard candidate worktrees");
		}
	};
}
/** A code incumbent must still match the immutable identity that was measured. */
function verifiedCodeIncumbent(surface) {
	if (typeof surface !== "object" || surface.kind !== "code") return void 0;
	verifyCodeSurface(surface);
	return surface;
}
/** Start at the root commit recorded by the incumbent, then fast-forward the
*  fresh branch to the incumbent commit. The worktree stays clean for the
*  generator while `finalize()` still emits one cumulative root-to-candidate
*  patch that can be applied or rolled back independently of prior branches. */
function advanceToIncumbent(worktree, incumbent) {
	if (worktree.baseCommit !== incumbent.baseCommit || worktree.baseTree !== incumbent.baseTree) throw new Error("improvementDriver: candidate worktree does not match incumbent base identity");
	if (worktree.baseCommit === incumbent.candidateCommit) return;
	const merge = spawnSync("git", [
		"merge",
		"--ff-only",
		incumbent.candidateCommit
	], {
		cwd: worktree.path,
		encoding: "utf8"
	});
	if (merge.error) throw new Error(`improvementDriver: failed to start candidate from incumbent: ${merge.error.message}`);
	if (merge.status !== 0) throw new Error(`improvementDriver: could not fast-forward candidate to incumbent ${incumbent.candidateCommit}: ${merge.stderr.trim()}`);
	const head = spawnSync("git", [
		"rev-parse",
		"--verify",
		"HEAD"
	], {
		cwd: worktree.path,
		encoding: "utf8"
	});
	if (head.error || head.status !== 0 || head.stdout.trim() !== incumbent.candidateCommit) throw new Error("improvementDriver: candidate worktree did not reach the incumbent commit");
}
//#endregion
//#region src/improvement/rollout-policy.ts
/** The profile extensions namespace the policy persists under. */
const ROLLOUT_POLICY_EXTENSION = "structural-rollout";
const isBoundedInt = (v, min) => typeof v === "number" && Number.isInteger(v) && v >= min;
/** Parse a serialized policy surface. Returns `undefined` for non-strings,
* malformed JSON, or values outside the policy invariants. Unknown fields are
* dropped; supported optional fields are preserved. */
function parseRolloutPolicy(surface) {
	if (typeof surface !== "string" || surface.trim().length === 0) return void 0;
	let raw;
	try {
		raw = JSON.parse(surface);
	} catch {
		return;
	}
	return normalizeRolloutPolicy(raw);
}
/** Normalize an untyped policy bag (a parsed surface or a profile extension) into
*  a full `StructuralRolloutPolicy`, defaults merged. Returns `undefined` when any
*  present dial violates the policy invariants (mirrors `resolvePolicy`: integer
*  k ≥ 1, repairRounds ≥ 0, testgen ≥ 0) — a corrupt config must read as "not
*  configured", never as a fabricated recipe. */
function normalizeRolloutPolicy(raw) {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return void 0;
	const bag = raw;
	const k = bag.k ?? defaultStructuralRolloutPolicy.k;
	const repairRounds = bag.repairRounds ?? defaultStructuralRolloutPolicy.repairRounds;
	const testgen = bag.testgen ?? defaultStructuralRolloutPolicy.testgen;
	if (!isBoundedInt(k, 1) || !isBoundedInt(repairRounds, 0) || !isBoundedInt(testgen, 0)) return;
	return {
		k,
		repairRounds,
		testgen,
		...typeof bag.diverse === "boolean" ? { diverse: bag.diverse } : {}
	};
}
/** Stable serialization with fixed field order. */
function serializeRolloutPolicy(policy) {
	return JSON.stringify({
		k: policy.k,
		repairRounds: policy.repairRounds,
		testgen: policy.testgen,
		...policy.diverse !== void 0 ? { diverse: policy.diverse } : {}
	});
}
/** Read the persisted policy off the profile. `undefined` when the profile does
*  not opt into structural rollout. */
function structuralRolloutPolicyFromProfile(profile) {
	const bag = profile.extensions?.[ROLLOUT_POLICY_EXTENSION];
	if (bag === void 0) return void 0;
	return normalizeRolloutPolicy(bag);
}
/** Persist a detached policy under the profile extension without mutating the input. */
function applyRolloutPolicyToProfile(profile, policy) {
	const candidate = structuredClone(profile);
	const bag = {
		k: policy.k,
		repairRounds: policy.repairRounds,
		testgen: policy.testgen,
		...policy.diverse !== void 0 ? { diverse: policy.diverse } : {}
	};
	return {
		...candidate,
		extensions: {
			...candidate.extensions,
			[ROLLOUT_POLICY_EXTENSION]: bag
		}
	};
}
//#endregion
//#region src/improvement/profile-surface.ts
/** Extract the baseline optimized by a method and retain its structured value
* so external optimizers can inspect it for private fields before serialization. */
function prepareProfileSurface(profile, surface, skills, profileComponents) {
	switch (surface) {
		case "prompt": return {
			surface: profile.prompt?.systemPrompt ?? "",
			value: profile.prompt?.systemPrompt ?? ""
		};
		case "skills": {
			const value = inlineSkill(profile, skills).content;
			return {
				surface: value,
				value
			};
		}
		case "tools": {
			const value = profile.tools ?? {};
			return {
				surface: canonicalJson(value),
				value
			};
		}
		case "mcp": {
			const value = profile.mcp ?? {};
			return {
				surface: canonicalJson(value),
				value
			};
		}
		case "hooks": {
			const value = profile.hooks ?? {};
			return {
				surface: canonicalJson(value),
				value
			};
		}
		case "subagents": {
			const value = profile.subagents ?? {};
			return {
				surface: canonicalJson(value),
				value
			};
		}
		case "agent-profile":
			if (profileComponents) {
				if (profileComponents.encoding !== void 0 && profileComponents.encoding !== "components" && profileComponents.encoding !== "json") throw new ConfigError("improve(): profileComponents.encoding must be components or json");
				const value = profileComponents.read(profile);
				const components = componentSurface(value, "profileComponents.read");
				return {
					surface: profileComponents.encoding === "json" ? canonicalJson(components.components) : components,
					value
				};
			}
			return {
				surface: canonicalJson(profile),
				value: profile
			};
		case "memory": {
			const value = profileInstructions(profile);
			return {
				surface: value,
				value
			};
		}
		case "rollout-policy": {
			const policy = structuralRolloutPolicyFromProfile(profile);
			return {
				surface: policy ? serializeRolloutPolicy(policy) : "",
				value: policy ?? null
			};
		}
		case "code": throw new ConfigError("improve(): code requires the isolated baseline created from opts.code.repoRoot");
	}
}
function isCodeSurface(surface) {
	return typeof surface === "object" && surface !== null && surface.kind === "code";
}
function isComponentSurface(surface) {
	return typeof surface === "object" && surface !== null && surface.kind === "components";
}
function componentSurface(components, source) {
	const entries = validateComponents(components, source);
	return immutableCandidateValue({
		kind: "components",
		components: Object.fromEntries(entries)
	});
}
function validateComponents(components, source) {
	if (typeof components !== "object" || components === null || Array.isArray(components)) throw new ConfigError(`improve(): ${source} must return a component record`);
	const entries = Object.entries(components);
	if (entries.length === 0) throw new ConfigError(`improve(): ${source} must return at least one component`);
	for (const [name, value] of entries) if (!name || name.trim() !== name || typeof value !== "string") throw new ConfigError(`improve(): ${source} must return trimmed component names with string values`);
	return entries;
}
/** Parse a JSON winner surface with a typed, contextual error. */
function parseWinnerJson(winner, surface) {
	try {
		return JSON.parse(winner);
	} catch (cause) {
		throw new ConfigError(`improve(): the '${surface}' candidate is not valid JSON, so it cannot form a profile candidate: ${cause.message}`);
	}
}
function assertCandidateSurfaceKind(surface, baseline, winner) {
	if (surface === "code") {
		if (isCodeSurface(winner)) return;
		throw new ConfigError(`improve(): the '${surface}' candidate returned an incompatible surface value`);
	}
	if (typeof baseline === "string") {
		if (typeof winner === "string") return;
		throw new ConfigError(`improve(): the '${surface}' candidate changed from a text surface to an incompatible surface value`);
	}
	if (!isComponentSurface(baseline) || !isComponentSurface(winner)) throw new ConfigError(`improve(): the '${surface}' candidate returned an incompatible surface value`);
	validateComponents(winner.components, `the '${surface}' candidate`);
	const baselineNames = Object.keys(baseline.components).sort();
	const winnerNames = Object.keys(winner.components).sort();
	if (baselineNames.length !== winnerNames.length || baselineNames.some((name, index) => name !== winnerNames[index])) throw new ConfigError(`improve(): the '${surface}' candidate must preserve the exact component names`);
}
/** Materialize a detached profile candidate without changing the baseline. */
function materializeImprovementProfileCandidate(profile, surface, winner, skills, profileComponents) {
	let candidate;
	if (isComponentSurface(winner)) {
		if (surface !== "agent-profile" || !profileComponents) throw new ConfigError(`improve(): the '${surface}' candidate has no profile component mapping`);
		const winnerComponents = immutableCandidateValue({ ...winner.components });
		const validated = parseMaterializedProfile(profileComponents.apply(profile, winnerComponents), surface);
		const materializedComponents = Object.fromEntries(validateComponents(profileComponents.read(validated), "profileComponents.read after apply"));
		const names = Object.keys(winnerComponents);
		if (names.length !== Object.keys(materializedComponents).length || names.some((name) => materializedComponents[name] !== winnerComponents[name])) throw new ConfigError("improve(): profileComponents.apply must round-trip every winning component exactly");
		return validated;
	}
	if (typeof winner !== "string") throw new ConfigError(`improve(): the '${surface}' candidate cannot form an AgentProfile`);
	switch (surface) {
		case "prompt":
			candidate = {
				...profile,
				prompt: {
					...profile.prompt,
					systemPrompt: winner
				}
			};
			break;
		case "skills": {
			const selectedSkill = inlineSkill(profile, skills);
			candidate = {
				...profile,
				resources: {
					...profile.resources,
					skills: profile.resources?.skills?.map((resource) => resource === selectedSkill ? {
						...resource,
						content: winner
					} : resource)
				}
			};
			break;
		}
		case "tools":
			candidate = {
				...profile,
				tools: parseWinnerJson(winner, surface)
			};
			break;
		case "mcp":
			candidate = {
				...profile,
				mcp: parseWinnerJson(winner, surface)
			};
			break;
		case "hooks":
			candidate = {
				...profile,
				hooks: parseWinnerJson(winner, surface)
			};
			break;
		case "subagents":
			candidate = {
				...profile,
				subagents: parseWinnerJson(winner, surface)
			};
			break;
		case "agent-profile":
			candidate = parseWinnerJson(winner, surface);
			break;
		case "memory":
			candidate = {
				...profile,
				resources: {
					...profile.resources,
					instructions: replaceProfileInstructions(profile, winner)
				}
			};
			break;
		case "rollout-policy": {
			const policy = normalizeRolloutPolicy(parseWinnerJson(winner, surface));
			if (!policy) throw new ConfigError(`improve(): the shipped 'rollout-policy' winner is not a valid StructuralRolloutPolicy (integer k >= 1, repairRounds >= 0, testgen >= 0), so it cannot be applied: ${winner}`);
			candidate = applyRolloutPolicyToProfile(profile, policy);
			break;
		}
	}
	return parseMaterializedProfile(candidate, surface);
}
function parseMaterializedProfile(candidate, surface) {
	const parsed = agentProfileSchema.safeParse(candidate);
	if (!parsed.success) throw new ConfigError(`improve(): the '${surface}' candidate does not produce a valid AgentProfile: ${parsed.error.message}`);
	return immutableCandidateValue(parsed.data);
}
function createProfileCandidateMaterializer(profile, surface, baselineSurface, skills, profileComponents) {
	const decode = (candidate) => {
		if (profileComponents?.encoding !== "json") return candidate;
		if (typeof candidate !== "string") throw new ConfigError("improve(): JSON profile components require a text surface");
		return componentSurface(parseWinnerJson(candidate, surface), "JSON profile components");
	};
	const decodedBaseline = decode(baselineSurface);
	const baselineDigest = canonicalCandidateDigest$1(baselineSurface);
	if (profileComponents) {
		if (canonicalAgentProfileDigest(materializeImprovementProfileCandidate(profile, surface, decodedBaseline, skills, profileComponents)) !== canonicalAgentProfileDigest(profile)) throw new ConfigError("improve(): profileComponents.apply(profile, profileComponents.read(profile)) must reproduce the complete baseline profile exactly");
	}
	const candidates = /* @__PURE__ */ new Map([[baselineDigest, profile]]);
	return (candidateSurface) => {
		assertCandidateSurfaceKind(surface, baselineSurface, candidateSurface);
		const decodedCandidate = decode(candidateSurface);
		assertCandidateSurfaceKind(surface, decodedBaseline, decodedCandidate);
		const digest = canonicalCandidateDigest$1(candidateSurface);
		const existing = candidates.get(digest);
		if (existing) return existing;
		const candidate = materializeImprovementProfileCandidate(profile, surface, immutableCandidateValue(decodedCandidate), skills, profileComponents);
		candidates.set(digest, candidate);
		return candidate;
	};
}
function inlineSkill(profile, options) {
	const resourceName = options?.resourceName.trim();
	if (!resourceName) throw new ConfigError("improve(): surface 'skills' requires opts.skills.resourceName for one inline profile skill");
	assertFailClosedResources(profile, "skills");
	const matches = (profile.resources?.skills ?? []).filter((resource) => resource.name === resourceName);
	if (matches.length !== 1 || matches[0]?.kind !== "inline") throw new ConfigError(`improve(): skill '${resourceName}' must identify exactly one inline profile resource`);
	return matches[0];
}
function profileInstructions(profile) {
	assertFailClosedResources(profile, "memory");
	const instructions = profile.resources?.instructions;
	if (instructions === void 0) return "";
	if (typeof instructions === "string") return instructions;
	if (instructions.kind === "inline") return instructions.content;
	throw new ConfigError("improve(): surface 'memory' requires inline profile instructions so candidate bytes are exact");
}
function replaceProfileInstructions(profile, content) {
	const instructions = profile.resources?.instructions;
	if (typeof instructions !== "object") return content;
	if (instructions.kind !== "inline") throw new ConfigError("improve(): surface 'memory' requires inline profile instructions so candidate bytes are exact");
	return {
		...instructions,
		content
	};
}
function assertFailClosedResources(profile, surface) {
	if (profile.resources?.failOnError !== true) throw new ConfigError(`improve(): surface '${surface}' requires profile.resources.failOnError: true`);
}
//#endregion
//#region src/improvement/raw-trace-distiller.ts
/**
*
* `rawTraceDistiller` — the meta-harness `analyzeGeneration` producer.
*
* The default `generationFailureDistiller` (in `improve.ts`) COMPRESSES each
* generation's failing cells into ~1500-char structured findings before the next
* proposal round. That is the ACE-style recipe: a small summary is the proposer's
* whole view of what went wrong. This producer does the opposite — the
* meta-harness recipe (yoonholee.com/meta-harness): it does NOT summarize. It
* points the coding-agent proposer at the generation's RAW run traces already on
* disk under `runDir` — the durable per-cell `spans.jsonl` event logs,
* `cached-result.json` scores, and any artifacts the substrate persisted — and
* instructs the agent to `grep`/`cat`/`ls` them to diagnose the failures itself
* (up to the harness's full context, ~millions of tokens, vs a ~1500-char digest).
*
* It emits `ProposalFinding[]` so it drops into the same `opts.analyzeGeneration`
* slot the default distiller uses, and renders through the same
* `agenticGenerator` prompt path (`claim` + `recommended_action`). The findings
* carry ABSOLUTE paths — the coding harness runs with `cwd` = a candidate
* worktree, so a relative `runDir` would be uncattable from there.
*
* Runtime layout it reads (written by agent-eval's optimization loop):
*
*   <runDir>/gen-<N>/                     ← the generation dir (input.runDir)
*     candidate-<i>/                      ← one candidate campaign (campaign.runDir)
*       <sanitized cellId>/               ← one scenario×rep cell
*         spans.jsonl                     ← the raw trace (event/span log)
*         cached-result.json              ← the cell's score + artifact ref
*         <artifacts…>                    ← whatever the dispatch wrote
*
* @stable
*/
const ANALYST_ID = "raw-trace-distiller";
/** A cell counts as "failing" below this mean composite (matches the default
*  distiller's near-perfect threshold) or when it recorded an `error`. */
const PASS_THRESHOLD = .999;
/**
* Build an `analyzeGeneration` producer that feeds the proposer RAW-TRACE
* FILESYSTEM CONTEXT — paths into the prior generation's real run traces plus a
* grep/cat-to-diagnose instruction — instead of a pre-summarized digest.
*
* Drop-in for `analyzeGeneration` on `improve({ surface: 'code' })`:
*
*   await improve({
*     surface: 'code',
*     findings: seedFindings,
*     code: { repoRoot, profile, executorForWorktree, buildPrompt },
*     runDir: '/abs/run',                 // MUST be a real path — the traces live here
*     analyzeGeneration: rawTraceDistiller(),
*     scenarios, judge, agent,
*   })
*/
function rawTraceDistiller(options = {}) {
	const maxCandidates = options.maxCandidates ?? 12;
	const maxCellsPerCandidate = options.maxCellsPerCandidate ?? 8;
	const maxFilesPerCell = options.maxFilesPerCell ?? 24;
	return async (input) => {
		const genRoot = absoluteRunDir(options.runDir ?? input.runDir);
		const durable = isDurable(genRoot);
		const ranked = [...input.candidates].map((c) => ({
			surfaceHash: c.surfaceHash,
			composite: c.composite,
			campaignDir: absoluteRunDir(c.campaign.runDir),
			cells: failingCells(c.campaign, maxCellsPerCandidate, maxFilesPerCell)
		})).sort((a, b) => compareCandidateComposites(a.composite, b.composite)).slice(0, maxCandidates);
		const totalFailingCells = ranked.reduce((n, c) => n + c.cells.length, 0);
		if (totalFailingCells === 0) {
			if (options.fallbackFindings && options.fallbackFindings.length > 0) return options.fallbackFindings;
			return [makeProposalFinding({
				analyst_id: ANALYST_ID,
				proposal_origin: "search",
				severity: "info",
				area: "raw-trace-context",
				confidence: 1,
				claim: `Generation ${input.generation} had no failing cells. The full raw run traces are on disk under ${genRoot}.`,
				recommended_action: `To keep improving, grep/cat the raw traces under ${genRoot} (per-cell spans.jsonl + cached-result.json) to find the weakest passing runs, then make a targeted harness-code edit.`,
				evidence_refs: [{
					kind: "artifact",
					uri: genRoot
				}],
				metadata: {
					generation: input.generation,
					runDir: genRoot,
					failingCells: 0
				}
			})];
		}
		const findings = [];
		findings.push(makeProposalFinding({
			analyst_id: ANALYST_ID,
			proposal_origin: "search",
			severity: "high",
			area: "raw-trace-context",
			confidence: 1,
			claim: `Generation ${input.generation} produced ${totalFailingCells} failing/low-scoring cell(s) across ${ranked.length} candidate(s). Their FULL RAW run traces are on disk under ${genRoot} — the actual event logs (spans.jsonl), scores (cached-result.json), and artifacts, not a summary.${durable ? "" : " (WARNING: this run root does not exist on disk — it looks like an in-memory run; pass a real runDir to improve() to get raw-trace context.)"}`,
			recommended_action: `Do NOT rely on a pre-summarized finding. Before editing, DIAGNOSE from the raw traces: run \`grep\`/\`cat\`/\`ls\` over the trace files and directories named in the following findings to see exactly what each failing run did and why it scored low, then make the smallest harness-code edit that fixes the dominant failure. Start with \`grep -rIn "error" ${genRoot}\` then \`cat\` the spans.jsonl of the worst cell.`,
			evidence_refs: [{
				kind: "artifact",
				uri: genRoot
			}],
			metadata: {
				generation: input.generation,
				runDir: genRoot,
				failingCells: totalFailingCells,
				candidates: ranked.length
			}
		}));
		for (const cand of ranked) {
			if (cand.cells.length === 0) continue;
			const scenarioList = cand.cells.map((c) => c.scenarioId).join(", ");
			const fileLines = cand.cells.map((c) => {
				const header = `  cell ${c.scenarioId} (composite ${c.composite.toFixed(3)}${c.error ? `, error: ${truncate(c.error, 160)}` : ""}) — dir ${c.cellDir}`;
				const files = c.files.map((f) => `    - ${f}`).join("\n");
				const more = c.truncatedFiles ? `\n    - …(ls ${c.cellDir} for the rest)` : "";
				return c.files.length > 0 ? `${header}\n${files}${more}` : header;
			}).join("\n");
			findings.push(makeProposalFinding({
				analyst_id: ANALYST_ID,
				proposal_origin: "search",
				severity: cand.composite !== null && cand.composite < .5 ? "critical" : "high",
				area: "raw-trace-context",
				confidence: 1,
				subject: cand.surfaceHash,
				claim: `Candidate ${cand.surfaceHash} ${candidateCompositeDescription(cand.composite)} with ${cand.cells.length} failing cell(s) [${scenarioList}]. Its raw traces are under ${cand.campaignDir}.`,
				recommended_action: `grep/cat these raw trace files to diagnose WHY this candidate failed before editing:\n${fileLines}\nOr scan the whole candidate at once: \`grep -rIn . ${cand.campaignDir}\` and \`ls -R ${cand.campaignDir}\`.`,
				evidence_refs: [{
					kind: "artifact",
					uri: cand.campaignDir
				}, ...cand.cells.flatMap((c) => c.files.map((f) => ({
					kind: "artifact",
					uri: f
				})))],
				metadata: {
					surfaceHash: cand.surfaceHash,
					composite: cand.composite,
					campaignDir: cand.campaignDir,
					cells: cand.cells.map((c) => ({
						scenarioId: c.scenarioId,
						composite: c.composite,
						cellDir: c.cellDir,
						files: c.files,
						...c.error ? { error: c.error } : {}
					}))
				}
			}));
		}
		return findings;
	};
}
/** Keep unscored candidates visible without inventing a numeric aggregate. */
function compareCandidateComposites(left, right) {
	if (left === null) return right === null ? 0 : 1;
	if (right === null) return -1;
	return left - right;
}
function candidateCompositeDescription(composite) {
	return composite === null ? "has no aggregate score" : `scored composite ${composite.toFixed(3)}`;
}
/** The failing cells of a candidate campaign, each with its on-disk trace files.
*  Mirrors the default distiller's per-cell composite (mean of judge composites,
*  0 when a cell produced no judge score) and its failing predicate. */
function failingCells(campaign, maxCells, maxFiles) {
	const campaignDir = absoluteRunDir(campaign.runDir);
	const durable = isDurable(campaignDir);
	const out = [];
	for (const cell of campaign.cells) {
		const scores = Object.values(cell.judgeScores ?? {});
		const composite = scores.length === 0 ? 0 : scores.reduce((sum, s) => sum + (s.composite ?? 0), 0) / scores.length;
		if (!cell.error && composite >= PASS_THRESHOLD) continue;
		const cellDir = join(campaignDir, sanitizeCellId(cell.cellId));
		const artifactPaths = artifactPathsForCell(campaign.artifactsByPath, cell.cellId);
		const discovered = durable ? listTraceFiles(cellDir) : [];
		const canonical = [join(cellDir, "spans.jsonl"), join(cellDir, "cached-result.json")];
		const files = dedupeSorted([
			...discovered,
			...artifactPaths,
			...canonical
		]);
		out.push({
			scenarioId: cell.scenarioId,
			composite: Number(composite.toFixed(3)),
			...cell.error ? { error: cell.error } : {},
			cellDir,
			files: files.slice(0, maxFiles),
			truncatedFiles: files.length > maxFiles
		});
		if (out.length >= maxCells) break;
	}
	return out;
}
/** Absolute paths of artifacts the campaign recorded for a cell. `artifactsByPath`
*  is keyed `${cellId}/${relPath}` → absolute path. */
function artifactPathsForCell(artifactsByPath, cellId) {
	if (!artifactsByPath) return [];
	const prefix = `${cellId}/`;
	return Object.entries(artifactsByPath).filter(([key]) => key.startsWith(prefix)).map(([, absPath]) => resolve(absPath));
}
/** Real files directly under `dir` and one level of sub-directories (artifacts
*  are sometimes nested). Absolute paths, sorted. `[]` when the dir is absent,
*  stale, unreadable, or contains symlinked dirs — trace context is advisory and
*  the canonical anchors below still tell the proposer where to inspect. */
function listTraceFiles(dir) {
	const out = [];
	for (const entry of safeReadDir(dir)) {
		const full = join(dir, entry.name);
		if (entry.isFile()) out.push(full);
		else if (!entry.isSymbolicLink() && entry.isDirectory()) {
			for (const sub of safeReadDir(full)) if (sub.isFile()) out.push(join(full, sub.name));
		}
	}
	return out;
}
function safeReadDir(dir) {
	try {
		return readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}
/** Substrate cell-dir sanitization — must match agent-eval's
*  `cellId.replace(/[^a-zA-Z0-9_-]/g, '_')` so the computed dir matches disk. */
function sanitizeCellId(cellId) {
	return cellId.replace(/[^a-zA-Z0-9_-]/g, "_");
}
/** A run root is durable (has real files) when it is not an in-memory sentinel
*  and exists on disk. `mem://` runs keep everything in-process — no traces. */
function isDurable(runDir) {
	return !runDir.startsWith("mem://") && existsSync(runDir);
}
/** Resolve a run dir to absolute (the coding harness runs from a worktree cwd, so
*  relative paths are uncattable there). `mem://` sentinels pass through untouched. */
function absoluteRunDir(runDir) {
	return runDir.startsWith("mem://") ? runDir : resolve(runDir);
}
function dedupeSorted(paths) {
	return [...new Set(paths)].sort((a, b) => {
		const da = a.slice(0, a.length - basename(a).length);
		const db = b.slice(0, b.length - basename(b).length);
		return da === db ? basename(a).localeCompare(basename(b)) : da.localeCompare(db);
	});
}
function truncate(s, n) {
	return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
//#endregion
//#region src/improvement/code-execution.ts
/** Slice bound for distilled judge notes: wide enough that a real traceback or
* failing assertion survives intact. */
const distilledNotesMaxChars = 1500;
/** Slice bound for a cell's error string. Full text remains on the raw cell. */
const distilledErrorMaxChars = 500;
/** Distill failing cells into typed findings for the next proposal round. */
function generationFailureDistiller(staticFindings) {
	const CAP = 12;
	return async (input) => {
		const failures = [];
		for (const candidate of input.candidates) for (const rawCell of candidate.campaign.cells) {
			const cell = rawCell;
			const scenario = String(cell.scenarioId ?? "unknown");
			const error = typeof cell.error === "string" ? cell.error : void 0;
			const judgeScores = cell.judgeScores && typeof cell.judgeScores === "object" ? Object.values(cell.judgeScores) : [];
			const composite = judgeScores.length === 0 ? 0 : judgeScores.reduce((sum, judge) => sum + (judge.composite ?? 0), 0) / judgeScores.length;
			if (!error && composite >= .999) continue;
			const notes = judgeScores.map((judge) => judge.notes).filter((note) => typeof note === "string" && note.length > 0).join("; ").slice(0, distilledNotesMaxChars);
			const claim = notes || (error ? `Scenario ${scenario} failed: ${error.slice(0, distilledErrorMaxChars)}` : "");
			failures.push({
				scenario,
				composite: Number(composite.toFixed(3)),
				notes,
				...claim ? { claim } : {},
				...error ? { error: error.slice(0, distilledErrorMaxChars) } : {}
			});
		}
		if (failures.length === 0) return staticFindings;
		failures.sort((left, right) => left.composite - right.composite);
		return failures.slice(0, CAP).map((failure) => makeProposalFinding({
			analyst_id: "generation-failure-distiller",
			proposal_origin: "search",
			severity: failure.error !== void 0 || failure.composite < .5 ? "high" : "medium",
			area: "generation-failure",
			confidence: 1,
			subject: failure.scenario,
			claim: `Scenario ${failure.scenario} scored composite ${failure.composite}${failure.notes ? `: ${failure.notes}` : ""}${failure.error ? ` (error: ${failure.error})` : ""}`,
			evidence_refs: [],
			metadata: {
				scenario: failure.scenario,
				composite: failure.composite,
				...failure.notes ? { notes: failure.notes } : {},
				...failure.error !== void 0 ? { error: failure.error } : {}
			}
		}));
	};
}
/** Default code-run analysis: raw trace paths for durable runs, otherwise a
* bounded digest of failed cells. */
function defaultDistillerFor(opts, findings) {
	const durableRun = opts.runDir !== void 0 && !opts.runDir.startsWith("mem://");
	if (opts.rawTraceContext ?? durableRun) return rawTraceDistiller({ fallbackFindings: findings });
	return generationFailureDistiller(findings);
}
async function discardPreparedBaseline(worktree, baselineWorktree, cause) {
	return rethrowAfterCleanup(cause, () => worktree.discard(baselineWorktree), "improve(): code preparation failed");
}
/**
* The real path of a repository root, for the one comparison that needs it.
*
* Git prints a RESOLVED worktree path, and the Eval worktree adapter compares what git
* printed against the root it was handed. A root whose PREFIX is a symlink therefore never
* matches: on macOS the OS hands out temp roots under /var, a symlink to /private/var, so the
* adapter refuses to finalize or discard a worktree it created seconds earlier. Resolve once
* here, where the caller's root meets git, instead of at every caller.
*
* A directory that does not exist yet — `worktreeDir` is created on demand — keeps its
* lexical form; the adapter creates it under a root that is already resolved.
*/
async function realRoot(path) {
	try {
		return await realpath(path);
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
		return resolve(path);
	}
}
/** Create a clean incumbent checkout and the candidate producer for a code run. */
async function prepareCodeRun(code) {
	const authorProfile = agentProfileSchema.parse(code.profile);
	assertExecutableAgentProfile(authorProfile, "improve(code) author");
	const baseRef = code.baseRef ?? "main";
	const worktree = code.worktree ?? gitWorktreeAdapter({
		repoRoot: await realRoot(code.repoRoot),
		...code.worktreeDir ? { worktreeDir: await realRoot(code.worktreeDir) } : {}
	});
	const baselineWorktree = await worktree.create({
		baseRef,
		label: "incumbent-baseline"
	});
	try {
		const baseline = await worktree.finalize(baselineWorktree, "Incumbent code checkout");
		let baselineDiscarded = false;
		const managed = improvementDriver({
			worktree,
			generator: code.generator ? code.generator : agenticGenerator({
				profile: authorProfile,
				executorForWorktree: code.executorForWorktree,
				buildPrompt: code.buildPrompt,
				...code.verify ? { verify: code.verify } : {},
				...code.timeoutMs !== void 0 ? { timeoutMs: code.timeoutMs } : {},
				...code.maximumCharge ? { maximumCharge: code.maximumCharge } : {}
			}),
			baseRef
		});
		return {
			baseline,
			proposer: managed,
			async cleanup(retainedWinner) {
				const errors = [];
				const retainedWorktreeRef = isCodeSurface(retainedWinner) ? retainedWinner.worktreeRef : void 0;
				try {
					await managed?.cleanup(retainedWorktreeRef ? [retainedWorktreeRef] : []);
				} catch (cause) {
					errors.push(cause);
				}
				if (!baselineDiscarded && retainedWorktreeRef !== baseline.worktreeRef) try {
					await worktree.discard(baselineWorktree);
					baselineDiscarded = true;
				} catch (cause) {
					errors.push(cause);
				}
				if (errors.length > 0) throw new AggregateError(errors, "improve(): failed to clean code improvement worktrees");
			}
		};
	} catch (cause) {
		return discardPreparedBaseline(worktree, baselineWorktree, cause);
	}
}
function idempotentDispose(dispose) {
	let disposed = false;
	let inFlight;
	return async () => {
		if (disposed) return;
		if (inFlight) return inFlight;
		inFlight = (async () => {
			await dispose();
			disposed = true;
		})();
		try {
			await inFlight;
		} finally {
			inFlight = void 0;
		}
	};
}
async function runCodeImprovement(opts) {
	const { gate = "holdout", findings: inputFindings = [], rawTraceContext: _rawTraceContext, code, promotionGate, analyzeGeneration, surface: _surface, ...sharedOptions } = opts;
	const findings = immutableCandidateValue([...assertProposalFindings(inputFindings, "improve() code findings")]);
	const preparedCode = await prepareCodeRun(code);
	const budget = gate === "none" ? {
		...sharedOptions.budget,
		generations: 0
	} : { ...sharedOptions.budget };
	let raw;
	try {
		raw = await selfImprove({
			...sharedOptions,
			baselineSurface: preparedCode.baseline,
			proposer: preparedCode.proposer,
			budget,
			findings,
			...promotionGate !== void 0 ? { gate: promotionGate } : {},
			...analyzeGeneration === null ? {} : { analyzeGeneration: analyzeGeneration ?? defaultDistillerFor(opts, findings) }
		});
	} catch (cause) {
		return rethrowAfterCleanup(cause, () => preparedCode.cleanup(), "improve(): code improvement failed");
	}
	const winnerSurface = raw.winner.surface;
	assertCandidateSurfaceKind("code", preparedCode.baseline, winnerSurface);
	try {
		await preparedCode.cleanup(winnerSurface);
	} catch (cleanupCause) {
		try {
			await preparedCode.cleanup();
		} catch (finalCleanupCause) {
			throw new AggregateError([cleanupCause, finalCleanupCause], "improve(): code result cleanup failed, including the final all-worktree retry");
		}
		throw new AggregateError([cleanupCause], "improve(): code result cleanup failed; the final all-worktree retry succeeded");
	}
	const dispose = idempotentDispose(async () => preparedCode.cleanup());
	return {
		mode: "code",
		candidate: immutableCandidateValue({
			surface: "code",
			value: winnerSurface
		}),
		decision: raw.gateDecision,
		...raw.lift !== void 0 ? { lift: raw.lift } : {},
		cost: copyImproveCost(raw.cost),
		durationMs: raw.durationMs,
		lineage: Object.freeze({
			invocationId: raw.provenance.runId,
			runId: raw.provenance.runId,
			developmentSplitDigest: raw.provenance.evidence.search.splitDigest
		}),
		generationsExplored: raw.generationsExplored,
		raw,
		dispose
	};
}
//#endregion
//#region src/improvement/method-controls.ts
const methodRuntimeControls = Symbol("agent-runtime.improvement.method-runtime-controls");
function withMethodRuntimeControls(method, controls) {
	return Object.freeze({
		...method,
		[methodRuntimeControls]: Object.freeze({ ...controls })
	});
}
function methodRuntimeControlsOf(method) {
	return method[methodRuntimeControls];
}
//#endregion
//#region src/improvement/method-cost.ts
const EVALUATION_TAG = "runtimeEvaluationRef";
const INVOCATION_TAG = "runtimeInvocationId";
function methodInputWithScopedCost(input, scope, costAttribution = "invocation") {
	return Object.freeze({
		...input,
		costLedger: scopedCostLedger(input.costLedger, scope, costAttribution)
	});
}
function methodInvocationCostLedger(ledger, scope) {
	return scopedCostLedger(ledger, scope, "invocation");
}
function assertMethodCostRecorded(methodName, result, compatibleLedger, invocationLedger, costCeiling, costAttribution = "invocation", historicalReceipts = []) {
	const { cost } = result;
	let observed = costAttribution === "optimizer-run" && result.provenance?.runId ? compatibleLedger.summary({ tags: { optimizerRun: result.provenance.runId } }) : invocationLedger.summary();
	if (historicalReceipts.length > 0 && costAttribution === "invocation") {
		const receipts = new Map(invocationLedger.list().map((receipt) => [receipt.callId, receipt]));
		for (const receipt of historicalReceipts) receipts.set(receipt.callId, receipt);
		observed = {
			...observed,
			totalCostUsd: [...receipts.values()].reduce((sum, receipt) => sum + receipt.costUsd, 0),
			accountingComplete: observed.accountingComplete && historicalReceipts.every((receipt) => !receipt.costUnknown && receipt.usageUnknown !== true)
		};
	}
	if (costCeiling !== void 0 && !cost.accountingComplete) throw new ConfigError(`improve(): method '${methodName}' returned incomplete cost accounting under costCeiling; refusing final scoring`);
	if (costCeiling !== void 0 && exceeds(cost.totalCostUsd, costCeiling)) throw new ConfigError(`improve(): method '${methodName}' reported cost $${cost.totalCostUsd} above costCeiling $${costCeiling}; refusing final scoring`);
	if (cost.accountingComplete && !observed.accountingComplete) throw new ConfigError(`improve(): method '${methodName}' reported complete cost accounting but its shared cost receipts are incomplete`);
	if (cost.accountingComplete && !approximatelyEqual$1(cost.totalCostUsd, observed.totalCostUsd)) throw new ConfigError(`improve(): method '${methodName}' reported $${cost.totalCostUsd} but recorded $${observed.totalCostUsd} through input.costLedger`);
}
function scopedCostLedger(parent, scope, costAttribution) {
	const evaluationTags = { [EVALUATION_TAG]: scope.evaluationRef };
	const invocationTags = {
		...evaluationTags,
		[INVOCATION_TAG]: scope.invocationId,
		...scope.methodTag === void 0 ? {} : { [scope.methodTag]: "1" }
	};
	const readTags = (filter) => costAttribution === "optimizer-run" && hasOptimizerRunFilter(filter) ? evaluationTags : invocationTags;
	return {
		costCeilingUsd: parent.costCeilingUsd,
		runPaidCall: (input) => parent.runPaidCall({
			...input,
			tags: {
				...input.tags ?? {},
				...invocationTags
			}
		}),
		reconcile: (...args) => parent.reconcile(...args),
		list: (filter) => parent.list(withTags(filter, readTags(filter))),
		listPending: (filter) => parent.listPending?.(withTags(filter, readTags(filter))) ?? [],
		summary: (filter) => parent.summary(withTags(filter, readTags(filter))),
		waitForIdle: (options = {}) => parent.waitForIdle?.({
			...options,
			filter: withTags(options.filter, readTags(options.filter))
		}) ?? Promise.resolve(parent.summary(withTags(options.filter, readTags(options.filter))).pendingCalls === 0),
		markCompleted: (count) => parent.markCompleted(count),
		costPerCompletedTask: () => parent.costPerCompletedTask()
	};
}
function hasOptimizerRunFilter(filter) {
	return typeof filter?.tags?.optimizerRun === "string" && filter.tags.optimizerRun.length > 0;
}
function withTags(filter, tags) {
	return {
		...filter ?? {},
		tags: {
			...filter?.tags ?? {},
			...tags
		}
	};
}
function approximatelyEqual$1(left, right) {
	const tolerance = Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8;
	return Math.abs(left - right) <= tolerance;
}
function exceeds(value, limit) {
	const tolerance = Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(limit)) * 8;
	return value - limit > tolerance;
}
/** Only prior root invocations are additional to a container's current invocation receipts. */
function methodHistoricalReceipts(ledger, optimizerRun, invocationId) {
	return ledger.list({ tags: { optimizerRun } }).filter((receipt) => receipt.tags?.[INVOCATION_TAG] !== invocationId);
}
//#endregion
//#region src/improvement/candidate-validation.ts
/** One spelling of the execution-identity rule for optimization, training, and the harness. */
function parseExecutionRef(value, label) {
	const parsed = sha256DigestSchema.safeParse(value);
	if (!parsed.success) throw new ConfigError(`${label}: executionRef must be a lowercase sha256:<64 hex> digest`);
	return parsed.data;
}
/** Validate the callback itself before any optimizer, trainer, or candidate work starts. */
function assertCandidateValidator(validator) {
	if (validator !== void 0 && typeof validator !== "function") throw new ConfigError("validateCandidate must be a function when present");
}
/** A validator accepts synchronously by returning void, or rejects by throwing. */
function validateProfileCandidate(validator, input) {
	assertCandidateValidator(validator);
	const result = validator?.(Object.freeze(input));
	if (result !== void 0) {
		Promise.resolve(result).catch(() => {});
		throw new ConfigError("candidate validators must return void synchronously or throw");
	}
}
/**
* Refuse exact held-out content digests already declared in this profile's training lineage.
* Both training and trainer-visible validation rows are exposure. This is an exact
* provenance check, not fuzzy decontamination or proof that undeclared training was fresh.
*/
function assertProfileTrainingIsHeldOut(profile, heldOutDigests) {
	const training = profile.metadata?.training;
	if (!training) return;
	for (const receipt of [training.receipt, ...training.ancestors]) if (receipt.dataset.tasks.some((task) => heldOutDigests.has(task.contentDigest))) throw new ConfigError("known training exposure overlaps held-out evaluation");
}
/**
* JSON paths of credential and private values in candidate content, found by
* the redaction core, which names each value it would change. A candidate that
* leaves Runtime (an external optimizer, a search ledger) is refused on any.
*/
function privateValuePaths(values) {
	return [...new Set(values.flatMap((value) => redact(value).report.findings.map((finding) => jsonPathOf(finding.path))))];
}
/** `/remote/url` or `/tools/0/env` as `$.remote.url` or `$.tools[0].env`. */
function jsonPathOf(pointer) {
	return pointer.split("/").slice(1).map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~")).reduce((path, segment) => /^\d+$/.test(segment) ? `${path}[${segment}]` : `${path}.${segment}`, "$");
}
//#endregion
//#region src/improvement/method-identity.ts
function buildMethodEvaluationIdentity(input) {
	const optimizationReps = input.optimizationRunOptions?.reps ?? 1;
	const finalTestReps = input.reps ?? 1;
	const scenarioPartitions = immutableCandidateValue({
		train: input.trainScenarios.map(campaignScenarioIdentity),
		selection: input.selectionScenarios.map(campaignScenarioIdentity),
		finalTest: input.testScenarios.map(campaignScenarioIdentity),
		optimizationReps,
		finalTestReps
	});
	const developmentSplitDigest = canonicalCandidateDigest$1({
		train: campaignSplitDigestFromIdentities(scenarioPartitions.train, optimizationReps),
		selection: campaignSplitDigestFromIdentities(scenarioPartitions.selection, optimizationReps)
	});
	const finalTestSplitDigest = campaignSplitDigestFromIdentities(scenarioPartitions.finalTest, finalTestReps);
	const judgeDescriptors = input.judges.map(judgeDescriptor);
	return {
		evaluationRef: canonicalCandidateDigest$1({
			executionRef: input.executionRef,
			baselineProfileDigest: input.baselineProfileDigest,
			coordinate: profileCoordinate(input.surface, input.baselineSurface, input.skills),
			candidateValidation: input.validateCandidate ? Function.prototype.toString.call(input.validateCandidate) : null,
			developmentSplitDigest,
			finalTestSplitDigest,
			findings: input.findings,
			judges: judgeDescriptors,
			run: {
				seed: input.seed ?? 42,
				finalReps: input.reps ?? 1,
				optimizationReps,
				costCeiling: input.costCeiling ?? null,
				resumable: input.optimizationRunOptions?.resumable ?? true,
				maxConcurrency: input.optimizationRunOptions?.maxConcurrency ?? 2,
				abortOnCellError: input.optimizationRunOptions?.abortOnCellError ?? false,
				dispatchTimeoutMs: input.optimizationRunOptions?.dispatchTimeoutMs ?? null,
				dispatchShutdownTimeoutMs: input.optimizationRunOptions?.dispatchShutdownTimeoutMs ?? 5e3,
				tracing: input.optimizationRunOptions?.tracing ?? "on",
				expectUsage: input.optimizationRunOptions?.expectUsage ?? "warn",
				captureSource: input.optimizationRunOptions?.captureSource ?? null,
				captureSourceVersionHash: input.optimizationRunOptions?.captureSourceVersionHash ?? null
			}
		}),
		developmentSplitDigest,
		finalTestSplitDigest,
		scenarioPartitions,
		judgeDescriptors
	};
}
function profileCoordinate(surface, baselineSurface, skills) {
	return {
		surface,
		resourceName: surface === "skills" ? skills?.resourceName.trim() ?? null : null,
		componentNames: typeof baselineSurface === "object" && baselineSurface !== null && baselineSurface.kind === "components" ? Object.keys(baselineSurface.components).sort() : []
	};
}
function judgeDescriptor(judge) {
	return {
		name: judge.name,
		dimensions: judge.dimensions.map((dimension) => ({ ...dimension })),
		declaredVersion: judge.judgeVersion ?? null,
		scoreImplementation: Function.prototype.toString.call(judge.score),
		appliesToImplementation: judge.appliesTo ? Function.prototype.toString.call(judge.appliesTo) : null
	};
}
//#endregion
//#region src/improvement/profile-improvement.ts
/**
* What every profile improvement prepares before any optimizer or search runs:
* the exact surface and its baseline, the evaluation identity, identified
* judges, the identities a search ledger records, and one materializer that
* admits a candidate only after the held-out and caller checks. `improve()`
* with an external method and with `searchMethod` share it, so a candidate is
* materialized and admitted the same way on both paths.
*/
function prepareProfileImprovement(profile, input) {
	const { surface = "prompt", validateCandidate, skills, profileComponents, minimumLift = 0 } = input;
	assertCandidateValidator(validateCandidate);
	if (!Number.isFinite(minimumLift) || minimumLift < 0) throw new ConfigError("improve(): minimumLift must be a finite number greater than or equal to 0");
	if (profileComponents && surface !== "agent-profile") throw new ConfigError("improve(): profileComponents is valid only with surface 'agent-profile'");
	if (input.subject !== void 0 && (typeof input.subject !== "string" || !input.subject.trim() || input.subject !== input.subject.trim())) throw new ConfigError("improve(): subject must be a trimmed non-empty string");
	const executionRef = parseExecutionRef(input.executionRef, "improve()");
	const findings = immutableCandidateValue([...assertProposalFindings(input.findings ?? [], "improve() method findings")]);
	const preparedSurface = prepareProfileSurface(profile, surface, skills, profileComponents);
	const baselineSurface = preparedSurface.surface;
	const baselineValue = immutableCandidateValue(preparedSurface.value);
	const baselineProfileDigest = canonicalAgentProfileDigest(profile);
	const identity = buildMethodEvaluationIdentity({
		executionRef,
		baselineProfileDigest,
		baselineSurface,
		surface,
		skills,
		validateCandidate,
		findings,
		trainScenarios: input.trainScenarios,
		selectionScenarios: input.selectionScenarios,
		testScenarios: input.testScenarios,
		judges: input.judges,
		seed: input.seed,
		reps: input.reps,
		costCeiling: input.costCeiling,
		optimizationRunOptions: input.optimizationRunOptions
	});
	const judges = input.judges.map((judge, index) => Object.freeze({
		...judge,
		judgeVersion: canonicalCandidateDigest$1({
			evaluationRef: identity.evaluationRef,
			descriptor: identity.judgeDescriptors[index]
		})
	}));
	const rawMaterializeProfile = createProfileCandidateMaterializer(profile, surface, baselineSurface, skills, profileComponents);
	const baselineSurfaceDigest = canonicalCandidateDigest$1(baselineSurface);
	const heldOutDigests = new Set(identity.scenarioPartitions.finalTest.map((task) => task.scenarioDigest));
	const validatedCandidates = /* @__PURE__ */ new Set();
	const validateMaterialized = (validator, candidate, candidateSurface, isBaseline) => {
		const prepared = prepareProfileSurface(candidate, surface, skills, profileComponents);
		validateProfileCandidate(validator, {
			profile: candidate,
			surface,
			candidateSurface,
			value: immutableCandidateValue(prepared.value),
			isBaseline
		});
	};
	const admitCandidate = (candidate, candidateSurface) => {
		const candidateDigest = canonicalCandidateDigest$1(candidateSurface);
		if (validatedCandidates.has(candidateDigest)) return;
		assertProfileTrainingIsHeldOut(candidate, heldOutDigests);
		validateMaterialized(validateCandidate, candidate, immutableCandidateValue(candidateSurface), candidateDigest === baselineSurfaceDigest);
		validatedCandidates.add(candidateDigest);
	};
	const materializeProfile = (candidateSurface) => {
		const candidate = rawMaterializeProfile(candidateSurface);
		admitCandidate(candidate, candidateSurface);
		return candidate;
	};
	materializeProfile(baselineSurface);
	return {
		profile,
		surface,
		executionRef,
		findings,
		minimumLift,
		baselineSurface,
		baselineValue,
		baselineProfileDigest,
		identity,
		invocationId: `runtime-optimization:${randomUUID()}`,
		judges,
		searchIdentity: Object.freeze({
			subject: input.subject ?? profile.name ?? "agent-profile",
			agent: {
				uri: "agent-runtime:improve-execution-ref",
				revision: executionRef
			},
			judge: {
				uri: "agent-runtime:improve-judges",
				revision: canonicalCandidateDigest$1(identity.judgeDescriptors)
			},
			model: profileModel(profile)
		}),
		surfaceOf: (candidate) => prepareProfileSurface(candidate, surface, skills, profileComponents).surface,
		materializeCandidate: rawMaterializeProfile,
		admitCandidate,
		materializeProfile,
		validateMaterialized
	};
}
/** The profile's model hint as a moving alias; each cell records what it resolved. */
function profileModel(profile) {
	const hint = profile.model?.default;
	if (!hint) return {
		provider: "unspecified",
		alias: "unspecified",
		unknown: "the profile names no model; each cell records the model it resolved"
	};
	return {
		provider: profile.model?.provider ?? "unspecified",
		alias: hint,
		unknown: "the profile names a model hint, not a snapshot; each cell records the model it resolved"
	};
}
//#endregion
//#region src/improvement/method-execution.ts
function resolveOptimizationMethod(source, context) {
	const method = typeof source === "function" ? source(context) : source;
	if (!method || typeof method !== "object" || typeof method.name !== "string" || method.name.trim() !== method.name || method.name.length === 0 || typeof method.optimize !== "function") throw new ConfigError("improve(): method must be a complete OptimizationMethod with a trimmed name and optimize(input)");
	return method;
}
/**
* Run one complete method, then compare its winner with the baseline on the
* held-out test split. A method that records its search (GEPA and SkillOpt do
* through `officialGepa` and `officialSkillOpt`) must close its ledger; Runtime
* replays the bytes and returns the receipt. A method that records none
* returns `searchHistory: null`: its lineage is unknown, not empty.
*/
async function runMethodImprovement(profile, opts) {
	const { surface: _surface, executionRef: _executionRef, method: methodSource, agent, validateCandidate: _validateCandidate, findings: _findings, skills: _skills, profileComponents: _profileComponents, optimizationRunOptions, minimumLift: _minimumLift, subject: _subject, ...comparisonOptions } = opts;
	const prepared = prepareProfileImprovement(profile, opts);
	const { surface, identity, invocationId, baselineSurface, materializeProfile, validateMaterialized, minimumLift } = prepared;
	const { evaluationRef, developmentSplitDigest, finalTestSplitDigest, scenarioPartitions } = identity;
	const dispatchRef = `improve:${evaluationRef}`;
	const method = resolveOptimizationMethod(methodSource, {
		profile,
		evaluationRef,
		surface,
		baselineSurface,
		baselineValue: prepared.baselineValue,
		findings: prepared.findings,
		searchIdentity: prepared.searchIdentity
	});
	const costScope = {
		evaluationRef: identity.evaluationRef,
		invocationId
	};
	const invoke = async (current, input) => {
		const controls = methodRuntimeControlsOf(current);
		const scope = {
			...costScope,
			methodTag: `runtimeMethod:${randomUUID()}`
		};
		const scopedInput = methodInputWithScopedCost(input, scope, "optimizer-run");
		const invocationLedger = methodInvocationCostLedger(scopedInput.costLedger, scope);
		const historical = /* @__PURE__ */ new Map();
		let children = 0;
		const checked = /* @__PURE__ */ new Set();
		const toRoot = (value) => immutableCandidateValue(input.surfaceToRoot?.(immutableCandidateValue(value)) ?? value);
		const currentBaselineDigest = canonicalCandidateDigest$1(toRoot(input.baselineSurface));
		const check = (value) => {
			const rootSurface = toRoot(value);
			const candidateDigest = canonicalCandidateDigest$1(rootSurface);
			if (checked.has(candidateDigest)) return;
			validateMaterialized(controls?.validateCandidate, materializeProfile(rootSurface), rootSurface, candidateDigest === currentBaselineDigest);
			checked.add(candidateDigest);
		};
		check(input.baselineSurface);
		const result = await current.optimize(Object.freeze({
			...scopedInput,
			invokeMethod: async (child, childInput) => {
				const verified = await invoke(child, childInput);
				children += 1;
				for (const receipt of verified.historical) historical.set(receipt.callId, receipt);
				return verified.result;
			},
			dispatchWithSurface: (...[value, scenario, context]) => {
				check(value);
				return input.dispatchWithSurface(value, scenario, context);
			}
		}));
		check(result.winnerSurface);
		assertMethodCostRecorded(current.name, result, scopedInput.costLedger, invocationLedger, comparisonOptions.costCeiling, children > 0 ? "invocation" : controls?.costAttribution, [...historical.values()]);
		if (controls?.costAttribution === "optimizer-run" && result.provenance?.runId) for (const receipt of methodHistoricalReceipts(scopedInput.costLedger, result.provenance.runId, invocationId)) historical.set(receipt.callId, receipt);
		return {
			result,
			historical: [...historical.values()]
		};
	};
	const measuredMethod = {
		...method,
		async optimize(input) {
			const scopedInput = methodInputWithScopedCost(input, costScope, "optimizer-run");
			return (await invoke(method, scopedInput)).result;
		}
	};
	const methodStorage = optimizationRunOptions?.storage ?? comparisonOptions.storage ?? fsCampaignStorage();
	const startedAt = Date.now();
	const raw = await compareOptimizationMethods({
		...comparisonOptions,
		judges: prepared.judges,
		dispatchRef,
		optimizationRunOptions: {
			...optimizationRunOptions ?? {},
			storage: methodStorage,
			dispatchRef
		},
		methods: [measuredMethod],
		baselineSurface,
		dispatchWithSurface: (candidateSurface, scenario, ctx) => agent(materializeProfile(candidateSurface), scenario, ctx)
	});
	if (comparisonOptions.costCeiling !== void 0 && raw.totalCost.totalCostUsd > comparisonOptions.costCeiling) throw new ConfigError(`improve(): reported total cost $${raw.totalCost.totalCostUsd} exceeds costCeiling $${comparisonOptions.costCeiling}`);
	const searchHistory = raw.searchHistory.producers[0]?.receipt ?? null;
	if (searchHistory) {
		if (!searchHistory.complete) throw new ConfigError(`improve(): method '${method.name}' returned an open search ledger: ${searchHistory.incompleteReasons.join("; ")}`);
		verifySearchHistoryArtifact(searchHistory, methodStorage);
	}
	const score = raw.best;
	const winnerSurface = immutableCandidateValue(score.winnerSurface);
	assertCandidateSurfaceKind(surface, baselineSurface, winnerSurface);
	const candidate = Object.freeze({
		surface,
		value: winnerSurface,
		profile: materializeProfile(winnerSurface)
	});
	const cost = copyImproveCost(raw.totalCost);
	return {
		mode: "method",
		method: method.name,
		...score.provenance ? { provenance: immutableCandidateValue(score.provenance) } : {},
		candidate,
		decision: cost.accountingComplete && score.decision.promote && score.decision.low > minimumLift ? "ship" : "hold",
		lift: score.lift,
		liftInterval: { ...score.liftCi },
		searchHistory,
		cost,
		durationMs: Date.now() - startedAt,
		lineage: Object.freeze({
			invocationId,
			runId: score.provenance?.runId ?? invocationId,
			developmentSplitDigest,
			finalTestSplitDigest,
			scenarioPartitions,
			executionRef: prepared.executionRef,
			baselineProfileDigest: prepared.baselineProfileDigest
		}),
		raw,
		async dispose() {}
	};
}
//#endregion
//#region src/improvement/search-method.ts
/** Build Runtime's native search for `improve(profile, { method })`. */
function searchMethod(options) {
	if (!options || typeof options !== "object") throw new ConfigError("searchMethod(): options are required");
	const { proposer } = options;
	if (!proposer || typeof proposer.kind !== "string" || typeof proposer.propose !== "function") throw new ConfigError("searchMethod(): proposer must be a SurfaceProposer");
	const count = (name, value, fallback, min) => {
		const resolved = value ?? fallback;
		if (!Number.isSafeInteger(resolved) || resolved < min) throw new ConfigError(`searchMethod(): ${name} must be an integer of at least ${min}`);
		return resolved;
	};
	const dollars = (name, value) => {
		if (value === void 0) return null;
		if (!Number.isFinite(value) || value < 0) throw new ConfigError(`searchMethod(): ${name} must be a finite non-negative number`);
		return value;
	};
	if (options.deadline !== void 0 && !Number.isFinite(Date.parse(options.deadline))) throw new ConfigError("searchMethod(): deadline must be an ISO time");
	const name = options.name ?? "search";
	if (!name.trim() || name.trim() !== name) throw new ConfigError("searchMethod(): name must be a trimmed non-empty string");
	return Object.freeze({
		kind: "search",
		name,
		policy: options.policy ?? incumbent(),
		allocation: options.allocation ?? uniform(),
		proposer,
		maxExpansions: count("maxExpansions", options.maxExpansions, NaN, 0),
		childrenPerProposal: count("childrenPerProposal", options.childrenPerProposal, 1, 1),
		concurrency: count("concurrency", options.concurrency, 2, 1),
		cellUsd: dollars("cellUsd", options.cellUsd) ?? 0,
		claimReserveUsd: dollars("claimReserveUsd", options.claimReserveUsd),
		deadline: options.deadline === void 0 ? null : new Date(options.deadline).toISOString(),
		maxAttempts: count("maxAttempts", options.maxAttempts, 3, 1)
	});
}
function isImproveSearchMethod(value) {
	return typeof value === "object" && value !== null && value.kind === "search";
}
const SEARCH_METHOD_SOURCE = {
	uri: "npm:@tangle-network/agent-runtime#searchMethod",
	revision: canonicalCandidateDigest$1({
		name: "agent-runtime.search-method.2026-09",
		node: "an exact AgentProfile materialized from the baseline and one surface, content-addressed by canonicalAgentProfileDigest; a surface that does not materialize is a node addressed by its surface and refused",
		edge: "the Interface diffs from the parent profile to the child, stored when they reproduce the child digest",
		admission: "a candidate is refused when it does not materialize, declares training on a test task, fails the caller validator, or carries a credential or private value",
		cell: "a one-cell runCampaign of the materialized profile in a directory addressed by its digest; a cached cell is read back, not run again",
		proposer: "a SurfaceProposer reads the parents, the train view and the train summary; paid calls it makes are its operation accounting",
		ship: "the claim shipped, re-derives from the ledger, cost accounting is complete, and the shipped finalist test lower bound exceeds minimumLift"
	})
};
async function runSearchImprovement(profile, opts) {
	const { method, claim: inputClaim, agent, trainScenarios, selectionScenarios, testScenarios, judges: _judges, surface: _surface, executionRef: _executionRef, validateCandidate: _validateCandidate, findings: _findings, skills: _skills, profileComponents: _profileComponents, minimumLift: _minimumLift, subject: _subject, costCeiling, costLedger: inputCostLedger, seed = 42, signal, ...campaignOptions } = opts;
	if (!isImproveSearchMethod(method)) throw new ConfigError("improve(): a search needs method: searchMethod(...)");
	const claim = defineEvaluationClaim(inputClaim);
	if (claim.minimumEffect === void 0) throw new ConfigError("improve(): a search claim needs minimumEffect for its power check");
	for (const [name, split] of [
		["trainScenarios", trainScenarios],
		["selectionScenarios", selectionScenarios],
		["testScenarios", testScenarios]
	]) if (!Array.isArray(split) || split.length === 0) throw new ConfigError(`improve(): a search needs at least one of ${name}`);
	const { allocation, policy } = method;
	const reps = allocation.reps;
	const prepared = prepareProfileImprovement(profile, {
		...opts,
		seed,
		reps,
		optimizationRunOptions: {
			reps,
			maxConcurrency: method.concurrency
		}
	});
	const { evaluationRef } = prepared.identity;
	const storage = campaignOptions.storage ?? fsCampaignStorage();
	const runDir = resolveRunDir(campaignOptions.runDir, campaignOptions.repo);
	const searchId = `improve-${canonicalCandidateDigest$1({
		evaluationRef,
		process: SEARCH_METHOD_SOURCE,
		method: searchMethodDescriptor(method)
	}).slice(7, 31)}`;
	const searchDir = `${runDir}/search/${searchId}`;
	const costLedger = inputCostLedger ?? createRunCostLedger({
		storage,
		runDir: searchDir,
		costCeilingUsd: costCeiling
	});
	const unitOf = (scenario) => summarizeEvaluationUnits(claim, [scenario]).units[0].id;
	const tasks = (scenarios) => scenarios.map((scenario) => ({
		taskId: scenario.id,
		unitId: unitOf(scenario),
		source: {
			uri: `scenario://${scenario.id}`,
			revision: canonicalCandidateDigest$1(scenario)
		}
	}));
	const splits = {
		train: tasks(trainScenarios),
		selection: tasks(selectionScenarios),
		test: tasks(testScenarios)
	};
	const developmentUnits = new Set([...splits.train, ...splits.selection].map((task) => task.unitId));
	const execution = {
		model: prepared.searchIdentity.model,
		agent: prepared.searchIdentity.agent,
		benchmark: {
			uri: "agent-runtime:improve-splits",
			revision: canonicalCandidateDigest$1({
				development: prepared.identity.developmentSplitDigest,
				test: prepared.identity.finalTestSplitDigest
			})
		}
	};
	const reservedClaimUsd = Math.max(method.claimReserveUsd ?? 0, searchClaimReserveUsd({
		testTasks: splits.test.length,
		reps,
		cellUsd: method.cellUsd
	}));
	const recorder = await SearchRecorder.open({
		ledger: storage.kind === "filesystem" ? openSearchLedger({
			path: `${searchDir}/ledger.jsonl`,
			searchId
		}) : openSearchLedger({
			path: `${searchDir}/ledger.jsonl`,
			searchId,
			store: storage
		}),
		storage
	}, {
		subject: prepared.searchIdentity.subject,
		process: {
			name: method.name,
			executionRef: SEARCH_METHOD_SOURCE
		},
		artifactKind: "agent-profile",
		objective: {
			metric: "composite",
			direction: "maximize",
			judge: prepared.searchIdentity.judge,
			claim
		},
		splits: {
			...splits,
			heldOutUnits: splits.test.every((task) => !developmentUnits.has(task.unitId))
		},
		policy: {
			expansion: policy.name,
			allocation: allocation.name,
			seed
		},
		budget: {
			maxUsd: costCeiling ?? null,
			maxCells: null,
			maxNodes: 1 + method.maxExpansions * method.childrenPerProposal,
			deadline: method.deadline,
			maxConcurrency: method.concurrency,
			reservedClaimUsd: costCeiling === void 0 ? 0 : reservedClaimUsd
		},
		containment: null,
		derivedFrom: null,
		identity: execution
	});
	const nodeOf = (candidateSurface) => {
		const surface = immutableCandidateValue(candidateSurface);
		try {
			return {
				surface,
				profile: prepared.materializeCandidate(surface),
				refusal: null
			};
		} catch (error) {
			return {
				surface,
				profile: null,
				refusal: refusalText(error)
			};
		}
	};
	const codec = profileCodec(prepared);
	const scenarios = [
		...trainScenarios,
		...selectionScenarios,
		...testScenarios
	];
	const scenarioIds = /* @__PURE__ */ new Set();
	for (const scenario of scenarios) {
		if (scenarioIds.has(scenario.id)) throw new ConfigError(`improve(): scenario '${scenario.id}' appears in more than one split`);
		scenarioIds.add(scenario.id);
	}
	const lane = "in-process";
	const executor = {
		lanes: () => [{
			name: lane,
			capacity: method.concurrency,
			costCap: "estimate",
			cellUsd: method.cellUsd
		}],
		place: () => lane,
		adopt: async () => null,
		async run(work) {
			const nodeProfile = work.artifact.profile;
			if (!nodeProfile) throw new Error(`improve(): refused node ${work.nodeId} was given a cell`);
			const profileDigest = canonicalAgentProfileDigest(nodeProfile);
			const cell = (await runCampaign({
				...campaignOptions,
				scenarios,
				judges: prepared.judges,
				seed,
				reps,
				storage,
				runDir: `${searchDir}/nodes/${profileDigest.slice(7)}`,
				dispatchRef: `improve:${evaluationRef}:${profileDigest}`,
				dispatch: (scenario, ctx) => agent(nodeProfile, scenario, ctx),
				cellFilter: ({ scenario, rep }) => scenario.id === work.taskId && rep === work.rep,
				resumable: true,
				maxConcurrency: 1,
				costLedger,
				costPhase: `search.${work.stage}`,
				signal: work.signal
			})).cells[0];
			if (!cell) throw new Error(`improve(): cell ${work.cellId} produced no campaign cell`);
			return campaignCellSearchResult(cell, {
				execution,
				lane: work.lane
			});
		}
	};
	const { proposer } = method;
	const proposerSource = {
		uri: `proposer:${proposer.kind}`,
		revision: canonicalCandidateDigest$1({
			kind: proposer.kind,
			propose: Function.prototype.toString.call(proposer.propose),
			decide: proposer.decide ? Function.prototype.toString.call(proposer.decide) : null
		})
	};
	const proposalPhase = "search.proposal";
	const port = {
		name: proposer.kind,
		kind: "optimizer",
		source: proposerSource,
		execution: {
			kind: "deterministic",
			source: proposerSource
		},
		childrenPerProposal: method.childrenPerProposal,
		async propose(request) {
			const before = new Set(costLedger.list({ phase: proposalPhase }).map((r) => r.callId));
			const state = await recorder.state();
			const parents = request.parents.map(({ nodeId, artifact }) => ({
				nodeId,
				artifact: artifact.surface
			}));
			const context = Object.freeze({
				currentSurface: parents[0]?.artifact ?? prepared.baselineSurface,
				operator: request.operator,
				parents,
				train: searchProposerView(state),
				summary: renderSearchSummary(state, { split: "train" }),
				history: [],
				findings: prepared.findings,
				populationSize: method.childrenPerProposal,
				generation: request.expansion,
				signal: request.signal,
				costLedger,
				costPhase: proposalPhase
			});
			const decision = proposer.decide?.({ history: [] });
			const proposed = decision?.stop ? [] : await proposer.propose(context);
			if (!Array.isArray(proposed)) throw new ConfigError("improve(): the search proposer must return an array");
			const fresh = costLedger.list({ phase: proposalPhase }).filter((receipt) => !before.has(receipt.callId));
			return {
				children: proposed.slice(0, method.childrenPerProposal).map((child) => isProposedCandidate(child) ? {
					artifact: nodeOf(child.surface),
					label: child.label,
					rationale: child.rationale,
					...child.attribution ? { attribution: child.attribution } : {}
				} : {
					artifact: nodeOf(child),
					label: "",
					rationale: ""
				}),
				...decision?.stop ? { stop: decision.reason ?? "the proposer decided to stop" } : {},
				accounting: searchReceiptAccounting(fresh),
				execution: searchProposalExecution(fresh, prepared.searchIdentity.model.provider, proposerSource)
			};
		}
	};
	const admit = (node) => {
		if (node.refusal !== null || node.profile === null) return node.refusal;
		try {
			prepared.admitCandidate(node.profile, node.surface);
		} catch (error) {
			return refusalText(error);
		}
		const paths = privateValuePaths([node.surface]);
		return paths.length === 0 ? null : `the surface carries a credential or private value at ${paths.slice(0, 8).join(", ")}`;
	};
	const startedAt = Date.now();
	const result = await runSearch({
		recorder,
		root: nodeOf(prepared.baselineSurface),
		codec,
		policy,
		allocation,
		proposer: port,
		executor,
		admit,
		maxExpansions: method.maxExpansions,
		maxAttempts: method.maxAttempts,
		...signal ? { signal } : {}
	});
	const { state } = result;
	const claimResult = result.claim;
	if (!claimResult || !result.claimVerification) throw new Error(`improve(): search ${searchId} closed without a claim`);
	const kept = codec.load(recorder, state.node(result.leader));
	if (!kept.profile) throw new Error(`improve(): search ${searchId} kept a refused node`);
	const candidate = Object.freeze({
		surface: prepared.surface,
		value: kept.surface,
		profile: kept.profile
	});
	const cost = copyImproveCost(costLedger.summary());
	const shipped = claimResult.finalists.find((finalist) => finalist.nodeId === claimResult.selected && finalist.test !== null);
	const { decision, reason } = runtimeShipDecision({
		claim: claimResult,
		verified: result.claimVerification.status === "verified",
		accountingComplete: cost.accountingComplete,
		lowerBound: shipped?.test?.interval[0] ?? null,
		minimumLift: prepared.minimumLift
	});
	return {
		mode: "search",
		method: method.name,
		candidate,
		decision,
		reason,
		claim: claimResult,
		claimVerification: result.claimVerification,
		...shipped?.test ? {
			lift: shipped.test.delta,
			liftInterval: {
				low: shipped.test.interval[0],
				high: shipped.test.interval[1]
			}
		} : {},
		searchHistory: recorder.receipt({
			producerId: method.name,
			runId: searchId
		}),
		cost,
		durationMs: Date.now() - startedAt,
		lineage: Object.freeze({
			invocationId: prepared.invocationId,
			runId: searchId,
			developmentSplitDigest: prepared.identity.developmentSplitDigest,
			finalTestSplitDigest: prepared.identity.finalTestSplitDigest,
			scenarioPartitions: prepared.identity.scenarioPartitions,
			executionRef: prepared.executionRef,
			baselineProfileDigest: prepared.baselineProfileDigest
		}),
		async dispose() {}
	};
}
/** Runtime's ship rule over the kernel's statistical claim (design §6.5 step 5). */
function runtimeShipDecision(input) {
	const { claim } = input;
	if (claim.decision !== "ship") return {
		decision: "hold",
		reason: claim.reason
	};
	if (!input.verified) return {
		decision: "hold",
		reason: "the claim shipped, but it does not re-derive from the ledger under this rule revision"
	};
	if (!input.accountingComplete) return {
		decision: "hold",
		reason: "the claim shipped, but the search cost accounting is incomplete"
	};
	if (input.lowerBound === null || !(input.lowerBound > input.minimumLift)) return {
		decision: "hold",
		reason: `the claim shipped, but its test lower bound ${input.lowerBound} does not exceed minimumLift ${input.minimumLift}`
	};
	return {
		decision: "ship",
		reason: claim.reason
	};
}
/** Profiles as search artifacts: nodes by profile digest, edges by profile diffs. */
function profileCodec(prepared) {
	const surfaceId = prepared.surface;
	return {
		node(recorder, node) {
			if (node.profile) {
				const artifact = recorder.blob("agent-profile", {
					kind: "agent-profile",
					profile: node.profile
				});
				return {
					artifactDigest: canonicalAgentProfileDigest(node.profile),
					artifact,
					surfaces: [{
						surfaceId,
						kind: "agent-profile",
						artifact
					}]
				};
			}
			const artifact = recorder.blob("surface", {
				kind: "unmaterialized-surface",
				surface: node.surface,
				refusal: node.refusal
			});
			return {
				artifactDigest: canonicalCandidateDigest$1({
					kind: "unmaterialized-surface",
					surface: node.surface
				}),
				artifact,
				surfaces: [{
					surfaceId,
					kind: "agent-profile",
					artifact
				}]
			};
		},
		diff(recorder, parent, child) {
			if (!parent.profile || !child.profile) return { unknown: "a surface that does not materialize has no profile to diff" };
			const diffs = diffAgentProfiles(parent.profile, child.profile);
			const to = canonicalAgentProfileDigest(child.profile);
			if (canonicalAgentProfileDigest(diffs.reduce(applyAgentProfileDiff, parent.profile)) !== to) return { unknown: "the Interface profile diffs do not reproduce the child profile" };
			return recorder.blob("diff", {
				kind: "agent-profile-diff",
				from: canonicalAgentProfileDigest(parent.profile),
				to,
				diffs
			});
		},
		load(recorder, node) {
			const stored = recorder.readBlob(node.artifact);
			if (stored.kind === "agent-profile") {
				const parsed = agentProfileSchema.safeParse(stored.profile);
				if (!parsed.success) throw new Error(`improve(): node ${node.nodeId} holds an invalid AgentProfile`);
				const loaded = immutableCandidateValue(parsed.data);
				return {
					surface: prepared.surfaceOf(loaded),
					profile: loaded,
					refusal: null
				};
			}
			if (stored.kind === "unmaterialized-surface" && stored.surface !== void 0) return {
				surface: stored.surface,
				profile: null,
				refusal: stored.refusal ?? null
			};
			throw new Error(`improve(): node ${node.nodeId} holds no profile search artifact`);
		}
	};
}
/** Everything that decides which search a call continues. */
function searchMethodDescriptor(method) {
	return {
		name: method.name,
		policy: method.policy.name,
		allocation: method.allocation.name,
		reps: method.allocation.reps,
		proposer: method.proposer.kind,
		maxExpansions: method.maxExpansions,
		childrenPerProposal: method.childrenPerProposal,
		concurrency: method.concurrency,
		cellUsd: method.cellUsd,
		claimReserveUsd: method.claimReserveUsd,
		deadline: method.deadline,
		maxAttempts: method.maxAttempts
	};
}
/** A refusal as the ledger stores it: redacted with the share profile. */
function refusalText(error) {
	return redact(error instanceof Error ? error.message : String(error), { profile: "share" }).value;
}
//#endregion
//#region src/improvement/training.ts
function positiveLimit(value, label) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid ${label}`);
}
async function hashFile(path, maximum, signal, capture = false) {
	signal.throwIfAborted();
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const before = await file.stat();
		if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size > maximum) throw new Error("artifact must be a bounded regular file");
		const hash = createHash("sha256");
		const chunks = [];
		let bytes = 0;
		for await (const chunk of file.createReadStream({
			autoClose: false,
			signal
		})) {
			bytes += chunk.length;
			if (bytes > maximum) throw new Error("artifact exceeded its byte limit");
			if (bytes > before.size) throw new Error("artifact changed while being hashed");
			hash.update(chunk);
			if (capture) chunks.push(Buffer.from(chunk));
		}
		const after = await file.stat();
		if (before.size !== bytes || after.size !== bytes || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("artifact changed while being hashed");
		return {
			digest: `sha256:${hash.digest("hex")}`,
			bytes,
			...capture ? { content: Buffer.concat(chunks) } : {}
		};
	} finally {
		await file.close();
	}
}
/** Execute one pinned command without a shell, in the runtime-owned job directory. POSIX only. */
function createCommandProfileTrainer(input) {
	const command = immutableCandidateValue(input);
	positiveLimit(command.maxOutputBytes, "trainer output limit");
	if (!command.id || command.id.trim() !== command.id || !Array.isArray(command.args) || !command.args.every((arg) => typeof arg === "string" && !arg.includes("\0"))) throw new Error("invalid trainer command");
	for (const file of [command.executable, ...command.inputs]) {
		if (!isAbsolute(file.path)) throw new Error("trainer files must use absolute paths");
		sha256DigestSchema.parse(file.digest);
	}
	for (const [name, value] of Object.entries(command.environment)) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || value.includes("\0")) throw new Error("invalid trainer environment");
	agentProfileEnvironmentSchema.parse(Object.fromEntries(Object.entries(command.environment).map(([key, value]) => [key, {
		kind: "public",
		value
	}])));
	const identity = immutableCandidateValue({
		mode: "command",
		id: command.id,
		revision: canonicalCandidateDigest$1(command)
	});
	agentTrainingReceiptSchema.shape.trainer.parse({
		...identity,
		parameters: {}
	});
	return Object.freeze({
		identity,
		async execute(request, signal) {
			try {
				if (process.platform === "win32") throw new Error("controlled trainers require POSIX process-group cancellation");
				const requestSnapshot = immutableCandidateValue(request);
				const inputBytes = Buffer.from(canonicalCandidateBytes(requestSnapshot));
				const verifyInputs = async () => {
					for (const file of [command.executable, ...command.inputs]) if ((await hashFile(file.path, Number.MAX_SAFE_INTEGER, signal)).digest !== file.digest) throw new Error("trainer executable or input digest mismatch");
				};
				await verifyInputs();
				signal.throwIfAborted();
				await new Promise((resolve, reject) => {
					const child = spawn(command.executable.path, command.args, {
						cwd: dirname(requestSnapshot.checkpointPath),
						env: command.environment,
						shell: false,
						detached: true,
						stdio: [
							"pipe",
							"pipe",
							"pipe"
						]
					});
					let failure;
					let outputBytes = 0;
					let leaderClosed = false;
					let termination;
					const stop = () => {
						if (!termination) {
							termination = terminateProcessTreeAndConfirm(child, () => leaderClosed, "createCommandProfileTrainer");
							termination.catch((error) => {
								failure ??= error;
							});
						}
						return termination;
					};
					const abort = () => {
						failure ??= /* @__PURE__ */ new Error("trainer cancelled");
						stop();
					};
					signal.addEventListener("abort", abort, { once: true });
					if (signal.aborted) abort();
					const count = (chunk) => {
						outputBytes += chunk.length;
						if (outputBytes > command.maxOutputBytes) {
							failure ??= /* @__PURE__ */ new Error("trainer output limit exceeded");
							stop();
						}
					};
					child.stdout.on("data", count);
					child.stderr.on("data", count);
					child.stdin.on("error", (error) => {
						failure ??= error;
						stop();
					});
					child.on("error", (error) => {
						failure ??= error;
					});
					child.on("exit", stop);
					child.on("close", (code, exitSignal) => {
						leaderClosed = true;
						signal.removeEventListener("abort", abort);
						stop().then(() => {
							if (failure) reject(failure);
							else if (code !== 0 || exitSignal !== null) reject(/* @__PURE__ */ new Error(`trainer exited unsuccessfully (${code ?? exitSignal})`));
							else resolve();
						}, reject);
					});
					child.stdin.end(inputBytes);
				});
				await verifyInputs();
				return {
					succeeded: true,
					value: void 0
				};
			} catch (error) {
				return {
					succeeded: false,
					reason: error instanceof Error ? error.message : "trainer failed"
				};
			}
		}
	});
}
function datasetIdentity(bytes) {
	const dataset = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	canonicalCandidateBytes(dataset);
	if (!dataset || typeof dataset !== "object" || Object.keys(dataset).sort().join(",") !== "format,rows,version" || dataset.version !== 1 || ![
		"sft",
		"dpo",
		"grpo"
	].includes(dataset.format) || !Array.isArray(dataset.rows) || dataset.rows.length === 0 || dataset.rows.length > 1e6) throw new Error("invalid training dataset");
	const tasks = /* @__PURE__ */ new Map();
	const partitions = /* @__PURE__ */ new Map();
	let trainingRows = 0;
	for (const row of dataset.rows) {
		if (!row || typeof row !== "object" || Object.keys(row).sort().join(",") !== "data,partition,task" || !["train", "validation"].includes(row.partition)) throw new Error("every dataset row needs its exposure identity and partition");
		if (row.partition === "train") trainingRows++;
		const task = agentTrainingTaskSchema.parse(row.task);
		for (const identity of [JSON.stringify([task.benchmark, task.task]), task.contentDigest]) {
			const previous = partitions.get(identity);
			if (previous !== void 0 && previous !== row.partition) throw new Error("training and validation task partitions intersect");
			partitions.set(identity, row.partition);
		}
		tasks.set(agentTrainingTaskKey(task), task);
	}
	if (trainingRows === 0) throw new Error("dataset contains no training rows");
	const members = [...tasks.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, task]) => task);
	return agentTrainingDatasetIdentitySchema.parse({
		digest: sha256Bytes$1(bytes),
		taskSetDigest: canonicalCandidateDigest$1(members),
		tasks: members
	});
}
/** Training materializes a candidate; it never emits a ship verdict or changes a live agent. */
async function runProfileTraining(profile, options) {
	let stage = "admission";
	let jobDirectory;
	const cancellation = linkAbort(...options.signal ? [options.signal] : []);
	const signal = cancellation.signal;
	const outputDirectory = options.outputDirectory;
	const timeoutMs = options.timeoutMs;
	let servingMayExist = false;
	let trainingMayExist = false;
	let clearTimer;
	try {
		if (options.mode !== "training") throw new Error("training mode is required");
		const parent = snapshotAgentProfile(profile);
		if (!parent.harness || !parent.model?.default?.trim() || !parent.model.provider?.trim()) throw new Error("training requires an explicit parent harness, provider and model");
		const parentProfileDigest = canonicalAgentProfileDigest(parent);
		const parentBytes = Buffer.from(JSON.stringify(parent), "utf8");
		sha256DigestSchema.parse(options.dataset.digest);
		if (timeoutMs !== void 0) positiveLimit(timeoutMs, "training timeout");
		positiveLimit(options.maxCheckpointBytes, "checkpoint byte limit");
		if (typeof options.trainer?.execute !== "function" || typeof options.serving?.serve !== "function") throw new Error("trainer and verified serving ports are required");
		const trainer = immutableCandidateValue(options.trainer.identity);
		const parameters = immutableCandidateValue(agentTrainingParametersSchema.parse(options.parameters));
		agentTrainingReceiptSchema.shape.trainer.parse({
			...trainer,
			parameters
		});
		assertCandidateValidator(options.validateCandidate);
		const execute = options.trainer.execute.bind(options.trainer);
		const serve = options.serving.serve.bind(options.serving);
		const executionRef = parseExecutionRef(options.executionRef, "training");
		const expectedDatasetDigest = options.dataset.digest;
		const sourceDataset = options.dataset.path;
		const maxCheckpointBytes = options.maxCheckpointBytes;
		const validateCandidate = options.validateCandidate;
		const ancestry = agentProfileTrainingSchema.shape.ancestors.parse(parent.metadata?.training ? [parent.metadata.training.receipt, ...parent.metadata.training.ancestors] : []);
		const validate = (candidate, isBaseline) => validateProfileCandidate(validateCandidate, {
			profile: candidate,
			surface: "agent-profile",
			candidateSurface: JSON.stringify(candidate),
			value: candidate,
			isBaseline
		});
		if (timeoutMs !== void 0) clearTimer = armDeadlineTimer(timeoutMs, () => cancellation.abort(/* @__PURE__ */ new Error("training deadline exceeded")), true);
		signal.throwIfAborted();
		validate(parent, true);
		await mkdir(outputDirectory, { recursive: true });
		const outputRoot = await realpath(outputDirectory);
		jobDirectory = await mkdtemp(join(outputRoot, "training-"));
		await chmod(jobDirectory, 448);
		syncDurableDirectory(outputRoot);
		const datasetPath = join(jobDirectory, "dataset.json");
		const parentProfilePath = join(jobDirectory, "parent-profile.json");
		const artifactPath = join(jobDirectory, "checkpoint.bin");
		stage = "dataset";
		const source = await hashFile(sourceDataset, 128 * 1024 * 1024, signal, true);
		if (source.digest !== expectedDatasetDigest) throw new Error("training dataset digest mismatch");
		const bytes = source.content;
		if (bytes.length !== source.bytes) throw new Error("training dataset snapshot is incomplete");
		const dataset = datasetIdentity(bytes);
		await writeFile(datasetPath, bytes, {
			flag: "wx",
			mode: 256
		});
		await writeFile(parentProfilePath, parentBytes, {
			flag: "wx",
			mode: 256
		});
		const request = immutableCandidateValue({
			version: 1,
			invocationId: jobDirectory,
			datasetPath,
			checkpointPath: artifactPath,
			parentProfilePath,
			parentProfileDigest,
			parameters,
			executionRef
		});
		stage = "training";
		const trained = await runAbortable(() => {
			trainingMayExist = true;
			return execute(request, signal);
		}, signal, "training cancelled");
		signal.throwIfAborted();
		if (trained?.succeeded !== true) throw new Error(trained?.reason ?? "trainer did not report success");
		trainingMayExist = false;
		stage = "checkpoint";
		if ((await hashFile(datasetPath, 128 * 1024 * 1024, signal)).digest !== dataset.digest || (await hashFile(parentProfilePath, parentBytes.byteLength, signal)).digest !== sha256Bytes$1(parentBytes)) throw new Error("trainer changed its pinned inputs");
		const artifact = await hashFile(artifactPath, maxCheckpointBytes, signal);
		if (artifact.bytes === 0) throw new Error("checkpoint must be nonempty");
		await chmod(artifactPath, 256);
		const checkpoint = await open(artifactPath, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			await checkpoint.sync();
		} finally {
			await checkpoint.close();
		}
		stage = "serving";
		const served = await runAbortable(() => {
			servingMayExist = true;
			return serve({
				artifactPath,
				artifactDigest: artifact.digest,
				artifactBytes: artifact.bytes,
				routerModelId: trainedModelIdForArtifact(artifact.digest),
				signal
			});
		}, signal, "checkpoint serving cancelled");
		signal.throwIfAborted();
		if (served?.succeeded !== true) throw new Error(served?.reason ?? "checkpoint serving is unverified");
		if (served.value.artifactDigest !== artifact.digest) throw new Error("Router serving evidence names a different checkpoint");
		const receipt = immutableCandidateValue(agentTrainingReceiptSchema.parse({
			version: 1,
			dataset,
			parentProfileDigest,
			parentReceiptDigest: ancestry[0] ? canonicalCandidateDigest$1(ancestry[0]) : null,
			executionRef,
			trainer: {
				...trainer,
				parameters
			},
			checkpoint: {
				artifactDigest: artifact.digest,
				artifactBytes: artifact.bytes,
				routerModelId: served.value.routerModelId,
				servingDigest: served.value.evidenceDigest
			}
		}));
		if ((await hashFile(artifactPath, maxCheckpointBytes, signal)).digest !== artifact.digest) throw new Error("checkpoint changed during serving");
		stage = "profile";
		const previousModel = parent.metadata?.training?.receipt.checkpoint.routerModelId;
		const routerModelId = receipt.checkpoint.routerModelId;
		const rebindModels = (entries) => Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, previousModel && value.model === previousModel ? {
			...value,
			model: routerModelId
		} : value]));
		const candidate = snapshotAgentProfile({
			...parent,
			model: {
				...parent.model,
				default: routerModelId,
				...previousModel && parent.model.small === previousModel ? { small: routerModelId } : {}
			},
			...parent.subagents && { subagents: rebindModels(parent.subagents) },
			...parent.modes && { modes: rebindModels(parent.modes) },
			metadata: {
				...parent.metadata,
				training: {
					receipt,
					ancestors: ancestry
				}
			}
		});
		validate(candidate, false);
		if ((await hashFile(artifactPath, maxCheckpointBytes, signal)).digest !== artifact.digest) throw new Error("checkpoint changed during candidate validation");
		stage = "persistence";
		const receiptPath = join(jobDirectory, "receipt.json");
		const profilePath = join(jobDirectory, "profile.json");
		const profileDigest = canonicalAgentProfileDigest(candidate);
		for (const [path, value] of [[receiptPath, receipt], [profilePath, candidate]]) {
			signal.throwIfAborted();
			if (!publishExclusiveDurableFile(path, JSON.stringify(value), { mode: 256 })) throw new Error("training publication path already exists");
		}
		return {
			mode: "training",
			succeeded: true,
			profile: candidate,
			profileDigest,
			receipt,
			artifactPath,
			receiptPath,
			profilePath
		};
	} catch (error) {
		let cleanupError;
		if (jobDirectory) try {
			await rm(join(jobDirectory, "profile.json"), { force: true });
			syncDurableDirectory(jobDirectory);
		} catch (failure) {
			cleanupError = failure instanceof Error ? failure.message : "profile cleanup failed";
		}
		return {
			mode: "training",
			succeeded: false,
			stage,
			reason: error instanceof Error ? error.message : typeof error === "string" ? error : "training failed",
			servingMayExist,
			trainingMayExist,
			...cleanupError ? { cleanupError } : {},
			...jobDirectory ? { outputDirectory: jobDirectory } : {}
		};
	} finally {
		clearTimer?.();
		cancellation.release();
	}
}
//#endregion
//#region src/improvement/improve.ts
async function improve(profileOrCode, opts) {
	if (opts === void 0) {
		const code = profileOrCode;
		if (code?.surface !== "code") throw new ConfigError("improve(): the one-argument form requires { surface: 'code', ... }");
		return runCodeImprovement(code);
	}
	if (opts === null || typeof opts !== "object") throw new ConfigError("improve(): options must be an object");
	if ("mode" in opts) {
		if (opts.mode !== "training") throw new ConfigError("improve(): unsupported mode");
		return runProfileTraining(profileOrCode, opts);
	}
	if (opts.surface === "code") throw new ConfigError("improve(): code takes one argument: improve({ surface: 'code', ... })");
	const parsedProfile = agentProfileSchema.safeParse(profileOrCode);
	if (!parsedProfile.success) throw new ConfigError(`improve(): input is not a valid AgentProfile: ${parsedProfile.error.message}`);
	const exact = immutableCandidateValue(parsedProfile.data);
	if (isImproveSearchMethod(opts.method)) return runSearchImprovement(exact, opts);
	return runMethodImprovement(exact, opts);
}
//#endregion
//#region src/intelligence/improvement-surfaces.ts
const changedSurfaceOrder = [
	"prompt",
	"skills",
	"tools",
	"mcp",
	"hooks",
	"subagents",
	"agent-profile",
	"memory",
	"code",
	"knowledge",
	"rollout-policy"
];
/** Agent improvement surfaces delivered as exact `AgentProfileDiff` replacements. */
const AGENT_IMPROVEMENT_PROFILE_SURFACES = [
	"prompt",
	"skills",
	"tools",
	"mcp",
	"hooks",
	"subagents"
];
/**
* Profile changes eligible for the product-owned measured comparison path.
* The six directly deliverable profile surfaces retain their granular labels;
* any residual profile axis also adds the complete `agent-profile` surface.
*/
const AGENT_PROFILE_MEASURED_SURFACES = [...AGENT_IMPROVEMENT_PROFILE_SURFACES, "agent-profile"];
function deriveChangedSurfaces(baselineBundle, candidateBundle) {
	if (baselineBundle.knowledge || candidateBundle.knowledge) assertKnowledgeCandidatePair(baselineBundle, candidateBundle);
	assertCodeCandidatePair(baselineBundle, candidateBundle);
	const baseline = improvementSurfaceValues(baselineBundle);
	const candidate = improvementSurfaceValues(candidateBundle);
	const changed = changedSurfaceOrder.filter((surface) => canonicalCandidateDigest$1(baseline[surface]) !== canonicalCandidateDigest$1(candidate[surface]));
	if (changed.length === 0) throw new Error("candidate experiment does not change an agent surface");
	return changed;
}
function assertAgentImprovementActivationTargets(surfaces, experiment, intent, targets) {
	if (isProfileImprovementExperiment(experiment)) assertProfileImprovementTargetsShareIdentity(targets);
	const expected = new Set(surfaces);
	const actual = new Set(targets.map((target) => target.surface));
	const sourceArm = intent === "activate-candidate" ? "baseline" : "candidate";
	if (!(isProfileImprovementExperiment(experiment) ? sameAgentImprovementSurfaceSet(surfaces, activationExperimentChangedSurfaces(experiment)) : sameOrderedSurfaces(surfaces, activationExperimentChangedSurfaces(experiment))) || targets.some((target) => !target.identity.trim()) || targets.some((target) => target.expectedBaseDigest !== activationTargetDigest(experiment, sourceArm, target.surface)) || targets.length !== surfaces.length || expected.size !== actual.size || [...expected].some((surface) => !actual.has(surface))) throw new Error("agent improvement activation targets must cover exactly the changed surfaces");
}
/** One opaque profile-state transition can change only one complete profile record. */
function assertProfileImprovementTargetsShareIdentity(targets) {
	if (new Set(targets.map((target) => target.identity)).size !== 1) throw new Error("profile improvement activation targets must name one profile identity");
}
/** Bind caller-owned target identities to the exact source state Runtime measured. */
function buildAgentImprovementActivationTargets(surfaces, experiment, intent, identities) {
	const sourceArm = intent === "activate-candidate" ? "baseline" : "candidate";
	const targets = identities.map((target) => ({
		...target,
		expectedBaseDigest: activationTargetDigest(experiment, sourceArm, target.surface)
	}));
	assertAgentImprovementActivationTargets(surfaces, experiment, intent, targets);
	return targets;
}
/** Exact host-owned profile state for every changed profile surface. */
function agentProfileImprovementStateDigest(experiment, arm) {
	return experiment[arm].stateDigest;
}
/** Map Interface's current profile-improvement contract to Runtime-deliverable surfaces. */
function profileImprovementChangedSurfaces(change) {
	const surfaces = changedProfileImprovementSurfaces(change);
	if (surfaces.length === 0 || !surfaces.every((surface) => isAgentProfileMeasuredSurface(surface))) throw new Error("profile improvement experiment does not change a supported surface");
	return surfaces;
}
function agentImprovementTargetDigest(experiment, arm, surface) {
	if (surface === "knowledge") {
		const knowledge = assertKnowledgeCandidatePair(experiment.baseline, experiment.candidate);
		return arm === "baseline" ? knowledge.candidate.baseHash : knowledge.candidate.candidateHash;
	}
	if (surface === "code") assertCodeCandidatePair(experiment.baseline, experiment.candidate);
	return canonicalCandidateDigest$1(improvementSurfaceValues(experiment[arm])[surface]);
}
function agentImprovementTargetInput(bundle, surface) {
	return improvementSurfaceValues(bundle)[surface];
}
function activationTargetDigest(experiment, arm, surface) {
	if (isProfileImprovementExperiment(experiment)) {
		if (!activationExperimentChangedSurfaces(experiment).includes(surface)) throw new Error("profile improvement activation targets an unchanged surface");
		return agentProfileImprovementStateDigest(experiment, arm);
	}
	return agentImprovementTargetDigest(experiment, arm, surface);
}
function activationExperimentChangedSurfaces(experiment) {
	if (!isProfileImprovementExperiment(experiment)) return deriveChangedSurfaces(experiment.baseline, experiment.candidate);
	return profileImprovementChangedSurfaces(experiment.change);
}
function isProfileImprovementExperiment(experiment) {
	return experiment.kind === "agent-profile-improvement-experiment";
}
function sameOrderedSurfaces(left, right) {
	return left.length === right.length && left.every((surface, index) => surface === right[index]);
}
/** Profile-change surface order is presentation only; its measured contract is set-based. */
function sameAgentImprovementSurfaceSet(left, right) {
	return left.length === right.length && left.every((surface) => right.includes(surface));
}
/** Return whether a measured surface can be delivered through an agent profile. */
function isAgentImprovementProfileSurface(surface) {
	return AGENT_IMPROVEMENT_PROFILE_SURFACES.includes(surface);
}
/** Return whether a surface is eligible for shared profile measurement. */
function isAgentProfileMeasuredSurface(surface) {
	return AGENT_PROFILE_MEASURED_SURFACES.includes(surface);
}
/**
* Return the canonical current-state input for one profile-deliverable improvement target.
* Missing slots become `null`; tools and subagents include both their direct and resource slots.
* Unrelated profile fields are excluded. The result matches `agentImprovementTargetInput` for the
* same profile inside a candidate bundle.
*/
function agentImprovementProfileSurfaceInput(profile, surface) {
	return immutableCandidateValue(profileSurfaceInput(parseExactAgentProfile(omitUndefinedObjectFields(profile, "agent improvement profile"), "agent improvement profile"), surface));
}
function profileSurfaceInput(profile, surface) {
	switch (surface) {
		case "prompt": return { prompt: profile.prompt ?? null };
		case "skills": return profile.resources?.skills ?? null;
		case "tools": return {
			tools: profile.tools ?? null,
			resources: profile.resources?.tools ?? null
		};
		case "mcp": return profile.mcp ?? null;
		case "hooks": return profile.hooks ?? null;
		case "subagents": return {
			subagents: profile.subagents ?? null,
			resources: profile.resources?.agents ?? null
		};
	}
}
/** Return the `Sha256Digest` of one profile surface using Runtime's canonical candidate digest. */
function agentImprovementProfileSurfaceDigest(profile, surface) {
	return canonicalCandidateDigest$1(agentImprovementProfileSurfaceInput(profile, surface));
}
/**
* Replace one measured profile surface exactly, including array-valued resources.
* Apply the returned diffs in order: a diff applies its set before its removal,
* so exact replacement requires a reset record followed by a set record.
*/
function agentImprovementTargetProfileDiffs(target, options) {
	const { remove, set } = improvementSurfaceReplacement(target);
	const common = {
		kind: "agent-profile-diff",
		...options.source ? { source: options.source } : {},
		metadata: {
			...options.metadata ?? {},
			surface: target.surface
		}
	};
	const reset = agentProfileDiffSchema.parse(defineAgentProfileDiff({
		...common,
		id: `${options.id}:${target.surface}:reset`,
		title: `Replace active ${target.surface}`,
		remove
	}));
	if (!set) return [reset];
	return [reset, agentProfileDiffSchema.parse(defineAgentProfileDiff({
		...common,
		id: `${options.id}:${target.surface}:set`,
		title: `Activate measured ${target.surface}`,
		set
	}))];
}
/**
* Derive the ordered profile patch that changes one executable profile into
* another, then prove the patch preserves the complete candidate state.
*/
function agentImprovementProfileDiffs(baselineInput, candidateInput, options) {
	const baseline = parseExactAgentProfile(omitUndefinedObjectFields(baselineInput, "profile improvement baseline"), "profile improvement baseline");
	const candidate = parseExactAgentProfile(omitUndefinedObjectFields(candidateInput, "profile improvement candidate"), "profile improvement candidate");
	if (canonicalAgentProfileDigest(baseline) === canonicalAgentProfileDigest(candidate)) throw new Error("profile improvement candidate does not change the profile");
	const completeChanges = completeAgentProfileReplacementDiffs(baseline, candidate, options);
	if (canonicalAgentProfileDigest(completeChanges.reduce((profile, change) => applyExactAgentProfileDiff(profile, change, "complete profile improvement candidate change"), baseline)) !== canonicalAgentProfileDigest(candidate)) throw new Error("complete profile improvement change did not reproduce the candidate");
	return completeChanges;
}
function completeAgentProfileReplacementDiffs(baseline, candidate, options) {
	const remove = {};
	const set = {};
	if (profileValuesDiffer(baseline.name, candidate.name) || profileValuesDiffer(baseline.description, candidate.description) || profileValuesDiffer(baseline.version, candidate.version)) {
		remove.identity = true;
		if (candidate.name !== void 0) set.name = candidate.name;
		if (candidate.description !== void 0) set.description = candidate.description;
		if (candidate.version !== void 0) set.version = candidate.version;
	}
	if (profileValuesDiffer(baseline.tags, candidate.tags)) {
		remove.tags = true;
		if (candidate.tags !== void 0) set.tags = candidate.tags;
	}
	if (profileValuesDiffer(baseline.prompt, candidate.prompt)) {
		remove.prompt = true;
		if (candidate.prompt !== void 0) set.prompt = candidate.prompt;
	}
	if (profileValuesDiffer(baseline.model, candidate.model)) {
		remove.model = true;
		if (candidate.model !== void 0) set.model = candidate.model;
	}
	if (profileValuesDiffer(baseline.harness, candidate.harness)) {
		remove.harness = true;
		if (candidate.harness !== void 0) set.harness = candidate.harness;
	}
	if (profileValuesDiffer(baseline.permissions, candidate.permissions)) {
		remove.permissions = true;
		if (candidate.permissions !== void 0) set.permissions = candidate.permissions;
	}
	if (profileValuesDiffer(baseline.tools, candidate.tools)) {
		remove.tools = true;
		if (candidate.tools !== void 0) set.tools = candidate.tools;
	}
	if (profileValuesDiffer(baseline.mcp, candidate.mcp)) {
		remove.mcp = true;
		if (candidate.mcp !== void 0) set.mcp = candidate.mcp;
	}
	if (profileValuesDiffer(baseline.connections, candidate.connections)) {
		remove.connections = true;
		if (candidate.connections !== void 0) set.connections = candidate.connections;
	}
	if (profileValuesDiffer(baseline.subagents, candidate.subagents)) {
		remove.subagents = true;
		if (candidate.subagents !== void 0) set.subagents = candidate.subagents;
	}
	replaceChangedProfileResources(baseline.resources, candidate.resources, remove, set);
	if (profileValuesDiffer(baseline.hooks, candidate.hooks)) {
		remove.hooks = true;
		if (candidate.hooks !== void 0) set.hooks = candidate.hooks;
	}
	if (profileValuesDiffer(baseline.modes, candidate.modes)) {
		remove.modes = true;
		if (candidate.modes !== void 0) set.modes = candidate.modes;
	}
	if (profileValuesDiffer(baseline.confidential, candidate.confidential)) {
		remove.confidential = true;
		if (candidate.confidential !== void 0) set.confidential = candidate.confidential;
	}
	if (profileValuesDiffer(baseline.metadata, candidate.metadata)) {
		remove.metadata = true;
		if (candidate.metadata !== void 0) set.metadata = candidate.metadata;
	}
	if (profileValuesDiffer(baseline.extensions, candidate.extensions)) {
		remove.extensions = true;
		if (candidate.extensions !== void 0) set.extensions = candidate.extensions;
	}
	if (Object.keys(remove).length === 0) throw new Error("complete profile differ found no changed fields");
	const common = {
		kind: "agent-profile-diff",
		...options.source ? { source: options.source } : {},
		metadata: {
			...options.metadata ?? {},
			surface: "agent-profile"
		}
	};
	const reset = agentProfileDiffSchema.parse(defineAgentProfileDiff({
		...common,
		id: `${options.id}:agent-profile:reset`,
		title: "Reset changed agent profile fields",
		remove
	}));
	if (Object.keys(set).length === 0) return [reset];
	return [reset, agentProfileDiffSchema.parse(defineAgentProfileDiff({
		...common,
		id: `${options.id}:agent-profile:set`,
		title: "Set changed agent profile fields",
		set
	}))];
}
function replaceChangedProfileResources(baseline, candidate, remove, set) {
	if (!profileValuesDiffer(baseline, candidate)) return;
	const resourceRemoval = {};
	const resourceSet = {};
	let changedSubfields = 0;
	if (profileValuesDiffer(baseline?.files, candidate?.files)) {
		changedSubfields += 1;
		resourceRemoval.files = true;
		if (candidate?.files !== void 0) resourceSet.files = candidate.files;
	}
	if (profileValuesDiffer(baseline?.tools, candidate?.tools)) {
		changedSubfields += 1;
		resourceRemoval.tools = true;
		if (candidate?.tools !== void 0) resourceSet.tools = candidate.tools;
	}
	if (profileValuesDiffer(baseline?.skills, candidate?.skills)) {
		changedSubfields += 1;
		resourceRemoval.skills = true;
		if (candidate?.skills !== void 0) resourceSet.skills = candidate.skills;
	}
	if (profileValuesDiffer(baseline?.agents, candidate?.agents)) {
		changedSubfields += 1;
		resourceRemoval.agents = true;
		if (candidate?.agents !== void 0) resourceSet.agents = candidate.agents;
	}
	if (profileValuesDiffer(baseline?.commands, candidate?.commands)) {
		changedSubfields += 1;
		resourceRemoval.commands = true;
		if (candidate?.commands !== void 0) resourceSet.commands = candidate.commands;
	}
	if (profileValuesDiffer(baseline?.instructions, candidate?.instructions)) {
		changedSubfields += 1;
		resourceRemoval.instructions = true;
		if (candidate?.instructions !== void 0) resourceSet.instructions = candidate.instructions;
	}
	if (profileValuesDiffer(baseline?.failOnError, candidate?.failOnError)) {
		changedSubfields += 1;
		resourceRemoval.failOnError = true;
		if (candidate?.failOnError !== void 0) resourceSet.failOnError = candidate.failOnError;
	}
	if (changedSubfields === 0) {
		remove.resources = true;
		if (candidate !== void 0) set.resources = candidate;
		return;
	}
	remove.resources = resourceRemoval;
	if (Object.keys(resourceSet).length > 0) set.resources = resourceSet;
}
function profileValuesDiffer(baseline, candidate) {
	const comparable = (value) => value === void 0 ? { present: false } : {
		present: true,
		value
	};
	return canonicalCandidateDigest$1(comparable(baseline)) !== canonicalCandidateDigest$1(comparable(candidate));
}
function improvementSurfaceReplacement(target) {
	const value = target.desiredInput;
	switch (target.surface) {
		case "prompt": {
			const prompt = exactObject(value, ["prompt"], "prompt activation input").prompt;
			assertDefined(prompt, "prompt activation input.prompt");
			return {
				remove: { prompt: true },
				...prompt === null ? {} : { set: parseProfileSet({ prompt }) }
			};
		}
		case "skills":
			assertDefined(value, "skills activation input");
			return {
				remove: { resources: { skills: true } },
				...value === null ? {} : { set: parseProfileSet({ resources: { skills: value } }) }
			};
		case "tools": {
			const parsed = exactObject(value, ["tools", "resources"], "tools activation input");
			assertDefined(parsed.tools, "tools activation input.tools");
			assertDefined(parsed.resources, "tools activation input.resources");
			const set = {
				...parsed.tools === null ? {} : { tools: parsed.tools },
				...parsed.resources === null ? {} : { resources: { tools: parsed.resources } }
			};
			return {
				remove: {
					tools: true,
					resources: { tools: true }
				},
				...Object.keys(set).length === 0 ? {} : { set: parseProfileSet(set) }
			};
		}
		case "mcp":
			assertDefined(value, "mcp activation input");
			return {
				remove: { mcp: true },
				...value === null ? {} : { set: parseProfileSet({ mcp: value }) }
			};
		case "hooks":
			assertDefined(value, "hooks activation input");
			return {
				remove: { hooks: true },
				...value === null ? {} : { set: parseProfileSet({ hooks: value }) }
			};
		case "subagents": {
			const parsed = exactObject(value, ["subagents", "resources"], "subagents activation input");
			assertDefined(parsed.subagents, "subagents activation input.subagents");
			assertDefined(parsed.resources, "subagents activation input.resources");
			const set = {
				...parsed.subagents === null ? {} : { subagents: parsed.subagents },
				...parsed.resources === null ? {} : { resources: { agents: parsed.resources } }
			};
			return {
				remove: {
					subagents: true,
					resources: { agents: true }
				},
				...Object.keys(set).length === 0 ? {} : { set: parseProfileSet(set) }
			};
		}
	}
}
function assertDefined(value, label) {
	if (value === void 0) throw new Error(`${label} must not be undefined`);
}
function exactObject(value, keys, label) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
	const record = value;
	const actual = Object.keys(record).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} must contain exactly: ${expected.join(", ")}`);
	return record;
}
function parseProfileSet(value) {
	return agentProfileSchema.parse(value);
}
function assertKnowledgeCandidatePair(baselineBundle, candidateBundle) {
	const baseline = baselineBundle.knowledge;
	const candidate = candidateBundle.knowledge;
	if (!baseline && !candidate) throw new Error("knowledge candidate pair is not present");
	if (!baseline || !candidate || canonicalCandidateDigest$1({
		candidate: baseline.candidate,
		evaluation: baseline.evaluation
	}) !== canonicalCandidateDigest$1({
		candidate: candidate.candidate,
		evaluation: candidate.evaluation
	})) throw new Error("knowledge experiment arms must share one measured candidate and evaluation identity");
	return candidate;
}
function assertCodeCandidatePair(baselineBundle, candidateBundle) {
	const baseline = baselineBundle.code;
	const candidate = candidateBundle.code;
	if (canonicalCandidateDigest$1(baseline) === canonicalCandidateDigest$1(candidate) || candidate.kind !== "git-patch") return;
	const baselineTree = baseline.kind === "no-op" ? baseline.baseTree : baseline.kind === "git-patch" ? baseline.candidateTree : void 0;
	const baselineRepository = baseline.kind === "disabled" ? void 0 : baseline.repository;
	if (baselineTree !== candidate.baseTree || !baselineRepository || canonicalCandidateDigest$1(baselineRepository) !== canonicalCandidateDigest$1(candidate.repository)) throw new Error("code candidate must be based on the exact repository tree measured by the baseline arm");
}
function improvementSurfaceValues(bundle) {
	const profile = agentCandidateProfileAsAgentProfile(bundle.profile);
	return {
		prompt: agentImprovementProfileSurfaceInput(profile, "prompt"),
		skills: agentImprovementProfileSurfaceInput(profile, "skills"),
		tools: agentImprovementProfileSurfaceInput(profile, "tools"),
		mcp: agentImprovementProfileSurfaceInput(profile, "mcp"),
		hooks: agentImprovementProfileSurfaceInput(profile, "hooks"),
		subagents: agentImprovementProfileSurfaceInput(profile, "subagents"),
		"agent-profile": {
			profile: opaqueProfileSlice(profile),
			execution: bundle.execution
		},
		memory: {
			instructions: profile.resources?.instructions ?? null,
			executionPolicy: bundle.memory
		},
		code: bundle.code,
		knowledge: bundle.knowledge ?? null,
		"rollout-policy": structuralRolloutPolicyFromProfile(profile) ?? null
	};
}
function opaqueProfileSlice(profile) {
	const { prompt: _prompt, tools: _tools, mcp: _mcp, hooks: _hooks, subagents: _subagents, extensions, resources, ...opaqueProfile } = profile;
	const { [ROLLOUT_POLICY_EXTENSION]: _rolloutPolicy, ...opaqueExtensions } = extensions ?? {};
	const { instructions: _instructions, skills: _skills, tools: _resourceTools, agents: _agents, ...opaqueResources } = resources ?? {};
	return {
		...opaqueProfile,
		...Object.keys(opaqueExtensions).length > 0 ? { extensions: opaqueExtensions } : {},
		...Object.keys(opaqueResources).length > 0 ? { resources: opaqueResources } : {}
	};
}
//#endregion
//#region src/intelligence/optimization-receipt.ts
const optimizationReceiptMetadataKey = "optimizationReceipt";
/** Build a detached receipt only for methods backed by an identified external optimizer. */
function createOptimizationActivationReceipt(improvement) {
	const provenance = improvement.provenance;
	if (!provenance) return void 0;
	const finalTestDataDigest = improvement.lineage.finalTestSplitDigest;
	if (!finalTestDataDigest) throw new Error("method improvement does not retain its final-test split digest");
	const optimizerModel = provenance.optimizerModel;
	const candidateModel = improvement.candidate.profile.model;
	return canonicalCandidateDocument({
		kind: "optimization-activation-receipt",
		method: improvement.method,
		source: provenance.source,
		...provenance.bridge ? { bridge: provenance.bridge } : {},
		...provenance.modules ? { modules: provenance.modules } : {},
		...provenance.python ? { python: provenance.python } : {},
		...candidateModel || optimizerModel ? { models: {
			...candidateModel ? { candidate: candidateModel } : {},
			...optimizerModel ? { optimizer: optimizerModel } : {}
		} } : {},
		usage: {
			optimizerEvaluations: provenance.evaluationCount,
			...provenance.tokenUsage ? { optimizerTokens: provenance.tokenUsage } : {}
		},
		cost: {
			optimization: receiptCost(improvement.raw.optimizationCost),
			finalTest: receiptCost(improvement.raw.testCost),
			total: receiptCost(improvement.raw.totalCost)
		},
		invocation: {
			runtimeInvocationId: improvement.lineage.invocationId,
			optimizerRunId: provenance.runId,
			...provenance.compatibleRunId ? { compatibleOptimizerRunId: provenance.compatibleRunId } : {},
			resumed: provenance.resumed,
			artifactDir: provenance.artifactDir
		},
		developmentDataDigest: improvement.lineage.developmentSplitDigest,
		finalTestDataDigest,
		scenarioPartitions: improvement.lineage.scenarioPartitions
	}).value;
}
/** Add Runtime-owned optimizer evidence without aliasing caller metadata. */
function attachOptimizationActivationReceipt(metadata, receipt) {
	assertNoCallerOptimizationReceipt(metadata);
	return immutableCandidateValue({
		...metadata ?? {},
		[optimizationReceiptMetadataKey]: receipt
	});
}
function assertNoCallerOptimizationReceipt(metadata) {
	if (metadata && Object.hasOwn(metadata, "optimizationReceipt")) throw new Error(`candidate metadata reserves '${optimizationReceiptMetadataKey}' for Runtime`);
}
/** Read and verify the optimizer evidence carried by a measured proposal. */
function optimizationActivationReceiptFromMetadata(metadata) {
	const value = metadata?.[optimizationReceiptMetadataKey];
	if (value === void 0) return void 0;
	return immutableCandidateValue(parseOptimizationActivationReceipt(value));
}
function parseOptimizationActivationReceipt(value) {
	if (!isRecord(value) || value.kind !== "optimization-activation-receipt") throw new Error("optimization receipt must be an optimization-activation-receipt");
	if (!isNonEmptyString(value.method) || !isPackageSource(value.source) || value.bridge !== void 0 && !isPackageSource(value.bridge) || !isModules(value.modules) || !isPythonRuntime(value.python) || !isModels(value.models) || !isUsage(value.usage) || !isCost(value.cost) || !isInvocation(value.invocation) || !isSha256Digest(value.developmentDataDigest) || !isSha256Digest(value.finalTestDataDigest) || !isScenarioPartitions(value.scenarioPartitions) || !isSha256Digest(value.digest)) throw new Error("optimization receipt contains invalid evidence");
	const receipt = value;
	if (!hasMatchingScenarioPartitionDigests(receipt)) throw new Error("optimization receipt task identities do not match its split digests");
	if (canonicalCandidateDigest$1(omitTopLevelDigest(receipt)) !== receipt.digest) throw new Error("optimization receipt digest does not match its evidence");
	return receipt;
}
function isScenarioPartitions(value) {
	if (!isRecord(value)) return false;
	return isScenarioIdentityList(value.train) && isScenarioIdentityList(value.selection) && isScenarioIdentityList(value.finalTest) && isPositiveSafeInteger(value.optimizationReps) && isPositiveSafeInteger(value.finalTestReps);
}
function isScenarioIdentityList(value) {
	return Array.isArray(value) && value.every((scenario) => isRecord(scenario) && isNonEmptyString(scenario.id) && isNonEmptyString(scenario.kind) && isSha256Digest(scenario.scenarioDigest));
}
function hasMatchingScenarioPartitionDigests(receipt) {
	try {
		const { scenarioPartitions } = receipt;
		const developmentDataDigest = canonicalCandidateDigest$1({
			train: campaignSplitDigestFromIdentities(scenarioPartitions.train, scenarioPartitions.optimizationReps),
			selection: campaignSplitDigestFromIdentities(scenarioPartitions.selection, scenarioPartitions.optimizationReps)
		});
		const finalTestDataDigest = campaignSplitDigestFromIdentities(scenarioPartitions.finalTest, scenarioPartitions.finalTestReps);
		return receipt.developmentDataDigest === developmentDataDigest && receipt.finalTestDataDigest === finalTestDataDigest;
	} catch {
		return false;
	}
}
function isPackageSource(value) {
	if (!isRecord(value) || value.kind !== "package" || value.evidence !== "observed" && value.evidence !== "declared" || !isNonEmptyString(value.package) || !isNonEmptyString(value.version)) return false;
	return isOptionalNonEmptyString(value.sourceUrl) && isOptionalNonEmptyString(value.revision) && (value.sourceSha256 === void 0 || typeof value.sourceSha256 === "string" && /^[0-9a-f]{64}$/.test(value.sourceSha256));
}
function isModules(value) {
	return value === void 0 || Array.isArray(value) && value.every((module) => isRecord(module) && isNonEmptyString(module.module) && typeof module.sourceSha256 === "string" && /^[0-9a-f]{64}$/.test(module.sourceSha256));
}
function isPythonRuntime(value) {
	return value === void 0 || isRecord(value) && isNonEmptyString(value.implementation) && isNonEmptyString(value.version);
}
function isModels(value) {
	return value === void 0 || isRecord(value) && (value.candidate === void 0 || agentProfileModelHintsSchema.safeParse(value.candidate).success) && isOptionalNonEmptyString(value.optimizer) && (value.candidate !== void 0 || value.optimizer !== void 0);
}
function isUsage(value) {
	if (!isRecord(value) || !isNonNegativeInteger(value.optimizerEvaluations)) return false;
	if (value.optimizerTokens === void 0) return true;
	const tokens = value.optimizerTokens;
	if (!isRecord(tokens)) return false;
	const inputTokens = tokens.inputTokens;
	const outputTokens = tokens.outputTokens;
	const totalTokens = tokens.totalTokens;
	const calls = tokens.calls;
	if (!isNonNegativeInteger(inputTokens) || !isNonNegativeInteger(outputTokens) || !isNonNegativeInteger(totalTokens) || !isNonNegativeInteger(calls)) return false;
	if (!isOptionalNonNegativeInteger(tokens.cachedInputTokens) || !isOptionalNonNegativeInteger(tokens.cacheWriteInputTokens) || !isOptionalNonNegativeInteger(tokens.reasoningTokens)) return false;
	const cachedInputTokens = typeof tokens.cachedInputTokens === "number" ? tokens.cachedInputTokens : 0;
	const cacheWriteInputTokens = typeof tokens.cacheWriteInputTokens === "number" ? tokens.cacheWriteInputTokens : 0;
	const reasoningTokens = typeof tokens.reasoningTokens === "number" ? tokens.reasoningTokens : 0;
	return totalTokens === inputTokens + outputTokens && cachedInputTokens + cacheWriteInputTokens <= inputTokens && reasoningTokens <= outputTokens && (totalTokens === 0 || calls > 0);
}
function isCost(value) {
	if (!isRecord(value) || !isCostPart(value.optimization) || !isCostPart(value.finalTest) || !isCostPart(value.total)) return false;
	const optimization = value.optimization;
	const finalTest = value.finalTest;
	const total = value.total;
	return approximatelyEqual(total.totalUsd, optimization.totalUsd + finalTest.totalUsd) && total.accountingComplete === (optimization.accountingComplete && finalTest.accountingComplete);
}
function isCostPart(value) {
	return isRecord(value) && typeof value.totalUsd === "number" && Number.isFinite(value.totalUsd) && value.totalUsd >= 0 && typeof value.accountingComplete === "boolean" && Array.isArray(value.incompleteReasons) && value.incompleteReasons.every((reason) => typeof reason === "string");
}
function receiptCost(value) {
	return {
		totalUsd: value.totalCostUsd,
		accountingComplete: value.accountingComplete,
		incompleteReasons: [...value.incompleteReasons]
	};
}
function approximatelyEqual(left, right) {
	const tolerance = Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8;
	return Math.abs(left - right) <= tolerance;
}
function isInvocation(value) {
	return isRecord(value) && isNonEmptyString(value.runtimeInvocationId) && isNonEmptyString(value.optimizerRunId) && isOptionalNonEmptyString(value.compatibleOptimizerRunId) && typeof value.resumed === "boolean" && isNonEmptyString(value.artifactDir);
}
function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}
function isOptionalNonEmptyString(value) {
	return value === void 0 || isNonEmptyString(value);
}
function isNonNegativeInteger(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function isPositiveSafeInteger(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function isOptionalNonNegativeInteger(value) {
	return value === void 0 || isNonNegativeInteger(value);
}
function isSha256Digest(value) {
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}
//#endregion
//#region src/intelligence/profile-improvement-experiment.ts
function createProfileImprovementCostLedger(budgetUsd, context = "profile improvement") {
	if (!Number.isFinite(budgetUsd) || budgetUsd < 0) throw new Error(`${context} budgetUsd must be a non-negative finite number`);
	return new CostLedger({ costCeilingUsd: budgetUsd });
}
function profilePolicyWithBudget(policy, budgetUsd, context = "profile improvement") {
	if (policy.budgetUsd !== void 0 && !numbersApproximatelyEqual(policy.budgetUsd, budgetUsd)) throw new Error(`${context} policy budgetUsd must equal the run budgetUsd`);
	return {
		...policy,
		budgetUsd
	};
}
function profilePreparationAccounting(costLedger, startedAt) {
	const summary = costLedger.summary();
	if (!summary.accountingComplete || summary.costProvenance.kind === "uncaptured") throw new Error("profile improvement preparation cost is incomplete");
	return {
		wallDurationMs: Math.max(0, performance.now() - startedAt),
		cost: {
			usd: summary.costProvenance.usd,
			provenance: summary.costProvenance.kind
		}
	};
}
function profileStateDigest(stateDigest, identity, profile) {
	return agentProfileImprovementArmSchema.parse({ stateDigest: stateDigest({
		identity,
		profile
	}) }).stateDigest;
}
function sealProfileImprovementBenchmark(input) {
	const tasks = input.tasks.map((task) => sealAgentProfileImprovementTask(task));
	return sealAgentProfileImprovementSuite({
		splitDigest: campaignSplitDigestFromIdentities(tasks.map(profileTaskScenarioIdentity), input.reps),
		tasks,
		reps: input.reps,
		seeds: input.seeds
	});
}
function profileTaskScenarioIdentity(task) {
	return {
		id: task.scenario.id,
		kind: task.scenario.kind,
		scenarioDigest: task.scenario.digest
	};
}
function profileImprovementMetadata(metadata, source, optimizationReceipt) {
	assertNoCallerOptimizationReceipt(metadata);
	if (metadata && Object.hasOwn(metadata, AGENT_IMPROVEMENT_SOURCE_METADATA_KEY)) throw new Error(`candidate metadata reserves '${AGENT_IMPROVEMENT_SOURCE_METADATA_KEY}' for Runtime`);
	const merged = {
		...metadata ?? {},
		...agentImprovementSourceMetadata(source)
	};
	return optimizationReceipt ? attachOptimizationActivationReceipt(merged, optimizationReceipt) : immutableCandidateValue(merged);
}
//#endregion
//#region src/intelligence/improvement-cycle.ts
/** A failed baseline or candidate cell with its complete Runtime failure result. */
var AgentCandidateExperimentCellExecutionError = class extends Error {
	finalization;
	constructor(finalization) {
		super(`candidate experiment cell failed: ${finalization.reason}`);
		this.name = "AgentCandidateExperimentCellExecutionError";
		this.finalization = finalization;
	}
};
function sealAgentImprovementExperiment(material, improvement) {
	assertRuntimeOwnedExperimentFieldsAbsent(material);
	const candidateLineage = {
		source: "optimizer",
		parentDigests: [material.baseline.digest],
		runIds: [improvement.lineage.runId],
		developmentSplitDigest: improvement.lineage.developmentSplitDigest
	};
	const experiment = sealCandidateExperiment({
		...material,
		candidateLineage
	});
	assertCandidateReleaseWorkIsFresh(experiment, improvement);
	return experiment;
}
function assertRuntimeOwnedExperimentFieldsAbsent(material) {
	if (material === null || typeof material !== "object" || Array.isArray(material)) throw new Error("agent improvement experiment material must be an object");
	const supplied = ["candidateLineage", "digest"].filter((field) => Object.hasOwn(material, field));
	if (supplied.length > 0) throw new Error(`agent improvement experiment material must not supply Runtime-owned fields: ${supplied.join(", ")}`);
}
/** Execute both arms of one immutable experiment and derive its paired result. */
async function runAgentCandidateExperiment(options) {
	const experiment = verifyCandidateExperiment(options.experiment);
	const preparation = options.preparation ?? {
		wallDurationMs: 0,
		cost: {
			usd: 0,
			provenance: "observed"
		}
	};
	const costLedger = options.costLedger ?? (experiment.policy.budgetUsd === void 0 ? void 0 : new CostLedger({ costCeilingUsd: experiment.policy.budgetUsd }));
	const run = await runCandidateExperiment({
		experiment,
		...options.maxConcurrency === void 0 ? {} : { maxConcurrency: options.maxConcurrency },
		...costLedger ? { costLedger } : {},
		...options.signal ? { signal: options.signal } : {},
		execute: async (input) => {
			const placement = await options.placeCell(input);
			return await executeAgentCandidateExperimentCell({
				...input,
				...placement
			});
		}
	});
	const evaluation = createAgentImprovementMeasuredComparison({
		experiment,
		measurements: run.measurements,
		preparation,
		measurement: run.measurement,
		runId: options.runId,
		...options.candidate ? { candidate: options.candidate } : {},
		...options.generationsExplored === void 0 ? {} : { generationsExplored: options.generationsExplored },
		...options.metadata ? { metadata: options.metadata } : {}
	});
	return {
		experiment,
		measurements: run.measurements,
		evaluation
	};
}
/** Execute one exact arm, task, repetition, seed, and attempt through Runtime. */
async function executeAgentCandidateExperimentCell(options) {
	const experiment = verifyCandidateExperiment(options.experiment);
	const bundle = experiment[options.arm];
	assertExactExperimentInput(options, experiment, bundle);
	const attempt = options.attempt ?? 1;
	if (attempt > options.task.attempt.maxAttempts) throw new Error("candidate experiment attempt exceeds the signed task policy");
	const runCell = canonicalCandidateDocument({
		kind: "agent-candidate-run-cell",
		experimentDigest: experiment.digest,
		arm: options.arm,
		bundleDigest: bundle.digest,
		suiteDigest: options.benchmarkCell.suiteDigest,
		taskDigest: options.task.digest,
		taskIndex: options.benchmarkCell.taskIndex,
		repetition: options.benchmarkCell.repetition,
		seed: options.seed,
		attempt
	}).value;
	const verified = await verifyAgentCandidateBundle(bundle, options.ports);
	const prepared = await prepareAgentCandidateExecution(verified, {
		executionId: options.executionId,
		runCell,
		benchmarkSuite: experiment.benchmark.suite,
		task: options.task,
		executionRoots: options.executionRoots,
		stagingRoots: options.stagingRoots
	}, options.ports, options.preparation);
	const finalization = await executePreparedAgentCandidate(prepared, options.execution);
	if (!finalization.succeeded) throw new AgentCandidateExperimentCellExecutionError(finalization);
	const evidence = canonicalCandidateDocument({
		kind: "agent-candidate-execution-evidence",
		materializationReceipt: prepared.materializationReceipt.value,
		receipt: finalization.receipt.value
	}).value;
	return verifyCandidateExecutionEvidence(evidence, {
		experiment,
		arm: options.arm,
		benchmarkCell: options.benchmarkCell,
		seed: options.seed,
		attempt,
		resolvedResources: verifiedResourceTextByDigest(verified)
	});
}
/** Delegate all statistics and promotion checks to agent-eval's receipt-based comparison. */
function createAgentImprovementMeasuredComparison(options) {
	return verifyCandidateExperimentComparison(measuredComparisonFromCandidateExperiment(options));
}
async function analyzeAgentImprovement(runId, options, costLedger, signal) {
	assertMeasuredAnalysisOptions(options);
	const analysis = await runAnalystLoop({
		...options,
		runId,
		...costLedger ? {
			costLedger,
			costPhase: "profile-improvement-analysis"
		} : {},
		...signal ? { signal } : {}
	});
	if (costLedger) assertAnalysisCostRecorded(analysis, costLedger);
	const judgeDerived = analysis.analystResult.findings.filter((finding) => finding.derived_from_judge === true);
	if (judgeDerived.length > 0) throw new Error(`agent improvement analysis must not produce judge-derived findings: [${judgeDerived.map((finding) => finding.finding_id).join(", ")}]`);
	return {
		analysis,
		findings: [...assertProposalFindings(analysis.analystResult.findings.map((finding) => ({
			...finding,
			proposal_origin: "production"
		})), "agent improvement findings")]
	};
}
function assertMeasuredAnalysisOptions(options) {
	const rawOptions = options;
	if (rawOptions.knowledgeProposalSource !== void 0 || rawOptions.improvementProposalSource !== void 0) throw new Error("measured agent improvement analysis must not run proposal sources");
	if (rawOptions.onEvent !== void 0 || rawOptions.log !== void 0) throw new Error("measured agent improvement analysis must not run callbacks");
	if (rawOptions.inputs.judgeInput !== void 0) throw new Error("measured agent improvement analysis must not receive judge input");
}
function completeAnalysisAccounting(analysis) {
	const analysisCost = analysis.analystResult.total_cost_provenance;
	if (!analysisCost || analysisCost.kind === "uncaptured") throw new Error("agent improvement analysis cost is uncaptured");
	if (!Number.isFinite(analysis.analystResult.total_cost_usd) || analysis.analystResult.total_cost_usd < 0) throw new Error("agent improvement analysis cost must be finite and non-negative");
	if (analysisCost.usd !== analysis.analystResult.total_cost_usd) throw new Error("agent improvement analysis cost does not match its provenance");
	if (!Number.isFinite(analysis.durationMs) || analysis.durationMs < 0) throw new Error("agent improvement analysis duration must be finite and non-negative");
	return {
		costUsd: analysis.analystResult.total_cost_usd,
		durationMs: analysis.durationMs
	};
}
function assertAnalysisCostRecorded(analysis, costLedger) {
	const reported = completeAnalysisAccounting(analysis);
	const summary = costLedger.summary();
	if (!summary.accountingComplete || summary.costProvenance.kind === "uncaptured") throw new Error("agent improvement analysis cost is incomplete in the shared account");
	const analysisCost = analysis.analystResult.total_cost_provenance;
	if (!analysisCost || analysisCost.kind === "uncaptured") throw new Error("agent improvement analysis cost is uncaptured");
	if (!numbersApproximatelyEqual(summary.totalCostUsd, reported.costUsd) || summary.costProvenance.kind !== analysisCost.kind) throw new Error("agent improvement analysis cost does not match the shared account");
}
function completeImprovementSearchAccounting(analysis, improvement) {
	if (!improvement.cost.accountingComplete) throw new Error(`agent improvement optimization cost is incomplete: ${improvement.cost.incompleteReasons.join(", ") || "unspecified"}`);
	if (!Number.isFinite(improvement.cost.totalCostUsd) || improvement.cost.totalCostUsd < 0) throw new Error("agent improvement optimization cost must be finite and non-negative");
	if (!Number.isFinite(improvement.durationMs) || improvement.durationMs < 0) throw new Error("agent improvement optimization duration must be finite and non-negative");
	return {
		searchCostUsd: analysis.costUsd + improvement.cost.totalCostUsd,
		searchDurationMs: analysis.durationMs + improvement.durationMs
	};
}
function assertReleaseSplitIsFresh(heldOutSplitDigest, improvement) {
	const consumedSplits = [improvement.lineage.developmentSplitDigest];
	if (improvement.mode === "method") {
		const finalTestSplitDigest = improvement.lineage.finalTestSplitDigest;
		if (!finalTestSplitDigest) throw new Error("method improvement does not retain its final-test split digest");
		consumedSplits.push(finalTestSplitDigest);
	}
	if (consumedSplits.includes(heldOutSplitDigest)) throw new Error("release benchmark reuses an optimizer development or final-test split");
}
function assertReleaseScenariosAreFresh(improvement, heldOutScenarios) {
	const optimizerScenarios = /* @__PURE__ */ new Map();
	for (const [partition, scenarios] of [
		["train", improvement.lineage.scenarioPartitions.train],
		["selection", improvement.lineage.scenarioPartitions.selection],
		["final-test", improvement.lineage.scenarioPartitions.finalTest]
	]) for (const scenario of scenarios) optimizerScenarios.set(canonicalCandidateDigest$1(scenario), partition);
	const reused = heldOutScenarios.filter((scenario) => optimizerScenarios.has(canonicalCandidateDigest$1(scenario))).map((scenario) => `${scenario.id} (${optimizerScenarios.get(canonicalCandidateDigest$1(scenario))})`);
	if (reused.length > 0) throw new Error(`release benchmark reuses optimizer scenario(s): [${reused.join(", ")}]`);
}
function assertCandidateReleaseWorkIsFresh(experiment, improvement) {
	for (const splitDigest of new Set(experiment.benchmark.tasks.map((task) => task.benchmark.splitDigest))) assertReleaseSplitIsFresh(splitDigest, improvement);
	if (improvement.mode !== "method") return;
	assertReleaseScenariosAreFresh(improvement, experiment.benchmark.tasks.map((task) => task.scenario));
}
function assertProfileReleaseWorkIsFresh(benchmark, improvement) {
	assertReleaseSplitIsFresh(benchmark.suite.splitDigest, improvement);
	assertReleaseScenariosAreFresh(improvement, benchmark.tasks.map(profileTaskScenarioIdentity));
}
/**
* Analyze a product-owned profile, search one profile surface, then run the
* exact baseline and candidate through the product executor before proposing.
*/
async function proposeAgentProfileImprovement(options) {
	const source = agentImprovementSourceSchema.parse(options.source);
	if (!isAgentProfileMeasuredSurface(options.improvement.surface ?? "prompt")) throw new Error("measured profile improvement supports profile surfaces or a complete agent profile; use the sealed-candidate path for this surface");
	assertMeasuredAnalysisOptions(options.analysis);
	const inputFindings = assertProposalFindings(options.improvement.findings ?? [], "profile improvement input findings");
	const costLedger = createProfileImprovementCostLedger(options.budgetUsd);
	const preparationStartedAt = performance.now();
	const profile = parseExactAgentProfile(options.profile, "profile improvement source");
	const baselineStateDigest = profileStateDigest(options.stateDigest, source.sourceIdentity, profile);
	if (baselineStateDigest !== source.sourceDigest) throw new Error("profile improvement source digest does not match the measured profile state");
	const policy = profilePolicyWithBudget(options.benchmark.policy, options.budgetUsd);
	const benchmark = sealProfileImprovementBenchmark({
		...options.benchmark,
		policy
	});
	const heldOutDigests = new Set(benchmark.tasks.map((task) => task.scenario.digest));
	assertProfileTrainingIsHeldOut(profile, heldOutDigests);
	if (options.improvement.costCeiling !== void 0 && !numbersApproximatelyEqual(options.improvement.costCeiling, options.budgetUsd)) throw new Error("profile improvement costCeiling must equal the run budgetUsd");
	const { analysis, findings } = await analyzeAgentImprovement(options.runId, options.analysis, costLedger, options.signal);
	const proposalFindings = immutableCandidateValue([...inputFindings, ...findings]);
	const improvement = await improve(profile, {
		...options.improvement,
		executionRef: options.executor.executionRef.digest,
		agent: options.executor.optimize,
		costLedger,
		costCeiling: options.budgetUsd,
		findings: proposalFindings
	});
	try {
		if (improvement.decision !== "ship") throw new Error("agent profile improvement search did not produce a promotable candidate");
		const candidateProfile = parseExactAgentProfile(improvement.candidate.profile, "profile improvement candidate");
		const candidateStateDigest = profileStateDigest(options.stateDigest, source.sourceIdentity, candidateProfile);
		if (candidateStateDigest === baselineStateDigest) throw new Error("profile improvement candidate state digest matches the baseline");
		const change = agentImprovementProfileDiffs(profile, candidateProfile, {
			id: `profile-improvement:${candidateStateDigest}`,
			metadata: {
				sourceIdentity: source.sourceIdentity,
				sourceRevision: source.sourceRevision
			}
		});
		const profileDiffIds = change.map((step) => {
			if (!step.id) throw new Error("profile improvement change requires an exact diff id");
			return step.id;
		});
		assertProfileTrainingIsHeldOut(candidateProfile, heldOutDigests);
		assertProfileReleaseWorkIsFresh(benchmark, improvement);
		const experiment = sealAgentProfileImprovementExperiment({
			kind: "agent-profile-improvement-experiment",
			digestAlgorithm: "rfc8785-sha256",
			source,
			executionRef: options.executor.executionRef,
			baseline: { stateDigest: baselineStateDigest },
			candidate: { stateDigest: candidateStateDigest },
			change,
			candidateLineage: {
				source: "optimizer",
				parentDigests: [source.sourceDigest],
				runIds: [improvement.lineage.runId],
				profileDiffIds,
				developmentSplitDigest: improvement.lineage.developmentSplitDigest
			},
			benchmark,
			policy
		});
		const profilesByStateDigest = /* @__PURE__ */ new Map([[baselineStateDigest, profile], [candidateStateDigest, candidateProfile]]);
		const preparation = profilePreparationAccounting(costLedger, preparationStartedAt);
		const run = await runAgentProfileImprovementExperiment({
			experiment,
			...options.maxConcurrency === void 0 ? {} : { maxConcurrency: options.maxConcurrency },
			costLedger,
			...options.signal ? { signal: options.signal } : {},
			execute: async (input) => {
				const measuredProfile = profilesByStateDigest.get(input.stateDigest);
				if (!measuredProfile) throw new Error("profile improvement execution requested an unknown profile state");
				return options.executor.measure({
					...input,
					profile: measuredProfile
				});
			}
		});
		const optimizationReceipt = createOptimizationActivationReceipt(improvement);
		const evaluation = verifyAgentProfileImprovementExperimentComparison(measuredComparisonFromAgentProfileImprovementExperiment({
			experiment,
			measurements: run.measurements,
			runId: options.runId,
			...options.candidate ? { candidate: options.candidate } : {},
			generationsExplored: improvement.generationsExplored ?? 0,
			preparation,
			measurement: run.measurement,
			metadata: profileImprovementMetadata(options.metadata, source, optimizationReceipt)
		}));
		const proposal = createAgentImprovementProposal({
			runId: options.runId,
			findings: proposalFindings,
			evaluation,
			...options.now ? { now: options.now } : {}
		});
		return {
			analysis,
			improvement,
			experiment,
			measurements: run.measurements,
			proposal
		};
	} catch (cause) {
		return rethrowAfterCleanup(cause, () => improvement.dispose(), "proposeAgentProfileImprovement failed");
	}
}
/** Analyze, search, then remeasure the resulting exact candidate before proposing it. */
async function proposeAgentImprovement(options) {
	assertNoCallerOptimizationReceipt(options.metadata);
	assertMeasuredAnalysisOptions(options.analysis);
	const inputFindings = assertProposalFindings(options.improvement.findings ?? [], "agent improvement input findings");
	const { analysis, findings } = await analyzeAgentImprovement(options.runId, options.analysis);
	const analysisAccounting = completeAnalysisAccounting(analysis);
	const proposalFindings = immutableCandidateValue([...inputFindings, ...findings]);
	const improvementInput = {
		...options.improvement,
		findings: proposalFindings
	};
	const improvement = improvementInput.surface === "code" ? await improve(improvementInput) : await improve(options.profile, improvementInput);
	try {
		if (improvement.decision !== "ship") throw new Error("agent improvement search did not produce a promotable candidate");
		const searchAccounting = completeImprovementSearchAccounting(analysisAccounting, improvement);
		const preparation = {
			wallDurationMs: searchAccounting.searchDurationMs,
			cost: {
				usd: searchAccounting.searchCostUsd,
				provenance: "estimated"
			}
		};
		const optimizationReceipt = improvement.mode === "method" ? createOptimizationActivationReceipt(improvement) : void 0;
		const experiment = sealAgentImprovementExperiment(await options.buildExperiment({
			analysis,
			improvement
		}), improvement);
		assertCandidateProfileBinding(options.profile, experiment.baseline.profile);
		assertImprovementCandidateBinding(improvement, experiment);
		const measured = await runAgentCandidateExperiment({
			experiment,
			runId: options.runId,
			placeCell: options.placeCell,
			...options.maxConcurrency === void 0 ? {} : { maxConcurrency: options.maxConcurrency },
			...options.signal ? { signal: options.signal } : {},
			...options.candidate ? { candidate: options.candidate } : {},
			...optimizationReceipt ? { metadata: attachOptimizationActivationReceipt(options.metadata, optimizationReceipt) } : options.metadata ? { metadata: options.metadata } : {},
			...improvement.generationsExplored === void 0 ? {} : { generationsExplored: improvement.generationsExplored },
			preparation
		});
		const proposal = createAgentImprovementProposal({
			runId: options.runId,
			findings: proposalFindings,
			evaluation: measured.evaluation,
			...options.now ? { now: options.now } : {}
		});
		return {
			analysis,
			improvement,
			experiment,
			measurements: measured.measurements,
			proposal
		};
	} catch (cause) {
		return rethrowAfterCleanup(cause, () => improvement.dispose(), "proposeAgentImprovement failed");
	}
}
function assertImprovementCandidateBinding(improvement, experiment) {
	const candidate = improvement.candidate;
	if (candidate.surface !== "code") {
		try {
			assertCandidateProfileBinding(candidate.profile, experiment.candidate.profile);
		} catch (cause) {
			throw new Error("candidate experiment does not contain the improvement winner", { cause });
		}
		return;
	}
	const surface = candidate.value;
	const code = experiment.candidate.code;
	if (typeof surface !== "object" || surface === null || surface.kind !== "code" || code.kind !== "git-patch" || code.baseCommit !== surface.baseCommit || code.baseTree !== surface.baseTree || code.candidateTree !== surface.candidateTree || code.patch.artifact.sha256 !== surface.patch.sha256 || code.patch.artifact.byteLength !== surface.patch.byteLength) throw new Error("candidate experiment does not contain the improvement winner");
	if (canonicalCandidateDigest$1(experiment.baseline.profile) !== canonicalCandidateDigest$1(experiment.candidate.profile)) throw new Error("code improvement candidate changed the agent profile");
}
/** Create the reviewable record only from a complete, recomputable experiment result. */
function createAgentImprovementProposal(options) {
	const findings = assertProposalFindings(options.findings, "createAgentImprovementProposal findings");
	const { evaluation, changedSurfaces } = validateShippableAgentImprovementEvaluation(options.evaluation, options.runId, "agent improvement proposal");
	return agentImprovementProposalSchema.parse(canonicalCandidateDocument({
		kind: "agent-improvement-proposal",
		runId: options.runId,
		changedSurfaces,
		proposedAt: (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString(),
		findings: [...findings],
		evaluation
	}).value);
}
/** Persist a human or tenant-policy decision bound to one exact proposal. */
function reviewAgentImprovementProposal(inputProposal, input) {
	const proposal = verifyAgentImprovementProposal(inputProposal);
	if (!input.reviewedBy.trim()) throw new Error("candidate review requires reviewedBy");
	if (!input.reason.trim()) throw new Error("candidate review requires a reason");
	if (input.decision === "approve" && proposal.evaluation.decision.outcome !== "ship") throw new Error("candidate cannot be approved without a passing experiment");
	const reviewedAt = (input.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
	if (Date.parse(reviewedAt) < Date.parse(proposal.proposedAt)) throw new Error("candidate review cannot predate its proposal");
	return agentImprovementReviewSchema.parse(canonicalCandidateDocument({
		kind: "agent-improvement-review",
		proposalDigest: proposal.digest,
		decision: input.decision,
		reviewedBy: input.reviewedBy,
		reviewedAt,
		reason: input.reason,
		...input.feedback === void 0 ? {} : { feedback: input.feedback }
	}).value);
}
/** Authorize product-owned writes only after the exact candidate was measured and approved. */
function createAgentImprovementActivation(inputProposal, inputReview, options) {
	const proposal = verifyAgentImprovementProposal(inputProposal);
	const review = verifyAgentImprovementReview(inputReview);
	if (review.decision !== "approve" || review.proposalDigest !== proposal.digest) throw new Error("candidate activation requires an approval for the exact proposal");
	if (!options.fundingOwner.trim() || !options.authorizedBy.trim()) throw new Error("candidate activation authority must be non-empty");
	const experiment = proposal.evaluation.experiment;
	const authorizedAt = (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
	if (Date.parse(authorizedAt) < Date.parse(review.reviewedAt)) throw new Error("candidate activation cannot predate its approval");
	const targets = buildAgentImprovementActivationTargets(proposal.changedSurfaces, experiment, options.intent, options.targets);
	const executionRef = profileActivationExecutionRef(experiment, targets, options.executionRef);
	return agentImprovementActivationSchema.parse(canonicalCandidateDocument({
		kind: "agent-improvement-activation",
		proposalDigest: proposal.digest,
		reviewDigest: review.digest,
		experimentDigest: experiment.digest,
		candidateDigest: measuredCandidateDigest(proposal),
		...executionRef ? { executionRef } : {},
		intent: options.intent,
		targets,
		fundingOwner: options.fundingOwner,
		authorizedBy: options.authorizedBy,
		authorizedAt,
		expiresAt: options.expiresAt
	}).value);
}
/** Validate a proposal and recompute every binding to its measured experiment. */
function verifyAgentImprovementProposal(input) {
	const proposal = verifyCanonicalCandidateDocument(agentImprovementProposalSchema.parse(input), "agent improvement proposal");
	const { changedSurfaces } = validateShippableAgentImprovementEvaluation(proposal.evaluation, proposal.runId, "agent improvement proposal");
	if (!(proposal.evaluation.kind === "agent-profile-improvement-measured-comparison" ? sameAgentImprovementSurfaceSet(proposal.changedSurfaces, changedSurfaces) : sameOrderedValues(proposal.changedSurfaces, changedSurfaces))) throw new Error("proposal changed surfaces do not match its exact experiment");
	assertProposalFindings(proposal.findings, "agent improvement proposal findings");
	return proposal;
}
/** Return a sealed bundle experiment; ordinary profile changes need a product-owned executor. */
function requireSealedCandidateExperiment(proposal) {
	if (proposal.evaluation.kind !== "agent-improvement-measured-comparison") throw new Error("agent profile improvement activation requires a product profile-diff executor, not a sealed candidate bundle");
	return proposal.evaluation.experiment;
}
function measuredCandidateDigest(proposal) {
	return proposal.evaluation.kind === "agent-profile-improvement-measured-comparison" ? proposal.evaluation.experiment.candidate.stateDigest : proposal.evaluation.experiment.candidate.digest;
}
function profileActivationExecutionRef(experiment, targets, executionRef) {
	if (!targets.some((target) => target.surface === "agent-profile")) {
		if (executionRef !== void 0) throw new Error("profile activation executionRef is valid only for agent-profile targets");
		return;
	}
	if (experiment.kind !== "agent-profile-improvement-experiment") throw new Error("agent-profile activation requires a measured profile experiment");
	if (executionRef === void 0) throw new Error("profile improvement activation requires the measured executor");
	const parsed = agentProfileImprovementExecutionRefSchema.parse(executionRef);
	if (canonicalCandidateDigest$1(parsed) !== canonicalCandidateDigest$1(experiment.executionRef)) throw new Error("profile improvement activation executor does not match the measurement");
	return parsed;
}
function validateShippableAgentImprovementEvaluation(input, runId, subject) {
	const evaluation = verifyAgentImprovementEvaluation(input);
	if (evaluation.decision.outcome !== "ship") throw new Error(`${subject} requires a passing experiment`);
	if (runId !== evaluation.provenance.runId) throw new Error("proposal runId does not match its measured experiment");
	return {
		evaluation,
		changedSurfaces: evaluation.kind === "agent-profile-improvement-measured-comparison" ? profileImprovementChangedSurfaces(evaluation.experiment.change) : deriveChangedSurfaces(evaluation.experiment.baseline, evaluation.experiment.candidate)
	};
}
/** Use each owning package's complete measurement validator before a proposal is persisted. */
function verifyAgentImprovementEvaluation(input) {
	if (typeof input === "object" && input !== null && "kind" in input && input.kind === "agent-profile-improvement-measured-comparison") {
		const evaluation = verifyAgentProfileImprovementExperimentComparison(input);
		optimizationActivationReceiptFromMetadata(evaluation.metadata);
		return evaluation;
	}
	const evaluation = verifyCandidateExperimentComparison(input);
	optimizationActivationReceiptFromMetadata(evaluation.metadata);
	return evaluation;
}
/** Validate the canonical identity and wire shape of an improvement review. */
function verifyAgentImprovementReview(input) {
	return verifyCanonicalCandidateDocument(agentImprovementReviewSchema.parse(input), "agent improvement review");
}
/** Validate activation authority against the exact proposal, review, experiment, and base state. */
function verifyAgentImprovementActivation(input) {
	const proposal = verifyAgentImprovementProposal(input.proposal);
	const review = verifyAgentImprovementReview(input.review);
	const activation = verifyCanonicalCandidateDocument(agentImprovementActivationSchema.parse(input.activation), "agent improvement activation");
	const experiment = proposal.evaluation.experiment;
	if (review.decision !== "approve" || review.proposalDigest !== proposal.digest || activation.proposalDigest !== proposal.digest || activation.reviewDigest !== review.digest || activation.experimentDigest !== experiment.digest || activation.candidateDigest !== measuredCandidateDigest(proposal) || Date.parse(review.reviewedAt) < Date.parse(proposal.proposedAt) || Date.parse(activation.authorizedAt) < Date.parse(review.reviewedAt)) throw new Error("candidate activation does not bind the measured and approved candidate");
	if (activation.targets.some((target) => target.surface === "agent-profile") && (proposal.evaluation.kind !== "agent-profile-improvement-measured-comparison" || activation.executionRef === void 0 || canonicalCandidateDigest$1(activation.executionRef) !== canonicalCandidateDigest$1(proposal.evaluation.experiment.executionRef))) throw new Error("profile activation does not bind the measured executor");
	assertAgentImprovementActivationTargets(proposal.changedSurfaces, experiment, activation.intent, activation.targets);
	return activation;
}
/** Recheck one Runtime receipt against its exact signed experiment cell. */
function verifyCandidateExecutionEvidence(input, options) {
	const experiment = verifyCandidateExperiment(options.experiment);
	const bundle = experiment[options.arm];
	const task = experiment.benchmark.tasks[options.benchmarkCell.taskIndex];
	const index = options.benchmarkCell.taskIndex * experiment.benchmark.suite.reps + options.benchmarkCell.repetition;
	if (!task || options.benchmarkCell.suiteDigest !== experiment.benchmark.suite.digest || options.seed !== experiment.benchmark.suite.seeds[index]) throw new Error("candidate execution evidence points outside its signed experiment");
	const evidence = verifyCanonicalCandidateDocument(candidateExecutionEvidenceSchema.parse(input), "candidate execution evidence");
	const materialization = verifyCanonicalCandidateDocument(agentCandidateMaterializationReceiptSchema.parse(evidence.materializationReceipt), "candidate materialization receipt");
	const receipt = verifyCanonicalCandidateDocument(agentCandidateRunReceiptSchema.parse(evidence.receipt), "candidate run receipt");
	const plan = materialization.executionPlan;
	const cell = plan.material.runCell;
	const attempt = options.attempt ?? 1;
	if (cell.experimentDigest !== experiment.digest || cell.arm !== options.arm || cell.bundleDigest !== bundle.digest || cell.suiteDigest !== experiment.benchmark.suite.digest || cell.taskDigest !== task.digest || cell.taskIndex !== options.benchmarkCell.taskIndex || cell.repetition !== options.benchmarkCell.repetition || cell.seed !== options.seed || cell.attempt !== attempt || canonicalCandidateDigest$1(omitTopLevelDigest(cell)) !== cell.digest) throw new Error("candidate execution receipt substituted its signed experiment cell");
	assertCapturedInput(materialization.benchmark.suite, experiment.benchmark.suite, "benchmark suite");
	assertCapturedInput(materialization.benchmark.task, task, "benchmark task");
	assertEvidenceMaterialDigest(plan, "candidate execution plan");
	assertEvidenceMaterialDigest(materialization.profileActivation.profilePlan, "candidate profile plan");
	const expectedProfilePlan = materializeAgentCandidateProfilePlan({
		profile: bundle.profile,
		harness: bundle.execution.harness,
		launch: bundle.execution.launch,
		workspace: bundle.execution.cwd.workspace,
		workspaces: plan.material.workspaces,
		resolvedResources: options.resolvedResources
	});
	const activation = parseAgentCandidateProfileActivation(materialization.profileActivation, materialization.profileActivation.profilePlan.digest);
	const regeneratedActivation = createAgentCandidateProfileActivation(expectedProfilePlan, materialization.profileActivation.profilePlan);
	if (activation.digest !== regeneratedActivation.digest) throw new Error("candidate profile activation does not match the experiment bundle");
	if (materialization.bundleDigest !== bundle.digest || receipt.bundleDigest !== bundle.digest || receipt.runCellDigest !== cell.digest || receipt.materializationReceiptDigest !== materialization.digest || receipt.executionPlanDigest !== plan.digest) throw new Error("candidate execution evidence does not bind one exact Runtime run");
	assertEvidenceMaterialDigest(receipt.modelSettlement, "candidate model settlement");
	assertEvidenceMaterialDigest(receipt.taskOutcome, "candidate task outcome");
	assertEvidenceMaterialDigest(receipt.benchmarkResult, "candidate benchmark result");
	return immutableCandidateValue(evidence);
}
function assertExactExperimentInput(input, experiment, bundle) {
	const task = experiment.benchmark.tasks[input.benchmarkCell.taskIndex];
	const index = input.benchmarkCell.taskIndex * experiment.benchmark.suite.reps + input.benchmarkCell.repetition;
	if (input.experiment.digest !== experiment.digest || input.bundle.digest !== bundle.digest || !task || input.task.digest !== task.digest || input.benchmarkCell.suiteDigest !== experiment.benchmark.suite.digest || input.seed !== experiment.benchmark.suite.seeds[index]) throw new Error("Runtime received a substituted candidate experiment cell");
}
function assertCapturedInput(captured, expected, label) {
	const bytes = canonicalCandidateBytes$1(omitTopLevelDigest(expected));
	if (captured.digest !== expected.digest || captured.material.sha256 !== expected.digest || captured.material.byteLength !== bytes.byteLength) throw new Error(`candidate materialization substituted its ${label}`);
}
function assertEvidenceMaterialDigest(evidence, label) {
	const bytes = canonicalCandidateBytes$1(evidence.material);
	if (canonicalCandidateDigest$1(evidence.material) !== evidence.digest || evidence.artifact.sha256 !== evidence.digest || evidence.artifact.byteLength !== bytes.byteLength) throw new Error(`${label} digest does not match its canonical material`);
}
function sameOrderedValues(left, right) {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}
//#endregion
export { commandVerifier as $, agentImprovementTargetInput as A, assertCandidateValidator as B, optimizationActivationReceiptFromMetadata as C, agentImprovementProfileSurfaceDigest as D, agentImprovementProfileDiffs as E, isAgentImprovementProfileSurface as F, rawTraceDistiller as G, parseExecutionRef as H, isAgentProfileMeasuredSurface as I, normalizeRolloutPolicy as J, ROLLOUT_POLICY_EXTENSION as K, improve as L, agentProfileImprovementStateDigest as M, assertProfileImprovementTargetsShareIdentity as N, agentImprovementProfileSurfaceInput as O, buildAgentImprovementActivationTargets as P, agenticGenerator as Q, createCommandProfileTrainer as R, createOptimizationActivationReceipt as S, AGENT_PROFILE_MEASURED_SURFACES as T, privateValuePaths as U, assertProfileTrainingIsHeldOut as V, withMethodRuntimeControls as W, serializeRolloutPolicy as X, parseRolloutPolicy as Y, structuralRolloutPolicyFromProfile as Z, profilePolicyWithBudget as _, executeAgentCandidateExperimentCell as a, profileTaskScenarioIdentity as b, requireSealedCandidateExperiment as c, verifyAgentImprovementActivation as d, defaultBuildPrompt as et, verifyAgentImprovementProposal as f, profileImprovementMetadata as g, createProfileImprovementCostLedger as h, createAgentImprovementProposal as i, agentImprovementTargetProfileDiffs as j, agentImprovementTargetDigest as k, reviewAgentImprovementProposal as l, verifyCandidateExecutionEvidence as m, createAgentImprovementActivation as n, proposeAgentImprovement as o, verifyAgentImprovementReview as p, applyRolloutPolicyToProfile as q, createAgentImprovementMeasuredComparison as r, proposeAgentProfileImprovement as s, AgentCandidateExperimentCellExecutionError as t, runAgentCandidateExperiment as u, profilePreparationAccounting as v, AGENT_IMPROVEMENT_PROFILE_SURFACES as w, sealProfileImprovementBenchmark as x, profileStateDigest as y, searchMethod as z };

//# sourceMappingURL=improvement-cycle-Bi43xCVa.js.map