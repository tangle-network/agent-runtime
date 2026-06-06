/**
 * @experimental
 *
 * `runDelegatedLoop` — the configured delegated loop-runner.
 *
 * One typed entrypoint a worker agent (or a scheduled routine) calls to run a
 * disciplined loop in a chosen MODE, over agent-runtime's hardened engines:
 *
 *   code         → build-in-a-loop via the coder delegate (no-op + secret floor,
 *                  optional reviewer gate, winner-selection)
 *   review       → code mode with a REQUIRED reviewer (the gate is the point)
 *   research     → research-in-a-loop with valid-only KB growth (createKbGate)
 *   audit        → analyze trace/run data → findings (runAnalystLoop, caller-wired)
 *   self-improve → closed-loop text/config optimization (selfImprove, held-out gated)
 *   dynamic      → agent-authored topology (runLoop + createDynamicDriver)
 *
 * It is intentionally a thin façade: the value is that EVERY product reuses the
 * one hardened engine instead of forking delegation logic. The dispatcher owns
 * mode routing, timing, fail-loud on an unregistered mode, and a uniform result
 * shape; each mode's engine is a pre-configured runner in the registry (build it
 * with the factories below, or inject your own / a stub).
 */

import type { Scenario } from '@tangle-network/agent-eval/campaign'
import {
  type SelfImproveOptions,
  type SelfImproveResult,
  selfImprove,
} from '@tangle-network/agent-eval/contract'
import { runAnalystLoop } from './analyst-loop'
import type { RunAnalystLoopOpts, RunAnalystLoopResult } from './analyst-loop/types'
import { ConfigError } from './errors'
import {
  type CoderReviewer,
  type CoderWinnerSelection,
  createDefaultCoderDelegate,
  type DelegateRunCtx,
} from './mcp/delegates'
import { type CreateKbGateOptions, createKbGate, type FactCandidate } from './mcp/kb-gate'
import type { DelegateCodeArgs } from './mcp/types'
import type { CoderOutput } from './profiles/coder'
import {
  type AgentRunSpec,
  type CreateDynamicDriverOptions,
  createDynamicDriver,
  type DynamicDecision,
  type LoopResult,
  type LoopSandboxClient,
  type OutputAdapter,
  runLoop,
  type TopologyPlanner,
  type Validator,
} from './runtime'

/** @experimental Every delegated-loop mode, for validation + CLI surfaces. */
export const DELEGATED_LOOP_MODES = [
  'code',
  'review',
  'research',
  'audit',
  'self-improve',
  'dynamic',
] as const

/** @experimental */
export type DelegatedLoopMode = (typeof DELEGATED_LOOP_MODES)[number]

/** @experimental Type guard for an untrusted mode string (CLI / config input). */
export function isDelegatedLoopMode(value: unknown): value is DelegatedLoopMode {
  return typeof value === 'string' && (DELEGATED_LOOP_MODES as readonly string[]).includes(value)
}

/** @experimental A pre-configured loop for one mode. Returns the mode's raw
 *  output; the dispatcher wraps it in a {@link DelegatedLoopResult}. */
export type DelegatedLoopRunner<T = unknown> = (signal: AbortSignal) => Promise<T>

/** @experimental Mode → configured runner. Partial: only register the modes a
 *  given product/routine actually uses. */
export type DelegatedLoopRegistry = Partial<Record<DelegatedLoopMode, DelegatedLoopRunner>>

/** @experimental Uniform result — never throws from a registered runner; a
 *  thrown engine becomes `{ ok: false, error }` so a routine can record + move on. */
export interface DelegatedLoopResult<T = unknown> {
  mode: DelegatedLoopMode
  ok: boolean
  output?: T
  error?: string
  durationMs: number
}

/** @experimental */
export interface RunDelegatedLoopOptions {
  signal?: AbortSignal
  /** Clock override for deterministic tests. */
  now?: () => number
}

/**
 * @experimental
 *
 * Dispatch a configured loop by mode. Fails loud (throws `ConfigError`) when no
 * runner is registered for the mode — a routine pointed at an unwired mode is a
 * config bug, not a silent no-op. A runner that throws is captured as
 * `{ ok: false }` so unattended runs record the failure rather than crash.
 */
export async function runDelegatedLoop<T = unknown>(
  mode: DelegatedLoopMode,
  registry: DelegatedLoopRegistry,
  options: RunDelegatedLoopOptions = {},
): Promise<DelegatedLoopResult<T>> {
  const runner = registry[mode] as DelegatedLoopRunner<T> | undefined
  if (!runner) {
    throw new ConfigError(
      `runDelegatedLoop: no runner registered for mode '${mode}' (registered: ${
        Object.keys(registry).join(', ') || 'none'
      })`,
    )
  }
  const now = options.now ?? Date.now
  const signal = options.signal ?? new AbortController().signal
  const start = now()
  try {
    const output = await runner(signal)
    return { mode, ok: true, output, durationMs: now() - start }
  } catch (err) {
    return {
      mode,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: now() - start,
    }
  }
}

/** @experimental Options for the default `code`/`review` runner. */
export interface CoderLoopRunnerOptions {
  sandboxClient: LoopSandboxClient
  /** What to build — the delegate args (goal, repoRoot, variants, config, …). */
  args: DelegateCodeArgs
  /** Adversarial reviewer. REQUIRED for `review` mode (see `reviewLoopRunner`). */
  reviewer?: CoderReviewer
  /** Winner-selection strategy. Default `highest-score`. */
  winnerSelection?: CoderWinnerSelection
  /** Harnesses for `variants > 1` fanout. */
  fanoutHarnesses?: string[]
}

/** @experimental Build a `code`-mode runner over the hardened coder delegate. */
export function coderLoopRunner(options: CoderLoopRunnerOptions): DelegatedLoopRunner<CoderOutput> {
  const delegate = createDefaultCoderDelegate({
    sandboxClient: options.sandboxClient,
    ...(options.reviewer ? { reviewer: options.reviewer } : {}),
    ...(options.winnerSelection ? { winnerSelection: options.winnerSelection } : {}),
    ...(options.fanoutHarnesses ? { fanoutHarnesses: options.fanoutHarnesses } : {}),
  })
  return async (signal) => {
    const ctx: DelegateRunCtx = { signal, report: () => {} }
    return delegate(options.args, ctx)
  }
}

/**
 * @experimental
 *
 * `review` mode = `code` with a REQUIRED reviewer. The gate is the whole point,
 * so the type forces a reviewer (a "review loop" with no reviewer is a code loop).
 */
export function reviewLoopRunner(
  options: CoderLoopRunnerOptions & { reviewer: CoderReviewer },
): DelegatedLoopRunner<CoderOutput> {
  return coderLoopRunner(options)
}

/** @experimental Options for the default `dynamic` runner. */
export interface DynamicLoopRunnerOptions<Task, Output> {
  sandboxClient: LoopSandboxClient
  /** The agent-authored topology planner (sync or async; an async planner is where an LLM call goes). */
  planner: TopologyPlanner<Task, Output>
  task: Task
  output: OutputAdapter<Output>
  validator?: Validator<Output>
  /** Exactly one of `agentRun` / `agentRuns` (runLoop validates). */
  agentRun?: AgentRunSpec<Task>
  agentRuns?: AgentRunSpec<Task>[]
  maxIterations?: number
  maxFanout?: number
  /** Optional trace-analyst hook forwarded to the dynamic driver so the loop runs
   *  `f(trace, findings)` — see `CreateDynamicDriverOptions.analyze`. Caller-side
   *  seam to `runAnalystLoop`; keeps this runner analyst-free. */
  analyze?: CreateDynamicDriverOptions<Task, Output>['analyze']
}

/** @experimental `dynamic` mode — agent-authored topology over `runLoop`. */
export function dynamicLoopRunner<Task, Output>(
  o: DynamicLoopRunnerOptions<Task, Output>,
): DelegatedLoopRunner<LoopResult<Task, Output, DynamicDecision>> {
  return async (signal) =>
    runLoop<Task, Output, DynamicDecision>({
      driver: createDynamicDriver<Task, Output>({
        planner: o.planner,
        ...(o.maxIterations !== undefined ? { maxIterations: o.maxIterations } : {}),
        ...(o.maxFanout !== undefined ? { maxFanout: o.maxFanout } : {}),
        ...(o.analyze ? { analyze: o.analyze } : {}),
      }),
      ...(o.agentRun ? { agentRun: o.agentRun } : {}),
      ...(o.agentRuns ? { agentRuns: o.agentRuns } : {}),
      output: o.output,
      ...(o.validator ? { validator: o.validator } : {}),
      task: o.task,
      ctx: { sandboxClient: o.sandboxClient, signal },
      ...(o.maxIterations !== undefined ? { maxIterations: o.maxIterations } : {}),
    })
}

/** @experimental A fact rejected at the KB gate — surfaced, never dropped. */
export interface VetoedFact {
  candidate: FactCandidate
  vetoedBy?: string
  reason?: string
}

/** @experimental */
export interface ResearchLoopResult {
  /** Facts that passed the fail-closed gate — safe to write to the KB. */
  accepted: FactCandidate[]
  /** Facts the gate vetoed in the final round — escalate, do not silently drop. */
  vetoed: VetoedFact[]
  /** Research rounds actually run. */
  rounds: number
}

/** @experimental Options for the default `research` runner. */
export interface ResearchLoopRunnerOptions {
  /**
   * The research engine (the consumer's web/doc searcher + extractor). Called
   * each round with the prior round's vetoes so it can re-research the gaps.
   * Returns fact candidates carrying their grounding (`verbatimPassage` +
   * `sourceText`).
   */
  research: (round: number, vetoed: VetoedFact[]) => Promise<FactCandidate[]>
  /** Gate config (extra judges, self-artifact kinds, …). The floor is always on. */
  gate?: CreateKbGateOptions
  /** Max research rounds (correct-on-veto remediation). Default 1. */
  maxRounds?: number
}

/**
 * @experimental `research` mode — research-in-a-loop with valid-only KB growth.
 *
 * Each round: research → gate every candidate (fail-closed; passage MUST be in
 * the source) → accept the clean ones → re-research the vetoed ones next round,
 * up to `maxRounds`. Vetoed facts in the final round are RETURNED (escalate,
 * never silently dropped) so the caller audits vs retries.
 */
export function researchLoopRunner(
  o: ResearchLoopRunnerOptions,
): DelegatedLoopRunner<ResearchLoopResult> {
  const gate = createKbGate(o.gate)
  const maxRounds = Math.max(1, Math.trunc(o.maxRounds ?? 1))
  return async (signal) => {
    const accepted: FactCandidate[] = []
    let vetoed: VetoedFact[] = []
    let rounds = 0
    for (let round = 0; round < maxRounds; round += 1) {
      if (signal.aborted) break
      rounds += 1
      const candidates = await o.research(round, vetoed)
      if (candidates.length === 0) break
      vetoed = []
      for (const c of candidates) {
        const v = await gate(c)
        if (v.accepted) accepted.push(c)
        else vetoed.push({ candidate: c, vetoedBy: v.vetoedBy, reason: v.reason })
      }
      if (vetoed.length === 0) break
    }
    return { accepted, vetoed, rounds }
  }
}

/** @experimental `self-improve` mode — agent-eval's one-call closed loop (held-out gated). */
export function selfImproveLoopRunner<TScenario extends Scenario, TArtifact>(
  options: SelfImproveOptions<TScenario, TArtifact>,
): DelegatedLoopRunner<SelfImproveResult<TScenario, TArtifact>> {
  return async () => selfImprove<TScenario, TArtifact>(options)
}

/** @experimental `audit` mode — analyst loop over captured trace/run data. */
export function auditLoopRunner<TProposal = unknown, TEdit = unknown>(
  options: RunAnalystLoopOpts,
): DelegatedLoopRunner<RunAnalystLoopResult<TProposal, TEdit>> {
  return async () => runAnalystLoop<TProposal, TEdit>(options)
}
