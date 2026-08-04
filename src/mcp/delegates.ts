/**
 *
 * `detachedSessionDelegate` — the sandbox-session coder delegate: a closure that drives `runAgentRounds`
 * against a `SandboxClient` + a caller-supplied exact worker profile, to a
 * mechanically-validated `CoderOutput`. The caller invokes the returned delegate directly with its
 * coder args; when wired into a durable queue it also settles cross-restart-resumed records.
 *
 * Delegation vs COORDINATION (`../runtime/supervise/coordination-mcp.ts`): this delegate runs a
 * coding task INSIDE the agent's OWN sandbox environment — a sibling box on its own `SandboxClient`,
 * fresh branch on its repo. It is NOT backend-pluggable. To instead SPAWN + live-drive workers in a
 * CHOSEN backend (sandbox OR cli-bridge, via `createExecutor({ backend })`) with observe/steer/resume
 * + recursion, use `delegate()` / the coordination MCP.
 *
 * The worker profile is a parameter the caller supplies (§1.5: the system authors profiles).
 * For NEW local-repo coding use `worktreeFanout` / `worktreeLoopRunner`
 * (author one `AgentProfile` per harness → `createWorktreeCliExecutor` leaves → `gateOnDeliverable`).
 *
 * @experimental
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { ConfigError } from '../errors'
import type { CoderTask } from '../profiles/coder'
import type {
  AgentRunSpec,
  Iteration,
  LoopTraceEmitter,
  Outcome,
  SandboxClient,
  WinnerStrategy,
} from '../runtime'
import { runAgentRounds, selectValidWinner } from '../runtime'
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
  DelegateUiAuditArgs,
  DelegationProgress,
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

/** @experimental The coder delegate closure — given the coder args + run context, drives the
 *  sandbox-session coder path to a validated `CoderOutput`. `detachedSessionDelegate` is the
 *  built-in implementation; the queue invokes one of these per coder delegation. */
export type CoderDelegate = (args: DelegateCodeArgs, ctx: DelegateRunCtx) => Promise<CoderOutput>

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
 *
 * Optional adversarial reviewer over a coder candidate that already passed
 * mechanical validation (tests/typecheck/forbidden/diff/no-op/secrets). Folded
 * from the ai-trading-blueprint delegation MCP: a candidate is only eligible to
 * win if the reviewer approves it. The reviewer is the consumer's seam — an LLM
 * judge, a `pnpm review` command, anything returning a `CoderReview`.
 *
 * @experimental
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
  /**
   * The worker's exact authored `AgentProfile` (§1.5: the system authors profiles). It is the sole
   * harness/provider/model/prompt authority for the single-coder path and the default identity for
   * repeated fanout shots.
   */
  workerProfile: AgentProfile
  /** Optional exact identities for heterogeneous fanout. Omit to repeat `workerProfile`. */
  fanoutProfiles?: ReadonlyArray<AgentProfile>
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
   * Loop trace emitter forwarded into every delegated `runAgentRounds`. Wire
   * `createPropagatingTraceEmitter(readTraceContextFromEnv())` here (the bin
   * does) so delegated build-loops export their topology spans to the OTLP /
   * Tangle Intelligence sink when `OTEL_EXPORTER_OTLP_ENDPOINT` is set — and
   * are a cheap no-op when it isn't. Configurable by construction.
   *
   * Detached single-variant turns (taken when `ctx.detachedSessionRef` is set)
   * bypass `runAgentRounds`; `runDetachedTurn` synthesizes a single-iteration loop
   * event stream for them so this emitter observes detached work too.
   */
  traceEmitter?: LoopTraceEmitter
  /** Tick cadence (ms) for the detached single-variant path. Default 5000. */
  detachedTickIntervalMs?: number
  /** Wall-clock cap (ms) forwarded to `driveTurn` for detached turns. */
  detachedWallCapMs?: number
}

/**
 * Build the sandbox-session coder delegate. It drives `runAgentRounds` against the project's
 * sandbox client + coder profile; when `args.variants > 1` it switches to the multi-harness fanout
 * topology.
 *
 * This is the SANDBOX-SESSION coder path: workers run the in-box harness via the
 * `SandboxClient`'s `streamPrompt`, and single-variant turns can dispatch DETACHED
 * (driveTurn ticks) so a durable queue resumes them across an MCP restart — a substrate
 * the recursive worktree-CLI leaf does not yet have a journal-replay equivalent for.
 *
 * For NEW local-repo coding use `worktreeFanout` / `worktreeLoopRunner` (author an `AgentProfile`
 * per harness → `createWorktreeCliExecutor` leaves → `gateOnDeliverable`). This delegate runs
 * held-stream by default and only its OPTIONAL cross-restart resume (the `driveTurn` tick) is opt-in
 * behind `MCP_ENABLE_DETACHED_RESUME`.
 *
 * @experimental
 */
export function detachedSessionDelegate(options: DetachedSessionDelegateOptions): CoderDelegate {
  if (!options.workerProfile) {
    throw new ConfigError('detachedSessionDelegate: workerProfile is required')
  }
  const workerProfile = coderRunSpec({ profile: options.workerProfile }).profile
  const fanoutProfiles = options.fanoutProfiles?.map((profile) => coderRunSpec({ profile }).profile)
  if (fanoutProfiles?.length === 0) {
    throw new ConfigError('detachedSessionDelegate: fanoutProfiles must not be empty')
  }
  const executor = resolveExecutor(options)
  const sandboxClient = executor.client
  const maxConcurrency = options.maxConcurrency ?? 4
  const traceEmitter = options.traceEmitter
  return async (args, ctx) => {
    const task = coderTaskFromArgs(args)
    const variants = Math.max(1, Math.trunc(args.variants ?? 1))
    const selectedFanoutProfiles =
      variants <= 1
        ? undefined
        : (fanoutProfiles ?? Array.from({ length: variants }, () => workerProfile))
    if (selectedFanoutProfiles && selectedFanoutProfiles.length < variants) {
      throw new ConfigError(
        `detachedSessionDelegate: ${variants} variants requested but only ${selectedFanoutProfiles.length} exact fanout profiles were configured`,
      )
    }
    const loopEmitter = composeLoopTraceEmitters(traceEmitter, ctx.traceEmitter)
    ctx.report({ iteration: 0, phase: 'starting' })
    if (variants <= 1) {
      const agentRunSpec = coderRunSpec({ profile: workerProfile })
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
          ...(options.reviewer ? { reviewer: options.reviewer } : {}),
        })
        ctx.report({ iteration: 1, phase: 'completed' })
        return chosen
      }
      const result = await runAgentRounds({
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
      profiles: selectedFanoutProfiles!.slice(0, variants),
    })
    const agentRuns = fanout.agentRuns.slice(0, variants)
    const result = await runAgentRounds({
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
  if (out?.kind !== 'done') return undefined
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
 * bound to the `runAgentRounds` + sandbox-session substrate. The recursive `Scope`/worktree-CLI leaf has
 * journal→replay but no driveTurn-over-a-detached-sandbox-session equivalent yet, so resume is NOT
 * advertised on the generic `worktreeFanout` path. This helper (with `coderTaskFromArgs` and
 * `createDetachedTurnResumeDriver`) stays as the resume seam `bin.ts` wires for in-flight records.
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
 * runAgentRounds kernel-level accounting (timing, cost, trace emission) while
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
