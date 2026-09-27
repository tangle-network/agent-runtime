import { diffFindings } from "@tangle-network/agent-eval";
//#region src/analyst-loop/run-analyst-loop.ts
/** Analyze a run and apply accepted knowledge and agent-surface proposals. */
async function runAnalystLoop(opts) {
	const log = opts.log ?? defaultLog;
	const strategy = opts.priorFindingsStrategy ?? "per-kind";
	const emit = makeEmitter(opts.onEvent);
	const startedAt = Date.now();
	const baselineRunId = resolveBaselineRunId(opts);
	const priorAll = baselineRunId ? opts.findingsStore?.loadRun(baselineRunId) ?? [] : [];
	log("baseline resolved", {
		baselineRunId,
		prior_findings: priorAll.length
	});
	await emit({
		type: "baseline-resolved",
		runId: opts.runId,
		baselineRunId,
		priorFindingCount: priorAll.length
	});
	const analystResult = await runRegistry(opts, buildPriorFindingsInput(priorAll, strategy, opts.registry.list()), emit);
	log("analyst run complete", {
		findings: analystResult.findings.length,
		cost_usd: analystResult.total_cost_usd,
		per_analyst: analystResult.per_analyst.map((s) => ({
			id: s.analyst_id,
			status: s.status,
			n: s.findings_count
		}))
	});
	if (opts.findingsStore && analystResult.findings.length > 0) {
		await opts.findingsStore.append(opts.runId, analystResult.findings);
		await emit({
			type: "findings-persisted",
			runId: opts.runId,
			count: analystResult.findings.length
		});
	}
	let diff = null;
	if (baselineRunId && analystResult.findings.length > 0) {
		diff = diffFindings(priorAll.map((f) => ({ ...f })), analystResult.findings.map((f) => ({
			...f,
			run_id: opts.runId
		})));
		log("diff vs baseline", {
			appeared: diff.appeared.length,
			disappeared: diff.disappeared.length,
			persisted: diff.persisted.length,
			changed: diff.changed.length
		});
		await emit({
			type: "diff-computed",
			runId: opts.runId,
			baselineRunId,
			appeared: diff.appeared.length,
			disappeared: diff.disappeared.length,
			persisted: diff.persisted.length,
			changed: diff.changed.length
		});
	}
	let knowledge = null;
	if (opts.knowledgeProposalSource) knowledge = await runKnowledgeProposalSource(opts, analystResult.findings, log, emit);
	let improvement = null;
	if (opts.improvementProposalSource) improvement = await runImprovementProposalSource(opts, analystResult.findings, log, emit);
	const durationMs = Math.max(0, Date.now() - startedAt);
	await emit({
		type: "loop-completed",
		runId: opts.runId,
		durationMs
	});
	return {
		runId: opts.runId,
		baselineRunId,
		durationMs,
		analystResult,
		diff,
		knowledge,
		improvement
	};
}
function makeEmitter(onEvent) {
	if (!onEvent) return async () => {};
	return async (event) => {
		await onEvent(event);
	};
}
async function runRegistry(opts, priorFindings, emit) {
	const reg = opts.registry;
	const registryOptions = {
		...priorFindings ? { priorFindings } : {},
		...opts.chainFindings !== void 0 ? { chainFindings: opts.chainFindings } : {},
		...opts.costLedger ? { costLedger: opts.costLedger } : {},
		...opts.costPhase ? { costPhase: opts.costPhase } : {},
		...opts.signal ? { signal: opts.signal } : {}
	};
	if (typeof reg.runStream === "function" && opts.onEvent) {
		let final = null;
		for await (const ev of reg.runStream(opts.runId, opts.inputs, registryOptions)) {
			await emit({
				type: "analyst",
				runId: opts.runId,
				event: ev
			});
			if (ev.type === "run-completed") final = ev.result;
		}
		if (!final) throw new Error("runAnalystLoop: registry.runStream ended without run-completed event");
		return final;
	}
	return opts.registry.run(opts.runId, opts.inputs, registryOptions);
}
function resolveBaselineRunId(opts) {
	if (opts.baselineRunId === null) return null;
	if (typeof opts.baselineRunId === "string") return opts.baselineRunId;
	if (!opts.findingsStore) return null;
	const all = opts.findingsStore.loadAll();
	let last = null;
	for (const row of all) {
		if (row.run_id === opts.runId) continue;
		last = row.run_id;
	}
	return last;
}
function buildPriorFindingsInput(prior, strategy, registry) {
	if (strategy === "none" || prior.length === 0) return void 0;
	const stripped = prior.map(({ run_id: _run_id, ...rest }) => rest);
	if (strategy === "wildcard") return { "*": stripped };
	return stripped;
}
async function runKnowledgeProposalSource(opts, findings, log, emit) {
	const batch = await opts.knowledgeProposalSource.proposeFromFindings(findings);
	log("knowledge.proposeFromFindings", {
		proposals: batch.proposals.length,
		skipped: batch.skipped,
		errors: batch.errors.length
	});
	await emit({
		type: "knowledge-proposed",
		runId: opts.runId,
		proposalCount: batch.proposals.length,
		skipped: batch.skipped,
		errors: batch.errors.length
	});
	return {
		proposals: batch.proposals,
		skipped: batch.skipped,
		errors: batch.errors
	};
}
async function runImprovementProposalSource(opts, findings, log, emit) {
	const batch = await opts.improvementProposalSource.proposeFromFindings(findings);
	log("improvement.proposeFromFindings", {
		edits: batch.edits.length,
		skipped: batch.skipped,
		errors: batch.errors.length
	});
	await emit({
		type: "improvement-proposed",
		runId: opts.runId,
		editCount: batch.edits.length,
		skipped: batch.skipped,
		errors: batch.errors.length
	});
	return {
		edits: batch.edits,
		skipped: batch.skipped,
		errors: batch.errors
	};
}
function defaultLog(msg, fields) {
	if (fields) console.log(`[analyst-loop] ${msg}`, fields);
	else console.log(`[analyst-loop] ${msg}`);
}
//#endregion
export { runAnalystLoop as t };

//# sourceMappingURL=analyst-loop-DZw5QWT9.js.map