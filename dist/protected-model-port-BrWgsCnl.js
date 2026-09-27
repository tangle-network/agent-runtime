import { C as canonicalCandidateDigest, D as immutableCandidateValue, S as canonicalCandidateBytes, k as sha256Bytes, u as assertExactObjectKeys } from "./workspace-archive-C9lgf77y.js";
import { b as assertAgentCandidateExecutionRoots, d as sealAgentCandidateModelSettlement, f as usdToNanos, i as candidateKnowledgeExecutionPaths } from "./prepare-DVlvGP7V.js";
import { s as candidateProfileAgentPaths } from "./profile-D3eXNBQV.js";
import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";
//#region src/candidate-execution/exact-process-executor.ts
const DEFAULT_PROVISION_TIMEOUT_MS = 12e4;
const DEFAULT_RECOVERY_RETENTION_MS = 15 * 6e4;
/** Adapt one neutral exact-process provider to Runtime's trusted candidate boundary. */
function exactProcessProviderAsCandidateExecutor(options) {
	return new ExactProcessAgentCandidateExecutor(options);
}
var ExactProcessAgentCandidateExecutor = class {
	options;
	states = /* @__PURE__ */ new Map();
	exactProcess;
	resources;
	provisionTimeoutMs;
	recoveryRetentionMs;
	providerOptions;
	capabilitiesPromise;
	constructor(options) {
		this.options = options;
		if (!options.provider.exactProcess) throw new Error(`agent environment provider "${options.provider.name}" does not implement exact processes`);
		this.exactProcess = options.provider.exactProcess;
		this.resources = exactResources(options.resources);
		this.provisionTimeoutMs = positiveInteger(options.provisionTimeoutMs ?? DEFAULT_PROVISION_TIMEOUT_MS, "exact process provision timeout");
		this.recoveryRetentionMs = positiveInteger(options.recoveryRetentionMs ?? DEFAULT_RECOVERY_RETENTION_MS, "exact process recovery retention");
		this.providerOptions = options.providerOptions ? immutableCandidateValue(options.providerOptions) : void 0;
	}
	async execute(request, context) {
		assertSupportedRequest(request);
		const outcome = request.benchmark.task.outcome;
		if (outcome.kind !== "output") throw new Error("exact process executor requires an output task");
		const network = request.executionPlan.value.material.model.access.network;
		const egress = network.mode === "disabled" ? { mode: "blocked" } : {
			mode: "strict",
			allowDomains: [...network.domains]
		};
		await this.assertCapability(egress.mode);
		context.signal.throwIfAborted();
		const key = executionKey(request.executionId, request.executionPlan.value.digest);
		if (this.states.has(key)) throw new Error("candidate execution environment is already active");
		const image = exactImage(request.executionPlan.value.material.container.image, request.executionPlan.value.material.container.manifestDigest);
		const maxLifetimeMs = environmentLifetimeMs(request.hardLimits.timeoutMs, this.recoveryRetentionMs);
		const createInputDigest = canonicalCandidateDigest(immutableCandidateValue({
			kind: "agent-candidate-exact-process-create",
			provider: this.options.provider.name,
			executionId: request.executionId,
			executionPlanDigest: request.executionPlan.value.digest,
			image,
			egress,
			maxLifetimeMs,
			provisionTimeoutMs: this.provisionTimeoutMs,
			resources: this.resources,
			output: {
				mediaType: outcome.mediaType,
				maxBytes: outcome.maxBytes
			},
			...this.providerOptions ? { providerOptions: this.providerOptions } : {}
		}));
		const metadata = immutableCandidateValue({
			kind: "agent-candidate-execution",
			provider: this.options.provider.name,
			executionId: request.executionId,
			executionPlanDigest: request.executionPlan.value.digest,
			createInputDigest,
			outputMediaType: outcome.mediaType,
			outputMaxBytes: outcome.maxBytes
		});
		const environment = await this.exactProcess.create({
			image,
			egress,
			maxLifetimeMs,
			provisionTimeoutMs: this.provisionTimeoutMs,
			resources: this.resources,
			metadata,
			idempotencyKey: executionIdempotencyKey(request.executionId, request.executionPlan.value.digest),
			signal: context.signal,
			...this.providerOptions ? { providerOptions: this.providerOptions } : {}
		});
		try {
			assertExecutionEnvironment(environment, metadata, this.options.provider.name);
		} catch (error) {
			try {
				await environment.destroy();
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "exact process validation and cleanup both failed");
			}
			throw error;
		}
		const state = { environment };
		this.states.set(key, state);
		if ((await environment.process.list()).length !== 0) throw new Error("fresh candidate environment already contains a process");
		await materializeRequest(environment, request, context.signal);
		const launch = exactLaunch(request);
		const startedAt = Date.now();
		state.trace = {
			runId: request.trace.runId,
			scenarioId: request.benchmark.task.scenario.id,
			startedAt,
			deadlineAtMs: context.deadlineAtMs,
			timeoutMs: request.hardLimits.timeoutMs,
			tags: {
				...request.trace.tags,
				environmentId: environment.id,
				environmentProvider: environment.provider
			},
			written: false
		};
		const process = await environment.process.spawn(launch, { signal: context.signal });
		const outputPromise = collectOutput(process, outcome.maxBytes);
		outputPromise.catch(() => void 0);
		let cancellation;
		let processExited = false;
		const cancel = () => {
			if (!processExited) cancellation ??= stopProcess(process);
		};
		context.signal.addEventListener("abort", cancel, { once: true });
		if (context.signal.aborted) cancel();
		try {
			const termination = await process.wait();
			processExited = true;
			context.signal.removeEventListener("abort", cancel);
			if (cancellation) await cancellation;
			const status = await process.status();
			assertTerminalStatus(status, termination);
			state.output = await awaitOutput(outputPromise, context.signal, context.deadlineAtMs);
			state.termination = termination;
			await appendExactProcessTrace(state, context.traceStore, status);
			return {
				executionId: request.executionId,
				termination
			};
		} finally {
			context.signal.removeEventListener("abort", cancel);
		}
	}
	async stop(request, context) {
		await this.assertCapability();
		context.signal.throwIfAborted();
		const environment = await this.resolve(request, true);
		if (!environment) return { stopped: true };
		let statuses = await environment.process.list();
		if (statuses.length > 1) throw new Error("candidate exact process environment contains more than one process");
		const status = statuses[0];
		if (status?.running) {
			const process = await environment.process.get(status.pid);
			if (!process) throw new Error("candidate environment lost its running process handle");
			await stopProcess(process);
		}
		context.signal.throwIfAborted();
		statuses = await environment.process.list();
		if (statuses.some((entry) => entry.running)) throw new Error("candidate exact process termination is not proven");
		const finalStatus = statuses[0];
		if (finalStatus) assertTerminalStatus(finalStatus);
		const state = this.states.get(executionKey(request.executionId, request.executionPlanDigest));
		if (state) {
			state.termination = finalStatus?.termination ?? state.termination;
			if (context.reason === "timeout" && state.trace) state.runtimeTermination = {
				kind: "timeout",
				timeoutMs: state.trace.timeoutMs
			};
			await appendExactProcessTrace(state, context.traceStore, finalStatus);
		}
		return { stopped: true };
	}
	async capture(request, context) {
		await this.assertCapability();
		context.signal.throwIfAborted();
		const environment = await this.resolve(request, false);
		const statuses = await environment.process.list();
		const status = statuses[0];
		if (statuses.length !== 1 || !status || status.running) throw new Error("candidate environment must contain one stopped process before capture");
		assertTerminalStatus(status);
		const process = await environment.process.get(status.pid);
		if (!process) throw new Error("candidate environment lost its captured process handle");
		assertTerminalStatus(await process.status(), status.termination);
		const state = this.states.get(executionKey(request.executionId, request.executionPlanDigest));
		const output = state?.output ?? await awaitOutput(collectOutput(process, outputSpec(environment).maxBytes), context.signal, Date.now() + this.provisionTimeoutMs);
		context.signal.throwIfAborted();
		const evidence = canonicalCandidateBytes({
			kind: "agent-candidate-exact-process-capture",
			provider: environment.provider,
			environmentId: environment.id,
			executionId: request.executionId,
			executionPlanDigest: request.executionPlanDigest,
			createInputDigest: environment.metadata?.createInputDigest,
			process: {
				pid: status.pid,
				exitCode: status.exitCode,
				...status.exitSignal ? { exitSignal: status.exitSignal } : {},
				termination: status.termination
			},
			...state?.runtimeTermination ? { runtimeTermination: state.runtimeTermination } : {},
			output: {
				sha256: sha256Bytes(output),
				byteLength: output.byteLength
			}
		});
		return {
			taskOutcome: {
				kind: "output",
				bytes: output
			},
			evidence
		};
	}
	async dispose(request, context) {
		await this.assertCapability();
		context.signal.throwIfAborted();
		const environment = await this.resolve(request, true);
		if (!environment) return { disposed: true };
		let destroyError;
		try {
			await environment.destroy();
		} catch (error) {
			destroyError = error;
		}
		if (await this.exactProcess.get(environment.id)) throw new Error("exact process environment disposal is not proven", { cause: destroyError });
		context.signal.throwIfAborted();
		this.states.delete(executionKey(request.executionId, request.executionPlanDigest));
		return { disposed: true };
	}
	async assertCapability(mode) {
		const pending = this.capabilitiesPromise ?? Promise.resolve(this.options.provider.capabilities());
		this.capabilitiesPromise = pending;
		let capabilities;
		try {
			capabilities = await pending;
		} catch (error) {
			if (this.capabilitiesPromise === pending) this.capabilitiesPromise = void 0;
			throw error;
		}
		const exact = capabilities.exactProcess;
		if (!exact) throw new Error(`agent environment provider "${this.options.provider.name}" does not declare exact process support`);
		if (mode && !exact.egress.includes(mode)) throw new Error(`agent environment provider "${this.options.provider.name}" does not declare ${mode} exact egress`);
	}
	async resolve(request, missingIsDeleted) {
		const key = executionKey(request.executionId, request.executionPlanDigest);
		const active = this.states.get(key)?.environment;
		if (active) return active;
		const metadata = {
			kind: "agent-candidate-execution",
			provider: this.options.provider.name,
			executionId: request.executionId,
			executionPlanDigest: request.executionPlanDigest
		};
		const matches = (await this.exactProcess.list({
			metadata,
			...this.providerOptions ? { providerOptions: this.providerOptions } : {}
		})).filter((environment) => environment.provider === this.options.provider.name && Object.entries(metadata).every(([name, value]) => isDeepStrictEqual(environment.metadata?.[name], value)));
		if (matches.length > 1) throw new Error("multiple exact process environments match one candidate execution");
		const environment = matches[0];
		if (!environment) {
			if (missingIsDeleted) return void 0;
			throw new Error("candidate exact process evidence is unavailable");
		}
		if (!isSha256Digest$1(environment.metadata?.createInputDigest)) throw new Error("candidate exact process create-input digest is unavailable");
		this.states.set(key, { environment });
		return environment;
	}
};
async function appendExactProcessTrace(state, traceStore, status) {
	const trace = state.trace;
	if (!trace || trace.written) return;
	const endedAt = Math.max(trace.startedAt, Math.min(Date.now(), trace.deadlineAtMs));
	const termination = state.runtimeTermination ?? state.termination ?? status?.termination;
	await traceStore.appendRun({
		runId: trace.runId,
		scenarioId: trace.scenarioId,
		startedAt: trace.startedAt,
		endedAt,
		status: termination?.kind === "exit" && termination.exitCode === 0 ? "completed" : "failed",
		tags: trace.tags
	});
	trace.written = true;
}
function assertSupportedRequest(request) {
	if (request.benchmark.task.outcome.kind !== "output") throw new Error("exact process candidate executor does not support workspace outcomes; use Pier");
	if (request.executionPlan.value.material.codeKind !== "disabled" || request.inputs.candidate) throw new Error("exact process candidate executor does not support code workspaces; use Pier");
	if (request.memory.mode !== "disabled") throw new Error("exact process candidate executor does not support isolated memory");
	const mediaType = request.benchmark.task.outcome.mediaType.toLowerCase();
	if (!(mediaType.startsWith("text/") || mediaType === "application/json" || mediaType.endsWith("+json"))) throw new Error("exact process candidate executor supports only UTF-8 text and JSON outputs");
	if (!posix.isAbsolute(request.launch.executable) && !request.launch.env.PATH?.trim()) throw new Error("exact process candidate executable must be absolute or declare a signed PATH");
	if (!request.roots) throw new Error("candidate execution roots are missing");
	assertAgentCandidateExecutionRoots(request.roots);
}
async function materializeRequest(environment, request, signal) {
	assertAgentCandidateExecutionRoots(request.roots);
	const knowledgePaths = assertKnowledgeExecutionBinding(request);
	for (const file of request.inputs.task.files) await environment.writeFile(beneath(request.roots.taskRoot, file.path), file.bytes, {
		mode: file.mode,
		signal
	});
	for (const file of request.inputs.profile.files) await environment.writeFile(profileFileExecutionPath(request, file), file.bytes, {
		mode: file.mode,
		signal
	});
	if (request.knowledge && knowledgePaths) {
		for (const file of request.knowledge.files) await environment.writeFile(beneath(knowledgePaths.root, file.path), file.bytes, {
			mode: file.mode,
			signal
		});
		if (request.knowledge.retrievalConfig && knowledgePaths.retrievalConfig) await environment.writeFile(knowledgePaths.retrievalConfig, request.knowledge.retrievalConfig, {
			mode: 420,
			signal
		});
	}
	if (request.instruction.delivery.kind === "utf8-file") await environment.writeFile(request.instruction.delivery.path, request.instruction.bytes, {
		mode: 420,
		signal
	});
}
function assertKnowledgeExecutionBinding(request) {
	const knowledge = request.knowledge;
	if (!knowledge) {
		if (request.launch.env["TANGLE_CANDIDATE_KNOWLEDGE_ROOT"] !== void 0 || request.launch.env["TANGLE_CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG"] !== void 0) throw new Error("candidate launch declares knowledge paths without verified knowledge");
		return;
	}
	const paths = candidateKnowledgeExecutionPaths(request.roots.taskRoot, knowledge.retrievalConfig !== void 0);
	if (request.launch.env["TANGLE_CANDIDATE_KNOWLEDGE_ROOT"] !== paths.root || request.launch.env["TANGLE_CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG"] !== paths.retrievalConfig) throw new Error("candidate knowledge paths do not match the signed launch environment");
	const reserved = [paths.root, paths.retrievalConfig].filter((value) => value !== void 0);
	if ([
		...request.inputs.task.files.map((file) => beneath(request.roots.taskRoot, file.path)),
		...request.inputs.profile.files.map((file) => profileFileExecutionPath(request, file)),
		...request.instruction.delivery.kind === "utf8-file" ? [request.instruction.delivery.path] : []
	].some((path) => reserved.some((reservedPath) => path === reservedPath || path.startsWith(`${reservedPath}/`) || reservedPath.startsWith(`${path}/`)))) throw new Error("candidate knowledge paths overlap other execution inputs");
	return paths;
}
function profileFileExecutionPath(request, file) {
	const workspaceRoot = request.executionPlan.value.material.profile.targetWorkspace === "task" ? request.roots.taskRoot : request.roots.candidateRoot;
	if (!workspaceRoot) throw new Error("candidate profile targets a missing workspace");
	if (file.root !== "agent") return beneath(workspaceRoot, file.path);
	return beneath(profileAgentDirectory(request), file.path);
}
function profileAgentDirectory(request) {
	const paths = candidateProfileAgentPaths(request.profilePlan.value.material, request.roots.profileRoot);
	if (!paths) throw new Error("candidate profile agent-root file is missing its private root");
	if (request.launch.env["PI_CODING_AGENT_DIR"] !== paths.agentDir || request.launch.env["PI_CODING_AGENT_SESSION_DIR"] !== paths.sessionDir) throw new Error("candidate Pi agent-root files do not match the signed launch environment");
	return paths.agentDir;
}
function exactLaunch(request) {
	const instruction = new TextDecoder("utf-8", { fatal: true }).decode(request.instruction.bytes);
	const base = {
		executable: request.launch.executable,
		args: request.launch.args,
		cwd: request.launch.cwd,
		env: request.launch.env,
		timeoutMs: 0
	};
	switch (request.instruction.delivery.kind) {
		case "argv-append": return {
			...base,
			args: [...base.args, instruction]
		};
		case "stdin-utf8": return {
			...base,
			stdin: instruction
		};
		case "utf8-file": return base;
	}
}
async function collectOutput(process, maxBytes) {
	const chunks = [];
	let byteLength = 0;
	for await (const chunk of process.stdout()) {
		const bytes = Buffer.from(chunk, "utf8");
		byteLength += bytes.byteLength;
		if (byteLength > maxBytes) {
			let stopError;
			try {
				await stopProcess(process);
			} catch (error) {
				stopError = error;
			}
			throw new Error(`candidate output exceeds its ${maxBytes}-byte maximum`, { cause: stopError });
		}
		chunks.push(bytes);
	}
	return Uint8Array.from(Buffer.concat(chunks, byteLength));
}
async function awaitOutput(output, signal, deadlineAtMs) {
	signal.throwIfAborted();
	const remainingMs = deadlineAtMs - Date.now();
	if (remainingMs <= 0) throw new Error("candidate output deadline expired");
	let timer;
	let onAbort;
	try {
		return await Promise.race([output, new Promise((_resolve, reject) => {
			onAbort = () => reject(signal.reason ?? /* @__PURE__ */ new Error("candidate output cancelled"));
			signal.addEventListener("abort", onAbort, { once: true });
			timer = setTimeout(() => reject(/* @__PURE__ */ new Error("candidate output deadline expired")), remainingMs);
		})]);
	} finally {
		if (onAbort) signal.removeEventListener("abort", onAbort);
		if (timer) clearTimeout(timer);
	}
}
async function stopProcess(process) {
	if (!(await process.status()).running) return;
	try {
		await process.kill();
	} catch (error) {
		if ((await process.status()).running) throw error;
	}
	const termination = await process.wait();
	assertTerminalStatus(await process.status(), termination);
}
function assertTerminalStatus(status, expected) {
	if (status.running || !status.termination) throw new Error("exact process returned no terminal reason after exit");
	if (expected && !isDeepStrictEqual(status.termination, expected)) throw new Error("exact process wait and status returned different terminal reasons");
}
function assertExecutionEnvironment(environment, metadata, providerName) {
	if (!environment.id || environment.provider !== providerName) throw new Error("exact process provider returned the wrong environment identity");
	if (!Object.entries(metadata).every(([name, value]) => isDeepStrictEqual(environment.metadata?.[name], value))) throw new Error("exact process provider did not persist candidate execution metadata");
}
function outputSpec(environment) {
	const maxBytes = environment.metadata?.outputMaxBytes;
	if (!Number.isSafeInteger(maxBytes) || Number(maxBytes) < 1) throw new Error("candidate exact process output bound is unavailable");
	return { maxBytes: Number(maxBytes) };
}
function executionKey(executionId, executionPlanDigest) {
	return `${executionId}\0${executionPlanDigest}`;
}
function executionIdempotencyKey(executionId, executionPlanDigest) {
	return `candidate-${canonicalCandidateDigest({
		kind: "agent-candidate-execution-identity",
		executionId,
		executionPlanDigest
	}).slice(7)}`;
}
function exactImage(image, manifestDigest) {
	if (isSha256Digest$1(image)) {
		if (image !== manifestDigest) throw new Error("candidate container image conflicts with its resolved manifest");
		return image;
	}
	const marker = image.lastIndexOf("@");
	if (marker < 0) return `${image}@${manifestDigest}`;
	if (image.slice(marker + 1) !== manifestDigest) throw new Error("candidate container image conflicts with its resolved manifest");
	return image;
}
function environmentLifetimeMs(timeoutMs, retentionMs) {
	const total = positiveInteger(timeoutMs, "candidate execution timeout") + retentionMs;
	if (!Number.isSafeInteger(total)) throw new Error("candidate environment lifetime is too large");
	return Math.ceil(total / 1e3) * 1e3;
}
function exactResources(resources) {
	if (!Number.isFinite(resources.cpu) || resources.cpu <= 0) throw new Error("exact process CPU must be positive and finite");
	return Object.freeze({
		cpu: resources.cpu,
		memoryMb: positiveInteger(resources.memoryMb, "exact process memory"),
		diskMb: positiveInteger(resources.diskMb, "exact process disk")
	});
}
function positiveInteger(value, label) {
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
	return value;
}
function beneath(root, relativePath) {
	if (posix.isAbsolute(relativePath)) throw new Error("candidate input path must be relative");
	const path = posix.normalize(relativePath);
	if (path === ".." || path.startsWith("../")) throw new Error("candidate input path escapes its execution root");
	return posix.join(root, path);
}
function isSha256Digest$1(value) {
	return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}
//#endregion
//#region src/candidate-execution/protected-model-port.ts
const MAX_RECENT_SETTLEMENTS = 4096;
const RECOVERED_SETTLEMENT_RETENTION_MS = 900 * 1e3;
/**
* Bind a protected model-grant service to the immutable candidate runtime.
*
* The service remains the authority for expiry, admission, revocation, and
* metering. This adapter independently checks every response before allowing
* it to cross into candidate execution or durable receipt finalization.
*/
function createProtectedAgentCandidateModelPort(options) {
	const gatewayDomain = assertGatewayDomain(options.gatewayDomain);
	const activationEnvNames = exactEnvironmentNames(options.activationEnvNames);
	const reservations = /* @__PURE__ */ new Map();
	const expiredReservations = /* @__PURE__ */ new Map();
	const recentSettlements = /* @__PURE__ */ new Map();
	return {
		resolve: async (input) => {
			const request = immutableCandidateValue(input);
			return immutableCandidateValue(validateResolvedModel(await options.resolveModel(request), request));
		},
		reserveGrant: async (input) => {
			pruneExpiredState(reservations, expiredReservations, recentSettlements, Date.now());
			const request = immutableCandidateValue(input);
			validateReserveInput(request);
			const requestDigest = canonicalCandidateDigest(request);
			const key = reservationKey(request.executionId, request.preparationId);
			if (recentSettlements.has(key)) throw new Error("protected model reservation is already settled");
			if (expiredReservations.get(key)) throw new Error("protected model reservation has expired");
			const previous = reservations.get(key);
			if (previous && previous.requestDigest !== requestDigest) throw new Error("protected model reservation retry changed immutable input");
			const reservation = validateReservation(await options.client.reserve(request), request, gatewayDomain);
			const responseDigest = canonicalCandidateDigest(reservation);
			if (recentSettlements.has(key)) throw new Error("protected model reservation completed after the grant was settled");
			const recorded = previous ?? reservations.get(key);
			if (recorded && recorded.requestDigest !== requestDigest) throw new Error("protected model reservation retry changed immutable input");
			if (recorded && recorded.responseDigest !== responseDigest) throw new Error("protected model reservation retry returned different evidence");
			if (!recorded) reservations.set(key, {
				requestDigest,
				responseDigest,
				executionId: request.executionId,
				preparationId: request.preparationId,
				grantDigest: reservation.digest,
				expiresAtMs: request.expiresAtMs,
				resolved: immutableCandidateValue(request.resolved),
				limits: immutableCandidateValue(request.limits),
				maxCostUsdNanos: usdToNanos(request.limits.maxCostUsd, "reserved maxCostUsd"),
				activation: "reserved"
			});
			return reservation;
		},
		activateGrant: async (input) => {
			pruneExpiredState(reservations, expiredReservations, recentSettlements, Date.now());
			const request = immutableCandidateValue(input);
			const key = reservationKey(request.executionId, request.preparationId);
			if (recentSettlements.has(key)) throw new Error("protected model grant is already settled");
			const state = reservations.get(key);
			if (!state && expiredReservations.has(key)) throw new Error("protected model grant reservation has expired");
			if (!state) throw new Error("protected model grant was not reserved by this port");
			assertGrantIdentity(state, request);
			if (state.settlementDigest) throw new Error("protected model grant is already settled");
			if (state.activation !== "reserved") throw new Error("protected model grant activation is single-use");
			if (!Number.isSafeInteger(request.deadlineAtMs) || request.deadlineAtMs <= 0) throw new Error("protected model activation deadline must be a positive safe integer");
			if (request.deadlineAtMs <= Date.now()) throw new Error("protected model activation deadline must be in the future");
			if (request.deadlineAtMs > state.expiresAtMs) throw new Error("protected model activation deadline exceeds the reserved expiry");
			state.activation = "activating";
			try {
				const activation = validateActivation(await options.client.activate(request), state.limits.maxModelCalls === 0 ? [] : activationEnvNames);
				if (recentSettlements.has(key) || reservations.get(key) !== state) throw new Error("protected model grant settled while activation was in flight");
				state.activation = "activated";
				return activation;
			} catch (error) {
				state.activation = "reserved";
				throw error;
			}
		},
		settleGrant: async (input) => {
			const now = Date.now();
			pruneExpiredState(reservations, expiredReservations, recentSettlements, now);
			const request = immutableCandidateValue(input);
			const key = reservationKey(request.executionId, request.preparationId);
			const state = reservations.get(key) ?? expiredReservations.get(key)?.state;
			if (state) assertGrantIdentity(state, request);
			const remembered = state ?? recentSettlements.get(key);
			if (remembered?.settlementReason && remembered.settlementReason !== request.reason) throw new Error("protected model settlement retry changed the termination reason");
			const sealed = sealAgentCandidateModelSettlement(await options.client.settle(request), {
				preparationId: request.preparationId,
				grantDigest: request.grantDigest,
				model: request.resolved.model
			});
			if (state) assertWithinReservedLimits(sealed.usage, state);
			const settlementDigest = canonicalCandidateDigest(sealed.value);
			if (remembered?.settlementDigest && remembered.settlementDigest !== settlementDigest) throw new Error("protected model settlement retry returned a different final ledger");
			if (remembered?.settlementReason && remembered.settlementReason !== request.reason) throw new Error("protected model settlement retry changed the termination reason");
			const expiresAtMs = state?.expiresAtMs ?? now + RECOVERED_SETTLEMENT_RETENTION_MS;
			if (state) {
				state.settlementDigest = settlementDigest;
				state.settlementReason = request.reason;
			}
			reservations.delete(key);
			expiredReservations.delete(key);
			rememberSettlement(recentSettlements, key, {
				settlementDigest,
				settlementReason: request.reason,
				expiresAtMs
			});
			return sealed.value;
		}
	};
}
function validateReserveInput(input) {
	if (!Number.isSafeInteger(input.expiresAtMs) || input.expiresAtMs <= 0) throw new Error("protected model reservation expiry must be a positive safe integer");
	if (input.expiresAtMs <= Date.now()) throw new Error("protected model reservation expiry must be in the future");
	for (const [name, value] of [
		["maxModelCalls", input.limits.maxModelCalls],
		["maxInputTokens", input.limits.maxInputTokens],
		["maxOutputTokens", input.limits.maxOutputTokens],
		["maxTotalTokens", input.limits.maxTotalTokens]
	]) {
		if (value === void 0) continue;
		if (!Number.isSafeInteger(value) || value < 0) throw new Error(`protected model reservation ${name} must be a nonnegative safe integer`);
	}
	usdToNanos(input.limits.maxCostUsd, "reserved maxCostUsd");
}
function validateReservation(value, expected, gatewayDomain) {
	const source = exactRecord(value, [
		"preparationId",
		"digest",
		"expiresAtMs",
		"enforcedLimits",
		"network"
	], "protected model reservation response");
	if (source.preparationId !== expected.preparationId) throw new Error("protected model reservation response changed preparation identity");
	if (!isSha256Digest(source.digest)) throw new Error("protected model reservation response has an invalid digest");
	if (source.expiresAtMs !== expected.expiresAtMs) throw new Error("protected model reservation response changed expiry");
	exactRecord(source.enforcedLimits, modelLimitKeys(expected.limits), "protected model reservation enforced limits");
	if (canonicalCandidateDigest(source.enforcedLimits) !== canonicalCandidateDigest(expected.limits)) throw new Error("protected model reservation response changed enforced limits");
	const network = validateReservationNetwork(source.network, expected.limits.maxModelCalls, gatewayDomain);
	return immutableCandidateValue({
		preparationId: source.preparationId,
		digest: source.digest,
		expiresAtMs: source.expiresAtMs,
		enforcedLimits: source.enforcedLimits,
		network
	});
}
function validateReservationNetwork(value, maxModelCalls, gatewayDomain) {
	if (maxModelCalls === 0) {
		if (exactRecord(value, ["mode"], "protected model reservation network").mode !== "disabled") throw new Error("zero-call protected model reservation must disable gateway access");
		return { mode: "disabled" };
	}
	const source = exactRecord(value, ["mode", "domains"], "protected model reservation network");
	if (source.mode !== "gateway-only") throw new Error("protected model reservation must allow only its model gateway");
	if (!Array.isArray(source.domains) || source.domains.length !== 1 || source.domains[0] !== gatewayDomain) throw new Error("protected model reservation returned an unexpected gateway domain");
	return {
		mode: "gateway-only",
		domains: [gatewayDomain]
	};
}
function validateActivation(value, expectedNames) {
	const env = record(exactRecord(value, ["env"], "protected model activation response").env, "protected model activation environment");
	const actualNames = Object.keys(env).sort();
	if (actualNames.length !== expectedNames.length || actualNames.some((name, index) => name !== expectedNames[index])) throw new Error("protected model activation returned unexpected environment names");
	const detached = Object.create(null);
	for (const name of expectedNames) {
		const value = env[name];
		if (typeof value !== "string" || value.length < 8 || value.length > 65536) throw new Error(`protected model activation ${name} must be a non-empty protected value`);
		detached[name] = value;
	}
	return Object.freeze({ env: Object.freeze(detached) });
}
function validateResolvedModel(value, expected) {
	const source = exactRecord(value, [
		"requested",
		"provider",
		"model",
		"snapshot",
		"reasoningEffort"
	], "resolved candidate model");
	if (source.requested !== expected.requested) throw new Error("model resolver changed the evaluator-owned request");
	if (source.reasoningEffort !== expected.reasoningEffort) throw new Error("model resolver changed the evaluator-owned reasoning effort");
	for (const name of [
		"requested",
		"provider",
		"model",
		"snapshot"
	]) if (typeof source[name] !== "string" || source[name].length === 0) throw new Error(`resolved candidate model ${name} must be non-empty`);
	return source;
}
function assertGrantIdentity(expected, actual) {
	if (actual.executionId !== expected.executionId || actual.preparationId !== expected.preparationId || actual.grantDigest !== expected.grantDigest || canonicalCandidateDigest(actual.resolved) !== canonicalCandidateDigest(expected.resolved)) throw new Error("protected model grant input does not match its immutable reservation");
}
function assertWithinReservedLimits(usage, reservation) {
	for (const [name, actual, limit] of [
		[
			"model calls",
			usage.modelCalls,
			reservation.limits.maxModelCalls
		],
		[
			"input tokens",
			usage.inputTokens,
			reservation.limits.maxInputTokens
		],
		[
			"output tokens",
			usage.outputTokens,
			reservation.limits.maxOutputTokens
		],
		[
			"cost USD nanos",
			usage.costUsdNanos,
			reservation.maxCostUsdNanos
		]
	]) if (actual > limit) throw new Error(`protected model settlement ${name} ${actual} exceeds reserved ${limit}`);
	const maxTotalTokens = reservation.limits.maxTotalTokens;
	if (maxTotalTokens !== void 0) {
		const totalTokens = usage.inputTokens + usage.outputTokens;
		if (!Number.isSafeInteger(totalTokens)) throw new Error("protected model settlement total token usage is incomplete");
		if (totalTokens > maxTotalTokens) throw new Error(`protected model settlement total tokens ${totalTokens} exceeds reserved ${maxTotalTokens}`);
	}
}
function modelLimitKeys(limits) {
	return limits.maxTotalTokens === void 0 ? [
		"maxModelCalls",
		"maxInputTokens",
		"maxOutputTokens",
		"maxCostUsd"
	] : [
		"maxModelCalls",
		"maxInputTokens",
		"maxOutputTokens",
		"maxTotalTokens",
		"maxCostUsd"
	];
}
function exactEnvironmentNames(values) {
	if (values.length === 0) throw new Error("protected model activation environment names must not be empty");
	const names = [...values].sort();
	if (new Set(names).size !== names.length) throw new Error("protected model activation environment names must be unique");
	for (const name of names) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || [
		"__proto__",
		"constructor",
		"prototype"
	].includes(name)) throw new Error(`protected model activation environment name is invalid: ${name}`);
	return Object.freeze(names);
}
function assertGatewayDomain(value) {
	if (value.length > 253 || value !== value.toLowerCase() || value.endsWith(".") || value.includes(":") || value === "localhost" || value.endsWith(".localhost") || value === "metadata.google" || value === "metadata.google.internal") throw new Error("protected model gateway must be an exact lowercase public DNS name");
	const labels = value.split(".");
	if (labels.length < 2 || !labels.every((label) => label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) || !/[a-z]/.test(labels.at(-1) ?? "")) throw new Error("protected model gateway must be an exact lowercase public DNS name");
	return value;
}
function reservationKey(executionId, preparationId) {
	return canonicalCandidateDigest({
		executionId,
		preparationId
	});
}
function pruneExpiredState(reservations, expiredReservations, settlements, now) {
	for (const [key, value] of reservations) if (value.expiresAtMs <= now) {
		reservations.delete(key);
		expiredReservations.set(key, {
			state: value,
			retainedUntilMs: now + RECOVERED_SETTLEMENT_RETENTION_MS
		});
	}
	for (const [key, value] of expiredReservations) if (value.retainedUntilMs <= now) expiredReservations.delete(key);
	for (const [key, value] of settlements) if (value.expiresAtMs <= now) settlements.delete(key);
}
function rememberSettlement(settlements, key, value) {
	settlements.delete(key);
	settlements.set(key, value);
	while (settlements.size > MAX_RECENT_SETTLEMENTS) {
		const oldest = settlements.keys().next().value;
		if (oldest === void 0) return;
		settlements.delete(oldest);
	}
}
function isSha256Digest(value) {
	return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}
function exactRecord(value, keys, label) {
	const source = record(value, label);
	assertExactObjectKeys(source, keys, label);
	return source;
}
function record(value, label) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain object`);
	return value;
}
//#endregion
export { exactProcessProviderAsCandidateExecutor as n, createProtectedAgentCandidateModelPort as t };

//# sourceMappingURL=protected-model-port-BrWgsCnl.js.map