/**
 * @experimental
 *
 * Delegate factories — the layer between MCP tool handlers and the
 * underlying `runLoop` runners.
 *
 * The MCP server is profile-agnostic: it owns the task queue + feedback
 * store + transport. Each `*Delegate` is the closure that the queue
 * invokes when a task runs. Consumers can override either delegate to
 * inject custom drivers, mocks, fleet-aware dispatchers, etc.
 *
 * The default coder delegate is wired here because we own
 * `coderProfile` / `multiHarnessCoderFanout`. The default researcher
 * delegate is **not** wired in this file — `agent-knowledge` cannot be
 * imported from `agent-runtime` without inducing a cycle. Consumers
 * pass `researcherDelegate` explicitly when constructing the server.
 */

import { type CoderOutput, coderProfile, multiHarnessCoderFanout } from '../profiles/coder'
import type { Iteration, LoopSandboxClient, LoopTraceEmitter } from '../runtime'
import { runLoop } from '../runtime'
import { createSiblingSandboxExecutor, type DelegationExecutor } from './executor'
import type {
  CoderTask,
  DelegateCodeArgs,
  DelegateResearchArgs,
  DelegateUiAuditArgs,
  DelegationProgress,
  ResearchOutputShape,
  UiAuditorDelegationOutput,
} from './types'

/** @experimental */
export interface DelegateRunCtx {
  signal: AbortSignal
  report(progress: DelegationProgress): void
}

/** @experimental */
export type CoderDelegate = (
  args: DelegateCodeArgs,
  ctx: DelegateRunCtx,
) => Promise<import('../profiles/coder').CoderOutput>

/** @experimental */
export type ResearcherDelegate = (
  args: DelegateResearchArgs,
  ctx: DelegateRunCtx,
) => Promise<ResearchOutputShape>

/**
 * UI-auditor delegate — fully consumer-injected. agent-runtime ships no
 * default factory because the inputs are workspace path + judge function
 * + (optionally) a `LoopSandboxClient`, and the judge is the consumer's
 * model seam. See `createInProcessUiAuditClient` + `uiAuditorProfile` in
 * `@tangle-network/agent-runtime/profiles` for the canonical wiring.
 *
 * @experimental
 */
export type UiAuditorDelegate = (
  args: DelegateUiAuditArgs,
  ctx: DelegateRunCtx,
) => Promise<UiAuditorDelegationOutput>

/** @experimental Structured review verdict over a coder candidate. */
export interface CoderReview {
  /** Gate: only approved candidates are eligible to win. */
  approved: boolean
  /** Reviewer's recommendation — surfaced in traces. */
  recommendation: 'ship' | 'approve-with-nits' | 'changes-requested' | 'reject'
  /** Readiness 0..1, used by the `highest-readiness` winner-selection strategy. */
  readiness: number
  notes?: string
}

/**
 * @experimental
 *
 * Optional adversarial reviewer over a coder candidate that already passed
 * mechanical validation (tests/typecheck/forbidden/diff/no-op/secrets). Folded
 * from the ai-trading-blueprint delegation MCP: a candidate is only eligible to
 * win if the reviewer approves it. The reviewer is the consumer's seam — an LLM
 * judge, a `pnpm review` command, anything returning a `CoderReview`.
 */
export type CoderReviewer = (
  output: import('../profiles/coder').CoderOutput,
  task: CoderTask,
  ctx: { signal: AbortSignal },
) => Promise<CoderReview> | CoderReview

/**
 * @experimental Winner-selection strategy among validated (+ reviewed)
 * candidates. `highest-readiness` requires a `reviewer`. Default `highest-score`
 * (the kernel's behavior — preserves backward compatibility).
 */
export type CoderWinnerSelection =
  | 'highest-score'
  | 'smallest-diff'
  | 'highest-readiness'
  | 'first-approved'

/** @experimental */
export interface CreateDefaultCoderDelegateOptions {
  /**
   * Execution placement. Pass a {@link DelegationExecutor} (sibling or fleet)
   * to control where worker iterations land. `sandboxClient` is a
   * convenience shorthand that wraps the client in a sibling executor — pass
   * one or the other, not both.
   */
  executor?: DelegationExecutor
  /**
   * Convenience shorthand for sibling placement. Equivalent to
   * `executor: createSiblingSandboxExecutor({ client: sandboxClient })`.
   */
  sandboxClient?: LoopSandboxClient
  /** Default `['claude-code', 'codex', 'opencode/zai-coding-plan/glm-5.1']` when variants > 1. */
  fanoutHarnesses?: string[]
  /** Hard cap on the kernel's per-batch concurrency. Default 4. */
  maxConcurrency?: number
  /**
   * Optional adversarial reviewer. When set, a candidate must pass mechanical
   * validation AND `reviewer.approved` to be eligible to win — empty/secret/
   * test-failing patches are already gone; this catches the "compiles + passes
   * but wrong/unsafe" class the deterministic validator can't see.
   */
  reviewer?: CoderReviewer
  /** Winner-selection strategy among eligible candidates. Default `highest-score`. */
  winnerSelection?: CoderWinnerSelection
  /**
   * Loop trace emitter forwarded into every delegated `runLoop`. Wire
   * `createPropagatingTraceEmitter(readTraceContextFromEnv())` here (the bin
   * does) so delegated build-loops export their topology spans to the OTLP /
   * Tangle Intelligence sink when `OTEL_EXPORTER_OTLP_ENDPOINT` is set — and
   * are a cheap no-op when it isn't. Configurable by construction.
   */
  traceEmitter?: LoopTraceEmitter
}

/**
 * Build a coder delegate that drives `runLoop` against the project's
 * sandbox client + coder profile. When `args.variants > 1` it switches
 * to the multi-harness fanout topology.
 *
 * @experimental
 */
export function createDefaultCoderDelegate(
  options: CreateDefaultCoderDelegateOptions,
): CoderDelegate {
  const executor = resolveExecutor(options)
  const sandboxClient = executor.client
  const fanoutHarnesses = options.fanoutHarnesses
  const maxConcurrency = options.maxConcurrency ?? 4
  const traceEmitter = options.traceEmitter
  return async (args, ctx) => {
    const task: CoderTask = {
      goal: buildCoderGoal(args),
      repoRoot: args.repoRoot,
      testCmd: args.config?.testCmd,
      typecheckCmd: args.config?.typecheckCmd,
      forbiddenPaths: args.config?.forbiddenPaths,
      maxDiffLines: args.config?.maxDiffLines,
    }
    const variants = Math.max(1, Math.trunc(args.variants ?? 1))
    ctx.report({ iteration: 0, phase: 'starting' })
    if (variants <= 1) {
      const { agentRunSpec, output, validator } = coderProfile({ task })
      const result = await runLoop({
        driver: singleShotDriver,
        agentRun: agentRunSpec,
        output,
        validator,
        task,
        ctx: { sandboxClient, signal: ctx.signal, ...(traceEmitter ? { traceEmitter } : {}) },
        maxIterations: 1,
        maxConcurrency,
      })
      const chosen = await pickCoderWinner({
        iterations: result.iterations,
        reviewer: options.reviewer,
        selection: options.winnerSelection ?? 'highest-score',
        task,
        signal: ctx.signal,
      })
      if (!chosen) throw new Error(noWinnerMessage(options.reviewer))
      ctx.report({ iteration: 1, phase: 'completed' })
      return chosen
    }
    const fanout = multiHarnessCoderFanout(
      fanoutHarnesses && fanoutHarnesses.length > 0
        ? { harnesses: fanoutHarnesses.slice(0, variants) }
        : { harnesses: undefined },
    )
    const agentRuns = fanout.agentRuns.slice(0, variants)
    const result = await runLoop({
      driver: fanout.driver,
      agentRuns,
      output: fanout.output,
      validator: fanout.validator,
      task,
      ctx: { sandboxClient, signal: ctx.signal, ...(traceEmitter ? { traceEmitter } : {}) },
      maxIterations: variants,
      maxConcurrency: Math.min(maxConcurrency, variants),
    })
    const chosen = await pickCoderWinner({
      iterations: result.iterations,
      reviewer: options.reviewer,
      selection: options.winnerSelection ?? 'highest-score',
      task,
      signal: ctx.signal,
    })
    if (!chosen) throw new Error(noWinnerMessage(options.reviewer))
    ctx.report({ iteration: agentRuns.length, phase: 'completed' })
    return chosen
  }
}

interface PickCoderWinnerArgs {
  iterations: ReadonlyArray<Iteration<CoderTask, CoderOutput>>
  reviewer: CoderReviewer | undefined
  selection: CoderWinnerSelection
  task: CoderTask
  signal: AbortSignal
}

interface CoderCandidate {
  index: number
  output: CoderOutput
  score: number
  readiness: number
}

/**
 * Pick the winning coder candidate from a finished loop's iterations:
 *   1. keep only mechanically-VALID candidates (the validator already gated
 *      tests/typecheck/forbidden/diff/no-op/secrets),
 *   2. if a `reviewer` is wired, keep only those it APPROVES,
 *   3. select among survivors by the chosen strategy.
 * Returns `undefined` when nothing survives — the delegate fails loud.
 */
async function pickCoderWinner(args: PickCoderWinnerArgs): Promise<CoderOutput | undefined> {
  const valid: CoderCandidate[] = []
  for (const iter of args.iterations) {
    if (iter.output === undefined || iter.error || iter.verdict?.valid !== true) continue
    valid.push({
      index: iter.index,
      output: iter.output,
      score: iter.verdict.score ?? 0,
      readiness: iter.verdict.score ?? 0,
    })
  }
  if (valid.length === 0) return undefined

  let eligible = valid
  if (args.reviewer) {
    eligible = []
    for (const c of valid) {
      const review = await args.reviewer(c.output, args.task, { signal: args.signal })
      if (review.approved) eligible.push({ ...c, readiness: review.readiness })
    }
    if (eligible.length === 0) return undefined
  }

  return selectCoderCandidate(eligible, args.selection).output
}

/** Apply the winner-selection strategy; ties broken by earliest iteration. */
function selectCoderCandidate(
  candidates: CoderCandidate[],
  selection: CoderWinnerSelection,
): CoderCandidate {
  const diffLines = (c: CoderCandidate) =>
    c.output.diffStats.insertions + c.output.diffStats.deletions
  const sorted = [...candidates].sort((a, b) => {
    switch (selection) {
      case 'smallest-diff':
        return diffLines(a) - diffLines(b) || a.index - b.index
      case 'highest-readiness':
        return b.readiness - a.readiness || a.index - b.index
      case 'first-approved':
        return a.index - b.index
      default:
        return b.score - a.score || a.index - b.index
    }
  })
  return sorted[0]!
}

function noWinnerMessage(reviewer: CoderReviewer | undefined): string {
  return reviewer
    ? 'coder delegate: no candidate passed validation + review'
    : 'coder delegate: no candidate passed validation'
}

function buildCoderGoal(args: DelegateCodeArgs): string {
  if (!args.contextHint) return args.goal
  return [args.goal, '', '## Context', args.contextHint].join('\n')
}

function resolveExecutor(options: CreateDefaultCoderDelegateOptions): DelegationExecutor {
  if (options.executor && options.sandboxClient) {
    throw new Error('createDefaultCoderDelegate: pass exactly one of `executor` or `sandboxClient`')
  }
  if (options.executor) return options.executor
  if (options.sandboxClient) {
    return createSiblingSandboxExecutor({ client: options.sandboxClient })
  }
  throw new Error('createDefaultCoderDelegate: `executor` or `sandboxClient` is required')
}

/**
 * Single-shot driver — plan one task on iteration 0, stop after one
 * iteration. Used by the coder delegate when `variants <= 1`. Keeps the
 * runLoop kernel-level accounting (timing, cost, trace emission) while
 * skipping fanout/refine topology overhead.
 */
const singleShotDriver = {
  name: 'mcp-single-shot',
  async plan<Task>(task: Task, history: ReadonlyArray<unknown>): Promise<Task[]> {
    return history.length === 0 ? [task] : []
  },
  decide(history: ReadonlyArray<unknown>): 'pick-winner' | 'fail' {
    return history.length > 0 ? 'pick-winner' : 'fail'
  },
}
