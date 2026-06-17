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
 * The `detachedSessionDelegate` here is the built-in SANDBOX-SESSION coder path — the live default
 * `delegate_code` delegate: workers run the in-box harness over a `SandboxClient`. By default it
 * holds the stream; single-variant turns can OPTIONALLY dispatch DETACHED (`driveTurn` ticks) so a
 * durable queue resumes them across an MCP restart — that resume tick is the only part gated behind
 * `MCP_ENABLE_DETACHED_RESUME` (default off) in `bin.ts`, a capability the recursive
 * `Scope`/worktree-CLI leaf has no durable equivalent for yet. For NEW local-repo coding use
 * `worktreeFanout` / `worktreeLoopRunner`. The default researcher delegate is **not** wired in this
 * file — `agent-knowledge` cannot be imported from `agent-runtime` without inducing a cycle.
 * Consumers pass `researcherDelegate` explicitly.
 */

import type { CoderTask } from '../profiles/coder'
import type {
  AgentRunSpec,
  Iteration,
  LoopTraceEmitter,
  Outcome,
  SandboxClient,
  WinnerStrategy,
} from '../runtime'
import { runLoop, selectValidWinner } from '../runtime'
import { composeLoopTraceEmitters } from './delegation-trace'
import {
  type CoderOutput,
  coderOutputAdapter,
  coderRunSpec,
  createCoderValidator,
  multiHarnessCoderFanout,
} from './detached-coder'
import {
  type DetachedTurn,
  detachedTurnEvents,
  formatDetachedSessionRef,
  parseDetachedSessionRef,
  runDetachedTurn,
} from './detached-turn'
import { createSiblingSandboxExecutor, type DelegationExecutor } from './executor'
import type {
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
  /**
   * Detached-run resume key recorded on the queue record at submit time
   * (`formatDetachedSessionRef`). Present only when the submit path requested
   * detached dispatch — its presence is what routes a session-backed delegate
   * onto the `driveTurn` tick path instead of holding a stream.
   */
  detachedSessionRef?: string
  /** Rebind the record's resume key (e.g. once the sandbox id is known). */
  updateDetachedSessionRef?(ref: string): void
  /**
   * Per-delegation trace sink supplied by the queue — loop events emitted
   * here land on the delegation record as a compact span tree. Delegates
   * compose it with their configured OTEL emitter so both sinks observe
   * the same stream.
   */
  traceEmitter?: LoopTraceEmitter
}

/** @experimental The server's coder-profile delegate slot — the closure the queue invokes for a
 *  `delegate_code` task. `detachedSessionDelegate` is the built-in implementation. */
export type CoderDelegate = (args: DelegateCodeArgs, ctx: DelegateRunCtx) => Promise<CoderOutput>

/** @experimental */
export type ResearcherDelegate = (
  args: DelegateResearchArgs,
  ctx: DelegateRunCtx,
) => Promise<ResearchOutputShape>

/**
 * UI-auditor delegate — fully consumer-injected. agent-runtime ships no
 * default factory because the inputs are workspace path + judge function
 * + (optionally) a `SandboxClient`, and the judge is the consumer's
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
  output: CoderOutput,
  task: CoderTask,
  ctx: { signal: AbortSignal },
) => Promise<CoderReview> | CoderReview

/**
 * @experimental Winner-selection strategy among validated (+ reviewed) candidates on the
 * sandbox-session path. The base strategies (`highest-score` / `smallest-diff` /
 * `first-approved`) delegate to the shared `selectValidWinner`; `highest-readiness` is the
 * reviewer-only strategy this path keeps that the generic selector does not express. Default
 * `highest-score`.
 */
export type DetachedWinnerSelection =
  | 'highest-score'
  | 'smallest-diff'
  | 'highest-readiness'
  | 'first-approved'

/** @experimental */
export interface DetachedSessionDelegateOptions {
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
  sandboxClient?: SandboxClient
  /** Backend harness for the single-coder path. Default comes from `coderProfile`. */
  harness?: string
  /** Model override for the single-coder path. */
  model?: string
  /**
   * The worker's authored system prompt (§1.5). Flows onto `coderProfile`'s
   * `profile.prompt.systemPrompt` → through `runLoop` → the executor's `harnessInvocation`, so the
   * harness runs under this stance, not just the default coder prompt. Omit to keep the default.
   */
  systemPrompt?: string
  /** Default `['claude-code', 'codex', 'opencode/zai-coding-plan/glm-5.1']` when variants > 1. */
  fanoutHarnesses?: string[]
  /** Optional per-harness model override for `variants > 1`. */
  fanoutModels?: (string | undefined)[]
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
  winnerSelection?: DetachedWinnerSelection
  /**
   * Loop trace emitter forwarded into every delegated `runLoop`. Wire
   * `createPropagatingTraceEmitter(readTraceContextFromEnv())` here (the bin
   * does) so delegated build-loops export their topology spans to the OTLP /
   * Tangle Intelligence sink when `OTEL_EXPORTER_OTLP_ENDPOINT` is set — and
   * are a cheap no-op when it isn't. Configurable by construction.
   *
   * Detached single-variant turns (taken when `ctx.detachedSessionRef` is set)
   * bypass `runLoop`; `runDetachedTurn` synthesizes a single-iteration loop
   * event stream for them so this emitter observes detached work too.
   */
  traceEmitter?: LoopTraceEmitter
  /** Tick cadence (ms) for the detached single-variant path. Default 5000. */
  detachedTickIntervalMs?: number
  /** Wall-clock cap (ms) forwarded to `driveTurn` for detached turns. */
  detachedWallCapMs?: number
}

/**
 * Build the sandbox-session coder delegate. It drives `runLoop` against the project's
 * sandbox client + coder profile; when `args.variants > 1` it switches to the multi-harness fanout
 * topology.
 *
 * This is the SANDBOX-SESSION coder path: workers run the in-box harness via the
 * `SandboxClient`'s `streamPrompt`, and single-variant turns can dispatch DETACHED
 * (driveTurn ticks) so a durable queue resumes them across an MCP restart — a substrate
 * the recursive worktree-CLI leaf does not yet have a journal-replay equivalent for.
 *
 * For NEW local-repo coding use `worktreeFanout` / `worktreeLoopRunner` (author an `AgentProfile`
 * per harness → `createWorktreeCliExecutor` leaves → `gateOnDeliverable`). This delegate stays as the
 * MCP server's built-in `delegate_code` path; it runs held-stream by default and only its OPTIONAL
 * cross-restart resume (the `driveTurn` tick) is opt-in behind `MCP_ENABLE_DETACHED_RESUME`.
 *
 * @experimental
 */
export function detachedSessionDelegate(options: DetachedSessionDelegateOptions): CoderDelegate {
  const executor = resolveExecutor(options)
  const sandboxClient = executor.client
  const fanoutHarnesses = options.fanoutHarnesses
  const maxConcurrency = options.maxConcurrency ?? 4
  const traceEmitter = options.traceEmitter
  return async (args, ctx) => {
    const task = coderTaskFromArgs(args)
    const variants = Math.max(1, Math.trunc(args.variants ?? 1))
    const loopEmitter = composeLoopTraceEmitters(traceEmitter, ctx.traceEmitter)
    ctx.report({ iteration: 0, phase: 'starting' })
    if (variants <= 1) {
      const agentRunSpec = coderRunSpec({
        ...(options.harness ? { harness: options.harness } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
      })
      const output = coderOutputAdapter
      const validator = createCoderValidator(task)
      // Detached dispatch: one session on one box, driven by `driveTurn` ticks
      // instead of a held stream, so the run survives an MCP-process restart
      // (the resume driver re-attaches via the persisted ref). Only the
      // single-variant path detaches — fanout needs N sessions + winner
      // selection over every candidate, which one resume key cannot express.
      if (ctx.detachedSessionRef !== undefined && ctx.updateDetachedSessionRef) {
        const { sessionId } = parseDetachedSessionRef(ctx.detachedSessionRef)
        const rebind = ctx.updateDetachedSessionRef
        const turn = await runDetachedTurn({
          client: sandboxClient,
          spec: agentRunSpec as AgentRunSpec<unknown>,
          prompt: agentRunSpec.taskToPrompt(task),
          sessionId,
          bindSandbox: (sandboxId) => rebind(formatDetachedSessionRef({ sandboxId, sessionId })),
          signal: ctx.signal,
          report: ctx.report,
          ...(loopEmitter ? { traceEmitter: loopEmitter } : {}),
          ...(executor.placement === 'fleet' ? { placement: 'fleet' as const } : {}),
          ...(options.detachedTickIntervalMs !== undefined
            ? { tickIntervalMs: options.detachedTickIntervalMs }
            : {}),
          ...(options.detachedWallCapMs !== undefined
            ? { wallCapMs: options.detachedWallCapMs }
            : {}),
        })
        const chosen = await settleDetachedCoderTurn(turn, {
          task,
          sessionId,
          signal: ctx.signal,
          ...(options.harness ? { harness: options.harness } : {}),
          ...(options.model ? { model: options.model } : {}),
          ...(options.reviewer ? { reviewer: options.reviewer } : {}),
        })
        ctx.report({ iteration: 1, phase: 'completed' })
        return chosen
      }
      const result = await runLoop({
        driver: singleShotDriver,
        agentRun: agentRunSpec,
        output,
        validator,
        task,
        ctx: {
          sandboxClient,
          signal: ctx.signal,
          ...(loopEmitter ? { traceEmitter: loopEmitter } : {}),
        },
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
    const fanout = multiHarnessCoderFanout({
      ...(fanoutHarnesses && fanoutHarnesses.length > 0
        ? { harnesses: fanoutHarnesses.slice(0, variants) }
        : {}),
      ...(options.fanoutModels ? { models: options.fanoutModels.slice(0, variants) } : {}),
    })
    const agentRuns = fanout.agentRuns.slice(0, variants)
    const result = await runLoop({
      driver: fanout.driver,
      agentRuns,
      output: fanout.output,
      validator: fanout.validator,
      task,
      ctx: {
        sandboxClient,
        signal: ctx.signal,
        ...(loopEmitter ? { traceEmitter: loopEmitter } : {}),
      },
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
  selection: DetachedWinnerSelection
  task: CoderTask
  signal: AbortSignal
}

/** A valid (and, when a reviewer is wired, approved) candidate kept for selection. */
interface EligibleCandidate {
  iter: Iteration<CoderTask, CoderOutput>
  /** Reviewer readiness (defaults to the verdict score when no reviewer ran). */
  readiness: number
}

/**
 * Pick the winning coder candidate from a finished loop's iterations:
 *   1. keep only mechanically-VALID candidates (the validator already gated
 *      tests/typecheck/forbidden/diff/no-op/secrets),
 *   2. if a `reviewer` is wired, keep only those it APPROVES,
 *   3. select among survivors via the shared `selectValidWinner` (base strategies) or, for the
 *      reviewer-only `highest-readiness`, a readiness sort (the one strategy the generic selector
 *      does not express — a documented capability of this sandbox-session path).
 * Returns `undefined` when nothing survives — the delegate fails loud.
 */
async function pickCoderWinner(args: PickCoderWinnerArgs): Promise<CoderOutput | undefined> {
  const eligible: EligibleCandidate[] = []
  for (const iter of args.iterations) {
    if (iter.output === undefined || iter.error || iter.verdict?.valid !== true) continue
    const readiness = iter.verdict.score ?? 0
    if (args.reviewer) {
      const review = await args.reviewer(iter.output, args.task, { signal: args.signal })
      if (!review.approved) continue
      eligible.push({ iter, readiness: review.readiness })
    } else {
      eligible.push({ iter, readiness })
    }
  }
  if (eligible.length === 0) return undefined

  // `highest-readiness` ranks on the reviewer's readiness — a reviewer-only metric the generic
  // valid-only selector does not carry. Ties → earliest iteration.
  if (args.selection === 'highest-readiness') {
    const sorted = [...eligible].sort(
      (a, b) => b.readiness - a.readiness || a.iter.index - b.iter.index,
    )
    return sorted[0]!.iter.output
  }

  // Base strategies route through the SHARED valid-only selector. Wrap each survivor's raw
  // `CoderOutput` in the `Outcome<D>` shape `selectValidWinner` reads, preserving verdict/index.
  const wrapped: Iteration<unknown, Outcome<CoderOutput>>[] = eligible.map(({ iter }) => ({
    ...iter,
    output: { kind: 'done', deliverable: iter.output as CoderOutput },
  }))
  const winner = selectValidWinner<CoderOutput>({
    strategy: baseStrategy(args.selection),
    sizeOf: (o) => o.diffStats.insertions + o.diffStats.deletions,
  })(wrapped)
  const out = winner?.output
  if (!out || out.kind !== 'done') return undefined
  return out.deliverable
}

/** Map the detached-session selection enum onto the shared `WinnerStrategy`. `first-approved`
 *  reduces to `first-valid` over the already-approved set; `smallest-diff` to `smallest-artifact`. */
function baseStrategy(
  selection: Exclude<DetachedWinnerSelection, 'highest-readiness'>,
): WinnerStrategy {
  switch (selection) {
    case 'smallest-diff':
      return 'smallest-artifact'
    case 'first-approved':
      return 'first-valid'
    default:
      return 'highest-score'
  }
}

function noWinnerMessage(reviewer: CoderReviewer | undefined): string {
  return reviewer
    ? 'coder delegate: no candidate passed validation + review'
    : 'coder delegate: no candidate passed validation'
}

/**
 * Canonical `DelegateCodeArgs` → `CoderTask` mapping — the single source for
 * the delegate's live dispatch AND the resume driver's settle/message
 * rebuilding, so a resumed record reproduces exactly the task the original
 * process dispatched.
 *
 * @experimental
 */
export function coderTaskFromArgs(args: DelegateCodeArgs): CoderTask {
  return {
    goal: buildCoderGoal(args),
    repoRoot: args.repoRoot,
    testCmd: args.config?.testCmd,
    typecheckCmd: args.config?.typecheckCmd,
    forbiddenPaths: args.config?.forbiddenPaths,
    maxDiffLines: args.config?.maxDiffLines,
  }
}

/** @experimental */
export interface SettleDetachedCoderTurnOptions {
  task: CoderTask
  /** Session id of the detached turn — used as the synthesized event id. */
  sessionId: string
  signal: AbortSignal
  harness?: string
  model?: string
  /** Same gate as the streaming path: an unapproved candidate cannot win. */
  reviewer?: CoderReviewer
}

/**
 * Settle a completed detached coder turn through the same gate the streaming
 * path applies: parse the terminal payload with the coder output adapter,
 * run the mechanical validator (tests/typecheck/forbidden/diff/no-op/secrets),
 * then the optional reviewer. Throws when nothing survives — a resumed or
 * detached run must not return an unvalidated patch.
 *
 * SCOPE NOTE (detached/resume): the detached `driveTurn`-tick + cross-restart resume path is
 * bound to the `runLoop` + sandbox-session substrate. The recursive `Scope`/worktree-CLI leaf has
 * journal→replay but no driveTurn-over-a-detached-sandbox-session equivalent yet, so resume is NOT
 * advertised on the generic `worktreeFanout` path. This helper (with `coderTaskFromArgs` and
 * `createDriveTurnResumeDriver`) stays as the resume seam `bin.ts` wires for in-flight records.
 *
 * @experimental
 */
export async function settleDetachedCoderTurn(
  turn: DetachedTurn,
  options: SettleDetachedCoderTurnOptions,
): Promise<CoderOutput> {
  const parsed = coderOutputAdapter.parse(detachedTurnEvents(options.sessionId, turn))
  const validator = createCoderValidator(options.task)
  const verdict = await validator.validate(parsed, { iteration: 0, signal: options.signal })
  if (verdict.valid !== true) throw new Error(noWinnerMessage(options.reviewer))
  if (options.reviewer) {
    const review = await options.reviewer(parsed, options.task, { signal: options.signal })
    if (!review.approved) throw new Error(noWinnerMessage(options.reviewer))
  }
  return parsed
}

function buildCoderGoal(args: DelegateCodeArgs): string {
  if (!args.contextHint) return args.goal
  return [args.goal, '', '## Context', args.contextHint].join('\n')
}

function resolveExecutor(options: DetachedSessionDelegateOptions): DelegationExecutor {
  if (options.executor && options.sandboxClient) {
    throw new Error('detachedSessionDelegate: pass exactly one of `executor` or `sandboxClient`')
  }
  if (options.executor) return options.executor
  if (options.sandboxClient) {
    return createSiblingSandboxExecutor({ client: options.sandboxClient })
  }
  throw new Error('detachedSessionDelegate: `executor` or `sandboxClient` is required')
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
