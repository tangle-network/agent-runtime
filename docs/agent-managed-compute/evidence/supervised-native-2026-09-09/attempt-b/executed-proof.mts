import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { agentInteractiveSessionStopRequestDigest } from "@tangle-network/agent-interface";
import { createTangleProvider } from "@tangle-network/agent-provider-tangle";
import { Sandbox } from "@tangle-network/sandbox";

const root = dirname(fileURLToPath(import.meta.url));
const runtime = process.env.RUNTIME_SOURCE;
const cli =
	process.env.SANDBOX_CLI_SOURCE;
const { getApiKey, getBaseUrl, resolveProductProfile } = await import(
	`${cli}/lib/config.ts`
);
const { fetchAuthenticatedAccount } = await import(`${cli}/lib/auth.ts`);
const { createSupervisor } = await import(
	`${runtime}/src/runtime/supervise/supervisor.ts`
);
const { createFileRunContext } = await import(
	`${runtime}/src/runtime/supervise/run-context.ts`
);
const { workerFromInteractiveProvider } = await import(
	`${runtime}/src/runtime/supervise/interactive-worker.ts`
);
const { attachWorker, readWorkerInteractiveBinding } = await import(
	`${runtime}/src/runtime/supervise/worker-interactive.ts`
);
const { claimRetainedInteractiveControl } = await import(
	`${runtime}/src/runtime/retained-interactive-control.ts`
);
const mode = process.argv[2] ?? "preflight";
const name = process.argv[3] ?? `runtime-773-workers-${Date.now()}`;
const eventDir = join(root, name, "journal");
const evidenceFile = join(root, name, `${mode}.json`);
await mkdir(join(root, name), { recursive: true });
const evidence: Record<string, any> = {
	name,
	mode,
	pid: process.pid,
	modelPrompts: 0,
	startedAt: new Date().toISOString(),
	steps: [],
};
async function record(step: string, fields = {}) {
	evidence.steps.push({ step, ...fields });
	await writeFile(evidenceFile, JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify({ mode, step }));
}
const profileName = resolveProductProfile("sandbox");
const apiKey = getApiKey(undefined, profileName);
const baseUrl = getBaseUrl(undefined, profileName);
assert.equal(new URL(baseUrl).origin, "https://sandbox.tangle.tools");
const account = await fetchAuthenticatedAccount({
	apiKey,
	baseUrl,
	timeoutMs: 10000,
});
assert.equal(
	account.email,
	process.env.EXPECTED_SANDBOX_EMAIL,
);
await record("account-ownership-verified");
const client = new Sandbox({ apiKey, baseUrl, timeoutMs: 15000 });
const provider = createTangleProvider({
	client,
	defaultBackend: "codex",
	readyTimeoutMs: 120000,
	mapCreateInput: (input) => ({
		name: `${name}-${input.profile.name}`,
		backend: { type: "codex", profile: input.profile },
		resources: { cpuCores: 1, memoryMB: 1024, diskGB: 1 },
		egressPolicy: { mode: "blocked" },
		idempotencyKey: input.idempotencyKey,
		metadata: input.metadata,
		maxLifetimeSeconds: 300,
		idleTimeoutSeconds: 180,
	}),
});
const signal = AbortSignal.timeout(240000);
async function waitFor<T>(
	read: () => Promise<T | undefined>,
	ms = 150000,
): Promise<T> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const value = await read();
		if (value !== undefined) return value;
		await delay(200);
	}
	throw new Error("proof observation deadline exceeded");
}
async function framesFor(handle: any, holder: string, input: boolean) {
	const control = await claimRetainedInteractiveControl({
		handle,
		holderId: holder,
		signal,
	});
	const terminal = await handle.attach(
		{ control, cols: 80, rows: 24 },
		{ signal },
	);
	const frames: Array<{ seq: number; digest: string }> = [];
	const readControl = new AbortController();
	const reader = (async () => {
		try {
			for await (const event of terminal.events({
				signal: readControl.signal,
			})) {
				if (event.type === "output")
					frames.push({
						seq: event.seq,
						digest: createHash("sha256").update(event.data).digest("hex"),
					});
			}
		} catch (error) {
			if (!readControl.signal.aborted) throw error;
		}
	})();
	await delay(700);
	if (input) {
		await terminal.resize({ cols: 100, rows: 30 }, { signal });
		await terminal.resize({ cols: 120, rows: 40 }, { signal });
		await terminal.input({ data: "/help\r" }, { signal });
	}
	await delay(1300);
	const detached = await terminal.detach({ signal });
	readControl.abort();
	await reader;
	assert.equal(detached.status, "detached");
	assert.ok(frames.length > 0);
	for (let i = 1; i < frames.length; i++)
		assert.equal(frames[i].seq, frames[i - 1].seq + 1);
	return { frames, control };
}
async function coordinator() {
	const makeWorker = workerFromInteractiveProvider(provider, {
		initialPrompt: "",
		pollIntervalMs: 1000,
		destroyEnvironmentOnTeardown: false,
		environment: {
			backend: "codex",
			resources: { cpu: 1, memoryMb: 1024, diskMb: 1024 },
			egress: { mode: "blocked" },
		},
	});
	const result = await createSupervisor().run(
		{
			name: "terminal-proof-coordinator",
			async act(_task, scope) {
				const workers = [];
				for (let index = 0; index < 2; index++) {
					const profile = {
						name: `worker-${index}`,
						harness: "codex",
						model: { provider: "openai", default: "openai/gpt-5.6-luna" },
					};
					const budget = { maxTokens: 10, maxIterations: 2 };
					const worker = makeWorker(profile, {
						assignmentId: `${name}-${index}`,
						parentNodeId: name,
						budget,
						task: "",
						label: profile.name,
					});
					const spawned = scope.spawn(worker, "", {
						label: profile.name,
						budget,
					});
					assert.equal(spawned.ok, true);
					const id = spawned.handle.id;
					await record("worker-spawned", { workerId: id });
					const session = await waitFor(async () => {
						const current = scope.interactive(id);
						if (current.status === "available") return current;
						const progress = scope.progress(id);
						if (
							progress &&
							["done", "failed", "cancelled"].includes(progress.status)
						)
							throw new Error("worker ended before attachment");
						return undefined;
					});
					const binding = readWorkerInteractiveBinding(eventDir, id);
					assert.equal(binding?.status, "available");
					assert.deepEqual(session.handle.ref, binding.ref);
					const capture = await framesFor(
						session.handle,
						`${name}-first-${index}`,
						true,
					);
					assert.equal(
						(await session.handle.status({ signal })).state,
						"running",
					);
					workers.push({
						workerId: id,
						parentId: name,
						ref: session.handle.ref,
						frames: capture.frames,
					});
					await record("worker-detached-running", {
						workerId: id,
						environmentId: session.handle.ref.run.environmentId,
						frameCount: capture.frames.length,
					});
				}
				assert.notEqual(
					workers[0].ref.run.environmentId,
					workers[1].ref.run.environmentId,
				);
				assert.notEqual(
					workers[0].ref.run.executionId,
					workers[1].ref.run.executionId,
				);
				await writeFile(
					join(root, name, "ready.json"),
					JSON.stringify(
						{ coordinatorPid: process.pid, eventDir, workers },
						null,
						2,
					),
				);
				await record("ready-for-coordinator-crash", {
					workerIds: workers.map((w) => w.workerId),
				});
				await new Promise(() => {});
			},
		},
		"",
		{
			...createFileRunContext(eventDir),
			resume: false,
			runId: name,
			budget: { maxTokens: 100, maxIterations: 10 },
			interactiveBindingDir: eventDir,
			signal,
		},
	);
	await record("unexpected-supervisor-return", { kind: result.kind });
	throw new Error("supervisor ended before intentional crash");
}
async function recover() {
	const ready = JSON.parse(
		await readFile(join(root, name, "ready.json"), "utf8"),
	);
	assert.notEqual(process.pid, ready.coordinatorPid);
	const handles = [];
	for (const [index, worker] of ready.workers.entries()) {
		const session = await attachWorker(eventDir, worker.workerId, {
			providers: provider,
			signal,
		});
		assert.equal(session.status, "available");
		assert.deepEqual(session.handle.ref, worker.ref);
		const capture = await framesFor(
			session.handle,
			`${name}-recovered-${index}`,
			false,
		);
		const replay = new Map(
			capture.frames.map((frame) => [frame.seq, frame.digest]),
		);
		for (const frame of worker.frames)
			assert.equal(replay.get(frame.seq), frame.digest);
		assert.equal((await session.handle.status({ signal })).state, "running");
		handles.push({ handle: session.handle, control: capture.control });
		await record("exact-worker-recovered", {
			workerId: worker.workerId,
			originalCoordinatorPid: ready.coordinatorPid,
			replacementPid: process.pid,
			initialFrames: worker.frames.length,
			replayFrames: capture.frames.length,
			matchingFrames: worker.frames.length,
			ref: session.handle.ref,
			replay: capture.frames,
		});
	}
	for (const [index, current] of handles.entries()) {
		const material = {
			operationId: `${name}-stop-${index}`,
			ref: current.handle.ref,
			control: current.control,
		};
		const ack = await current.handle.stop(
			{
				...material,
				requestDigest: agentInteractiveSessionStopRequestDigest(material),
			},
			{ signal },
		);
		assert.ok(["accepted", "replayed"].includes(ack.status));
		const status = await waitFor(async () => {
			const s = await current.handle.status({ signal });
			return s.state === "exited" ? s : undefined;
		}, 10000);
		await record("exact-worker-stopped", {
			workerId: ready.workers[index].workerId,
			status: ack.status,
			effect: ack.effect,
			terminalState: status.state,
		});
		if (index === 0) {
			assert.equal(
				(await handles[1].handle.status({ signal })).state,
				"running",
			);
			await record("sibling-unaffected-by-selected-worker-stop", {
				runningWorkerId: ready.workers[1].workerId,
			});
		}
	}
}
async function orchestrate() {
	const requested = {
		cpuCores: 1,
		memoryMB: 1024,
		diskGB: 1,
		maxLifetimeSeconds: 300,
		idleTimeoutSeconds: 180,
		egress: "blocked",
		sandboxMaximum: 2,
	};
	await record("requested-limits", requested);
	const children = [];
	const start = (phase: string) => {
		const child = spawn(
			process.execPath,
			[...process.execArgv, fileURLToPath(import.meta.url), phase, name],
			{ cwd: root, stdio: ["ignore", "pipe", "pipe"] },
		);
		children.push(child);
		child.stdout.on("data", () => {});
		child.stderr.on("data", () => {});
		return child;
	};
	const exited = (child: any) =>
		new Promise<any>((resolve) =>
			child.once("exit", (code, signal) => resolve({ code, signal })),
		);
	try {
		const first = start("coordinator");
		const firstExit = exited(first);
		const ready = await Promise.race([
			waitFor(async () => {
				try {
					return JSON.parse(
						await readFile(join(root, name, "ready.json"), "utf8"),
					);
				} catch {
					return undefined;
				}
			}, 200000),
			firstExit.then(() => {
				throw new Error("coordinator failed before readiness");
			}),
		]);
		assert.equal(ready.coordinatorPid, first.pid);
		first.kill("SIGKILL");
		const crash = await firstExit;
		assert.equal(crash.signal, "SIGKILL");
		await record("coordinator-process-killed", {
			pid: first.pid,
			signal: crash.signal,
		});
		const replacement = start("recover");
		const outcome = await Promise.race([
			exited(replacement),
			delay(60000).then(() => {
				throw new Error("replacement deadline exceeded");
			}),
		]);
		assert.equal(outcome.code, 0);
		await record("replacement-process-completed", {
			pid: replacement.pid,
			exitCode: outcome.code,
		});
	} finally {
		for (const child of children)
			if (child.exitCode === null && child.signalCode === null)
				child.kill("SIGKILL");
		const boxes = (await client.list({ limit: 100 })).filter((box) =>
			box.name.startsWith(`${name}-worker-`),
		);
		assert.ok(boxes.length <= 2);
		for (const box of boxes) {
			const existing = await client.get(box.id);
			if (existing) await existing.delete();
			const gone = await client
				.get(box.id)
				.then((value) => value === null)
				.catch(
					(error) =>
						error.status === 404 ||
						error.statusCode === 404 ||
						error.name === "NotFoundError",
				);
			await record("cleanup-confirmed", { environmentId: box.id, gone });
			assert.equal(gone, true);
		}
		await record("cleanup-inventory", { matchingSandboxes: boxes.length });
	}
}
try {
	assert.equal((await provider.capabilities()).interactiveAgent?.start, true);
	if (mode === "preflight")
		await record("imports-and-interactive-capability-ready");
	else if (mode === "coordinator") await coordinator();
	else if (mode === "recover") await recover();
	else if (mode === "orchestrate") await orchestrate();
	else throw new Error("unknown mode");
} catch (error: any) {
	await record("failure", {
		name: error.name,
		status: error.status ?? error.statusCode ?? null,
	});
	process.exitCode = 1;
}
