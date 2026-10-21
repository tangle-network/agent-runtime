import { RuntimeRunStateError, ValidationError } from '../../errors'
import type { ToolSpec } from '../router-request-body'
import type {
  ToolLoopCallContext,
  ToolLoopChat,
  ToolLoopCompaction,
  ToolLoopMessageRecord,
} from '../tool-loop'
import { promptCacheTokenClasses, unmeteredSpend } from '../util'
import type { DriverAgentOptions } from './driver-agent-options'
import { deadlinePassed, ownTurnsUnbounded, poolStarved } from './driver-budget-guards'
import type {
  createCancelAcknowledger,
  createSteerAcknowledger,
} from './driver-control-acknowledgers'
import { validateDriverPromptCache } from './driver-prompt-cache'
import { distillInstruction, safeJson, summarizeRoster } from './driver-prompt-context'
import { runExtraTool, runTool } from './driver-tool-dispatch'
import type { DriverToolSurface } from './driver-tool-surface'
import { errMessage } from './error-message'
import type { Inbox, InboxLease } from './inbox'
import { providerAttemptEvidence } from './materialization'
import { addResourceSpend, withBudgetResources } from './resources'
import type { RouterTranscript } from './router-transcript'
import { meterRuntimeOwnedProviderAttempt } from './scope'
import { createProgressTracker, progressStop } from './stop-rules'
import type { Scope, Spend } from './types'
import { composeWakeInput, deadlineWarningAt, resolveWakePolicy } from './wake'

/** How often a waiting driver applies operator cancels and steers between its turns. */
const WAITING_CONTROL_POLL_MS = 5_000

type BrainReply = Awaited<ReturnType<DriverAgentOptions['brain']>>

/** What one brain call is: its position, its trusted call context, and its journal detail. */
interface DriverBrainCall {
  readonly call: number
  readonly context: ToolLoopCallContext
  readonly detail: Record<string, unknown>
}

/** The operator-control passes a durable driver runs at its turn boundaries. */
export interface DriverControlPasses {
  readonly acknowledger: ReturnType<typeof createCancelAcknowledger> | undefined
  readonly steerAcknowledger: ReturnType<typeof createSteerAcknowledger> | undefined
}

/** The evidence fault a brain reply carries, if any: identity, transport count, or prompt cache. */
function driverBrainEvidenceError(
  res: BrainReply,
  expectedModel: string | undefined,
): ValidationError | undefined {
  let evidenceError: ValidationError | undefined
  if (expectedModel !== undefined) {
    if (res.model === undefined) {
      evidenceError = new ValidationError(
        `driverAgent: Router response omitted model identity; expected ${JSON.stringify(expectedModel)}`,
      )
    } else if (res.model !== expectedModel) {
      evidenceError = new ValidationError(
        `driverAgent: Router response reported model ${JSON.stringify(res.model)}; expected ${JSON.stringify(expectedModel)}`,
      )
    }
  }
  if (
    res.transportAttempts !== undefined &&
    (!Number.isSafeInteger(res.transportAttempts) || res.transportAttempts < 1)
  ) {
    evidenceError = new ValidationError(
      'driverAgent: transportAttempts must be a positive safe integer when reported',
    )
  }
  return validateDriverPromptCache(res.promptCache) ?? evidenceError
}

/** What one brain reply spent, with every channel it did not prove left unknown. */
function driverTurnSpend(res: BrainReply): Spend {
  const trustedCost =
    res.costProvenance === 'provider-receipt' || res.costProvenance === 'billing-receipt'
  const cacheUsage = promptCacheTokenClasses(res.usage?.input, res.promptCache)
  return {
    ...addResourceSpend(res.resources),
    iterations: 0,
    tokens: {
      input: res.usage?.input ?? 0,
      output: res.usage?.output ?? 0,
      ...cacheUsage,
    },
    ...(res.usage === undefined ? { tokensKnown: false } : {}),
    usd: trustedCost ? (res.costUsd ?? 0) : 0,
    ...(trustedCost && res.costUsd !== undefined ? {} : { usdKnown: false }),
    ms: 0,
  }
}

// Calling the brain is the provider-attempt boundary: a later rejection carries no trusted served
// identity, so an empty attempt is preserved for root settlement.
async function meterFailedBrainCall(
  opts: DriverAgentOptions,
  scope: Scope<unknown>,
  { call, context, detail }: DriverBrainCall,
  error: unknown,
): Promise<never> {
  opts.onProviderModel?.(undefined)
  try {
    await meterRuntimeOwnedProviderAttempt(
      scope,
      withBudgetResources(unmeteredSpend(0), scope.budget),
      providerAttemptEvidence(undefined),
      {
        driver: opts.name,
        inferenceFailed: true,
        call,
        callId: context.callId,
        correlationId: context.correlationId,
        ...detail,
      },
    )
  } catch (meteringError) {
    // Preserve the provider diagnosis without turning an accounting refusal into a retry.
    throw new RuntimeRunStateError(
      `${errMessage(error)}; accounting failed: ${errMessage(meteringError)}`,
      { cause: error },
    )
  }
  throw error
}

// Meter the driver's OWN inference on EVERY turn into the conserved pool: the largest token
// consumer in the loop, and what makes maxTurns=0 bounded (a thinking driver drains the pool).
// Driver turns never consume the child-iteration budget; failed inference stays visible through
// unknown token/USD channels. No branch skips `scope.meter`: a turn whose brain reported no usage
// is metered as UNKNOWN (`tokensKnown: false`), never omitted, because a missing measurement is
// never zero. It debits the zero it knows and marks `pool.readout().tokensKnown` false; scripted
// turns take this path too, so offline equal-k still debits zero.
async function meterDriverBrainCall(
  opts: DriverAgentOptions,
  scope: Scope<unknown>,
  brainCall: DriverBrainCall,
  messages: ReadonlyArray<Record<string, unknown>>,
  tools: ReadonlyArray<ToolSpec>,
  // A conversation turn (not a compaction) keeps its reply, and its turn event carries what
  // the turn added, so an observer journal holds the conversation while the run is live.
  conversationTurn?: (reply: BrainReply) => unknown,
): Promise<BrainReply> {
  const { call, context, detail } = brainCall
  let res: BrainReply
  try {
    res = await opts.brain(messages, tools, context)
  } catch (error) {
    return meterFailedBrainCall(opts, scope, brainCall, error)
  }
  opts.onProviderModel?.(res.model)
  const evidenceError = driverBrainEvidenceError(res, opts.expectedModel)
  await meterRuntimeOwnedProviderAttempt(
    scope,
    withBudgetResources(driverTurnSpend(res), scope.budget),
    providerAttemptEvidence(res.model),
    {
      driver: opts.name,
      call,
      callId: context.callId,
      correlationId: context.correlationId,
      toolCalls: (res.toolCalls ?? []).map((c) => c.name),
      ...(res.model !== undefined ? { model: res.model } : {}),
      ...(res.transportAttempts !== undefined ? { transportAttempts: res.transportAttempts } : {}),
      ...(res.usage?.reasoning !== undefined ? { reasoningTokens: res.usage.reasoning } : {}),
      ...(res.promptCache !== undefined ? { promptCache: res.promptCache } : {}),
      // The stream says explicitly when it finished with no usage chunk (a broken `include_usage`
      // contract), distinct from a brain that never reports usage; the journal records which.
      ...(res.usageUnknown === true ? { streamUsageMissing: true } : {}),
      ...(res.costProvenance === 'catalog-estimate' ? { estimatedCostUsd: res.costUsd } : {}),
      ...detail,
      ...(conversationTurn ? { conversation: conversationTurn(res) } : {}),
    },
  )
  if (evidenceError !== undefined) throw evidenceError
  return res
}

interface DriverBrainTurnsInput {
  readonly opts: DriverAgentOptions
  readonly scope: Scope<unknown>
  readonly surface: DriverToolSurface
  readonly inbox: Inbox
  readonly transcript: RouterTranscript
  readonly controls: DriverControlPasses
  /** A flow root: Runtime schedules its work from graph data and its brain makes no model call. */
  readonly runtimeScheduled: boolean
  readonly now: () => number
}

/**
 * One driver turn loop's state and the hooks `runBrainLoop` calls: the metered brain, the inbox
 * folded into each turn, the wait between turns, and the stop predicate.
 */
export class DriverBrainTurns {
  private readonly opts: DriverAgentOptions
  private readonly scope: Scope<unknown>
  private readonly surface: DriverToolSurface
  private readonly inbox: Inbox
  private readonly transcript: RouterTranscript
  private readonly controls: DriverControlPasses
  private readonly runtimeScheduled: boolean
  private readonly now: () => number
  // Built only when a rule is configured, so a run without one allocates and evaluates nothing.
  private readonly tracker: ReturnType<typeof createProgressTracker> | undefined
  // The pool this manager started with, for the overdraw guard in `ownTurnsUnbounded`.
  private readonly poolTokens: number
  private readonly wakePolicy: ReturnType<typeof resolveWakePolicy>
  private readonly startedAt: number
  private driverTurns = 0
  private progressStopReason: string | undefined
  private deadlineWarned = false
  private driverTurn = 0
  private driverCall = 0
  // Inbox messages folded into the conversation and not yet carried by an answered call.
  private readonly leases: InboxLease[] = []

  constructor(input: DriverBrainTurnsInput) {
    this.opts = input.opts
    this.scope = input.scope
    this.surface = input.surface
    this.inbox = input.inbox
    this.transcript = input.transcript
    this.controls = input.controls
    this.runtimeScheduled = input.runtimeScheduled
    this.now = input.now
    this.tracker = input.opts.stopRule ? createProgressTracker({ now: input.now }) : undefined
    this.poolTokens = input.scope.budget.tokensLeft + input.scope.budget.reservedTokens
    this.wakePolicy = resolveWakePolicy(input.opts.wake)
    this.startedAt = input.now()
  }

  private meteredBrain(
    messages: ReadonlyArray<Record<string, unknown>>,
    tools: ReadonlyArray<ToolSpec>,
    detail: Record<string, unknown>,
    conversationTurn?: (reply: BrainReply) => unknown,
  ): Promise<BrainReply> {
    const call = this.driverCall
    this.driverCall += 1
    const context: ToolLoopCallContext = Object.freeze({
      signal: this.scope.signal,
      callId: `${this.scope.view.root}:brain:${crypto.randomUUID()}`,
      correlationId: this.scope.view.root,
    })
    return meterDriverBrainCall(
      this.opts,
      this.scope,
      { call, context, detail },
      messages,
      tools,
      conversationTurn,
    )
  }

  readonly chat: ToolLoopChat = async (messages, tools) => {
    const turn = this.driverTurn
    const { transcript } = this
    // A compaction may have replaced the middle since `beforeTurn`; its note is what the model sees.
    transcript.observe(messages)
    // A flow root's turn reaches no provider, so there is no attempt to meter or attribute.
    const res = this.runtimeScheduled
      ? await this.opts.brain(messages, tools)
      : await this.meteredBrain(messages, tools, { kind: 'driver-inference', turn }, (reply) =>
          transcript.reply(reply),
        )
    for (const lease of this.leases.splice(0)) {
      for (const message of lease.messages) {
        lease.commit(`${this.scope.view.root}#driver-turn-${turn}`, message.id)
      }
    }
    this.driverTurn += 1
    return res
  }

  // Chapter-close on the brain's window: the default distiller pairs the settled-worker roster
  // with a brain-authored note through the metered `chat`, so the one-time distill cost debits
  // the pool and replaces per-turn O(history) re-billing.
  compaction(): ToolLoopCompaction | undefined {
    const compaction = this.opts.compaction
    if (!compaction) return undefined
    return {
      thresholdTokens: compaction.thresholdTokens,
      distill:
        compaction.distill ??
        (async (msgs) => {
          const roster = summarizeRoster(this.scope.view, this.surface.coord.settled())
          try {
            const res = await this.meteredBrain(
              [...msgs, { role: 'user', content: distillInstruction }],
              [],
              { kind: 'driver-compaction', compactingTurn: this.driverTurn },
            )
            const narrative = (res.content ?? '').trim()
            return narrative ? `${roster}\n\n## Progress notes\n${narrative}` : roster
          } catch (e) {
            return `${roster}\n\n## Progress notes\nSummary unavailable: ${errMessage(e)}`
          }
        }),
      ...(compaction.onCompact ? { onCompact: compaction.onCompact } : {}),
      ...(compaction.preserveHead !== undefined ? { preserveHead: compaction.preserveHead } : {}),
      ...(compaction.estimateTokens ? { estimateTokens: compaction.estimateTokens } : {}),
    }
  }

  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { opts, surface } = this
    // WORK FIRST: a work tool the driver runs itself (act). A non-null return is handled here;
    // null/undefined means "not mine" → fall through to the coordination dispatch (spawn/await/…).
    if (opts.executeExtraTool && surface.extraNames.has(name)) {
      const worked = await runExtraTool(opts.executeExtraTool, name, args)
      if (worked !== null && worked !== undefined) return worked
    }
    const tool = surface.byName.get(name)
    const result = tool ? await runTool(tool, args) : { error: `unknown tool: ${name}` }
    return safeJson(result)
  }

  async beforeTurn(messages: ToolLoopMessageRecord[]): Promise<void> {
    this.driverTurns += 1
    await this.controls.steerAcknowledger?.pass('turn')
    this.controls.acknowledger?.pass('turn')
    const lease = this.inbox.take()
    if (lease.messages.length > 0) {
      messages.push({ role: 'user', content: this.inbox.fold(lease.messages) })
      this.leases.push(lease)
    }
    // Before a compaction can fold them away: the previous turn's tool results and this inbox.
    this.transcript.observe(messages)
  }

  // A turn without a tool call ends the turn, not the manager: while work is open, wait
  // with no model turn and continue with what happened.
  async afterFinal(): Promise<string | undefined> {
    const { scope, inbox } = this
    const wakePolicy = this.wakePolicy
    const { coord } = this.surface
    if (coord.isStopped() || coord.submittedResult() !== undefined || scope.signal.aborted) {
      return undefined
    }
    if (inbox.pending() === 0 && !coord.hasOpenWork()) return undefined
    const deadlineMs = scope.budget.deadlineMs
    const warnAt = deadlineWarningAt(deadlineMs, wakePolicy, this.deadlineWarned, this.startedAt)
    const controlClock = this.startControlClock()
    let wake: Awaited<ReturnType<typeof coord.awaitWake>>
    try {
      wake = await coord.awaitWake({
        signal: scope.signal,
        heartbeatMs: wakePolicy.heartbeatMs,
        quietWhileProgressing: true,
        debounceMs: wakePolicy.debounceMs,
        ...(warnAt === undefined ? {} : { deadlineAt: warnAt }),
        alsoWakeOn: inbox.pending() > 0 ? Promise.resolve() : inbox.nextDelivery(),
      })
    } finally {
      if (controlClock !== undefined) clearInterval(controlClock)
    }
    if (wake === undefined) return undefined
    if (wake.reason === 'deadline') this.deadlineWarned = true
    return composeWakeInput(wake, { tools: this.surface.toolNames, deadlineMs, now: this.now() })
  }

  // Operator controls apply at turn boundaries, and on a short clock while the driver waits, so a
  // cancelled worker settles into the wake and a root steer ends the wait.
  private startControlClock(): ReturnType<typeof setInterval> | undefined {
    const { acknowledger, steerAcknowledger } = this.controls
    const controlClock =
      acknowledger === undefined && steerAcknowledger === undefined
        ? undefined
        : setInterval(() => {
            void (async () => {
              await steerAcknowledger?.pass('turn')
              acknowledger?.pass('turn')
            })().catch(() => undefined)
          }, WAITING_CONTROL_POLL_MS)
    controlClock?.unref?.()
    return controlClock
  }

  // The pool + deadline + external-stop bound (what maxTurns=0 relies on): a starved or
  // past-deadline driver stops here instead of burning turns. Checked before each inference turn.
  stopBefore(): boolean {
    const { opts, scope, now } = this
    const tracker = this.tracker
    const { coord } = this.surface
    // HARD CEILINGS FIRST and independent: a progress rule may never keep a run alive past one.
    if (
      coord.isStopped() ||
      scope.signal.aborted ||
      poolStarved(scope, opts.perWorker, opts.preserveOwnerTurns) ||
      deadlinePassed(scope, now) ||
      (!this.runtimeScheduled &&
        ownTurnsUnbounded(scope, this.poolTokens, this.driverTurns, opts.maxTurns))
    ) {
      return true
    }
    if (!opts.stopRule || !tracker) return false
    const decision = progressStop(tracker, opts.stopRule, coord, scope, now, opts.stallAfterMs)
    if (!decision.stop) return false
    // `stopBefore` may be consulted repeatedly; the one-shot callback fires on the FIRST stop only.
    if (this.progressStopReason === undefined) {
      this.progressStopReason = decision.reason
      opts.onProgressStop?.(decision.reason)
    }
    return true
  }

  /** The conversation holding the folded messages dies with this loop; the next entry of this
   *  manager takes them again. */
  releaseLeases(): void {
    for (const lease of this.leases.splice(0)) lease.release()
  }
}
