import { $i as detachedSnapshot, Fi as finalizeRuntimeOwnedPendingExecutor, Ia as armDeadlineTimer, Mi as attestRuntimeOwnedPendingExecutor, Na as abortError, Sa as sleep, Sr as linkAbort, St as startRetainedInteractiveRun, Xi as executableAgentProfileSnapshot, _r as retainedCreateMaterial, _t as readWorkerInteractiveBinding, ir as sandboxClientAsProvider, jr as contentAddress, mn as taskToPrompt, n as createRootHandle, pt as interactiveAdmissionSeamKey, r as createSupervisor, vn as createInbox, vr as destroyInteractiveEnvironment, xr as abortError$1, yr as environmentGone, zi as newExecutionAttemptId } from "./supervisor-DtlPj9me.js";
import { a as concreteProfileModel } from "./model-policy-BbSCSak0.js";
import { a as writeAtomicDurableFile } from "./durable-file-DWQA4ooo.js";
import { A as createCoordinationTools, n as createSteerAcknowledger, t as createCancelAcknowledger, v as createFileRunContext } from "./coordination-driver-BBL_OgRw.js";
import { h as supervisorRunDir } from "./run-layout-vwd4SwX_.js";
import { agentInteractiveSessionControlClaimRequestDigest, agentInteractiveSessionPromptRequestDigest, agentInteractiveSessionStopRequestDigest, agentProfileSchema, canonicalAgentProfileDigest, canonicalCandidateDigest } from "@tangle-network/agent-interface";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
//#region src/runtime/retained-interactive-control.ts
const MAX_GENERATION_CONFLICTS = 8;
/**
* Acquire provider-issued write authority without reading authority from status.
*
* A new coordinator starts at generation zero. If another claim already exists,
* the provider returns its public generation and this helper retries one new
* compare-and-swap operation. Every generation has a deterministic operation
* identifier, so retrying after an ambiguous response cannot create two claims.
* @stable
*/
async function claimRetainedInteractiveControl(options) {
	const expected = options.expectedGeneration ?? 0;
	if (!Number.isSafeInteger(expected) || expected < 0) throw new Error("interactive control expectedGeneration must be a non-negative integer");
	let generation = expected;
	for (let conflict = 0; conflict <= MAX_GENERATION_CONFLICTS; conflict += 1) {
		if (options.signal?.aborted) throw abortError(options.signal.reason);
		const material = {
			operationId: controlClaimOperationId(options.handle, options.holderId, generation),
			ref: options.handle.ref,
			holderId: options.holderId,
			expectedGeneration: generation
		};
		const acknowledgement = await options.handle.claimControl({
			...material,
			requestDigest: agentInteractiveSessionControlClaimRequestDigest(material)
		}, options.signal === void 0 ? void 0 : { signal: options.signal });
		if (acknowledgement.status === "accepted" || acknowledgement.status === "replayed") {
			const control = acknowledgement.control;
			if (control === void 0) throw new Error("provider accepted interactive control without returning its claim");
			if (Date.parse(control.expiresAt) <= Date.now()) throw new Error("provider returned an expired interactive control claim");
			return control;
		}
		if (acknowledgement.status !== "conflict" || acknowledgement.conflictReason !== "generation_mismatch") throw new Error(acknowledgement.status === "unknown" ? "interactive control claim outcome is unknown; retry the same acquisition" : "interactive control claim operation conflicts with different request material");
		const current = acknowledgement.currentGeneration;
		if (current === void 0 || current <= generation) throw new Error("provider returned a non-advancing interactive control generation");
		generation = current;
	}
	throw new Error("interactive control changed too often to acquire safely");
}
function controlClaimOperationId(handle, holderId, expectedGeneration) {
	return `interactive-claim-${canonicalCandidateDigest({
		kind: "retained-interactive-control-claim.v1",
		ref: handle.ref,
		holderId,
		expectedGeneration
	}).slice(7, 47)}`;
}
//#endregion
//#region src/runtime/supervise/interactive-worker.ts
/**
* Runtime-owned worker seam for a provider's native interactive coding-agent process.
*
* This adapter composes the retained-interactive lifecycle. It does not create a second stream,
* replay buffer, session id, or cancellation protocol. The provider owns process state; Scope owns
* the supervised worker, journal, budget, and local control inbox.
*/
const INTERACTIVE_TEARDOWN_TIMEOUT_MS = 3e4;
/**
* Build a `MakeWorkerAgent` that starts one exact provider-owned native TUI per worker.
*
* A Scope supplies the durable admission hook and kernel-minted node attempt. The returned worker
* exposes `interactiveReady`, so Scope writes the exact provider reference before the worker can be
* attached by a different process. `attachWorker` then reconnects that same reference through the
* provider's public `get`/interactive contract.
*/
function workerFromInteractiveProvider(provider, options = {}) {
	if (!provider.name.trim()) throw new Error("workerFromInteractiveProvider: provider.name required");
	if (!provider.get) throw new Error(`workerFromInteractiveProvider(${provider.name}): provider.get is required for reconnect`);
	const capturedEnvironment = options.environment ? structuredClone(options.environment) : void 0;
	const unscopedNamespace = randomUUID();
	let unscopedOrdinal = 0;
	const runtime = options.runtime ?? provider.name;
	return (rawProfile, spawnContext) => {
		const profile = executableAgentProfileSnapshot(rawProfile, `workerFromInteractiveProvider(${provider.name})`);
		const input = {
			provider: provider.name,
			profile,
			...spawnContext === void 0 ? {} : { context: spawnContext }
		};
		const assignmentId = spawnContext?.assignmentId ?? `unscoped:${unscopedNamespace}:${unscopedOrdinal++}`;
		const baseInput = {
			...input,
			nodeId: spawnContext?.parentNodeId
		};
		const environmentKey = stableKey(options.environmentIdempotencyKey?.({ ...baseInput }) ?? derivedKey("supervised-interactive-environment", {
			provider: provider.name,
			assignmentId,
			parentNodeId: spawnContext?.parentNodeId,
			profile
		}), "environment idempotency key");
		const name = profile.name ?? "interactive-worker";
		const executorFactory = (spec, ctx) => interactiveExecutor({
			provider,
			profile: spec.profile,
			context: spawnContext,
			environment: capturedEnvironment,
			environmentKey,
			interactiveKey: (task) => stableKey(options.interactiveIdempotencyKey?.({
				...baseInput,
				task
			}) ?? derivedKey("supervised-interactive-session", {
				provider: provider.name,
				assignmentId,
				parentNodeId: spawnContext?.parentNodeId,
				profile: spec.profile,
				task
			}), "interactive idempotency key"),
			holderId: (task) => {
				return stableKey((typeof options.holderId === "function" ? options.holderId({
					...baseInput,
					task
				}) : options.holderId) ?? `runtime-interactive-worker:${canonicalCandidateDigest({
					provider: provider.name,
					assignmentId
				})}`, "interactive holder id");
			},
			initialPrompt: options.initialPrompt,
			cwd: options.cwd,
			cols: options.cols,
			rows: options.rows,
			runtime,
			pollIntervalMs: options.pollIntervalMs,
			destroyEnvironmentOnTeardown: options.destroyEnvironmentOnTeardown,
			executionAttemptId: ctx.node?.attemptId,
			nodeId: ctx.node?.nodeId,
			admission: admissionWriter(ctx, provider.name, ctx.node?.nodeId)
		});
		return {
			name,
			act: async () => {
				throw new Error("workerFromInteractiveProvider: interactive workers execute through executorSpec");
			},
			executorSpec: {
				profile,
				harness: null,
				executorFactory,
				...spawnContext?.execution ? { execution: spawnContext.execution } : {}
			}
		};
	};
}
function interactiveExecutor(input) {
	const attemptId = input.executionAttemptId ?? newExecutionAttemptId(input.nodeId ?? input.environmentKey);
	const localController = new AbortController();
	const inbox = createInbox();
	let handle;
	let createdEnvironment;
	let environmentId;
	let artifact;
	let activeLink;
	let startPromise;
	let executeStarted = false;
	let readyResolve;
	const ready = new Promise((resolve) => {
		readyResolve = resolve;
	});
	const stopOperations = /* @__PURE__ */ new Map();
	const memoryAdmissions = /* @__PURE__ */ new Map();
	let teardownComplete = false;
	let teardownPromise;
	let flushChain = Promise.resolve();
	let controlError;
	const executor = {
		runtime: input.runtime,
		teardownTimeoutMs: INTERACTIVE_TEARDOWN_TIMEOUT_MS,
		execute(task, signal) {
			if (executeStarted || teardownComplete || teardownPromise !== void 0) throw new Error("workerFromInteractiveProvider: execute() may only be called once");
			executeStarted = true;
			startPromise = startInteractive(task, signal);
			return runInteractive(signal);
		},
		deliver(message) {
			if (teardownComplete || teardownPromise !== void 0) return false;
			const accepted = inbox.deliver(message);
			if (accepted) flushInbox();
			return accepted;
		},
		interactive() {
			return handle ? {
				status: "available",
				handle
			} : {
				status: "unavailable",
				reason: "interactive-session-not-started"
			};
		},
		interactiveReady() {
			return ready;
		},
		async cancel(request) {
			const existing = stopOperations.get(request.operationId);
			if (existing) return existing;
			const tracked = stopInteractive(request.operationId, request.reason, request.signal).then((result) => {
				if (result.status === "unknown" && stopOperations.get(request.operationId) === tracked) stopOperations.delete(request.operationId);
				return result;
			});
			stopOperations.set(request.operationId, tracked);
			return tracked;
		},
		teardown(grace) {
			if (teardownComplete) return Promise.resolve({ destroyed: true });
			if (teardownPromise !== void 0) return teardownPromise;
			teardownPromise = teardownInteractive().then((result) => {
				teardownComplete = true;
				return result;
			}, (error) => {
				teardownPromise = void 0;
				throw error;
			});
			return teardownPromise;
		},
		heldEnvironments() {
			if (teardownComplete || input.destroyEnvironmentOnTeardown === false) return [];
			const held = createdEnvironment?.id ?? environmentId ?? handle?.ref.run.environmentId;
			return held === void 0 ? [] : [{
				provider: input.provider.name,
				environmentId: held
			}];
		},
		resultArtifact() {
			if (!artifact) throw new Error("workerFromInteractiveProvider: resultArtifact() read before execution settled");
			return artifact;
		}
	};
	const declaredEnvironment = input.environment ? retainedCreateMaterial({
		...input.environment,
		profile: input.profile,
		idempotencyKey: input.environmentKey
	}) : null;
	const profileModel = concreteProfileModel(input.profile);
	const plannedDeclaration = {
		effectiveProfile: input.profile,
		backend: input.provider.name,
		model: profileModel ? {
			status: "known",
			id: profileModel
		} : {
			status: "unknown",
			reason: "provider selected the model"
		},
		execution: {
			kind: "interactive-session",
			id: input.nodeId ?? input.environmentKey
		},
		materializer: "retained-interactive-provider",
		plan: {
			kind: "retained-interactive-provider",
			provider: input.provider.name,
			environment: declaredEnvironment,
			environmentIdempotencyKey: input.environmentKey,
			destroyEnvironmentOnTeardown: input.destroyEnvironmentOnTeardown !== false
		}
	};
	attestRuntimeOwnedPendingExecutor(executor, input.runtime, plannedDeclaration, {
		attemptId,
		binding: {
			provider: input.provider.name,
			environmentIdempotencyKey: input.environmentKey,
			nodeId: input.nodeId ?? null
		},
		descriptor: {
			kind: "interactive-session",
			provider: input.provider.name,
			transport: "agent-environment"
		}
	});
	async function startInteractive(task, signal) {
		try {
			activeLink = linkAbort(signal, localController.signal);
			const initialPrompt = typeof input.initialPrompt === "function" ? input.initialPrompt(task, {
				provider: input.provider.name,
				profile: input.profile,
				...input.context === void 0 ? {} : { context: input.context },
				task,
				...input.nodeId === void 0 ? {} : { nodeId: input.nodeId }
			}) : input.initialPrompt ?? taskToPrompt(task);
			if (typeof initialPrompt !== "string") throw new Error("workerFromInteractiveProvider: initialPrompt must return a string");
			const interactiveIdempotencyKey = input.interactiveKey(task);
			const started = await startRetainedInteractiveRun({
				provider: {
					...input.provider,
					async create(environmentInput) {
						const environment = await input.provider.create(environmentInput);
						createdEnvironment = environment;
						return environment;
					}
				},
				environment: {
					...input.environment ?? {},
					profile: input.profile,
					idempotencyKey: input.environmentKey
				},
				interactiveIdempotencyKey,
				...initialPrompt.length === 0 ? {} : { initialPrompt },
				...input.cwd === void 0 ? {} : { cwd: input.cwd },
				...input.cols === void 0 ? {} : { cols: input.cols },
				...input.rows === void 0 ? {} : { rows: input.rows },
				onAdmission: async (admission) => {
					environmentId = admission.phase === "interactive_environment" ? admission.environmentId : environmentId;
					const existing = memoryAdmissions.get(admission.phase);
					if (existing !== void 0) {
						if (canonicalCandidateDigest(existing) !== canonicalCandidateDigest(admission)) throw new Error(`interactive admission phase '${admission.phase}' changed across retry`);
					} else memoryAdmissions.set(admission.phase, detachedSnapshot(admission, "interactive admission"));
					await input.admission(admission);
				},
				signal: activeLink.signal
			});
			finalizeRuntimeOwnedPendingExecutor(executor, {
				...plannedDeclaration,
				execution: {
					kind: "interactive-session",
					id: started.ref.run.executionId
				},
				plan: {
					...plannedDeclaration.plan,
					environmentId: started.ref.run.environmentId,
					interactiveIdempotencyKey
				}
			}, {
				attemptId,
				binding: {
					provider: input.provider.name,
					ref: started.ref,
					environmentId: started.ref.run.environmentId
				},
				descriptor: {
					kind: "interactive-session",
					provider: input.provider.name,
					transport: "agent-environment"
				}
			});
			handle = started;
			readyResolve({
				status: "available",
				handle: started
			});
			flushInbox();
			return started;
		} catch (error) {
			readyResolve({
				status: "unavailable",
				reason: unavailableReason(error)
			});
			activeLink?.release();
			throw error;
		}
	}
	async function* runInteractive(signal) {
		const startedAt = Date.now();
		try {
			const current = await startPromise;
			if (current === void 0) throw new Error("workerFromInteractiveProvider: interactive start did not begin");
			yield { kind: "iteration" };
			yield {
				kind: "tokens",
				input: 0,
				output: 0,
				tokensKnown: false
			};
			yield {
				kind: "cost",
				usd: 0,
				usdKnown: false,
				provenance: "uncaptured"
			};
			let status;
			for (;;) {
				if (signal.aborted || localController.signal.aborted) throw abortError$1(signal.aborted ? signal : localController.signal, "interactive execution aborted");
				status = await current.status({ signal: activeLink?.signal });
				await flushChain;
				if (controlError !== void 0) throw controlErrorValue(controlError);
				if (status.state !== "running") break;
				await sleep(input.pollIntervalMs ?? 100, activeLink?.signal);
			}
			const finished = status;
			const output = {
				provider: input.provider.name,
				environmentId: current.ref.run.environmentId,
				sessionId: current.ref.run.sessionId,
				executionId: current.ref.run.executionId,
				state: finished?.state === "exited" ? "exited" : "unknown",
				ref: current.ref,
				...finished?.state === "exited" && finished.reason ? { reason: finished.reason } : {},
				...finished?.state === "exited" && finished.exitCode !== void 0 ? { exitCode: finished.exitCode } : {},
				...finished?.state === "exited" && finished.exitSignal !== void 0 ? { exitSignal: finished.exitSignal } : {}
			};
			const spent = {
				iterations: 1,
				tokens: {
					input: 0,
					output: 0
				},
				tokensKnown: false,
				usd: 0,
				usdKnown: false,
				ms: Date.now() - startedAt
			};
			artifact = {
				outRef: contentAddress(output),
				out: output,
				spent
			};
		} finally {
			activeLink?.release();
		}
	}
	async function flushInbox() {
		flushChain = flushChain.then(async () => {
			try {
				if (!handle) return;
				const messages = inbox.drain();
				if (messages.length === 0) return;
				const prompt = inbox.fold(messages);
				const operationId = `interactive-prompt-${canonicalCandidateDigest({
					ref: handle.ref,
					prompt
				}).slice(7)}`;
				const control = await claimRetainedInteractiveControl({
					handle,
					holderId: input.holderId(void 0)
				});
				const material = {
					operationId,
					ref: handle.ref,
					control,
					prompt
				};
				const command = {
					...material,
					requestDigest: agentInteractiveSessionPromptRequestDigest(material)
				};
				await handle.sendPrompt(command);
			} catch (error) {
				controlError ??= error;
			}
		});
		await flushChain;
	}
	async function stopInteractive(operationId, reason, signal) {
		const observedAt = (/* @__PURE__ */ new Date()).toISOString();
		if (!handle) {
			localController.abort(reason ?? "interactive cancellation requested");
			return {
				status: "unknown",
				effect: "cancel_requested",
				observedAt,
				detail: "interactive process has not published a provider reference"
			};
		}
		try {
			const control = await claimRetainedInteractiveControl({
				handle,
				holderId: input.holderId(void 0),
				signal
			});
			const material = {
				operationId,
				ref: handle.ref,
				control
			};
			const command = {
				...material,
				requestDigest: agentInteractiveSessionStopRequestDigest(material)
			};
			const acknowledgement = await handle.stop(command, signal === void 0 ? void 0 : { signal });
			localController.abort(reason ?? "interactive cancellation requested");
			return cancellationFromAcknowledgement(acknowledgement, observedAt);
		} catch (error) {
			localController.abort(reason ?? "interactive cancellation requested");
			return {
				status: "unknown",
				effect: "cancel_requested",
				observedAt,
				detail: error instanceof Error ? error.message : String(error),
				evidence: { operationId }
			};
		}
	}
	async function teardownInteractive() {
		localController.abort("interactive worker teardown");
		activeLink?.release();
		await startPromise?.catch(() => void 0);
		if (handle) {
			if ((await safeStatus(handle))?.state === "running") {
				const cancellation = await stopInteractive(`interactive-teardown-${canonicalCandidateDigest(handle.ref).slice(7)}`, "interactive worker teardown");
				if (cancellation.status === "rejected" || cancellation.status === "unknown") throw new Error(cancellation.detail ?? "interactive teardown was not acknowledged");
			}
		}
		await destroyEnvironment();
		return { destroyed: true };
	}
	async function destroyEnvironment() {
		if (input.destroyEnvironmentOnTeardown === false) return;
		if (createdEnvironment !== void 0) {
			await destroyConfirmed(createdEnvironment);
			return;
		}
		if (!input.provider.get) return;
		const cleanupEnvironmentId = environmentId ?? handle?.ref.run.environmentId;
		if (!cleanupEnvironmentId) return;
		const environment = await input.provider.get(cleanupEnvironmentId);
		if (environment !== void 0 && environment !== null) await destroyConfirmed(environment);
	}
	async function destroyConfirmed(environment) {
		try {
			await destroyInteractiveEnvironment(environment);
		} catch (error) {
			if (!await environmentGone(input.provider, environment.id)) throw error;
		}
	}
	return executor;
}
function admissionWriter(ctx, provider, workerId) {
	const candidate = ctx.seams[interactiveAdmissionSeamKey];
	if (typeof candidate === "function") return async (admission) => {
		await candidate(admission);
	};
	const records = /* @__PURE__ */ new Map();
	return async (admission) => {
		const prior = records.get(admission.phase);
		if (prior && canonicalCandidateDigest(prior) !== canonicalCandidateDigest(admission)) throw new Error(`worker ${workerId ?? "(unscoped)"} provider ${provider} admission changed in memory`);
		records.set(admission.phase, detachedSnapshot(admission, "interactive admission"));
	};
}
function derivedKey(kind, value) {
	return `${kind}-${canonicalCandidateDigest(value).slice(7)}`;
}
function stableKey(value, label) {
	if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
	const key = value.trim();
	if (key.length > 256) throw new Error(`${label} must not exceed 256 bytes`);
	return key;
}
function unavailableReason(error) {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("interactive") || message.includes("Interactive") ? "provider-has-no-interactive-contract" : "interactive-binding-stale";
}
function cancellationFromAcknowledgement(acknowledgement, observedAt) {
	return {
		status: acknowledgement.status === "accepted" || acknowledgement.status === "replayed" ? "accepted" : acknowledgement.status === "conflict" ? "rejected" : "unknown",
		effect: acknowledgement.effect === "stopped" ? "cancelled" : acknowledgement.effect === "not_live" ? "not_live" : acknowledgement.effect === "stop_requested" ? "cancel_requested" : "unknown",
		observedAt,
		...acknowledgement.message === void 0 ? {} : { detail: acknowledgement.message },
		evidence: {
			operationId: acknowledgement.operationId,
			requestDigest: acknowledgement.requestDigest,
			providerStatus: acknowledgement.status,
			providerEffect: acknowledgement.effect
		}
	};
}
function controlErrorValue(error) {
	return error instanceof Error ? error : new Error(String(error));
}
async function safeStatus(handle) {
	let timer;
	const timeout = new Promise((resolve) => {
		timer = setTimeout(() => resolve(void 0), 100);
		timer.unref?.();
	});
	try {
		return await Promise.race([handle.status(), timeout]);
	} catch {
		return;
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
}
//#endregion
//#region src/runtime/supervise/provision-supervisor.ts
/**
* Public one-call composition for a durable Runtime supervisor proof run.
*
* This is intentionally a thin owner of existing Runtime primitives. The supervisor owns the
* root abort channel and join barrier, Scope owns worker admission and lifecycle, and the provider
* owns the environment and interactive process. External clients receive identifiers and opaque
* handles; they do not receive a second supervisor protocol or a copy of provider state.
*
* @experimental
*/
const DEFAULT_POLL_MS = 25;
const ROOT_MAX_ITERATIONS = 100;
const ROOT_MAX_TOKENS = 1e5;
const WORKER_MAX_ITERATIONS = 25;
const WORKER_MAX_TOKENS = 25e3;
var SupervisorProvisionUnavailableError = class extends Error {
	unavailable = true;
	constructor(message, cause) {
		super(message, cause === void 0 ? void 0 : { cause });
		this.name = "SupervisorProvisionUnavailableError";
	}
};
/**
* Provision one real provider-backed worker and keep its owning manager alive for controls.
*
* The root manager does not use a model. It runs the same coordination tools used by a driver in a
* small deterministic loop, so durable steer and cancel requests are acknowledged by the owning
* Runtime turn loop and never by a test-only shortcut. The caller owns profile, task, and provider
* connection selection; Runtime does not infer them from process environment variables.
*/
async function provisionSupervisor(request) {
	const input = normalizeRequest(request);
	const provider = await resolveProvider(input);
	const terminalTakeover = terminalCapability(await readCapabilities(provider));
	const profile = input.profile;
	const rootDir = resolve(input.workspaceDir ?? makeWorkspaceDir());
	mkdirSync(rootDir, { recursive: true });
	const supervisorId = supervisorIdFor(input.invocationId);
	const eventDir = supervisorRunDir(rootDir, supervisorId);
	const statePath = join(eventDir, "state.json");
	mkdirSync(dirname(eventDir), { recursive: true });
	try {
		mkdirSync(eventDir);
	} catch (error) {
		if (error.code === "EEXIST") throw unavailable(`Runtime supervisor '${supervisorId}' already exists at '${eventDir}'; use a new invocationId`);
		throw error;
	}
	const context = createFileRunContext(eventDir);
	const startedAtMs = Date.now();
	const state = {
		id: supervisorId,
		status: "running",
		task: input.task,
		workspaceDir: rootDir,
		budget: ROOT_MAX_TOKENS,
		...profile.model?.default === void 0 ? {} : { workerModel: profile.model.default },
		startedAt: new Date(startedAtMs).toISOString()
	};
	writeState(statePath, state);
	const rootHandle = createRootHandle();
	const supervisor = createSupervisor();
	supervisor.attach(rootHandle);
	const workerSpawned = deferred();
	const workerRunning = deferred();
	const workerProfile = profile;
	const makeWorkerAgent = workerFromInteractiveProvider(provider, {
		environment: {
			...input.workerEnvironment ?? {},
			metadata: {
				...input.workerEnvironment?.metadata ?? {},
				runtime: "agent-runtime",
				invocationId: input.invocationId
			},
			name: input.workerEnvironment?.name ?? `runtime-${supervisorId}`
		},
		pollIntervalMs: input.pollMs,
		destroyEnvironmentOnTeardown: true
	});
	const rootAgent = {
		name: "runtime-supervisor-root",
		async act(_task, scope) {
			const coord = createCoordinationTools({
				scope,
				blobs: context.blobs,
				makeWorkerAgent,
				perWorker: workerBudget(),
				awaitTimeoutMs: input.pollMs
			});
			await coord.ready();
			const spawn = findTool(coord.tools, "spawn_worker");
			const awaitEvent = findTool(coord.tools, "await_event");
			const childId = workerIdFromSpawn(await spawn.handler({
				profile: workerProfile,
				task: input.task,
				label: "interactive-worker"
			}));
			workerSpawned.resolve(childId);
			for (;;) {
				const child = scope.view.nodes.find((node) => node.id === childId);
				if (child?.status === "running") break;
				if (child === void 0 || child.status === "done" || child.status === "failed" || child.status === "cancelled") throw new Error(`Runtime supervisor worker '${childId}' ended before becoming live`);
				await delay(input.pollMs);
			}
			workerRunning.resolve();
			const steerAcknowledger = createSteerAcknowledger({
				dir: eventDir,
				coord,
				now: Date.now,
				ownerId: scope.view.root
			});
			const cancelAcknowledger = createCancelAcknowledger({
				dir: eventDir,
				coord,
				scope,
				now: Date.now,
				ownerId: scope.view.root,
				controlScope: "run"
			});
			try {
				while (true) {
					await steerAcknowledger.pass("turn");
					cancelAcknowledger.pass("turn");
					const event = await awaitEvent.handler({ kinds: ["settled"] });
					if (isSettledEvent(event)) {
						await steerAcknowledger.pass("final");
						cancelAcknowledger.pass("final");
						return;
					}
					if (isIdleEvent(event)) throw new Error(`Runtime supervisor worker '${childId}' ended without a settlement`);
					if (!isPendingEvent(event)) throw new Error(`Runtime supervisor returned an invalid settlement response`);
				}
			} finally {
				await steerAcknowledger.pass("final");
				cancelAcknowledger.pass("final");
				cancelAcknowledger.finish();
			}
		}
	};
	const runBudget = rootBudget(input.timeoutMs);
	let runResult;
	let runError;
	let runSettled = false;
	const runPromise = supervisor.run(rootAgent, input.task, {
		budget: runBudget,
		rootIdentity: {
			profileDigest: canonicalAgentProfileDigest(profile),
			taskDigest: canonicalCandidateDigest(input.task)
		},
		runId: supervisorId,
		...context,
		interactiveBindingDir: eventDir,
		maxDepth: 1,
		workerSlots: 1
	}).then((result) => {
		runResult = result;
		runSettled = true;
		updateStateFromResult(state, result);
		writeState(statePath, state);
		return result;
	}, (error) => {
		runError = error;
		runSettled = true;
		state.status = "down";
		state.completedAt = (/* @__PURE__ */ new Date()).toISOString();
		writeState(statePath, state);
		throw error;
	});
	runPromise.catch(() => void 0);
	let workerId;
	try {
		workerId = await waitForWorkerSpawn(workerSpawned.promise, runPromise, input.timeoutMs);
		await waitForWorkerRunning(workerRunning.promise, runPromise, input.timeoutMs);
		if (terminalTakeover === "required") await waitForInteractiveBinding(eventDir, workerId, runPromise, input.timeoutMs, input.pollMs);
	} catch (error) {
		if (!runSettled) try {
			rootHandle.abort("supervisor provisioning failed");
		} catch {}
		await runPromise.catch(() => void 0);
		throw error;
	}
	let cleanupPromise;
	const cleanup = async () => {
		cleanupPromise ??= (async () => {
			if (!runSettled) try {
				rootHandle.abort("supervisor cleanup");
			} catch {}
			const result = await runPromise.catch((error) => {
				runError = error;
			});
			if (result !== void 0) runResult = result;
			if (runError !== void 0) throw runError;
			const workerStatus = workerStatusFromEvents(await waitForWorkerTerminal(context.journal, supervisorId, workerId, input.timeoutMs, input.pollMs), workerId);
			if (workerStatus === "running") throw new Error(`Runtime supervisor worker '${workerId}' did not reach a terminal state`);
			if (runResult?.teardownUnconfirmed?.length) {
				const environments = runResult.teardownUnconfirmed.flatMap((node) => (node.environments ?? []).map((environment) => `${environment.provider}:${environment.environmentId}`));
				throw new Error(`Runtime supervisor cleanup could not confirm ${runResult.teardownUnconfirmed.length} resource(s) released${environments.length > 0 ? `; environments still held: ${environments.join(", ")}` : ""}`);
			}
			const supervisorStatus = state.status;
			state.completedAt ??= (/* @__PURE__ */ new Date()).toISOString();
			writeState(statePath, state);
			return Object.freeze({
				status: "completed",
				rootDir,
				supervisorId,
				workerId,
				supervisorStatus,
				workerStatus,
				resourcesReleased: true,
				remainingResources: Object.freeze([])
			});
		})();
		return cleanupPromise;
	};
	return Object.freeze({
		rootDir,
		supervisorId,
		workerId,
		providers: provider,
		terminalTakeover,
		cleanup
	});
}
function normalizeRequest(request) {
	const invocationId = request.invocationId.trim();
	if (!invocationId) throw new SupervisorProvisionUnavailableError("invocationId is required");
	const task = request.task.trim();
	if (!task) throw new SupervisorProvisionUnavailableError("task is required");
	const profile = resolveProfile(request.profile);
	if (request.connection === void 0) throw new SupervisorProvisionUnavailableError("provider connection is required");
	const timeoutMs = request.timeoutMs === void 0 ? void 0 : positiveNumber(request.timeoutMs, "timeoutMs");
	const pollMs = positiveNumber(request.pollMs ?? DEFAULT_POLL_MS, "pollMs");
	return {
		...request,
		invocationId,
		task,
		timeoutMs,
		pollMs,
		profile
	};
}
function positiveNumber(value, name) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new SupervisorProvisionUnavailableError(`${name} must be a positive safe integer`);
	return value;
}
function makeWorkspaceDir() {
	return join(tmpdir(), `agent-runtime-supervisor-${randomUUID()}`);
}
function supervisorIdFor(invocationId) {
	return `runtime-supervisor-${canonicalCandidateDigest({
		kind: "runtime-supervisor",
		invocationId
	}).slice(7)}`;
}
/** A caller-supplied deadline covers the complete supervisor lifecycle from run start through cleanup. */
function rootBudget(timeoutMs) {
	return {
		maxIterations: ROOT_MAX_ITERATIONS,
		maxTokens: ROOT_MAX_TOKENS,
		...timeoutMs === void 0 ? {} : { deadlineMs: timeoutMs }
	};
}
function workerBudget() {
	return {
		maxIterations: WORKER_MAX_ITERATIONS,
		maxTokens: WORKER_MAX_TOKENS
	};
}
function resolveProfile(profile) {
	const parsed = agentProfileSchema.safeParse(profile);
	if (!parsed.success) throw unavailable(`Runtime supervisor profile is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
	return parsed.data;
}
async function resolveProvider(request) {
	const connection = request.connection;
	if (connection === void 0) throw unavailable("Runtime supervisor provider connection is required");
	if (connection?.provider !== void 0) return requireReconnectProvider(connection.provider);
	const client = connection?.client ?? connection?.sandboxClient;
	if (client !== void 0) return requireReconnectProvider(sandboxClientAsProvider(client));
	const apiKey = connection.apiKey?.trim();
	const endpoint = connection.endpoint?.trim();
	if (!apiKey || !endpoint) throw unavailable("Runtime supervisor needs a provider/client or both connection.endpoint and connection.apiKey");
	let module;
	try {
		module = await import("@tangle-network/sandbox");
	} catch (error) {
		throw unavailable("Runtime supervisor could not load the Sandbox SDK peer dependency", error);
	}
	const SandboxCtor = module.Sandbox;
	if (SandboxCtor === void 0) throw unavailable("Sandbox SDK does not export a Sandbox client");
	return requireReconnectProvider(sandboxClientAsProvider(new SandboxCtor({
		apiKey,
		baseUrl: endpoint
	})));
}
function requireReconnectProvider(provider) {
	if (!provider.name.trim()) throw unavailable("Runtime supervisor provider has no name");
	if (typeof provider.get !== "function") throw unavailable(`Runtime supervisor provider '${provider.name}' cannot reconnect environments`);
	return provider;
}
async function readCapabilities(provider) {
	try {
		return await provider.capabilities();
	} catch (error) {
		throw unavailable(`Runtime supervisor could not read '${provider.name}' capabilities`, error);
	}
}
function terminalCapability(capabilities) {
	const interactive = capabilities.interactiveAgent;
	if (interactive === void 0) return "unsupported";
	return [
		interactive.start,
		interactive.control,
		interactive.status,
		interactive.attach,
		interactive.reattach,
		interactive.sendPrompt,
		interactive.input,
		interactive.resize,
		interactive.stop
	].every((value) => value === true) ? "required" : "unsupported";
}
function findTool(tools, name) {
	const tool = tools.find((candidate) => candidate.name === name);
	if (tool === void 0) throw new Error(`Runtime supervisor coordination tool '${name}' is missing`);
	return tool;
}
function workerIdFromSpawn(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Runtime supervisor spawn did not return a worker id");
	const workerId = value.workerId;
	if (typeof workerId !== "string" || !workerId.trim()) throw new Error("Runtime supervisor spawn did not return a worker id");
	return workerId;
}
function isSettledEvent(value) {
	return isObject(value) && value.type === "settled";
}
function isIdleEvent(value) {
	return isObject(value) && value.idle === true;
}
function isPendingEvent(value) {
	return isObject(value) && value.pending === true;
}
function isObject(value) {
	return typeof value === "object" && value !== null;
}
async function waitForWorkerSpawn(worker, run, timeoutMs) {
	return await withTimeout(Promise.race([worker, run.then(() => {
		throw new Error("Runtime supervisor ended before it spawned a worker");
	})]), timeoutMs, "worker spawn");
}
async function waitForWorkerRunning(running, run, timeoutMs) {
	await withTimeout(Promise.race([running, run.then(() => {
		throw new Error("Runtime supervisor ended before the worker became live");
	})]), timeoutMs, "worker readiness");
}
async function waitForInteractiveBinding(eventDir, workerId, run, timeoutMs, pollMs) {
	await withTimeout(pollUntil(async () => {
		const binding = readWorkerInteractiveBinding(eventDir, workerId);
		if (binding?.status === "available") return true;
		if (binding?.status === "unavailable") throw unavailable(`Runtime worker '${workerId}' could not publish an interactive binding`);
		return false;
	}, run, pollMs), timeoutMs, "interactive terminal binding");
}
async function pollUntil(read, run, pollMs) {
	for (;;) {
		if (await read()) return;
		await Promise.race([delay(pollMs), run.then(() => {
			throw new Error("Runtime supervisor ended before readiness was observed");
		})]);
	}
}
async function withTimeout(promise, timeoutMs, label) {
	if (timeoutMs === void 0) return await promise;
	let clearTimer;
	const timeout = new Promise((_resolve, reject) => {
		clearTimer = armDeadlineTimer(timeoutMs, () => reject(unavailable(`Runtime supervisor timed out waiting for ${label}`)));
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		clearTimer?.();
	}
}
function delay(ms, keepAlive = false) {
	return sleep(ms, void 0, keepAlive);
}
function updateStateFromResult(state, result) {
	state.status = result.kind === "winner" ? "done" : result.reason === "cancelled" ? "cancelled" : "down";
	state.completedAt = (/* @__PURE__ */ new Date()).toISOString();
}
function workerStatusFromEvents(events, workerId) {
	let status = "running";
	let terminal = false;
	for (const event of events) {
		if (event.id !== workerId) continue;
		if (terminal) continue;
		if (event.kind === "spawned" || event.kind === "progress") status = "running";
		else if (event.kind === "settled") {
			status = event.status === "done" ? "done" : "down";
			terminal = true;
		} else if (event.kind === "cancelled") {
			status = "cancelled";
			terminal = true;
		}
	}
	return status;
}
async function waitForWorkerTerminal(journal, root, workerId, timeoutMs, pollMs) {
	const deadline = timeoutMs === void 0 ? void 0 : Date.now() + timeoutMs;
	for (;;) {
		const events = await journal.loadTree(root);
		if (events !== void 0 && workerStatusFromEvents(events, workerId) !== "running") return events;
		if (deadline !== void 0 && Date.now() >= deadline) throw unavailable(`Runtime supervisor timed out waiting for worker '${workerId}' to settle`);
		await delay(pollMs, true);
	}
}
function deferred() {
	let done = false;
	let resolveValue;
	let rejectValue;
	return {
		promise: new Promise((resolvePromise, rejectPromise) => {
			resolveValue = (value) => {
				if (done) return;
				done = true;
				resolvePromise(value);
			};
			rejectValue = (error) => {
				if (done) return;
				done = true;
				rejectPromise(error);
			};
		}),
		resolve: resolveValue,
		reject: rejectValue,
		settled: () => done
	};
}
function unavailable(message, cause) {
	return new SupervisorProvisionUnavailableError(message, cause);
}
function writeState(path, state) {
	mkdirSync(dirname(path), { recursive: true });
	writeAtomicDurableFile(path, `${JSON.stringify(state)}\n`, { mode: 384 });
}
//#endregion
export { workerFromInteractiveProvider as n, claimRetainedInteractiveControl as r, provisionSupervisor as t };

//# sourceMappingURL=provision-supervisor-BvnihiyB.js.map