import { jt as createExecutorRegistry } from "./supervisor-DtlPj9me.js";
import { i as ConfigError } from "./errors-DodWX-cb.js";
import { h as worktreeFanout, nt as runPersonified, tt as definePersona } from "./runtime-DsAHXig2.js";
import { t as runAnalystLoop } from "./analyst-loop-DZw5QWT9.js";
import { t as createKbGate } from "./kb-gate-DpaSwXVx.js";
//#region src/loop-runner.ts
/** All valid delegated-loop mode names — used for validation and CLI surfaces. @experimental */
const DELEGATED_LOOP_MODES = [
	"code",
	"review",
	"research",
	"audit",
	"self-improve"
];
/** Type guard — returns true when `value` is a valid `DelegatedLoopMode` string. @experimental */
function isDelegatedLoopMode(value) {
	return typeof value === "string" && DELEGATED_LOOP_MODES.includes(value);
}
/**
*
* Dispatch a configured loop by mode. Fails loud (throws `ConfigError`) when no
* runner is registered for the mode — a routine pointed at an unwired mode is a
* config bug, not a silent no-op. A runner that throws is captured as
* `{ ok: false }` so unattended runs record the failure rather than crash.
*
* @experimental
*/
async function runDelegatedLoop(mode, registry, options = {}) {
	const runner = registry[mode];
	if (!runner) throw new ConfigError(`runDelegatedLoop: no runner registered for mode '${mode}' (registered: ${Object.keys(registry).join(", ") || "none"})`);
	const now = options.now ?? Date.now;
	const signal = options.signal ?? new AbortController().signal;
	const start = now();
	try {
		return {
			mode,
			ok: true,
			output: await runner(signal),
			durationMs: now() - start
		};
	} catch (err) {
		return {
			mode,
			ok: false,
			error: err instanceof Error ? err.message : String(err),
			durationMs: now() - start
		};
	}
}
/**
*
* `code` mode on the GENERIC recursive path: author one `AgentProfile` per harness, run them as a
* `worktreeFanout` (N `createWorktreeCliExecutor` leaves, each `gateOnDeliverable`) through
* `runPersonified` on the keystone Supervisor. The sandbox-session counterpart that drives the in-box
* harness over a `SandboxClient` is `detachedSessionDelegate` (`./mcp/delegates`); here there is no
* `runAgentRounds` driver, no role-coupled delegate — the harness list is the fanout, the gate is
* `patchDelivered`,
* the winner is the shared valid-only selector (NOT `defaultSelectWinner`, whose non-valid fallback
* would surface an ungated patch). Equal-k holds by the conserved budget pool. Returns the winning
* patch artifact, or throws when no candidate is delivered (fail loud, never a vacuous done).
*
* @experimental
*/
function worktreeLoopRunner(options) {
	const shape = worktreeFanout({
		repoRoot: options.repoRoot,
		taskPrompt: options.taskPrompt,
		harnesses: options.harnesses,
		...options.testCmd !== void 0 ? { testCmd: options.testCmd } : {},
		...options.typecheckCmd !== void 0 ? { typecheckCmd: options.typecheckCmd } : {},
		...options.require !== void 0 ? { require: options.require } : {},
		...options.maxDiffLines !== void 0 ? { maxDiffLines: options.maxDiffLines } : {},
		...options.forbiddenPaths !== void 0 ? { forbiddenPaths: options.forbiddenPaths } : {},
		...options.winnerStrategy !== void 0 ? { winnerStrategy: options.winnerStrategy } : {},
		...options.runGit ? { runGit: options.runGit } : {},
		...options.runHarness ? { runHarness: options.runHarness } : {},
		...options.runCommand ? { runCommand: options.runCommand } : {}
	});
	const persona = definePersona({
		name: "worktree-coder",
		root: {
			profile: options.rootProfile,
			harness: null
		},
		directive: "deliver a minimal validated patch on a fresh worktree",
		context: { role: "coder" },
		executors: { registry: createExecutorRegistry() }
	});
	return async (signal) => {
		const result = await runPersonified({
			persona,
			shape,
			task: options.taskPrompt,
			budget: options.budget,
			signal
		});
		if (result.kind !== "winner" || result.out.kind !== "done") {
			const blockers = result.kind === "winner" && result.out.kind === "blocked" ? result.out.blockers.join("; ") : `supervisor settled ${result.kind}`;
			throw new Error(`worktreeLoopRunner: no delivered patch (${blockers})`);
		}
		return result.out.deliverable;
	};
}
/**
* `research` mode — research-in-a-loop with valid-only KB growth.
*
* Each round: research → gate every candidate (fail-closed; passage MUST be in
* the source) → accept the clean ones → re-research the vetoed ones next round,
* up to `maxRounds`. Vetoed facts in the final round are RETURNED (escalate,
* never silently dropped) so the caller audits vs retries.
*
* @experimental
*/
function researchLoopRunner(o) {
	const gate = createKbGate(o.gate);
	const maxRounds = Math.max(1, Math.trunc(o.maxRounds ?? 1));
	return async (signal) => {
		const accepted = [];
		let vetoed = [];
		let rounds = 0;
		for (let round = 0; round < maxRounds; round += 1) {
			if (signal.aborted) break;
			rounds += 1;
			const candidates = await o.research(round, vetoed);
			if (candidates.length === 0) break;
			vetoed = [];
			for (const c of candidates) {
				const v = await gate(c);
				if (v.accepted) accepted.push(c);
				else vetoed.push({
					candidate: c,
					vetoedBy: v.vetoedBy,
					reason: v.reason
				});
			}
			if (vetoed.length === 0) break;
		}
		return {
			accepted,
			vetoed,
			rounds
		};
	};
}
/**
* `audit` mode — analyst loop over captured trace/run data.
*
* @experimental
*/
function auditLoopRunner(options) {
	return async () => runAnalystLoop(options);
}
//#endregion
//#region src/loop-runner-bin.ts
/**
*
* `agent-runtime-loop` — the schedulable entrypoint for the configured
* delegated loop-runner. A cron job / routine / Makefile target invokes:
*
*   agent-runtime-loop --mode research --config ./loops.config.js
*
* The config module wires the registry (with full access to env / creds —
* which is why the deps live there, not in this generic bin). It must default-
* export a `DelegatedLoopRegistry`, or a `() => DelegatedLoopRegistry | Promise<…>`.
* The bin runs the selected mode, prints the `DelegatedLoopResult` as JSON, and
* exits 0 on `ok`, 1 on a recorded failure, 2 on a usage/config error.
*
* @experimental
*/
/**
*
* Pure CLI core (no process / argv / IO) so it's unit-testable: validate the
* mode, load the registry, dispatch, map to an exit code (0 ok / 1 failed /
* 2 usage). Exported for embedding in custom runners + tests.
*
* @experimental
*/
async function runLoopRunnerCli(args) {
	if (!isDelegatedLoopMode(args.mode)) return {
		exitCode: 2,
		error: `unknown mode '${args.mode}' (expected one of: ${DELEGATED_LOOP_MODES.join(", ")})`
	};
	let registry;
	try {
		registry = await args.loadRegistry();
	} catch (err) {
		return {
			exitCode: 2,
			error: `failed to load registry: ${errMsg(err)}`
		};
	}
	if (!registry[args.mode]) return {
		exitCode: 2,
		error: `config registers no runner for mode '${args.mode}' (registered: ${Object.keys(registry).join(", ") || "none"})`
	};
	const result = await runDelegatedLoop(args.mode, registry, { ...args.now ? { now: args.now } : {} });
	return {
		exitCode: result.ok ? 0 : 1,
		result
	};
}
/** Parse `--mode X --config Y` from an argv tail (`process.argv.slice(2)`). */
function parseLoopRunnerArgv(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === "--mode") out.mode = argv[++i];
		else if (a === "--config") out.config = argv[++i];
		else if (a?.startsWith("--mode=")) out.mode = a.slice(7);
		else if (a?.startsWith("--config=")) out.config = a.slice(9);
	}
	return out;
}
/** Normalize a config module's default export → a registry. */
function resolveRegistry(mod) {
	const def = mod?.default ?? mod;
	return typeof def === "function" ? def() : def;
}
function errMsg(err) {
	return err instanceof Error ? err.message : String(err);
}
/** The argv → IO → exit shell. Kept thin; logic lives in `runLoopRunnerCli`. */
async function main() {
	const { mode, config } = parseLoopRunnerArgv(process.argv.slice(2));
	if (!mode || !config) {
		process.stderr.write(`usage: agent-runtime-loop --mode <mode> --config <module>
  modes: ${DELEGATED_LOOP_MODES.join(" | ")}\n  config: a JS/TS module default-exporting a DelegatedLoopRegistry (or a factory)
`);
		process.exit(2);
	}
	const { pathToFileURL } = await import("node:url");
	const { resolve } = await import("node:path");
	const cli = await runLoopRunnerCli({
		mode,
		loadRegistry: async () => resolveRegistry(await import(pathToFileURL(resolve(config)).href))
	});
	process.stdout.write(`${JSON.stringify(cli.result ?? { error: cli.error }, null, 2)}\n`);
	if (cli.error) process.stderr.write(`${cli.error}\n`);
	process.exit(cli.exitCode);
}
const invokedScript = typeof process !== "undefined" ? process.argv?.[1] : void 0;
if (invokedScript && /loop-runner-bin\.(js|ts|mjs)$/.test(invokedScript)) main();
//#endregion
export { isDelegatedLoopMode as a, worktreeLoopRunner as c, auditLoopRunner as i, runLoopRunnerCli as n, researchLoopRunner as o, DELEGATED_LOOP_MODES as r, runDelegatedLoop as s, parseLoopRunnerArgv as t };

//# sourceMappingURL=loop-runner-bin-C9FJshTP.js.map