/**
 * @stable
 *
 * Conversation orchestrator. Drives N participants in turn through their own
 * `AgentExecutionBackend`s, aggregating per-turn text + usage, enforcing
 * `maxTurns` / `maxCreditsCents` / `haltOn`, and emitting per-event stream
 * markers so callers can plumb the run through SSE without buffering.
 *
 * `runConversation` returns the full result; `runConversationStream` returns
 * an `AsyncIterable<ConversationStreamEvent>` for callers that want to
 * forward events as they arrive. Both share one driving loop.
 *
 * Distributed-systems primitives layered on top of the loop:
 *   - **Idempotent turn ids** — `turnId(runId, index, speaker)` stays stable
 *     across retries so caching gateways can dedupe.
 *   - **Durable journal** — optional `ConversationJournal` persists every
 *     committed turn; reusing a runId against the same journal resumes
 *     transparently from the last committed turn.
 *   - **Per-turn call policy** — deadline, retry-with-backoff, and a
 *     per-participant circuit breaker. Retries replay the same logical turn
 *     (same `turnId`); the retry loop lives inside the outer generator so
 *     deltas yield naturally without cross-coroutine buffering.
 *   - **Header propagation** — run/turn/depth headers (+ forwarded user
 *     authorization) stamped onto every outbound backend call so downstream
 *     gateways can bill the right user and enforce `X-Tangle-Forwarded-Depth`.
 *
 * Credit cap is enforced *between turns*, not mid-stream: a turn that
 * overshoots the cap completes, the cap then halts the conversation before
 * the next turn.
 */

import type { KnowledgeReadinessReport } from '@tangle-network/agent-eval'

import { BackendTransportError } from '../errors'
import { newRuntimeSession, nowIso, touchSession } from '../sessions'
import type {
  AgentBackendContext,
  AgentBackendInput,
  AgentTaskSpec,
  RuntimeSession,
} from '../types'
import {
  type BackendCallPolicy,
  CircuitBreakerState,
  computeBackoff,
  defaultIsRetryable,
  makePerAttemptSignal,
  sleep,
} from './call-policy'
import { buildForwardHeaders, FORWARD_HEADERS } from './headers'
import { turnId as deriveTurnId } from './turn-id'
import type {
  Conversation,
  ConversationParticipant,
  ConversationResult,
  ConversationStreamEvent,
  ConversationTurn,
  HaltContext,
  HaltReason,
  RunConversationOptions,
  TurnOrder,
} from './types'

export async function runConversation(
  conversation: Conversation,
  options: RunConversationOptions,
): Promise<ConversationResult> {
  let result: ConversationResult | undefined
  for await (const event of runConversationStream(conversation, options)) {
    if (options.onEvent) await options.onEvent(event)
    if (event.type === 'conversation_end') result = event.result
  }
  if (!result) {
    throw new BackendTransportError(
      'conversation',
      'conversation stream ended without a conversation_end event',
    )
  }
  return result
}

export async function* runConversationStream(
  conversation: Conversation,
  options: RunConversationOptions,
): AsyncIterable<ConversationStreamEvent> {
  const runId = options.runId ?? `conv_${crypto.randomUUID()}`
  const inboundDepth = options.inboundDepth ?? 0
  const callerHeaders = options.propagatedHeaders ?? {}
  const forwardedAuthorization = callerHeaders[FORWARD_HEADERS.authorization]

  const breakers = new Map<string, CircuitBreakerState>()
  for (const participant of conversation.participants) {
    const cfg =
      participant.callPolicy?.circuitBreaker ??
      conversation.policy.defaultCallPolicy?.circuitBreaker
    breakers.set(participant.name, new CircuitBreakerState(cfg))
  }

  let transcript: ConversationTurn[] = []
  let spentCreditsCents = 0
  let startedAt = nowIso()
  let resumed = false

  if (options.journal) {
    const prior = await options.journal.loadRun(runId)
    if (prior) {
      if (prior.halted) {
        // Run already terminated — surface its final state without re-running.
        const replayResult: ConversationResult = {
          runId,
          transcript: prior.turns,
          turns: prior.turns.length,
          spentCreditsCents: prior.turns.reduce(
            (sum, t) => sum + centsFromUsd(t.usage?.costUsd ?? 0),
            0,
          ),
          halted: prior.halted,
          durationMs: 0,
          startedAt: prior.startedAt,
          endedAt: prior.endedAt ?? prior.startedAt,
        }
        yield {
          type: 'conversation_resumed',
          runId,
          participants: conversation.participants.map((p) => p.name),
          transcript: prior.turns,
          timestamp: nowIso(),
        }
        yield { type: 'conversation_end', runId, result: replayResult, timestamp: nowIso() }
        return
      }
      transcript = [...prior.turns]
      spentCreditsCents = transcript.reduce(
        (sum, t) => sum + centsFromUsd(t.usage?.costUsd ?? 0),
        0,
      )
      startedAt = prior.startedAt
      resumed = true
    } else {
      await options.journal.beginRun(runId, startedAt)
    }
  }
  const startedAtMs = Date.now()

  if (resumed) {
    yield {
      type: 'conversation_resumed',
      runId,
      participants: conversation.participants.map((p) => p.name),
      // Snapshot the resumed transcript — the live `transcript` array gets
      // pushed to as the run continues, so handing the bare reference to a
      // subscriber would leak future writes into a past event.
      transcript: [...transcript],
      timestamp: nowIso(),
    }
  } else {
    yield {
      type: 'conversation_start',
      runId,
      participants: conversation.participants.map((p) => p.name),
      seed: options.seed,
      timestamp: startedAt,
    }
  }

  // When resumed, the next user input is the last persisted turn's text;
  // for a fresh run, it's the caller's seed.
  let currentInput =
    transcript.length === 0
      ? options.seed
      : (transcript[transcript.length - 1]?.text ?? options.seed)
  let halt: HaltReason | undefined

  const initialOffset = transcript.length
  for (let turnIndex = initialOffset; turnIndex < conversation.policy.maxTurns; turnIndex++) {
    if (options.signal?.aborted) {
      halt = { kind: 'abort' }
      break
    }
    if (
      conversation.policy.maxCreditsCents !== undefined &&
      spentCreditsCents >= conversation.policy.maxCreditsCents
    ) {
      halt = {
        kind: 'max_credits',
        spentCents: spentCreditsCents,
        capCents: conversation.policy.maxCreditsCents,
      }
      break
    }

    const speakerIdx = selectSpeaker(
      conversation.policy.turnOrder,
      conversation.participants.length,
      { transcript, turnIndex, spentCreditsCents },
    )
    const speaker = conversation.participants[speakerIdx]
    if (!speaker) {
      throw new BackendTransportError(
        'conversation',
        `turnOrder selector returned out-of-range index ${speakerIdx} for ${conversation.participants.length} participants`,
      )
    }

    const tid = deriveTurnId(runId, turnIndex, speaker.name)
    const callPolicy: BackendCallPolicy | undefined =
      speaker.callPolicy ?? conversation.policy.defaultCallPolicy
    const breaker = breakers.get(speaker.name)
    if (!breaker) {
      throw new BackendTransportError(
        'conversation',
        `internal: no circuit-breaker state registered for participant '${speaker.name}'`,
      )
    }
    const isRetryable = callPolicy?.isRetryable ?? defaultIsRetryable
    const totalAttempts = 1 + (callPolicy?.maxRetries ?? 0)

    yield {
      type: 'turn_start',
      runId,
      index: turnIndex,
      speaker: speaker.name,
      turnId: tid,
      attempt: 1,
      timestamp: nowIso(),
    }

    let aggregator: TurnAggregator | undefined
    let attemptCount = 0
    let lastError: unknown
    let breakerOpenFailure: unknown

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      attemptCount = attempt
      try {
        breaker.preflight(speaker.name)
      } catch (err) {
        // Breaker open — no point retrying; halt the conversation with this
        // participant's error rather than busy-looping until exhaustion.
        breakerOpenFailure = err
        break
      }

      if (attempt > 1) {
        yield {
          type: 'turn_retry',
          runId,
          index: turnIndex,
          speaker: speaker.name,
          turnId: tid,
          attempt,
          reason: lastError instanceof Error ? lastError.message : String(lastError),
          timestamp: nowIso(),
        }
      }

      const perAttempt = makePerAttemptSignal(options.signal, callPolicy?.perAttemptDeadlineMs)
      const localAgg = new TurnAggregator({
        index: turnIndex,
        speaker: speaker.name,
        startedAt: nowIso(),
      })

      try {
        for await (const delta of driveSingleAttempt({
          speaker,
          participants: conversation.participants,
          input: currentInput,
          turnIndex,
          runId,
          turnId: tid,
          transcript,
          signal: perAttempt.signal,
          aggregator: localAgg,
          propagatedHeaders: buildForwardHeaders({
            inboundDepth,
            // When the participant elects to pay for its own outbound calls,
            // drop the forwarded user identity so the downstream gateway
            // bills the participant's own credentials instead. The backend
            // brings its own `Authorization` header at construction time
            // (e.g. `createOpenAICompatibleBackend({ apiKey: sk-tan-AGENT })`);
            // omitting the forwarded header is what flips the billing target.
            forwardedAuthorization: resolveAuthForwarding(speaker, {
              transcript,
              turnIndex,
              spentCreditsCents,
            })
              ? forwardedAuthorization
              : undefined,
            runId,
            turnId: tid,
            parentTurnId: options.parentTurnId,
            speaker: speaker.name,
          }),
        })) {
          yield {
            type: 'turn_text_delta',
            runId,
            index: turnIndex,
            speaker: speaker.name,
            turnId: tid,
            text: delta.text,
            timestamp: delta.timestamp,
          }
        }
        perAttempt.dispose()
        breaker.recordSuccess()
        aggregator = localAgg
        break
      } catch (err) {
        perAttempt.dispose()
        breaker.recordFailure()
        // Surface the deadline error explicitly when timeout was the cause —
        // otherwise the upstream may throw a generic AbortError that loses
        // diagnostic info.
        lastError = perAttempt.getDeadlineError() ?? err
        if (attempt >= totalAttempts || !isRetryable(lastError)) {
          break
        }
        await sleep(computeBackoff(callPolicy?.retryBackoffMs, attempt))
      }
    }

    if (!aggregator) {
      const failure = breakerOpenFailure ?? lastError
      const message = failure instanceof Error ? failure.message : String(failure)
      halt = { kind: 'participant_error', participant: speaker.name, message }
      break
    }

    const turn = aggregator.toTurn({ turnId: tid, attempts: attemptCount })
    transcript.push(turn)
    spentCreditsCents += centsFromUsd(turn.usage?.costUsd ?? 0)
    if (options.journal) {
      await options.journal.appendTurn(runId, turn)
    }

    yield { type: 'turn_end', runId, turn, timestamp: nowIso() }

    if (conversation.policy.haltOn) {
      const haltCtx: HaltContext = {
        transcript,
        lastTurn: turn,
        turnIndex,
        spentCreditsCents,
      }
      const decision = await conversation.policy.haltOn(haltCtx)
      if (decision === true) {
        halt = { kind: 'predicate', reason: 'predicate_true' }
        break
      }
      if (typeof decision === 'object' && decision !== null && decision.halted) {
        halt = { kind: 'predicate', reason: decision.reason }
        break
      }
    }

    currentInput = turn.text
  }

  if (!halt) halt = { kind: 'max_turns', turns: transcript.length }

  const endedAt = nowIso()
  const result: ConversationResult = {
    runId,
    transcript,
    turns: transcript.length,
    spentCreditsCents,
    halted: halt,
    durationMs: Date.now() - startedAtMs,
    startedAt,
    endedAt,
  }
  if (options.journal) {
    await options.journal.recordHalt(runId, halt, endedAt)
  }

  yield { type: 'conversation_end', runId, result, timestamp: endedAt }
}

// ── Single attempt ───────────────────────────────────────────────────────

interface SingleAttemptArgs {
  speaker: ConversationParticipant
  participants: readonly ConversationParticipant[]
  input: string
  turnIndex: number
  runId: string
  turnId: string
  transcript: readonly ConversationTurn[]
  signal: AbortSignal
  aggregator: TurnAggregator
  propagatedHeaders: Record<string, string>
}

async function* driveSingleAttempt(
  args: SingleAttemptArgs,
): AsyncGenerator<{ text: string; timestamp?: string }> {
  const task: AgentTaskSpec = {
    id: args.turnId,
    intent: args.input,
    metadata: {
      runId: args.runId,
      turnId: args.turnId,
      turnIndex: args.turnIndex,
      speaker: args.speaker.name,
      participants: args.participants.map((p) => p.name),
    },
  }
  const knowledge = passingReadiness(task.id)
  const messages = buildMessagesFor(args.speaker.name, args.transcript, args.input)
  const backendInput: AgentBackendInput = { task, message: args.input, messages }

  const startCtx: Omit<AgentBackendContext, 'session'> & { requestedSessionId?: string } = {
    task,
    knowledge,
    signal: args.signal,
    runId: args.runId,
    turnId: args.turnId,
    propagatedHeaders: args.propagatedHeaders,
  }
  const session: RuntimeSession = args.speaker.backend.start
    ? touchSession(await args.speaker.backend.start(backendInput, startCtx))
    : newRuntimeSession(args.speaker.backend.kind, undefined, {
        runId: args.runId,
        turnIndex: args.turnIndex,
        turnId: args.turnId,
        speaker: args.speaker.name,
      })

  const streamCtx: AgentBackendContext = {
    task,
    knowledge,
    session,
    signal: args.signal,
    runId: args.runId,
    turnId: args.turnId,
    propagatedHeaders: args.propagatedHeaders,
  }

  for await (const event of args.speaker.backend.stream(backendInput, streamCtx)) {
    if (args.signal.aborted) {
      // Surface the abort so the outer retry/halt logic can react. The signal
      // either fires because of caller-cancel (propagate as-is) or because of
      // the per-attempt deadline timer (signal.reason is DeadlineExceededError).
      const reason = args.signal.reason
      throw reason instanceof Error ? reason : new Error('aborted')
    }
    if (event.type === 'text_delta') {
      args.aggregator.appendText(event.text)
      yield { text: event.text, timestamp: event.timestamp }
    } else if (event.type === 'llm_call') {
      args.aggregator.recordUsage(event)
    } else if (event.type === 'final') {
      args.aggregator.adoptFinalText(event.text)
    }
  }
}

class TurnAggregator {
  private text = ''
  private adoptedFinal = false
  private usage:
    | {
        tokensIn?: number
        tokensOut?: number
        costUsd?: number
        latencyMs?: number
        model?: string
      }
    | undefined

  constructor(private readonly base: { index: number; speaker: string; startedAt: string }) {}

  appendText(text: string): void {
    if (this.adoptedFinal) return
    this.text += text
  }

  /**
   * Use the backend's `final.text` only when no streamed deltas were observed.
   * Some backends emit deltas AND a final summary; treating both as content
   * would double-count.
   */
  adoptFinalText(text: string | undefined): void {
    if (!text) return
    if (this.text.length > 0) return
    this.text = text
    this.adoptedFinal = true
  }

  recordUsage(event: {
    model?: string
    tokensIn?: number
    tokensOut?: number
    costUsd?: number
    latencyMs?: number
  }): void {
    const u = this.usage ?? {}
    if (event.tokensIn !== undefined) u.tokensIn = (u.tokensIn ?? 0) + event.tokensIn
    if (event.tokensOut !== undefined) u.tokensOut = (u.tokensOut ?? 0) + event.tokensOut
    if (event.costUsd !== undefined) u.costUsd = (u.costUsd ?? 0) + event.costUsd
    if (event.latencyMs !== undefined) u.latencyMs = event.latencyMs
    if (event.model !== undefined) u.model = event.model
    this.usage = u
  }

  toTurn(meta: { turnId: string; attempts: number }): ConversationTurn {
    return {
      index: this.base.index,
      speaker: this.base.speaker,
      turnId: meta.turnId,
      text: this.text.trim(),
      usage: this.usage,
      attempts: meta.attempts,
      startedAt: this.base.startedAt,
      endedAt: nowIso(),
    }
  }
}

/**
 * Build the participant's POV of the transcript so an OpenAI-compatible
 * backend sees its own turns as `assistant` and everyone else's as `user`,
 * with explicit speaker tags so 3+ party conversations stay disambiguated.
 * The seed / current input is appended as the trailing user message.
 */
function buildMessagesFor(
  speakerName: string,
  transcript: readonly ConversationTurn[],
  currentInput: string,
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = []
  for (const turn of transcript) {
    if (turn.speaker === speakerName) {
      messages.push({ role: 'assistant', content: turn.text })
    } else {
      messages.push({ role: 'user', content: `[${turn.speaker}] ${turn.text}` })
    }
  }
  if (currentInput) messages.push({ role: 'user', content: currentInput })
  return messages
}

/**
 * True when this participant should forward the caller's
 * `X-Tangle-Forwarded-Authorization` on outbound calls (the "pass-through"
 * commercial mode). False when it elects to pay for its own outbound calls
 * (the "reseller" / "bundle" mode). See ConversationParticipant.authSource.
 */
function resolveAuthForwarding(
  participant: ConversationParticipant,
  state: { transcript: readonly ConversationTurn[]; turnIndex: number; spentCreditsCents: number },
): boolean {
  const decision =
    typeof participant.authSource === 'function'
      ? participant.authSource(state)
      : (participant.authSource ?? 'forward-user')
  return decision === 'forward-user'
}

function selectSpeaker(
  order: TurnOrder | undefined,
  participantCount: number,
  state: { transcript: readonly ConversationTurn[]; turnIndex: number; spentCreditsCents: number },
): number {
  const resolved = order ?? (participantCount === 2 ? 'alternate' : 'round-robin')
  if (resolved === 'alternate' || resolved === 'round-robin') {
    return state.turnIndex % participantCount
  }
  if (typeof resolved === 'function') {
    const idx = resolved(state)
    if (!Number.isInteger(idx) || idx < 0 || idx >= participantCount) {
      throw new BackendTransportError(
        'conversation',
        `turnOrder function returned invalid index ${String(idx)} for ${participantCount} participants`,
      )
    }
    return idx
  }
  throw new BackendTransportError('conversation', `unknown turnOrder: ${String(resolved)}`)
}

function centsFromUsd(usd: number): number {
  return Math.round(usd * 100)
}

/**
 * Synthesize a knowledge-readiness report that *passes* every gate, used to
 * satisfy `AgentBackendContext.knowledge` per turn. Conversations don't apply
 * task-level readiness gating per-turn — that's a `runAgentTask` concern.
 */
function passingReadiness(taskId: string): KnowledgeReadinessReport {
  return {
    taskId,
    readinessScore: 1,
    blockingMissingRequirements: [],
    nonBlockingGaps: [],
    recommendedAction: 'run_agent',
    bundle: {
      taskId,
      requirements: [],
      evidenceIds: [],
      claimIds: [],
      wikiPageIds: [],
      userAnswers: {},
      missing: [],
      readinessScore: 1,
    },
    severity: 'info',
    reason: 'conversation-mode: readiness gating not applied per-turn',
  }
}
