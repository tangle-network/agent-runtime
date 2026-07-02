/**
 *
 * `runDelegatedLoop` — the configured delegated loop-runner.
 *
 * One typed entrypoint a worker agent (or a scheduled routine) calls to run a
 * disciplined loop in a chosen MODE, over agent-runtime's hardened engines:
 *
 *   code         → build-in-a-loop on the GENERIC recursive path (worktreeLoopRunner: author one
 *                  `AgentProfile` per harness → worktree-CLI leaves → `patchDelivered` gate)
 *   review       → caller-registered runner — a `code` runner with an approval gate over candidates
 *   research     → research-in-a-loop with valid-only KB growth (createKbGate)
 *   audit        → analyze trace/run data → findings (runAnalystLoop, caller-wired)
 *   self-improve → closed-loop text/config optimization (selfImprove, held-out gated)
 *
 * It is intentionally a thin façade: the value is that EVERY product reuses the
 * one hardened engine instead of forking delegation logic. The dispatcher owns
 * mode routing, timing, fail-loud on an unregistered mode, and a uniform result
 * shape; each mode's engine is a pre-configured runner in the registry (build it
 * with the factories below, or inject your own / a stub).
 *
 * @experimental
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
import { type CreateKbGateOptions, createKbGate, type FactCandidate } from './mcp/kb-gate'
import {
  type AuthoredHarness,
  type Budget,
  createExecutorRegistry,
  definePersona,
  runPersonified,
  type WinnerStrategy,
  type WorktreeFanoutOptions,
  type WorktreePatchArtifact,
  worktreeFanout,
} from './runtime'

/** @experimental Every delegated-loop mode, for validation + CLI surfaces. */
export const DELEGATED_LOOP_MODES = ['code', 'review', 'research', 'audit', 'self-improve'] as const

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
 *
 * Dispatch a configured loop by mode. Fails loud (throws `ConfigError`) when no
 * runner is registered for the mode — a routine pointed at an unwired mode is a
 * config bug, not a silent no-op. A runner that throws is captured as
 * `{ ok: false }` so unattended runs record the failure rather than crash.
 *
 * @experimental
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

/** @experimental Options for the local-repo `code` runner over the GENERIC recursive path. */
export interface WorktreeLoopRunnerOptions {
  /** Absolute path to the local git checkout each worktree is cut from. */
  repoRoot: string
  /** The instruction handed to every authored harness (composed under each profile's systemPrompt). */
  taskPrompt: string
  /** The supervisor-authored harness profiles — one fanout item (one worktree-CLI leaf) each. */
  harnesses: ReadonlyArray<AuthoredHarness>
  /** Conserved budget pool bounding the fanout (equal-k holds by construction). */
  budget: Budget
  /** Shell command run in each worktree to derive the tests-PASS signal. */
  testCmd?: string
  /** Shell command run in each worktree to derive the typecheck-PASS signal. */
  typecheckCmd?: string
  /** Which verification signals the deliverable REQUIRES present-and-passing (default none). */
  require?: ReadonlyArray<'tests' | 'typecheck'>
  /** Diff-size cap (lines). */
  maxDiffLines?: number
  /** Literal path prefixes the patch must not touch (the secret-floor is always on regardless). */
  forbiddenPaths?: string[]
  /** Winner-selection strategy among gated candidates. Default `highest-score`. */
  winnerStrategy?: WinnerStrategy
  /** Test seams forwarded to the worktree-CLI leaves so the runner drives offline. */
  runGit?: WorktreeFanoutOptions['runGit']
  runHarness?: WorktreeFanoutOptions['runHarness']
  runCommand?: WorktreeFanoutOptions['runCommand']
}

/**
 *
 * `code` mode on the GENERIC recursive path: author one `AgentProfile` per harness, run them as a
 * `worktreeFanout` (N `createWorktreeCliExecutor` leaves, each `gateOnDeliverable`) through
 * `runPersonified` on the keystone Supervisor. The sandbox-session counterpart that drives the in-box
 * harness over a `SandboxClient` is `detachedSessionDelegate` (`./mcp/delegates`); here there is no
 * `runLoop` driver, no role-coupled delegate — the harness list is the fanout, the gate is
 * `patchDelivered`,
 * the winner is the shared valid-only selector (NOT `defaultSelectWinner`, whose non-valid fallback
 * would surface an ungated patch). Equal-k holds by the conserved budget pool. Returns the winning
 * patch artifact, or throws when no candidate is delivered (fail loud, never a vacuous done).
 *
 * @experimental
 */
export function worktreeLoopRunner(
  options: WorktreeLoopRunnerOptions,
): DelegatedLoopRunner<WorktreePatchArtifact> {
  const shape = worktreeFanout<string>({
    repoRoot: options.repoRoot,
    taskPrompt: options.taskPrompt,
    harnesses: options.harnesses,
    ...(options.testCmd !== undefined ? { testCmd: options.testCmd } : {}),
    ...(options.typecheckCmd !== undefined ? { typecheckCmd: options.typecheckCmd } : {}),
    ...(options.require !== undefined ? { require: options.require } : {}),
    ...(options.maxDiffLines !== undefined ? { maxDiffLines: options.maxDiffLines } : {}),
    ...(options.forbiddenPaths !== undefined ? { forbiddenPaths: options.forbiddenPaths } : {}),
    ...(options.winnerStrategy !== undefined ? { winnerStrategy: options.winnerStrategy } : {}),
    ...(options.runGit ? { runGit: options.runGit } : {}),
    ...(options.runHarness ? { runHarness: options.runHarness } : {}),
    ...(options.runCommand ? { runCommand: options.runCommand } : {}),
  })
  // The persona's only role here is to carry the fanout shape onto the Supervisor; each item's
  // executor is BYO (the gated worktree-CLI leaf), so the registry only needs to pass BYO through.
  const persona = definePersona<WorktreePatchArtifact>({
    name: 'worktree-coder',
    root: { profile: { name: 'worktree-coder' }, harness: null },
    directive: 'deliver a minimal validated patch on a fresh worktree',
    context: { role: 'coder' },
    executors: { registry: createExecutorRegistry() },
  })
  return async (signal) => {
    const result = await runPersonified<string, WorktreePatchArtifact>({
      persona,
      shape,
      task: options.taskPrompt,
      budget: options.budget,
      signal,
    })
    if (result.kind !== 'winner' || result.out.kind !== 'done') {
      const blockers =
        result.kind === 'winner' && result.out.kind === 'blocked'
          ? result.out.blockers.join('; ')
          : `supervisor settled ${result.kind}`
      throw new Error(`worktreeLoopRunner: no delivered patch (${blockers})`)
    }
    return result.out.deliverable
  }
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
 * `research` mode — research-in-a-loop with valid-only KB growth.
 *
 * Each round: research → gate every candidate (fail-closed; passage MUST be in
 * the source) → accept the clean ones → re-research the vetoed ones next round,
 * up to `maxRounds`. Vetoed facts in the final round are RETURNED (escalate,
 * never silently dropped) so the caller audits vs retries.
 *
 * @experimental
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

/**
 * `self-improve` mode — agent-eval's one-call closed improvement loop (held-out gated).
 *
 * @experimental
 */
export function selfImproveLoopRunner<TScenario extends Scenario, TArtifact>(
  options: SelfImproveOptions<TScenario, TArtifact>,
): DelegatedLoopRunner<SelfImproveResult<TScenario, TArtifact>> {
  return async () => selfImprove<TScenario, TArtifact>(options)
}

/**
 * `audit` mode — analyst loop over captured trace/run data.
 *
 * @experimental
 */
export function auditLoopRunner<TProposal = unknown, TEdit = unknown>(
  options: RunAnalystLoopOpts,
): DelegatedLoopRunner<RunAnalystLoopResult<TProposal, TEdit>> {
  return async () => runAnalystLoop<TProposal, TEdit>(options)
}
