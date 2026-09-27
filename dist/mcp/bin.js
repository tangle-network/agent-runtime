#!/usr/bin/env node
import { Pr as readTraceContextFromEnv } from "../supervisor-DtlPj9me.js";
import { i as ConfigError } from "../errors-DodWX-cb.js";
import { s as supervisorInstructions } from "../delegate-CZc7B-Tl.js";
import { _ as FileDelegationStore, n as createMcpServer, p as DelegationTaskQueue } from "../server-Dyc1zvug.js";
//#region src/mcp/delegate-supervisor-provisioning.ts
function trimmed(value) {
	const v = value?.trim();
	return v ? v : void 0;
}
function requiredEnv(env, name) {
	const value = trimmed(env[name]);
	if (value) return value;
	throw new ConfigError(`agent-runtime-mcp: ${name} is required when MCP_ENABLE_DELEGATE=1`);
}
/** True when the operator opted the generic `delegate` verb in (`MCP_ENABLE_DELEGATE=1`). Default off:
*  the wiring is additive, so consumers that do not enable it are unaffected. */
function delegateEnabled(env = process.env) {
	return env.MCP_ENABLE_DELEGATE === "1";
}
/**
* Resolve the supervisor brain from dedicated MCP configuration. The model is part of the exact
* profile; the URL and key are transport-only. No generic worker/model/key variable may silently
* select this paid execution path.
*/
function resolveRouterSupervisor(env) {
	const routerKey = requiredEnv(env, "MCP_SUPERVISOR_ROUTER_KEY");
	const base = requiredEnv(env, "MCP_SUPERVISOR_ROUTER_BASE_URL");
	const routerBaseUrl = /\/v\d+\/?$/.test(base) ? base.replace(/\/$/, "") : `${base.replace(/\/$/, "")}/v1`;
	const model = requiredEnv(env, "MCP_SUPERVISOR_MODEL");
	return {
		router: {
			routerBaseUrl,
			routerKey
		},
		profile: {
			name: "delegate-supervisor",
			harness: "cli-base",
			model: {
				provider: "tangle-router",
				default: model
			},
			prompt: { systemPrompt: supervisorInstructions() }
		}
	};
}
/**
* Build the `delegateSupervisor` substrate for `createMcpServer` from env + the bin's loaded
* `SandboxClient`. Returns `undefined` when `delegate` is not opted in, so the caller mounts it only
* when asked. The worker backend is `sandbox`; every authored worker's exact profile selects its
* own harness/provider/model.
*/
function resolveDelegateSupervisor(sandboxClient, env = process.env) {
	if (!delegateEnabled(env)) return void 0;
	const supervisor = resolveRouterSupervisor(env);
	const backend = {
		backend: "sandbox",
		sandboxClient
	};
	return {
		router: supervisor.router,
		supervisorProfile: supervisor.profile,
		backend
	};
}
//#endregion
//#region src/mcp/bin.ts
const DEFAULT_SANDBOX_BASE_URL = "https://sandbox.tangle.tools";
async function main() {
	const wantDelegate = delegateEnabled(process.env);
	let sandboxClient;
	if (wantDelegate) {
		const apiKey = process.env.TANGLE_API_KEY;
		if (!apiKey && !process.env.AGENT_RUNTIME_MCP_ALLOW_NO_KEY) {
			process.stderr.write("agent-runtime-mcp: TANGLE_API_KEY is required to serve `delegate`. Set AGENT_RUNTIME_MCP_ALLOW_NO_KEY=1 to run without it for diagnostics, or unset MCP_ENABLE_DELEGATE to run the queue-only subset.\n");
			process.exit(2);
		}
		sandboxClient = await loadSandboxClient(apiKey);
	}
	const traceContext = readTraceContextFromEnv();
	if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) process.stderr.write(`agent-runtime-mcp: exporting loop topology → ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}\n`);
	let delegateSupervisor;
	if (wantDelegate && sandboxClient) try {
		delegateSupervisor = resolveDelegateSupervisor(sandboxClient);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(2);
	}
	if (delegateSupervisor) process.stderr.write(`agent-runtime-mcp: delegate enabled — generic authoring supervisor on ${delegateSupervisor.supervisorProfile.model?.default}\n`);
	const durableQueue = await buildDurableQueueFromEnv(traceContext);
	const server = createMcpServer({
		...delegateSupervisor ? { delegateSupervisor } : {},
		traceContext,
		...durableQueue ? { queue: durableQueue } : {}
	});
	const shutdown = () => {
		server.stop();
		if (durableQueue) {
			durableQueue.flush().catch(() => {}).finally(() => process.exit(0));
			return;
		}
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
	await server.serve();
}
async function buildDurableQueueFromEnv(traceContext) {
	const stateFile = process.env.AGENT_RUNTIME_DELEGATION_STATE_FILE?.trim();
	if (!stateFile) return void 0;
	const store = new FileDelegationStore({
		filePath: stateFile,
		recoverCorrupt: process.env.AGENT_RUNTIME_DELEGATION_STATE_RECOVER === "1"
	});
	const maxTerminalRecords = parseRetention(process.env.AGENT_RUNTIME_DELEGATION_RETAIN_TERMINAL);
	const queue = await DelegationTaskQueue.restore({
		store,
		traceContext,
		...maxTerminalRecords !== void 0 ? { maxTerminalRecords } : {},
		onPersistError: (error) => {
			process.stderr.write(`agent-runtime-mcp: ${error.message}\n`);
			process.exit(1);
		}
	});
	process.stderr.write(`agent-runtime-mcp: durable delegation state → ${stateFile}\n`);
	return queue;
}
function parseRetention(raw) {
	if (raw === void 0 || raw.trim() === "") return void 0;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1) {
		process.stderr.write(`agent-runtime-mcp: AGENT_RUNTIME_DELEGATION_RETAIN_TERMINAL must be a positive integer, got "${raw}"\n`);
		process.exit(2);
	}
	return n;
}
async function loadSandboxClient(apiKey) {
	if (!apiKey) return { async create() {
		throw new Error("agent-runtime-mcp: TANGLE_API_KEY is unset; `delegate` is disabled in diagnostic mode. Set TANGLE_API_KEY or unset MCP_ENABLE_DELEGATE to remove the unsupported tool from the tool list.");
	} };
	const SandboxCtor = (await import("@tangle-network/sandbox").catch((err) => {
		process.stderr.write(`agent-runtime-mcp: failed to load @tangle-network/sandbox (${err.message}); install the peer dependency\n`);
		process.exit(2);
	})).Sandbox;
	if (!SandboxCtor) {
		process.stderr.write("agent-runtime-mcp: @tangle-network/sandbox does not export Sandbox; cannot construct client\n");
		process.exit(2);
	}
	return new SandboxCtor({
		apiKey,
		baseUrl: process.env.SANDBOX_BASE_URL?.trim() || DEFAULT_SANDBOX_BASE_URL
	});
}
main().catch((err) => {
	process.stderr.write(`agent-runtime-mcp: ${err instanceof Error ? err.stack : String(err)}\n`);
	process.exit(1);
});
//#endregion
export {};

//# sourceMappingURL=bin.js.map