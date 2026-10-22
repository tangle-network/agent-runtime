/**
 * The STEERABLE sandbox worker: one box, one server-side session, MANY turns, so a driver message
 * has a boundary to be folded into. The default worker (`singleShotDriver`, one `runAgentRounds`
 * shot) had no turn boundary and no `Executor.deliver`, so `steer_agent` reported `delivered:false`
 * on every call. Structure mirrors `streamBridgeSession` so both steerable runtimes share ONE shape:
 *
 *   - turn 0 sends the task through `SandboxLineage.start` (fresh box, minted session id);
 *   - each later turn fires ONLY when the inbox has a steer/answer to fold, through
 *     `SandboxLineage.continue` (same box, same session), so the prompt carries only the new
 *     instruction;
 *   - a worker may not settle while a delivered steer is unread: the loop drains once more before
 *     breaking, which makes `steer_agent` a promise rather than a hint;
 *   - a forceful (`interrupt:true`) steer aborts the in-flight turn so the worker re-plans.
 *
 * It also produces the LIVE signal a supervisor steers FROM: every sandbox event stamps activity,
 * tool parts decode into the shared `ToolSpan` currency for the online detector panel, and
 * `progress()` answers turn / tool / idle / pending-steer questions synchronously. Reports REAL
 * usage only, from the sandbox events themselves.
 *
 * @experimental
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type { BackendType, SandboxEvent } from '@tangle-network/sandbox'
import { createAgentRunOutcomeTracker } from '@tangle-network/sandbox/runtime'
import { ValidationError } from '../../errors'
import { readPromptOptions } from '../prompt-options'
import type { ProviderWorkspaceCaptureReceipt } from '../provider-workspace-retention'
import { assertSandboxServedModel, createSandboxUsageLedger } from '../sandbox-events'
import { createSandboxLineage } from '../sandbox-lineage'
import { projectSandboxOutcome } from '../sandbox-outcome'
import type { AgentRunSpec, ExecCtx, SandboxClient } from '../types'
import { armDeadlineTimer } from './deadline'
import type { Inbox, InboxLease } from './inbox'
import { concreteProfileModel } from './model-policy'
import type { ExecutorProgress } from './progress'
import {
  cancelSandboxSession,
  creditSandboxCall,
  newSandboxSessionRun,
  recordBoxEvent,
  type SandboxSessionRun,
  sandboxSessionOutput,
} from './sandbox-session-run'
import type { TraceSource } from './trace-source'
import type {
  DefaultVerdict,
  ExecutorCancellation,
  ExecutorCancellationRequest,
  Spend,
  UsageEvent,
} from './types'

/** Ceiling on continuation turns (turn 0 is the task, each later turn a folded steer). */
export const DEFAULT_SANDBOX_STEERING_MAX_TURNS = 24

/** Opt-in configuration for the steerable sandbox worker (`SandboxSeam.steering`); absent, the single-shot composition is kept. */
export interface SandboxSteeringOptions {
  /** Max turns for one worker (turn 0 + folded steers). Default {@link DEFAULT_SANDBOX_STEERING_MAX_TURNS}. */
  readonly maxTurns?: number
  /** How many recent tool/turn notes `progress()` reports. Default 12. */
  readonly activityWindow?: number
  /** Per-turn wall-clock ceiling; the turn's stream is aborted when it elapses. */
  readonly turnTimeoutMs?: number
}

/** What the steerable session exposes to its executor: the usage stream plus the live reads. */
export interface SteerableSandboxSession {
  /** Drive the worker to settlement. `signal` is the spawn-scoped abort handed to `execute`. */
  stream(task: unknown, signal: AbortSignal): AsyncIterable<UsageEvent>
  progress(): ExecutorProgress
  /** Ask the box to stop the running execution on this exact session and report what it answered. */
  cancel(request: ExecutorCancellationRequest): Promise<ExecutorCancellation>
  traceSource(): TraceSource
  artifact(): { outRef: string; out: unknown; verdict?: DefaultVerdict; spent: Spend } | undefined
  /** Same output projection used at capture and terminal publication. */
  output(): unknown
  teardown(): Promise<void>
}

export interface SteerableSandboxArgs {
  readonly controller: AbortController
  readonly profile: AgentProfile
  readonly harness: BackendType
  readonly sandboxClient: SandboxClient
  /** Require capture failures at box cleanup to fail the supervised worker. */
  readonly failOnDestroyError?: boolean
  readonly workspaceCaptures?: () => ReadonlyArray<ProviderWorkspaceCaptureReceipt>
  readonly inbox: Inbox
  readonly taskToPrompt: (task: unknown) => string
  readonly options?: SandboxSteeringOptions
  readonly loopCtx?: Partial<Omit<ExecCtx, 'sandboxClient' | 'signal'>>
  /** Inherited `TRACE_ID` / `PARENT_SPAN_ID`, merged into `CreateSandboxOptions.env` so the
   *  worker's spans join the supervisor's trace. Absent when the run records no spans. */
  readonly traceEnv?: Record<string, string>
  readonly contentRef: (prefix: string, value: unknown) => string
  readonly now?: () => number
}

/** One steerable sandbox worker. The returned session is inert until `stream()` is drained. */
export function createSteerableSandboxSession(args: SteerableSandboxArgs): SteerableSandboxSession {
  const maxTurns = args.options?.maxTurns ?? DEFAULT_SANDBOX_STEERING_MAX_TURNS
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 0) {
    throw new ValidationError(
      'steerable sandbox worker: maxTurns must be a nonnegative safe integer (0 means unbounded)',
    )
  }
  const run = newSandboxSessionRun(args)
  return {
    stream: (task, signal) => streamSession(run, maxTurns, task, signal),
    output() {
      if (!run.outputReady) throw new ValidationError('sandbox output read before execution')
      return sandboxSessionOutput(run)
    },
    cancel: (request: ExecutorCancellationRequest) => cancelSandboxSession(run, request),
    progress: (): ExecutorProgress => ({
      turns: run.turns,
      pendingMessages: args.inbox.pending(),
      recentActivity: run.activity.read(),
      note: run.note,
    }),
    traceSource: () => run.trace.source,
    artifact: () => run.artifact,
    async teardown() {
      if (args.failOnDestroyError) await run.teardown?.()
      else await run.teardown?.().catch(() => {})
    },
  }
}

/** What every turn of one session shares: its lineage, spec, requested model and usage ledger. */
interface SessionTurns {
  readonly run: SandboxSessionRun
  readonly lineage: ReturnType<typeof createSandboxLineage>
  readonly spec: AgentRunSpec<unknown>
  readonly promptOptions: ReturnType<typeof readPromptOptions>
  readonly requested: { provider?: string; model?: string }
  readonly usageLedger: ReturnType<typeof createSandboxUsageLedger>
  readonly signal: AbortSignal
}

async function* streamSession(
  run: SandboxSessionRun,
  maxTurns: number,
  task: unknown,
  signal: AbortSignal,
): AsyncIterable<UsageEvent> {
  const { args, now } = run
  let preservationError: unknown
  let executionFailure: unknown
  const lineage = createSandboxLineage(args.sandboxClient, {
    maxConcurrency: 1,
    failOnDestroyError: args.failOnDestroyError,
  })
  run.teardown = () => lineage.teardown()

  const spec: AgentRunSpec<unknown> = {
    profile: args.profile,
    taskToPrompt: args.taskToPrompt,
    name: args.profile.name ?? String(args.harness),
    sandboxOverrides: {
      backend: { type: args.harness },
      ...(args.traceEnv && Object.keys(args.traceEnv).length > 0 ? { env: args.traceEnv } : {}),
    },
  }
  const promptOptions = readPromptOptions(
    args.loopCtx?.promptOptions,
    'steerable sandbox worker: loopCtx.promptOptions',
  )
  // The exact instrument every turn of this session asks the box for (agent-runtime#892).
  const requestedModel = concreteProfileModel(args.profile)
  const requested = {
    ...(args.profile.model?.provider !== undefined
      ? { provider: args.profile.model.provider }
      : {}),
    ...(requestedModel !== undefined ? { model: requestedModel } : {}),
  }

  const started = now()
  let nextPrompt: string | undefined = args.taskToPrompt(task)
  // One ledger per session: credits canonical usage events and holds the harness receipt until the
  // turn ends, so a turn reporting both is charged once. `settleTurn` resets it per turn.
  const usageLedger = createSandboxUsageLedger(args.harness)
  run.outputReady = true
  const turns: SessionTurns = { run, lineage, spec, promptOptions, requested, usageLedger, signal }

  // The messages this turn's prompt carries, committed once the box streams the turn. A turn
  // that fails or is interrupted before then hands them back to the next prompt.
  let lease: InboxLease | undefined
  try {
    for (let turn = 0; maxTurns === 0 || turn < maxTurns; turn += 1) {
      lease?.release()
      // Take the down-leg FIRST: on turn 0 a steer that landed during acquisition is appended to
      // the task; later the steer IS the whole prompt (context lives server-side).
      const turnLease = args.inbox.take()
      lease = turnLease
      nextPrompt = foldInboxIntoPrompt(run, turnLease, turn, nextPrompt)
      if (nextPrompt === undefined) break

      const prompt = nextPrompt
      nextPrompt = undefined
      run.note = `turn ${turn}`

      const outcome = yield* runSandboxTurn(turns, turn, prompt, turnLease)
      if (outcome === 'replan') continue
      // No settling while a delivered steer is unread (the `steer_agent` contract). Peer mail is
      // excluded: a sibling must not deny a finished worker settlement by keeping mail in flight.
      if (args.inbox.pendingAuthority() === 0) break
    }
  } catch (error) {
    executionFailure = error
    lease?.release()
    throw error
  } finally {
    run.note = 'settled'
    if (args.failOnDestroyError) {
      try {
        await lineage.teardown()
        run.teardown = undefined
      } catch (error) {
        run.preservationFailure = error instanceof Error ? error.message : String(error)
        preservationError = error
        if (executionFailure instanceof Error) {
          Object.assign(executionFailure, { cause: executionFailure.cause ?? error })
        }
      }
    } else {
      await lineage.teardown().catch(() => {})
      run.teardown = undefined
    }
  }

  if (run.preservationFailure !== undefined) throw preservationError

  // Mark the dollar channel unknown even when no event carried a numeric subtotal: a completed
  // sandbox turn is not proof that the provider billed exactly zero.
  if (run.turns > 0) {
    yield { kind: 'cost', usd: 0, usdKnown: false, provenance: 'uncaptured' }
  }
  publishSessionArtifact(run, started)
}

/** Fold the messages the inbox holds into the next prompt, noting the fold in the activity window. */
function foldInboxIntoPrompt(
  run: SandboxSessionRun,
  turnLease: InboxLease,
  turn: number,
  nextPrompt: string | undefined,
): string | undefined {
  const pending = turnLease.messages
  if (pending.length === 0) return nextPrompt
  const folded = run.args.inbox.fold(pending)
  const peerCount = pending.filter((m) => m.kind === 'mail').length
  run.activity.push({
    at: run.now(),
    kind: 'note',
    // Split the label by authority class: peer mail folded into a turn is not a steer.
    label: peerCount === pending.length ? 'peer-mail-folded' : 'steer-folded',
    detail:
      peerCount === 0
        ? `${pending.length} message(s)`
        : `${pending.length} message(s), ${peerCount} peer`,
  })
  return turn === 0 && nextPrompt ? `${nextPrompt}\n\n${folded}` : folded
}

/**
 * One turn's abort: the spawn signal, the executor's controller, a forceful steer, or the turn
 * deadline. `cleanup` detaches every listener.
 */
function openTurnAbort(run: SandboxSessionRun, signal: AbortSignal) {
  const { args } = run
  const interruptSig = args.inbox.freshInterrupt()
  const turnController = new AbortController()
  const abortTurn = () => turnController.abort()
  if (signal.aborted || args.controller.signal.aborted) turnController.abort()
  else {
    signal.addEventListener('abort', abortTurn)
    args.controller.signal.addEventListener('abort', abortTurn)
  }
  interruptSig.addEventListener('abort', abortTurn, { once: true })
  const clearTimer = args.options?.turnTimeoutMs
    ? armDeadlineTimer(args.options.turnTimeoutMs, abortTurn, true)
    : undefined
  const cleanup = () => {
    signal.removeEventListener('abort', abortTurn)
    args.controller.signal.removeEventListener('abort', abortTurn)
    interruptSig.removeEventListener('abort', abortTurn)
    clearTimer?.()
  }
  return { interruptSig, turnController, cleanup }
}

/** Stream one turn through the lineage: `'replan'` when a forceful steer ended it, else `'ran'`. */
async function* runSandboxTurn(
  turns: SessionTurns,
  turn: number,
  prompt: string,
  turnLease: InboxLease,
): AsyncGenerator<UsageEvent, 'replan' | 'ran'> {
  const { run, lineage, spec, promptOptions, requested, usageLedger, signal } = turns
  const { args } = run
  const callerName = spec.name ?? String(args.harness)
  const { interruptSig, turnController, cleanup } = openTurnAbort(run, signal)
  let events: AsyncIterable<SandboxEvent>
  let sawLlmCall = false
  const outcomeTracker = createAgentRunOutcomeTracker()
  try {
    if (!run.handle) {
      const opened = await lineage.start(spec, prompt, turnController.signal, promptOptions)
      run.handle = opened.handle
      events = opened.events
    } else {
      events = await lineage.continue(run.handle, prompt, turnController.signal, promptOptions)
    }
    for await (const event of events) {
      // The box streamed this turn, so its prompt reached the session.
      if (run.handle) {
        for (const message of turnLease.messages) {
          turnLease.commit(`${run.handle.sessionId}#turn-${turn}`, message.id)
        }
      }
      outcomeTracker.observe(event)
      for (const progress of recordBoxEvent(run, event)) yield { kind: 'progress', progress }
      const call = usageLedger.observe(event, callerName)
      if (call) {
        sawLlmCall = true
        yield* creditSandboxCall(run, call)
      }
      assertSandboxServedModel(event, requested)
    }
    const harnessCall = usageLedger.settleTurn(callerName)
    if (harnessCall) {
      sawLlmCall = true
      yield* creditSandboxCall(run, harnessCall)
    }
    run.latestOutcome = outcomeTracker.finish()
  } catch (e) {
    cleanup()
    // A forceful steer ends the turn mid-stream; the receipt already reported is credited anyway.
    const abortedCall = usageLedger.settleTurn(callerName)
    if (abortedCall) yield* creditSandboxCall(run, abortedCall)
    // Re-plan ONLY when a forceful steer (not external teardown) aborted the turn: the
    // steer is already queued, so loop back and fold it. Anything else is fatal.
    if (isInterruptAbort(e, interruptSig, signal, args.controller.signal)) {
      run.activity.push({ at: run.now(), kind: 'note', label: 'interrupted', detail: 'replanning' })
      return 'replan'
    }
    throw e
  }
  cleanup()

  if (!sawLlmCall) {
    run.tokensKnown = false
    yield { kind: 'tokens', input: 0, output: 0, tokensKnown: false }
  }

  run.turns += 1
  run.activity.push({ at: run.now(), kind: 'turn', label: `turn ${turn}` })
  yield { kind: 'iteration' }
  return 'ran'
}

function publishSessionArtifact(run: SandboxSessionRun, started: number): void {
  const { turns, usd } = run
  const spent: Spend = {
    iterations: turns,
    tokens: run.tokens,
    ...(run.tokensKnown ? {} : { tokensKnown: false }),
    usd,
    ...(turns > 0 ? { usdKnown: false } : {}),
    // Every dollar came without a receipt, so the estimate channel names all of them; an estimate
    // on a measured channel is a contradiction the pool refuses.
    ...(turns > 0 && usd > 0 ? { usdEstimated: usd } : {}),
    ms: run.now() - started,
  }
  const out = sandboxSessionOutput(run)
  const verdict = run.latestOutcome ? projectSandboxOutcome(run.latestOutcome).verdict : undefined
  run.artifact = {
    outRef: run.args.contentRef('sandbox-steerable', { harness: run.args.harness, out }),
    out,
    ...(verdict ? { verdict } : {}),
    spent,
  }
}

/** A forceful steer aborted this turn (and NOT an external teardown), so the loop re-plans. */
function isInterruptAbort(
  err: unknown,
  interrupt: AbortSignal,
  external: AbortSignal,
  owned: AbortSignal,
): boolean {
  const aborted =
    (err instanceof DOMException && err.name === 'AbortError') ||
    (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError')
  return aborted && interrupt.aborted && !external.aborted && !owned.aborted
}
