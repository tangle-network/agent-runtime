import { A as verifyCanonicalCandidateDocument, C as canonicalCandidateDigest$1, D as immutableCandidateValue, w as canonicalCandidateDocument } from "./workspace-archive-C9lgf77y.js";
import { A as agentImprovementTargetInput, M as agentProfileImprovementStateDigest, c as requireSealedCandidateExperiment, d as verifyAgentImprovementActivation, f as verifyAgentImprovementProposal, k as agentImprovementTargetDigest } from "./improvement-cycle-Bi43xCVa.js";
import { agentImprovementActivationResultSchema, agentImprovementActivationSchema, agentProfileImprovementExperimentSchema } from "@tangle-network/agent-interface";
//#region src/runtime-usage.ts
function createRuntimeUsageTotals() {
	return {
		tokensIn: 0,
		tokensOut: 0,
		costUsd: 0,
		llmCalls: 0
	};
}
function isUsageAmount(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
/** Fold normalized per-call events. Backend adapters own cumulative receipt reconciliation. */
function addRuntimeUsage(totals, event) {
	totals.llmCalls += 1;
	for (const key of [
		"tokensIn",
		"tokensOut",
		"costUsd"
	]) {
		const value = event[key];
		if (isUsageAmount(value)) totals[key] += value;
		else if (key === "costUsd") totals.usdKnown = false;
		else totals.tokensKnown = false;
	}
	if (event.tokensKnown === false) totals.tokensKnown = false;
	if (event.usdKnown === false) totals.usdKnown = false;
	if (isUsageAmount(event.estimatedCostUsd)) totals.estimatedCostUsd = (totals.estimatedCostUsd ?? 0) + event.estimatedCostUsd;
}
//#endregion
//#region src/intelligence/activation.ts
/** Create the exact result a product stores in the same transaction as its target write. */
function createAgentImprovementActivationResult(transition, options) {
	const activation = verifyCanonicalCandidateDocument(agentImprovementActivationSchema.parse(transition.activation), "agent improvement activation");
	assertTransitionInput(activation, transition);
	const result = agentImprovementActivationResultSchema.parse(canonicalCandidateDocument({
		kind: "agent-improvement-activation-result",
		idempotencyKey: activation.digest,
		attemptedAt: transition.attemptedAt,
		completedAt: options.completedAt,
		outcome: options.outcome
	}).value);
	assertResultAgainstActivation(activation, result);
	assertOutcomeDesiredState(activation, result, new Map(transition.targets.map((target) => [targetIdentity(target), target.desiredDigest])));
	return immutableCandidateValue(result);
}
/**
* Recompute one historical activation result against the exact measured proposal and authority.
* The result records that attempt; it is not a query of the target's current state.
*/
function verifyAgentImprovementActivationResult(input) {
	const proposal = verifyAgentImprovementProposal(input.proposal);
	const activation = verifyAgentImprovementActivation(input);
	const result = verifyCanonicalCandidateDocument(agentImprovementActivationResultSchema.parse(input.result), "agent improvement activation result");
	assertResultAgainstActivation(activation, result);
	assertResultDesiredState(proposal, activation, result);
	return result;
}
/** Validate and execute one product-owned activation transition. */
async function executeAgentImprovementActivation(input, options) {
	const proposal = verifyAgentImprovementProposal(input.proposal);
	const activation = verifyAgentImprovementActivation(input);
	const observedAt = (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
	const attemptedAt = Date.parse(observedAt) < Date.parse(activation.authorizedAt) ? activation.authorizedAt : observedAt;
	const expired = Date.parse(attemptedAt) >= Date.parse(activation.expiresAt);
	const transition = immutableCandidateValue(proposal.evaluation.kind === "agent-improvement-measured-comparison" ? sealedCandidateTransition(proposal.evaluation.experiment, activation, attemptedAt, expired) : profileImprovementTransition(proposal.evaluation.experiment, activation, attemptedAt, expired));
	if (transition.expired) {
		if (!options.reconcile) return uncertainActivationResult(transition, "RECONCILIATION_UNAVAILABLE");
		let reconciled;
		try {
			reconciled = await options.reconcile(transition);
		} catch {
			return uncertainActivationResult(transition, "RECONCILIATION_THROW");
		}
		if (reconciled === void 0) return createAgentImprovementActivationResult(transition, {
			completedAt: transition.attemptedAt,
			outcome: { status: "expired" }
		});
		try {
			return verifyAgentImprovementActivationResult({
				...input,
				result: reconciled
			});
		} catch {
			return uncertainActivationResult(transition, "INVALID_RECONCILIATION");
		}
	}
	let rawResult;
	try {
		rawResult = await options.transition(transition);
	} catch {
		return uncertainActivationResult(transition, "TRANSITION_THROW");
	}
	try {
		return verifyAgentImprovementActivationResult({
			...input,
			result: rawResult
		});
	} catch {
		return uncertainActivationResult(transition, "INVALID_RESULT");
	}
}
function sealedCandidateTransition(experiment, activation, attemptedAt, expired) {
	const targetArm = activation.intent === "activate-candidate" ? "candidate" : "baseline";
	return {
		kind: "sealed-candidate",
		activation,
		candidateBundle: experiment.candidate,
		bundle: experiment[targetArm],
		targets: activation.targets.map((target) => ({
			...target,
			desiredDigest: agentImprovementTargetDigest(experiment, targetArm, target.surface),
			desiredInput: agentImprovementTargetInput(experiment[targetArm], target.surface)
		})),
		attemptedAt,
		expired
	};
}
function profileImprovementTransition(experiment, activation, attemptedAt, expired) {
	const sourceArm = activation.intent === "activate-candidate" ? "baseline" : "candidate";
	const targetArm = activation.intent === "activate-candidate" ? "candidate" : "baseline";
	const operation = profileImprovementOperation(experiment, activation.intent);
	return {
		kind: "profile-improvement",
		activation,
		experiment,
		sourceStateDigest: agentProfileImprovementStateDigest(experiment, sourceArm),
		desiredStateDigest: agentProfileImprovementStateDigest(experiment, targetArm),
		operation,
		targets: activation.targets.map((target) => ({
			...target,
			desiredDigest: agentProfileImprovementStateDigest(experiment, targetArm),
			desiredInput: operation
		})),
		attemptedAt,
		expired
	};
}
function profileImprovementOperation(experiment, intent) {
	return intent === "activate-candidate" ? {
		kind: "apply-change",
		changes: experiment.change
	} : { kind: "restore-state" };
}
function uncertainActivationResult(transition, code) {
	return createAgentImprovementActivationResult(transition, {
		completedAt: transition.attemptedAt,
		outcome: {
			status: "indeterminate",
			code,
			message: "The product transition did not return a trustworthy commit result."
		}
	});
}
function assertTransitionInput(activation, transition) {
	if (transition.kind === "sealed-candidate") {
		assertSealedCandidateTransitionInput(activation, transition);
		return;
	}
	assertProfileImprovementTransitionInput(activation, transition);
}
function assertSealedCandidateTransitionInput(activation, transition) {
	assertAuthorizedTransitionTargets(activation, transition.targets);
	const desiredInputsMatch = transition.targets.every((target) => canonicalCandidateDigest$1(target.desiredInput) === canonicalCandidateDigest$1(agentImprovementTargetInput(transition.bundle, target.surface)));
	if (transition.expired !== Date.parse(transition.attemptedAt) >= Date.parse(activation.expiresAt) || transition.candidateBundle.digest !== activation.candidateDigest || !desiredInputsMatch || activation.intent === "activate-candidate" && transition.bundle.digest !== transition.candidateBundle.digest) throw new Error("activation transition does not match its authorization");
}
function assertProfileImprovementTransitionInput(activation, transition) {
	assertAuthorizedTransitionTargets(activation, transition.targets);
	const targetsAgentProfile = activation.targets.some((target) => target.surface === "agent-profile");
	const experiment = agentProfileImprovementExperimentSchema.parse(transition.experiment);
	const sourceArm = activation.intent === "activate-candidate" ? "baseline" : "candidate";
	const targetArm = activation.intent === "activate-candidate" ? "candidate" : "baseline";
	const sourceStateDigest = agentProfileImprovementStateDigest(experiment, sourceArm);
	const desiredStateDigest = agentProfileImprovementStateDigest(experiment, targetArm);
	const operation = profileImprovementOperation(experiment, activation.intent);
	const targetsMatch = transition.targets.every((target) => target.expectedBaseDigest === sourceStateDigest && target.desiredDigest === desiredStateDigest && canonicalCandidateDigest$1(target.desiredInput) === canonicalCandidateDigest$1(operation));
	if (transition.expired !== Date.parse(transition.attemptedAt) >= Date.parse(activation.expiresAt) || experiment.digest !== activation.experimentDigest || experiment.candidate.stateDigest !== activation.candidateDigest || targetsAgentProfile && (activation.executionRef === void 0 || canonicalCandidateDigest$1(activation.executionRef) !== canonicalCandidateDigest$1(experiment.executionRef)) || transition.sourceStateDigest !== sourceStateDigest || transition.desiredStateDigest !== desiredStateDigest || canonicalCandidateDigest$1(transition.operation) !== canonicalCandidateDigest$1(operation) || !targetsMatch) throw new Error("activation transition does not match its authorization");
}
function assertAuthorizedTransitionTargets(activation, targets) {
	const authorized = targetMap(activation.targets);
	const planned = targetMap(targets);
	if (authorized.size !== planned.size || [...authorized.entries()].some(([identity, target]) => planned.get(identity)?.expectedBaseDigest !== target.expectedBaseDigest)) throw new Error("activation transition does not match its authorization");
}
function assertResultAgainstActivation(activation, result) {
	const attemptedAt = Date.parse(result.attemptedAt);
	const completedAt = Date.parse(result.completedAt);
	const expiresAt = Date.parse(activation.expiresAt);
	if (result.idempotencyKey !== activation.digest || attemptedAt < Date.parse(activation.authorizedAt) || completedAt < attemptedAt) throw new Error("activation result does not bind its authorization");
	const expired = attemptedAt >= expiresAt;
	if (result.outcome.status === "expired" && !expired || expired && ![
		"expired",
		"indeterminate",
		"already-applied"
	].includes(result.outcome.status)) throw new Error("activation result does not honor its authorization expiry");
	if (!("targets" in result.outcome)) return;
	const authorized = targetMap(activation.targets);
	const observed = new Set(result.outcome.targets.map(targetIdentity));
	if (authorized.size !== observed.size || [...authorized.keys()].some((identity) => !observed.has(identity))) throw new Error("activation result must cover every authorized target exactly once");
	if (result.outcome.status === "applied" && result.outcome.targets.some((target) => target.beforeDigest !== authorized.get(targetIdentity(target))?.expectedBaseDigest)) throw new Error("applied activation did not start from its authorized base state");
}
function assertResultDesiredState(proposal, activation, result) {
	if (!("targets" in result.outcome)) return;
	const targetArm = activation.intent === "activate-candidate" ? "candidate" : "baseline";
	const desiredStateDigest = proposal.evaluation.kind === "agent-profile-improvement-measured-comparison" ? agentProfileImprovementStateDigest(proposal.evaluation.experiment, targetArm) : void 0;
	assertOutcomeDesiredState(activation, result, new Map(activation.targets.map((target) => [targetIdentity(target), desiredStateDigest ?? agentImprovementTargetDigest(requireSealedCandidateExperiment(proposal), targetArm, target.surface)])));
}
function assertOutcomeDesiredState(activation, result, desired) {
	if (!("targets" in result.outcome)) return;
	if (result.outcome.status === "applied") {
		if (result.outcome.targets.some((target) => target.afterDigest !== desired.get(targetIdentity(target)))) throw new Error("applied activation does not match the requested bundle");
		return;
	}
	const allDesired = result.outcome.targets.every((target) => target.currentDigest === desired.get(targetIdentity(target)));
	if (result.outcome.status === "already-applied") {
		if (!allDesired) throw new Error("already-applied activation is not at the requested state");
		return;
	}
	const authorized = targetMap(activation.targets);
	const hasStaleTarget = result.outcome.targets.some((target) => target.currentDigest !== authorized.get(targetIdentity(target))?.expectedBaseDigest);
	if (allDesired || !hasStaleTarget) throw new Error("activation conflict does not identify stale target state");
}
function targetMap(targets) {
	return new Map(targets.map((target) => [targetIdentity(target), target]));
}
function targetIdentity(target) {
	return `${target.surface}\u0000${target.identity}`;
}
//#endregion
export { createRuntimeUsageTotals as a, addRuntimeUsage as i, executeAgentImprovementActivation as n, isUsageAmount as o, verifyAgentImprovementActivationResult as r, createAgentImprovementActivationResult as t };

//# sourceMappingURL=activation-BkUdrvqh.js.map