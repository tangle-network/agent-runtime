import { i as Budget } from "./types-D56jQad-.js";
import { d as RunAnalystLoopOpts, f as RunAnalystLoopResult } from "./types-zWfqDjeL.js";
import { O as AuthoredHarness, jt as WorktreePatchArtifact, k as WorktreeFanoutOptions, rs as WinnerStrategy } from "./index-Dm8SHDGW.js";
import { n as FactCandidate, t as CreateKbGateOptions } from "./kb-gate-C8z2juK8.js";
import { AgentProfile } from "@tangle-network/agent-interface";
//#region src/loop-runner.d.ts
/** All valid delegated-loop mode names — used for validation and CLI surfaces. @experimental */
declare const DELEGATED_LOOP_MODES: readonly ["code", "review", "research", "audit", "self-improve"];
/** @experimental */
type DelegatedLoopMode = (typeof DELEGATED_LOOP_MODES)[number];
/** Type guard — returns true when `value` is a valid `DelegatedLoopMode` string. @experimental */
declare function isDelegatedLoopMode(value: unknown): value is DelegatedLoopMode;
/** @experimental A pre-configured loop for one mode. Returns the mode's raw
 *  output; the dispatcher wraps it in a {@link DelegatedLoopResult}. */
type DelegatedLoopRunner<T = unknown> = (signal: AbortSignal) => Promise<T>;
/** @experimental Mode → configured runner. Partial: only register the modes a
 *  given product/routine actually uses. */
type DelegatedLoopRegistry = Partial<Record<DelegatedLoopMode, DelegatedLoopRunner>>;
/** @experimental Uniform result — never throws from a registered runner; a
 *  thrown engine becomes `{ ok: false, error }` so a routine can record + move on. */
interface DelegatedLoopResult<T = unknown> {
  mode: DelegatedLoopMode;
  ok: boolean;
  output?: T;
  error?: string;
  durationMs: number;
}
/** @experimental */
interface RunDelegatedLoopOptions {
  signal?: AbortSignal;
  /** Clock override for deterministic tests. */
  now?: () => number;
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
declare function runDelegatedLoop<T = unknown>(mode: DelegatedLoopMode, registry: DelegatedLoopRegistry, options?: RunDelegatedLoopOptions): Promise<DelegatedLoopResult<T>>;
/** @experimental Options for the local-repo `code` runner over the GENERIC recursive path. */
interface WorktreeLoopRunnerOptions {
  /** Exact profile carried by the personified root that owns this fanout. */
  rootProfile: AgentProfile;
  /** Absolute path to the local git checkout each worktree is cut from. */
  repoRoot: string;
  /** The instruction handed to every authored harness (composed under each profile's systemPrompt). */
  taskPrompt: string;
  /** The supervisor-authored harness profiles — one fanout item (one worktree-CLI leaf) each. */
  harnesses: ReadonlyArray<AuthoredHarness>;
  /** Conserved budget pool bounding the fanout (equal-k holds by construction). */
  budget: Budget;
  /** Shell command run in each worktree to derive the tests-PASS signal. */
  testCmd?: string;
  /** Shell command run in each worktree to derive the typecheck-PASS signal. */
  typecheckCmd?: string;
  /** Which verification signals the deliverable REQUIRES present-and-passing (default none). */
  require?: ReadonlyArray<'tests' | 'typecheck'>;
  /** Diff-size cap (lines). */
  maxDiffLines?: number;
  /** Literal path prefixes the patch must not touch (the secret-floor is always on regardless). */
  forbiddenPaths?: string[];
  /** Winner-selection strategy among gated candidates. Default `highest-score`. */
  winnerStrategy?: WinnerStrategy;
  /** Test seams forwarded to the worktree-CLI leaves so the runner drives offline. */
  runGit?: WorktreeFanoutOptions['runGit'];
  runHarness?: WorktreeFanoutOptions['runHarness'];
  runCommand?: WorktreeFanoutOptions['runCommand'];
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
declare function worktreeLoopRunner(options: WorktreeLoopRunnerOptions): DelegatedLoopRunner<WorktreePatchArtifact>;
/** @experimental A fact rejected at the KB gate — surfaced, never dropped. */
interface VetoedFact {
  candidate: FactCandidate;
  vetoedBy?: string;
  reason?: string;
}
/** @experimental */
interface ResearchLoopResult {
  /** Facts that passed the fail-closed gate — safe to write to the KB. */
  accepted: FactCandidate[];
  /** Facts the gate vetoed in the final round — escalate, do not silently drop. */
  vetoed: VetoedFact[];
  /** Research rounds actually run. */
  rounds: number;
}
/** @experimental Options for the default `research` runner. */
interface ResearchLoopRunnerOptions {
  /**
   * The research engine (the consumer's web/doc searcher + extractor). Called
   * each round with the prior round's vetoes so it can re-research the gaps.
   * Returns fact candidates carrying their grounding (`verbatimPassage` +
   * `sourceText`).
   */
  research: (round: number, vetoed: VetoedFact[]) => Promise<FactCandidate[]>;
  /** Gate config (extra judges, self-artifact kinds, …). The floor is always on. */
  gate?: CreateKbGateOptions;
  /** Max research rounds (correct-on-veto remediation). Default 1. */
  maxRounds?: number;
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
declare function researchLoopRunner(o: ResearchLoopRunnerOptions): DelegatedLoopRunner<ResearchLoopResult>;
/**
 * `audit` mode — analyst loop over captured trace/run data.
 *
 * @experimental
 */
declare function auditLoopRunner<TProposal = unknown, TEdit = unknown>(options: RunAnalystLoopOpts): DelegatedLoopRunner<RunAnalystLoopResult<TProposal, TEdit>>;
//#endregion
//#region src/loop-runner-bin.d.ts
/** @experimental Parsed CLI invocation. */
interface LoopRunnerCliArgs {
  mode: string;
  /** Loads the registry — the bin wires this from `--config`; tests inject a stub. */
  loadRegistry: () => Promise<DelegatedLoopRegistry> | DelegatedLoopRegistry;
  now?: () => number;
}
/** @experimental */
interface LoopRunnerCliResult {
  exitCode: number;
  result?: DelegatedLoopResult;
  error?: string;
}
/**
 *
 * Pure CLI core (no process / argv / IO) so it's unit-testable: validate the
 * mode, load the registry, dispatch, map to an exit code (0 ok / 1 failed /
 * 2 usage). Exported for embedding in custom runners + tests.
 *
 * @experimental
 */
declare function runLoopRunnerCli(args: LoopRunnerCliArgs): Promise<LoopRunnerCliResult>;
/** Parse `--mode X --config Y` from an argv tail (`process.argv.slice(2)`). */
declare function parseLoopRunnerArgv(argv: string[]): {
  mode?: string;
  config?: string;
};
//#endregion
export { researchLoopRunner as _, DELEGATED_LOOP_MODES as a, DelegatedLoopResult as c, ResearchLoopRunnerOptions as d, RunDelegatedLoopOptions as f, isDelegatedLoopMode as g, auditLoopRunner as h, runLoopRunnerCli as i, DelegatedLoopRunner as l, WorktreeLoopRunnerOptions as m, LoopRunnerCliResult as n, DelegatedLoopMode as o, VetoedFact as p, parseLoopRunnerArgv as r, DelegatedLoopRegistry as s, LoopRunnerCliArgs as t, ResearchLoopResult as u, runDelegatedLoop as v, worktreeLoopRunner as y };
//# sourceMappingURL=loop-runner-bin-D6khQtoC.d.ts.map