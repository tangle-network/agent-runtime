import { _ as supervisorWorkersDir, a as legacySupervisorRunsRoot, g as supervisorRunsRoot, j as writeWorkerSteer, m as safeWorkerFile, n as cancelWorker, t as cancelRun } from "./run-layout-vwd4SwX_.js";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { emitKeypressEvents } from "node:readline";
//#region src/tui/top-model.ts
/**
* The read side of the supervisor-run TUI: turn the on-disk run layout into one `TopSnapshot`, and
* render that snapshot to an ANSI frame.
*
* This module never derives a run path itself. Every directory and per-worker file it reads comes
* from `../runtime/supervise/run-layout` — the same module the writers use — so the reader cannot
* drift from the layout the way an independently-versioned copy of the contract would.
*
* Extracted from the `loops` repo (`src/top-model.ts`), which held a hand-joined copy of the
* layout. Rendering is deliberately unchanged: raw ANSI, zero dependencies.
*
* This is the OPERATOR view: what is on disk right now, for a human watching a workspace. It
* carries no model-call identity, so its per-supervisor totals cannot be joined with root stream
* events without double counting. A client that needs one execution's totals reads
* `projectPursuit` from `../durable` instead.
*
* @experimental
*/
const emptySpend = {
	iterations: 0,
	tokensInput: 0,
	tokensOutput: 0,
	usd: 0,
	ms: 0
};
const ansiPattern = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const colors = {
	reset: "\x1B[0m",
	dim: "\x1B[2m",
	bold: "\x1B[1m",
	red: "\x1B[31m",
	green: "\x1B[32m",
	yellow: "\x1B[33m",
	blue: "\x1B[34m",
	magenta: "\x1B[35m",
	cyan: "\x1B[36m",
	white: "\x1B[37m",
	inverse: "\x1B[7m"
};
/**
* Read every supervisor run under one workspace into a single point-in-time snapshot.
*
* Pure with respect to the process: it only reads, and it never throws for a writer mid-append.
* An unreadable or half-written source is still skipped — an operator view must survive a live
* writer — but every skip is reported as one bounded `TopSnapshotDiagnostic`, so a client can
* tell a removed run from a partial read. `now` is injectable so elapsed time is deterministic
* under test.
*/
function loadTopSnapshot(rootDir, now = Date.now()) {
	const root = resolve(rootDir);
	const supervisors = [];
	const diagnostics = [];
	let discovered = 0;
	const report = (runId, sources) => {
		for (const source of sources) diagnostics.push({
			...source,
			runId
		});
	};
	for (const runsRoot of [supervisorRunsRoot(root), legacySupervisorRunsRoot(root)]) {
		if (!existsSync(runsRoot)) continue;
		for (const entry of readdirSync(runsRoot)) {
			const dir = join(runsRoot, entry);
			if (!isDirectory(dir)) continue;
			discovered += 1;
			const state = readSupervisorState(dir);
			report(entry, state.diagnostics);
			if (!state.value) continue;
			const journal = readJournal(dir);
			const progress = readProgressTail(dir, 8);
			const workerEvents = readWorkerEventTails(supervisorWorkersDir(dir), 8);
			report(entry, [
				...journal.diagnostics,
				...progress.diagnostics,
				...workerEvents.diagnostics
			]);
			supervisors.push(buildSupervisorView(state.value, dir, journal.value, progress.value, now, workerEvents.value));
		}
	}
	supervisors.sort((a, b) => String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? "")));
	return {
		root,
		generatedAt: now,
		supervisors,
		completeness: diagnostics.length === 0 ? "complete" : "partial",
		diagnostics,
		discovered,
		loaded: supervisors.length
	};
}
/**
* The journal file a run dir actually carries. `createFileRunContext` — this repo's own durable
* writer — names it `spawn-journal.jsonl`; `journal.jsonl` is the retired bare-event file older
* runs left behind. First existing name wins; a reader that knew only the retired name would show
* zero workers for every current run.
*/
const journalFileNames = ["spawn-journal.jsonl", "journal.jsonl"];
function readJournal(eventDir) {
	const path = journalFileNames.find((candidate) => existsSync(join(eventDir, candidate)));
	if (!path) return {
		value: [],
		diagnostics: []
	};
	const read = readSourceFile(join(eventDir, path), "journal", path);
	if (read.value === void 0) return {
		value: [],
		diagnostics: read.diagnostics
	};
	const out = [];
	let partial = false;
	for (const line of read.value.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed);
			const event = parsed.event ?? parsed;
			if (isSpawnEvent(event)) out.push(event);
		} catch {
			partial = true;
		}
	}
	return {
		value: out,
		diagnostics: partial ? [{
			source: "journal",
			path,
			reason: "partial-json"
		}] : []
	};
}
function buildSupervisorView(state, stateDir, events, progressTail, now, workerEventTails = /* @__PURE__ */ new Map()) {
	const workers = /* @__PURE__ */ new Map();
	let driverSpend = emptySpend;
	const journalRootId = events.find((event) => event.kind === "spawned" && !event.parent && event.label === "root")?.id;
	const isRoot = (id) => id === state.id || id === journalRootId;
	for (const event of events) {
		if (event.kind === "spawned") {
			if (isRoot(event.id) || !event.parent && event.label === "root") continue;
			const worker = ensureWorker(workers, event.id, event.label ?? event.id);
			worker.label = event.label ?? worker.label;
			if (event.parent) worker.parent = event.parent;
			if (event.runtime) worker.runtime = event.runtime;
			worker.status = "running";
			if (event.at) worker.startedAt = event.at;
			const budget = parseBudget(event.budget);
			if (budget) worker.budget = budget;
			continue;
		}
		if (event.kind === "settled") {
			if (isRoot(event.id)) continue;
			const worker = ensureWorker(workers, event.id, event.id);
			worker.status = event.status === "down" ? "down" : "done";
			if (event.at) worker.endedAt = event.at;
			if (event.outRef) worker.outRef = event.outRef;
			if (event.infra !== void 0) worker.infra = event.infra;
			const verdict = describeVerdict(event.verdict);
			if (verdict) worker.verdict = verdict;
			worker.spend = addSpend(worker.spend, parseSpend(event.spent));
			worker.metered = emptySpend;
			continue;
		}
		if (event.kind === "cancelled") {
			if (isRoot(event.id)) continue;
			const worker = ensureWorker(workers, event.id, event.id);
			worker.status = "cancelled";
			if (event.at) worker.endedAt = event.at;
			if (event.reason) worker.reason = event.reason;
			if (event.spent !== void 0) {
				worker.spend = addSpend(worker.spend, parseSpend(event.spent));
				worker.metered = emptySpend;
			}
			continue;
		}
		if (event.kind === "metered") {
			const spend = parseSpend(event.spend);
			if (isRoot(event.id)) {
				if (event.accountingOnly !== true) driverSpend = addSpend(driverSpend, spend);
			} else {
				const worker = ensureWorker(workers, event.id, event.id);
				if (event.accountingOnly !== true) worker.metered = addSpend(worker.metered, spend);
			}
			continue;
		}
		if (event.kind === "progress") {
			if (isRoot(event.id)) continue;
			const worker = ensureWorker(workers, event.id, event.id);
			worker.metered = parseSpend(event.spend);
		}
	}
	const workerViews = [...workers.values()].map((worker) => {
		const tail = workerEventTails.get(worker.label) ?? workerEventTails.get(safeWorkerFile(worker.label)) ?? workerEventTails.get(safeWorkerFile(worker.id)) ?? workerEventTails.get(worker.id);
		worker.liveTail = tail?.lines ?? [];
		if (tail?.file) worker.eventFile = tail.file;
		return finalizeWorker(worker, now);
	}).sort((a, b) => compareWorker(a, b));
	const totals = supervisorTotals(state, workerViews, driverSpend, now);
	return {
		id: state.id,
		stateDir,
		status: state.status,
		task: state.task,
		workspaceDir: state.workspaceDir,
		budget: state.budget,
		...state.verifyCmd ? { verifyCmd: state.verifyCmd } : {},
		...state.workerModel ? { workerModel: state.workerModel } : {},
		...state.driverModel ? { driverModel: state.driverModel } : {},
		...state.verdict ? { verdict: state.verdict } : {},
		...state.progress ? { progress: state.progress } : {},
		...state.startedAt ? { startedAt: state.startedAt } : {},
		...state.completedAt ? { completedAt: state.completedAt } : {},
		...state.maxSandboxes !== void 0 ? { maxSandboxes: state.maxSandboxes } : {},
		...state.maxLifetimeSeconds !== void 0 ? { maxLifetimeSeconds: state.maxLifetimeSeconds } : {},
		...state.idleTimeoutSeconds !== void 0 ? { idleTimeoutSeconds: state.idleTimeoutSeconds } : {},
		...state.maxUsd !== void 0 ? { maxUsd: state.maxUsd } : {},
		...state.maxDepth !== void 0 ? { maxDepth: state.maxDepth } : {},
		...state.result?.spentUsd !== void 0 ? { resultSpentUsd: state.result.spentUsd } : {},
		...state.result?.spentTokens !== void 0 ? { resultSpentTokens: state.result.spentTokens } : {},
		workers: workerViews,
		progressTail: [...progressTail],
		journalTail: events.slice(-12),
		driverSpend,
		totals
	};
}
/** Render one snapshot to an ANSI frame. Use this when nothing needs to be clickable. */
function renderTopFrame(snapshot, options = {}) {
	return renderTopFrameWithLayout(snapshot, options).frame;
}
/**
* Render one snapshot, returning the frame together with the row→entity map a mouse click resolves
* against. The layout is the only thing that knows which row is which run or worker, so emitting it
* alongside the text is what keeps click handling out of the renderer.
*/
function renderTopFrameWithLayout(snapshot, options = {}) {
	const width = Math.max(88, options.width ?? 128);
	const height = Math.max(24, options.height ?? 42);
	const color = options.color ?? false;
	const focus = options.focus ?? "supervisors";
	const mode = options.mode ?? "overview";
	const selectedSupervisor = selectSupervisor(snapshot, options.selectedSupervisorId);
	const selectedWorker = selectedSupervisor ? selectWorker(selectedSupervisor, options.selectedWorkerId) : void 0;
	const targets = [];
	const lines = [];
	const push = (line = "", target) => {
		if (lines.length >= height) return;
		if (target) targets.push({
			row: lines.length,
			...target
		});
		lines.push(fitAnsi(line, width));
	};
	const aggregate = aggregateSnapshot(snapshot);
	push(`${paint("SUPERVISOR TOP", "bold", color)} ${paint(snapshot.root, "dim", color)}  runs ${aggregate.supervisors}  workers ${aggregate.workers}  live ${aggregate.running}  done ${aggregate.done}  down ${aggregate.down}  ${formatMoney(aggregate.usd)}  tok ${formatTokens(aggregate.tokensInput)}/${formatTokens(aggregate.tokensOutput)}`);
	push(`${paint("keys", "dim", color)} up/down select  left/right run  tab focus  enter detail  o overview  l log  s steer  c cancel  mouse  q quit`);
	if (options.notice) push(paint(options.notice, "yellow", color));
	if (snapshot.completeness === "partial") push(paint(`partial snapshot: ${snapshot.diagnostics.length} source${snapshot.diagnostics.length === 1 ? "" : "s"} skipped or truncated; runs loaded ${snapshot.loaded}/${snapshot.discovered}`, "yellow", color));
	if (options.steerInput?.active) push(renderSteerInput(options.steerInput, width, color));
	push(rule(width, color));
	if (snapshot.supervisors.length === 0) {
		if (snapshot.discovered > 0) {
			push(paint("NO READABLE SUPERVISORS", "yellow", color));
			push(`${snapshot.discovered} run director${snapshot.discovered === 1 ? "y" : "ies"} found under ${supervisorRunsRoot(snapshot.root)}, none readable`);
		} else {
			push(paint("NO SUPERVISORS", "yellow", color));
			push(`No run state under ${supervisorRunsRoot(snapshot.root)}`);
		}
		push(`A run appears here once its driver writes state.json; re-point with: agent-runtime-top <root>`);
		return {
			frame: `${lines.join("\n")}\n`,
			targets
		};
	}
	push(sectionTitle("SUPERVISORS", focus === "supervisors", color));
	push(`  id                    status       workers       spend        tok in/out       latency      task`);
	for (const supervisor of snapshot.supervisors.slice(0, 9)) {
		const selected = supervisor.id === selectedSupervisor?.id;
		const status = statusText(supervisor.status, color);
		const pointer = selected ? paint(">", "cyan", color) : " ";
		const rowFocus = selected && focus === "supervisors" ? "inverse" : void 0;
		const workerSummary = `${supervisor.totals.running}/${supervisor.totals.workers} live`;
		const task = compact(supervisor.task, 34);
		const line = `${pointer} ${pad(supervisor.id, 21)} ${pad(status, 12)} ${pad(workerSummary, 13)} ${pad(formatMoney(supervisor.totals.usd), 12)} ${pad(`${formatTokens(supervisor.totals.tokensInput)}/${formatTokens(supervisor.totals.tokensOutput)}`, 16)} ${pad(formatDuration(supervisor.totals.latencyMs), 12)} ${task}`;
		push(rowFocus ? paint(line, rowFocus, color) : line, {
			kind: "supervisor",
			id: supervisor.id
		});
	}
	if (!selectedSupervisor) return {
		frame: `${lines.join("\n")}\n`,
		targets
	};
	push();
	push(sectionTitle(`WORKERS ${selectedSupervisor.id}`, focus === "workers", color));
	push(`  id           state        runtime    latency      cost        tok in/out       score     detail`);
	for (const worker of selectedSupervisor.workers.slice(0, 12)) {
		const selected = worker.id === selectedWorker?.id;
		const pointer = selected ? paint(">", "cyan", color) : " ";
		const rowFocus = selected && focus === "workers" ? "inverse" : void 0;
		const score = worker.verdict ?? (worker.status === "done" ? "done" : worker.status);
		const detail = worker.reason ?? worker.outRef ?? worker.parent ?? "";
		const spend = totalSpend(worker);
		const line = `${pointer} ${pad(worker.label, 12)} ${pad(statusText(worker.status, color), 12)} ${pad(worker.runtime ?? "-", 10)} ${pad(formatDuration(worker.latencyMs), 12)} ${pad(formatMoney(spend.usd), 11)} ${pad(`${formatTokens(spend.tokensInput)}/${formatTokens(spend.tokensOutput)}`, 16)} ${pad(compact(score, 9), 10)} ${compact(detail, 30)}`;
		push(rowFocus ? paint(line, rowFocus, color) : line, {
			kind: "worker",
			id: worker.id,
			supervisorId: selectedSupervisor.id
		});
	}
	if (selectedSupervisor.workers.length === 0) push("  no workers spawned yet");
	push();
	push(sectionTitle("OBSERVABILITY", false, color));
	for (const line of renderStatusBars(selectedSupervisor, width, color)) push(line);
	push();
	for (const line of renderCostBars(selectedSupervisor, width, color)) push(line);
	push();
	for (const line of renderTokenBars(selectedSupervisor, width, color)) push(line);
	push();
	for (const line of renderLatencyHistogram(selectedSupervisor, width, color)) push(line);
	push();
	if (mode === "log") {
		push(sectionTitle("JOURNAL TAIL", false, color));
		for (const line of renderJournalTail(selectedSupervisor, width, color)) push(line);
	} else {
		push(sectionTitle(mode === "detail" ? "DETAIL" : "RUN SUMMARY", false, color));
		for (const line of renderDetail(selectedSupervisor, selectedWorker, mode, width, color)) push(line);
	}
	return {
		frame: `${lines.join("\n")}\n`,
		targets
	};
}
function ensureWorker(workers, id, label) {
	const existing = workers.get(id);
	if (existing) return existing;
	const created = {
		id,
		label,
		status: "running",
		spend: emptySpend,
		metered: emptySpend,
		liveTail: []
	};
	workers.set(id, created);
	return created;
}
function finalizeWorker(worker, now) {
	const startMs = parseTime(worker.startedAt);
	const endMs = parseTime(worker.endedAt) ?? (worker.status === "running" ? now : startMs);
	const latencyMs = startMs !== void 0 && endMs !== void 0 ? Math.max(0, endMs - startMs) : 0;
	return {
		id: worker.id,
		label: worker.label,
		...worker.eventFile ? { eventFile: worker.eventFile } : {},
		...worker.parent ? { parent: worker.parent } : {},
		...worker.runtime ? { runtime: worker.runtime } : {},
		status: worker.status,
		...worker.verdict ? { verdict: worker.verdict } : {},
		...worker.infra !== void 0 ? { infra: worker.infra } : {},
		...worker.startedAt ? { startedAt: worker.startedAt } : {},
		...worker.endedAt ? { endedAt: worker.endedAt } : {},
		latencyMs,
		...worker.budget ? { budget: worker.budget } : {},
		spend: worker.spend,
		metered: worker.metered,
		liveTail: worker.liveTail,
		...worker.outRef ? { outRef: worker.outRef } : {},
		...worker.reason ? { reason: worker.reason } : {}
	};
}
function supervisorTotals(state, workers, driverSpend, now) {
	const workerSpends = workers.map(totalSpend);
	const tokenInput = sum(workerSpends.map((spend) => spend.tokensInput)) + driverSpend.tokensInput;
	const tokenOutput = sum(workerSpends.map((spend) => spend.tokensOutput)) + driverSpend.tokensOutput;
	const computedUsd = sum(workerSpends.map((spend) => spend.usd)) + driverSpend.usd;
	const usd = computedUsd > 0 ? computedUsd : state.result?.spentUsd ?? 0;
	const started = parseTime(state.startedAt);
	const completed = parseTime(state.completedAt);
	const latencyMs = started !== void 0 ? Math.max(0, (completed ?? now) - started) : 0;
	const latencies = workers.map((worker) => worker.latencyMs).filter((ms) => ms > 0);
	return {
		workers: workers.length,
		running: workers.filter((worker) => worker.status === "running").length,
		done: workers.filter((worker) => worker.status === "done").length,
		down: workers.filter((worker) => worker.status === "down").length,
		cancelled: workers.filter((worker) => worker.status === "cancelled").length,
		inFlight: workers.filter((worker) => worker.status === "running").length,
		settled: workers.filter((worker) => worker.status !== "running").length,
		tokensInput: tokenInput,
		tokensOutput: tokenOutput,
		tokensTotal: tokenInput + tokenOutput,
		usd,
		latencyMs,
		workerLatency: distribution(latencies)
	};
}
function aggregateSnapshot(snapshot) {
	return {
		supervisors: snapshot.supervisors.length,
		workers: sum(snapshot.supervisors.map((supervisor) => supervisor.totals.workers)),
		running: sum(snapshot.supervisors.map((supervisor) => supervisor.totals.running)),
		done: sum(snapshot.supervisors.map((supervisor) => supervisor.totals.done)),
		down: sum(snapshot.supervisors.map((supervisor) => supervisor.totals.down)),
		usd: sum(snapshot.supervisors.map((supervisor) => supervisor.totals.usd)),
		tokensInput: sum(snapshot.supervisors.map((supervisor) => supervisor.totals.tokensInput)),
		tokensOutput: sum(snapshot.supervisors.map((supervisor) => supervisor.totals.tokensOutput))
	};
}
function compareWorker(a, b) {
	const aStart = parseTime(a.startedAt) ?? 0;
	const bStart = parseTime(b.startedAt) ?? 0;
	if (a.status === "running" && b.status !== "running") return -1;
	if (b.status === "running" && a.status !== "running") return 1;
	return aStart - bStart || a.label.localeCompare(b.label);
}
function totalSpend(worker) {
	return addSpend(worker.spend, worker.metered);
}
function addSpend(a, b) {
	return {
		iterations: a.iterations + b.iterations,
		tokensInput: a.tokensInput + b.tokensInput,
		tokensOutput: a.tokensOutput + b.tokensOutput,
		usd: a.usd + b.usd,
		ms: a.ms + b.ms
	};
}
function parseSpend(value) {
	if (!isRecord(value)) return emptySpend;
	const tokens = isRecord(value.tokens) ? value.tokens : {};
	return {
		iterations: numberValue(value.iterations),
		tokensInput: numberValue(tokens.input),
		tokensOutput: numberValue(tokens.output),
		usd: numberValue(value.usd),
		ms: numberValue(value.ms)
	};
}
function parseBudget(value) {
	if (!isRecord(value)) return void 0;
	const budget = {
		...typeof value.maxIterations === "number" ? { maxIterations: value.maxIterations } : {},
		...typeof value.maxTokens === "number" ? { maxTokens: value.maxTokens } : {},
		...typeof value.maxUsd === "number" ? { maxUsd: value.maxUsd } : {}
	};
	return Object.keys(budget).length ? budget : void 0;
}
function describeVerdict(value) {
	if (!isRecord(value)) return void 0;
	if (typeof value.valid === "boolean") return value.valid ? "valid" : "invalid";
	if (typeof value.score === "number") return `score ${value.score.toFixed(2)}`;
}
function distribution(values) {
	if (values.length === 0) return {
		n: 0,
		min: 0,
		median: 0,
		p90: 0,
		max: 0
	};
	const sorted = [...values].sort((a, b) => a - b);
	return {
		n: sorted.length,
		min: sorted[0] ?? 0,
		median: percentile(sorted, .5),
		p90: percentile(sorted, .9),
		max: sorted[sorted.length - 1] ?? 0
	};
}
function percentile(sorted, p) {
	if (sorted.length === 0) return 0;
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] ?? 0;
}
function renderStatusBars(supervisor, width, color) {
	const total = Math.max(1, supervisor.totals.workers);
	const barWidth = Math.max(12, Math.min(28, width - 58));
	return [`status  ${pad("running", 9)} ${bar(supervisor.totals.running, total, barWidth, "#", color, "yellow")} ${supervisor.totals.running}   ${pad("done", 5)} ${bar(supervisor.totals.done, total, barWidth, "#", color, "green")} ${supervisor.totals.done}   ${pad("down", 5)} ${bar(supervisor.totals.down, total, barWidth, "#", color, "red")} ${supervisor.totals.down}`];
}
function renderCostBars(supervisor, width, color) {
	const workers = supervisor.workers.map((worker) => ({
		worker,
		spend: totalSpend(worker)
	})).sort((a, b) => b.spend.usd - a.spend.usd).slice(0, 6);
	const maxUsd = Math.max(1e-6, ...workers.map((row) => row.spend.usd), supervisor.driverSpend.usd);
	const out = [`cost   total ${formatMoney(supervisor.totals.usd)}  driver ${formatMoney(supervisor.driverSpend.usd)}`];
	const barWidth = Math.max(18, Math.min(46, width - 38));
	for (const row of workers) out.push(`  ${pad(row.worker.label, 12)} ${bar(row.spend.usd, maxUsd, barWidth, "$", color, "magenta")} ${formatMoney(row.spend.usd)}`);
	if (workers.length === 0) out.push("  no worker cost yet");
	return out;
}
function renderTokenBars(supervisor, width, color) {
	const rows = supervisor.workers.map((worker) => ({
		worker,
		spend: totalSpend(worker),
		total: totalSpend(worker).tokensInput + totalSpend(worker).tokensOutput
	})).sort((a, b) => b.total - a.total).slice(0, 6);
	const maxTokens = Math.max(1, ...rows.map((row) => row.total), supervisor.driverSpend.tokensInput + supervisor.driverSpend.tokensOutput);
	const out = [`tokens total in ${formatTokens(supervisor.totals.tokensInput)} / out ${formatTokens(supervisor.totals.tokensOutput)}  driver ${formatTokens(supervisor.driverSpend.tokensInput)}/${formatTokens(supervisor.driverSpend.tokensOutput)}`];
	const barWidth = Math.max(18, Math.min(46, width - 44));
	for (const row of rows) out.push(`  ${pad(row.worker.label, 12)} ${stackedTokenBar(row.spend.tokensInput, row.spend.tokensOutput, maxTokens, barWidth, color)} ${formatTokens(row.spend.tokensInput)}/${formatTokens(row.spend.tokensOutput)}`);
	if (rows.length === 0) out.push("  no worker tokens yet");
	return out;
}
function renderLatencyHistogram(supervisor, width, color) {
	const values = supervisor.workers.map((worker) => worker.latencyMs).filter((value) => value > 0);
	const summary = supervisor.totals.workerLatency;
	const out = [`latency n=${summary.n}  min ${formatDuration(summary.min)}  p50 ${formatDuration(summary.median)}  p90 ${formatDuration(summary.p90)}  max ${formatDuration(summary.max)}`];
	if (values.length === 0) {
		out.push("  no latency samples yet");
		return out;
	}
	const bins = histogram(values, 6);
	const maxCount = Math.max(1, ...bins.map((bin) => bin.count));
	const barWidth = Math.max(18, Math.min(48, width - 34));
	for (const bin of bins) out.push(`  ${pad(`${formatDuration(bin.min)}-${formatDuration(bin.max)}`, 15)} ${bar(bin.count, maxCount, barWidth, "#", color, "blue")} ${bin.count}`);
	return out;
}
function renderDetail(supervisor, worker, mode, width, color) {
	if (mode === "detail" && worker) {
		const spend = totalSpend(worker);
		return [
			`worker ${paint(worker.label, "bold", color)} (${worker.id})  ${statusText(worker.status, color)}  latency ${formatDuration(worker.latencyMs)}`,
			`tokens in/out ${formatTokens(spend.tokensInput)}/${formatTokens(spend.tokensOutput)}  cost ${formatMoney(spend.usd)}  iterations ${spend.iterations}`,
			`parent ${worker.parent ?? "-"}  runtime ${worker.runtime ?? "-"}  out ${worker.outRef ?? "-"}${worker.infra ? "  infra" : ""}`,
			`events ${compact(worker.eventFile ?? "-", width - 8)}`,
			...worker.reason ? [`reason ${compact(worker.reason, width - 7)}`] : [],
			...renderWorkerTail(worker, width, color)
		];
	}
	const caps = [
		supervisor.maxSandboxes !== void 0 ? `boxes ${supervisor.maxSandboxes}` : void 0,
		supervisor.maxUsd !== void 0 ? `max ${formatMoney(supervisor.maxUsd)}` : void 0,
		supervisor.maxDepth !== void 0 ? `depth ${supervisor.maxDepth}` : void 0,
		supervisor.maxLifetimeSeconds !== void 0 ? `ttl ${supervisor.maxLifetimeSeconds}s` : void 0
	].filter((value) => value !== void 0);
	return [
		`task ${compact(supervisor.task, width - 7)}`,
		`workspace ${compact(supervisor.workspaceDir, width - 12)}`,
		`verify ${compact(supervisor.verifyCmd ?? "-", width - 9)}`,
		`models worker ${supervisor.workerModel ?? "-"} / driver ${supervisor.driverModel ?? "-"}  caps ${caps.join(" | ") || "-"}`,
		`progress ${compact(supervisor.progress ?? supervisor.verdict ?? supervisor.status, width - 10)}`
	];
}
function renderJournalTail(supervisor, width, color) {
	if (supervisor.journalTail.length === 0) return ["  no journal events yet"];
	return supervisor.journalTail.map((event) => {
		const at = event.at ? formatClock(event.at) : "--:--:--";
		if (event.kind === "spawned") return `  ${at} ${paint("spawn", "yellow", color)}  ${pad(event.label ?? event.id, 16)} ${event.id}`;
		if (event.kind === "settled") {
			const spend = parseSpend(event.spent);
			return `  ${at} ${statusText(event.status ?? "settled", color)} ${pad(event.id, 18)} ${formatMoney(spend.usd)} ${formatTokens(spend.tokensInput)}/${formatTokens(spend.tokensOutput)}`;
		}
		if (event.kind === "metered") {
			const spend = parseSpend(event.spend);
			return `  ${at} ${paint("meter", "cyan", color)}  ${pad(event.id, 18)} ${formatMoney(spend.usd)} ${formatTokens(spend.tokensInput)}/${formatTokens(spend.tokensOutput)}`;
		}
		if (event.kind === "progress") {
			const spend = parseSpend(event.spend);
			return `  ${at} ${paint("live", "blue", color)}   ${pad(event.id, 18)} ${formatMoney(spend.usd)} ${formatTokens(spend.tokensInput)}/${formatTokens(spend.tokensOutput)}`;
		}
		return `  ${at} ${paint("cancel", "red", color)} ${pad(event.id, 18)} ${compact(event.reason ?? "", width - 32)}`;
	});
}
function renderWorkerTail(worker, width, color) {
	if (worker.liveTail.length === 0) return ["live events: none recorded yet"];
	return ["live events:", ...worker.liveTail.slice(-5).map((line) => `  ${paint(compact(formatWorkerEvent(line), width - 2), "dim", color)}`)];
}
function renderSteerInput(input, width, color) {
	const target = input.workerLabel ?? "-";
	const value = compact(input.value, Math.max(10, width - target.length - 14));
	return `${paint("steer", "cyan", color)} ${target} > ${value}${paint("_", "inverse", color)}`;
}
function formatWorkerEvent(line) {
	try {
		const parsed = JSON.parse(line);
		const at = typeof parsed.at === "string" ? formatClock(parsed.at) : "--:--:--";
		const kind = typeof parsed.kind === "string" ? parsed.kind : "event";
		if (kind === "progress") return `${at} progress iter ${numberValue(parsed.iteration)} ${String(parsed.phase ?? "")}`;
		if (kind === "message") {
			const state = parsed.queued === true ? "queued" : "sent";
			const source = typeof parsed.source === "string" && parsed.source.length > 0 ? `${parsed.source} ` : "";
			const message = typeof parsed.message === "string" && parsed.message.length > 0 ? ` ${parsed.message}` : "";
			return `${at} ${source}steer ${state} delivered=${String(parsed.delivered)}${message}`;
		}
		if (kind === "verify") return `${at} verify passed=${String(parsed.passed)} exit=${String(parsed.exitCode ?? "-")}${evidenceSnippet(parsed.outputTail, 160)}`;
		if (kind === "finished") {
			const branch = typeof parsed.branch === "string" ? ` branch=${parsed.branch}` : "";
			const files = typeof parsed.filesChanged === "number" ? ` files=${parsed.filesChanged}` : "";
			const tests = typeof parsed.testPassed === "boolean" ? ` tests=${String(parsed.testPassed)}` : "";
			return `${at} finished passed=${String(parsed.passed)} patchBytes=${numberValue(parsed.patchBytes)}${files}${tests}${branch}${evidenceSnippet(parsed.evidence, 220)}`;
		}
		if (kind === "error") return `${at} error ${String(parsed.error ?? "")}`;
		return `${at} ${kind}`;
	} catch {
		return line;
	}
}
/** One-line the settle evidence / verify tail a worker event carries so the
*  failure is legible in the tail view (the full block stays in the ndjson). */
function evidenceSnippet(value, max) {
	if (typeof value !== "string") return "";
	const oneLine = value.replace(/\s+/g, " ").trim();
	return oneLine ? ` :: ${compact(oneLine, max)}` : "";
}
function histogram(values, count) {
	const min = Math.min(...values);
	const max = Math.max(...values);
	if (min === max) return [{
		min,
		max,
		count: values.length
	}];
	const step = (max - min) / count;
	return Array.from({ length: count }, (_, index) => {
		const low = min + step * index;
		const high = index === count - 1 ? max : min + step * (index + 1);
		return {
			min: low,
			max: high,
			count: values.filter((value) => value >= low && (index === count - 1 ? value <= high : value < high)).length
		};
	}).filter((bin) => bin.count > 0);
}
function bar(value, max, width, ch, color, colorName) {
	const filled = Math.max(0, Math.min(width, Math.round(value / Math.max(max, 1e-6) * width)));
	return paint(ch.repeat(filled).padEnd(width, "."), colorName, color);
}
function stackedTokenBar(input, output, max, width, color) {
	const inputWidth = Math.round(input / Math.max(max, 1) * width);
	const outputWidth = Math.round(output / Math.max(max, 1) * width);
	const clippedInput = Math.min(width, inputWidth);
	const clippedOutput = Math.min(width - clippedInput, outputWidth);
	const rest = Math.max(0, width - clippedInput - clippedOutput);
	return `${paint("#".repeat(clippedInput), "cyan", color)}${paint("+".repeat(clippedOutput), "green", color)}${".".repeat(rest)}`;
}
function sectionTitle(title, focused, color) {
	return paint(focused ? `[${title}]` : title, focused ? "cyan" : "bold", color);
}
function statusText(status, color) {
	if ([
		"completed",
		"done",
		"delivered",
		"valid"
	].includes(status)) return paint(status.toUpperCase(), "green", color);
	if ([
		"failed",
		"down",
		"cancelled",
		"invalid",
		"error"
	].includes(status)) return paint(status.toUpperCase(), "red", color);
	if ([
		"running",
		"spawned",
		"settled"
	].includes(status)) return paint(status.toUpperCase(), "yellow", color);
	return paint(status.toUpperCase(), "white", color);
}
function selectSupervisor(snapshot, requested) {
	if (requested) {
		const found = snapshot.supervisors.find((supervisor) => supervisor.id === requested);
		if (found) return found;
	}
	return snapshot.supervisors[0];
}
function selectWorker(supervisor, requested) {
	if (requested) {
		const found = supervisor.workers.find((worker) => worker.id === requested);
		if (found) return found;
	}
	return supervisor.workers[0];
}
/**
* Read one source file under a run directory. An absent file is not a defect on its own — the
* writer may not have reached it yet — so it reads as `undefined` with no diagnostic; only a
* failed read raises one. `path` stays run-relative and never carries file contents.
*/
function readSourceFile(file, source, path) {
	if (!existsSync(file)) return {
		value: void 0,
		diagnostics: []
	};
	try {
		return {
			value: readFileSync(file, "utf8"),
			diagnostics: []
		};
	} catch {
		return {
			value: void 0,
			diagnostics: [{
				source,
				path,
				reason: "unreadable"
			}]
		};
	}
}
function tailLines(raw, maxLines) {
	if (raw === void 0) return [];
	return raw.trim().split("\n").filter(Boolean).slice(-maxLines);
}
function readProgressTail(dir, maxLines) {
	const path = "progress.ndjson";
	const read = readSourceFile(join(dir, path), "progress", path);
	return {
		value: tailLines(read.value, maxLines),
		diagnostics: read.diagnostics
	};
}
function readWorkerEventTails(dir, maxLines) {
	const out = /* @__PURE__ */ new Map();
	if (!existsSync(dir)) return {
		value: out,
		diagnostics: []
	};
	const workersDir = basename(dir);
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return {
			value: out,
			diagnostics: [{
				source: "worker-tail",
				path: workersDir,
				reason: "unreadable"
			}]
		};
	}
	const diagnostics = [];
	for (const entry of entries) {
		if (!entry.endsWith(".ndjson") || entry.endsWith(".inbox.ndjson")) continue;
		const file = join(dir, entry);
		const read = readSourceFile(file, "worker-tail", join(workersDir, entry));
		diagnostics.push(...read.diagnostics);
		const lines = tailLines(read.value, maxLines);
		out.set(entry.slice(0, -7), {
			file,
			lines
		});
	}
	return {
		value: out,
		diagnostics
	};
}
function readSupervisorState(dir) {
	const path = "state.json";
	const read = readSourceFile(join(dir, path), "supervisor-state", path);
	if (read.diagnostics.length > 0) return {
		value: void 0,
		diagnostics: read.diagnostics
	};
	if (read.value === void 0) return {
		value: void 0,
		diagnostics: [{
			source: "supervisor-state",
			path,
			reason: "missing"
		}]
	};
	let parsed;
	try {
		parsed = JSON.parse(read.value);
	} catch {
		return {
			value: void 0,
			diagnostics: [{
				source: "supervisor-state",
				path,
				reason: "partial-json"
			}]
		};
	}
	if (!isSupervisorState(parsed)) return {
		value: void 0,
		diagnostics: [{
			source: "supervisor-state",
			path,
			reason: "invalid-state"
		}]
	};
	return {
		value: parsed,
		diagnostics: []
	};
}
function isSupervisorState(value) {
	return value !== void 0 && typeof value.id === "string" && typeof value.status === "string" && typeof value.task === "string" && typeof value.workspaceDir === "string" && typeof value.budget === "number";
}
function isSpawnEvent(value) {
	return value.kind === "spawned" && typeof value.id === "string" || value.kind === "settled" && typeof value.id === "string" || value.kind === "cancelled" && typeof value.id === "string" || value.kind === "metered" && typeof value.id === "string" || value.kind === "progress" && typeof value.id === "string";
}
function isRecord(value) {
	return typeof value === "object" && value !== null;
}
function isDirectory(path) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}
function numberValue(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function parseTime(value) {
	if (!value) return void 0;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : void 0;
}
function sum(values) {
	return values.reduce((total, value) => total + value, 0);
}
function formatClock(value) {
	const parsed = parseTime(value);
	if (parsed === void 0) return "--:--:--";
	return new Date(parsed).toISOString().slice(11, 19);
}
function formatMoney(value) {
	if (value === 0) return "$0";
	if (Math.abs(value) < .01) return `$${value.toFixed(4)}`;
	return `$${value.toFixed(2)}`;
}
function formatTokens(value) {
	if (value >= 1e6) return `${(value / 1e6).toFixed(1)}m`;
	if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
	return `${Math.round(value)}`;
}
function formatDuration(ms) {
	if (!Number.isFinite(ms) || ms <= 0) return "0s";
	if (ms < 1e3) return `${Math.round(ms)}ms`;
	const seconds = ms / 1e3;
	if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
	const minutes = seconds / 60;
	if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`;
	return `${(minutes / 60).toFixed(1)}h`;
}
function compact(value, width) {
	if (width <= 1) return "";
	if (value.length <= width) return value;
	return `${value.slice(0, width - 1)}~`;
}
function pad(value, width) {
	const visible = visibleLength(value);
	if (visible >= width) return fitAnsi(value, width);
	return `${value}${" ".repeat(width - visible)}`;
}
function rule(width, color) {
	return paint("-".repeat(width), "dim", color);
}
function paint(value, colorName, enabled) {
	if (!enabled || !colorName) return value;
	return `${colors[colorName]}${value}${colors.reset}`;
}
function visibleLength(value) {
	return stripAnsi(value).length;
}
function stripAnsi(value) {
	return value.replace(ansiPattern, "");
}
function fitAnsi(value, width) {
	if (visibleLength(value) <= width) return value;
	let out = "";
	let visible = 0;
	for (let i = 0; i < value.length; i += 1) {
		const ch = value[i];
		if (ch === "\x1B") {
			const rest = value.slice(i);
			const match = /^\x1b\[[0-9;?]*[ -/]*[@-~]/.exec(rest);
			if (match) {
				out += match[0];
				i += match[0].length - 1;
				continue;
			}
		}
		if (visible >= width - 1) {
			out += "~";
			break;
		}
		out += ch;
		visible += 1;
	}
	if (out.includes("\x1B[") && !out.endsWith(colors.reset)) out += colors.reset;
	return out;
}
//#endregion
//#region src/tui/top-app.ts
/**
* The interactive side of the supervisor-run TUI: a keypress/mouse loop over the frames
* `./top-model` renders, plus the operator controls that write back to the run — steer a live
* worker, cancel one worker, and request cancellation of a whole run.
*
* The controls go through the owned run layout: steers via `writeWorkerSteer` (the durable inbox
* append) and worker cancellation via `cancelWorker` (the acknowledged operation the runtime's
* turn loop applies). Run-level cancellation targets the ROOT, which has no acknowledged runtime
* path yet for a non-retained tree — it stays a `cancel.request.json` write inside the run
* directory for a host process to honor. Nothing here joins a path from the workspace root.
*
* Extracted from the `loops` repo (`src/top.ts`). The module-level singletons are the origin's
* shape and are kept: this drives one terminal, and `runTopApp` is its one entry point.
*
* @experimental
*/
let state = initialState([], process.cwd());
let snapshot = {
	root: state.root,
	generatedAt: 0,
	supervisors: [],
	completeness: "complete",
	diagnostics: [],
	discovered: 0,
	loaded: 0
};
let targets = [];
let timer;
/**
* Render exactly one frame and return it. This is the non-interactive path — `--once`, a pipe, a
* test — so it never touches raw mode, the alternate screen, or `process.exit`.
*/
function renderTopOnce(options = {}) {
	state = initialState([...options.argv ?? process.argv.slice(2)], options.cwd ?? process.cwd());
	snapshot = loadTopSnapshot(state.root);
	clampSelection();
	return renderTopFrameWithLayout(snapshot, {
		color: state.color,
		width: process.stdout.columns ?? 128,
		focus: state.focus,
		mode: state.mode,
		...state.selectedSupervisorId ? { selectedSupervisorId: state.selectedSupervisorId } : {},
		...state.selectedWorkerId ? { selectedWorkerId: state.selectedWorkerId } : {},
		steerInput: renderSteerInputState()
	}).frame;
}
/**
* Run the TUI. With a TTY on both ends and no `--once` this takes over the terminal until `q`;
* otherwise it writes a single frame to stdout and returns.
*/
function runTopApp(options = {}) {
	const args = [...options.argv ?? process.argv.slice(2)];
	if (!process.stdout.isTTY || !process.stdin.isTTY || args.includes("--once")) {
		process.stdout.write(renderTopOnce(options));
		return;
	}
	state = initialState(args, options.cwd ?? process.cwd());
	snapshot = loadTopSnapshot(state.root);
	start();
}
function initialState(args, cwd) {
	return {
		root: resolve(args.find((arg) => !arg.startsWith("-")) ?? cwd),
		color: Boolean(process.stdout.isTTY) && !args.includes("--no-color"),
		focus: args.includes("--detail") ? "workers" : "supervisors",
		mode: args.includes("--log") ? "log" : args.includes("--detail") ? "detail" : "overview",
		selectedSupervisorId: void 0,
		selectedWorkerId: void 0,
		notice: void 0,
		steerInput: {
			active: false,
			value: ""
		}
	};
}
function start() {
	process.stdout.write("\x1B[?1049h\x1B[?25l\x1B[?1000h\x1B[?1006h");
	emitKeypressEvents(process.stdin);
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.on("keypress", onKey);
	process.stdin.on("data", onData);
	process.on("SIGINT", stop);
	draw();
	timer = setInterval(draw, 1e3);
}
function stop() {
	if (timer) clearInterval(timer);
	process.stdin.setRawMode(false);
	process.stdout.write("\x1B[?1000l\x1B[?1006l\x1B[?25h\x1B[?1049l");
	process.exit(0);
}
function draw() {
	snapshot = loadTopSnapshot(state.root);
	clampSelection();
	const rendered = renderTopFrameWithLayout(snapshot, {
		width: process.stdout.columns ?? 128,
		height: process.stdout.rows ?? 42,
		color: state.color,
		focus: state.focus,
		mode: state.mode,
		...state.notice ? { notice: state.notice } : {},
		...state.selectedSupervisorId ? { selectedSupervisorId: state.selectedSupervisorId } : {},
		...state.selectedWorkerId ? { selectedWorkerId: state.selectedWorkerId } : {},
		steerInput: renderSteerInputState()
	});
	targets = rendered.targets;
	process.stdout.write(`\x1b[2J\x1b[H${rendered.frame}`);
}
function onKey(str, key) {
	state.notice = void 0;
	if (key.ctrl && key.name === "c") stop();
	if (state.steerInput.active) {
		handleSteerInput(str, key);
		draw();
		return;
	}
	if (key.name === "q" || key.name === "escape") stop();
	if (key.name === "tab") state.focus = state.focus === "supervisors" ? "workers" : "supervisors";
	else if (key.name === "up") moveSelection(-1);
	else if (key.name === "down") moveSelection(1);
	else if (key.name === "left") moveSupervisor(-1);
	else if (key.name === "right") moveSupervisor(1);
	else if (key.name === "return") {
		state.mode = "detail";
		state.focus = "workers";
	} else if (key.name === "o") state.mode = "overview";
	else if (key.name === "l") state.mode = "log";
	else if (key.name === "s") startSteerInput();
	else if (key.name === "c") requestCancel();
	draw();
}
function handleSteerInput(str, key) {
	if (key.name === "escape") {
		state.steerInput = {
			active: false,
			value: ""
		};
		return;
	}
	if (key.name === "return") {
		submitSteerInput();
		return;
	}
	if (key.name === "backspace") {
		state.steerInput.value = state.steerInput.value.slice(0, -1);
		return;
	}
	if (key.ctrl && key.name === "u") {
		state.steerInput.value = "";
		return;
	}
	if (key.ctrl || key.name === "tab" || key.name === "up" || key.name === "down" || key.name === "left" || key.name === "right") return;
	if (!str || str === "\r" || str === "\n") return;
	if ([...str].every((char) => char >= " " && char !== "")) state.steerInput.value += str;
}
function onData(data) {
	const click = parseMouse(data.toString("utf8"));
	if (!click) return;
	const target = targets.find((candidate) => candidate.row === click.row);
	if (!target) return;
	state.notice = void 0;
	if (target.kind === "supervisor") {
		state.focus = "supervisors";
		state.selectedSupervisorId = target.id;
		state.selectedWorkerId = void 0;
	} else {
		state.focus = "workers";
		state.mode = "detail";
		state.selectedSupervisorId = target.supervisorId;
		state.selectedWorkerId = target.id;
	}
	draw();
}
function startSteerInput() {
	state.mode = "detail";
	state.focus = "workers";
	if (!selectedSupervisor()) {
		state.notice = "no supervisor selected";
		return;
	}
	if (!selectedWorker()) {
		state.notice = "no worker selected";
		return;
	}
	state.steerInput = {
		active: true,
		value: ""
	};
}
function submitSteerInput() {
	const supervisor = selectedSupervisor();
	const worker = selectedWorker();
	const message = state.steerInput.value;
	state.steerInput = {
		active: false,
		value: ""
	};
	if (!supervisor) {
		state.notice = "no supervisor selected";
		return;
	}
	if (!worker) {
		state.notice = "no worker selected";
		return;
	}
	try {
		const written = writeWorkerSteer(state.root, supervisor.id, worker.id, {
			operationId: randomUUID(),
			message,
			source: "agent-runtime-top"
		});
		state.notice = `steer queued for ${supervisor.id}/${worker.label} (op ${written.request.operationId})`;
	} catch (err) {
		state.notice = `steer failed: ${err instanceof Error ? err.message : String(err)}`;
	}
}
function parseMouse(raw) {
	const match = /\x1b\[<(\d+);(\d+);(\d+)([mM])/.exec(raw);
	if (match?.[4] !== "M") return void 0;
	const col = Number(match[2]);
	const row = Number(match[3]);
	if (!Number.isFinite(col) || !Number.isFinite(row)) return void 0;
	return {
		col: col - 1,
		row: row - 1
	};
}
function moveSelection(delta) {
	if (state.focus === "supervisors") {
		moveSupervisor(delta);
		return;
	}
	const supervisor = selectedSupervisor();
	if (!supervisor || supervisor.workers.length === 0) return;
	const next = wrap(Math.max(0, supervisor.workers.findIndex((worker) => worker.id === state.selectedWorkerId)) + delta, supervisor.workers.length);
	const worker = supervisor.workers[next];
	if (worker) state.selectedWorkerId = worker.id;
}
function moveSupervisor(delta) {
	if (snapshot.supervisors.length === 0) return;
	const next = wrap(Math.max(0, snapshot.supervisors.findIndex((supervisor) => supervisor.id === state.selectedSupervisorId)) + delta, snapshot.supervisors.length);
	const supervisor = snapshot.supervisors[next];
	if (!supervisor) return;
	state.selectedSupervisorId = supervisor.id;
	state.selectedWorkerId = supervisor.workers[0]?.id;
}
function clampSelection() {
	if (snapshot.supervisors.length === 0) {
		state.selectedSupervisorId = void 0;
		state.selectedWorkerId = void 0;
		return;
	}
	const supervisor = selectedSupervisor() ?? snapshot.supervisors[0];
	if (!supervisor) return;
	state.selectedSupervisorId = supervisor.id;
	const worker = supervisor.workers.find((candidate) => candidate.id === state.selectedWorkerId) ?? supervisor.workers[0];
	state.selectedWorkerId = worker?.id;
}
function selectedSupervisor() {
	return snapshot.supervisors.find((supervisor) => supervisor.id === state.selectedSupervisorId);
}
function selectedWorker() {
	return selectedSupervisor()?.workers.find((worker) => worker.id === state.selectedWorkerId);
}
function renderSteerInputState() {
	const worker = selectedWorker();
	return {
		active: state.steerInput.active,
		value: state.steerInput.value,
		...worker?.label ? { workerLabel: worker.label } : {}
	};
}
function requestCancel() {
	const supervisor = selectedSupervisor();
	if (!supervisor) {
		state.notice = "no supervisor selected";
		return;
	}
	if (supervisor.status !== "running") {
		state.notice = `${supervisor.id} is ${supervisor.status}; no cancel request written`;
		return;
	}
	const worker = state.focus === "workers" ? selectedWorker() : void 0;
	if (worker) {
		if (worker.status !== "running") {
			state.notice = `${worker.label} is ${worker.status}; nothing to cancel`;
			return;
		}
		try {
			const record = cancelWorker(supervisor.stateDir, worker.id, randomUUID(), {
				reason: "operator requested cancel from TUI",
				source: "agent-runtime-top"
			});
			state.notice = record.effect === "unknown" ? `cancel queued for ${supervisor.id}/${worker.label} (op ${record.operationId}); awaiting runtime acknowledgement` : `cancel ${record.effect} for ${supervisor.id}/${worker.label} (op ${record.operationId})`;
		} catch (err) {
			state.notice = `cancel request failed: ${err instanceof Error ? err.message : String(err)}`;
		}
		return;
	}
	try {
		const record = cancelRun(supervisor.stateDir, randomUUID(), {
			reason: "operator requested cancel from TUI",
			source: "agent-runtime-top"
		});
		state.notice = record.effect === "unknown" ? `run cancel queued for ${supervisor.id} (op ${record.operationId}); awaiting runtime acknowledgement` : `run cancel ${record.effect} for ${supervisor.id} (op ${record.operationId})`;
	} catch (err) {
		state.notice = `cancel request failed: ${err instanceof Error ? err.message : String(err)}`;
	}
}
function wrap(value, size) {
	return (value % size + size) % size;
}
//#endregion
export { renderTopFrameWithLayout as a, renderTopFrame as i, runTopApp as n, loadTopSnapshot as r, renderTopOnce as t };

//# sourceMappingURL=top-app-VAOrBskv.js.map