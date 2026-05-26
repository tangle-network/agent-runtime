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
 * The credit cap is enforced *between turns*, not mid-stream: a turn that
 * overshoots the cap completes, the cap then halts the conversation before
 * the next turn. Wrap a tighter `maxTurns` or per-backend timeout for finer
 * control.
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
  const startedAt = nowIso()
  const startedAtMs = Date.now()
  const transcript: ConversationTurn[] = []
  let spentCreditsCents = 0
  let halt: HaltReason | undefined

  yield {
    type: 'conversation_start',
    runId,
    participants: conversation.participants.map((p) => p.name),
    seed: options.seed,
    timestamp: startedAt,
  }

  let currentInput = options.seed

  for (let turnIndex = 0; turnIndex < conversation.policy.maxTurns; turnIndex++) {
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
      {
        transcript,
        turnIndex,
        spentCreditsCents,
      },
    )
    const speaker = conversation.participants[speakerIdx]
    if (!speaker) {
      throw new BackendTransportError(
        'conversation',
        `turnOrder selector returned out-of-range index ${speakerIdx} for ${conversation.participants.length} participants`,
      )
    }

    yield {
      type: 'turn_start',
      runId,
      index: turnIndex,
      speaker: speaker.name,
      timestamp: nowIso(),
    }

    let turn: ConversationTurn
    try {
      const driver = driveOneTurn(
        speaker,
        conversation.participants,
        currentInput,
        turnIndex,
        runId,
        transcript,
        options.signal,
      )
      let aggregator: TurnAggregator | undefined
      for await (const evt of driver) {
        if (evt.kind === 'delta') {
          yield {
            type: 'turn_text_delta',
            runId,
            index: turnIndex,
            speaker: speaker.name,
            text: evt.text,
            timestamp: evt.timestamp,
          }
        } else {
          aggregator = evt.aggregator
        }
      }
      if (!aggregator) {
        throw new BackendTransportError(
          speaker.backend.kind,
          `participant '${speaker.name}' produced no final aggregate for turn ${turnIndex}`,
        )
      }
      turn = aggregator.toTurn()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      halt = { kind: 'participant_error', participant: speaker.name, message }
      break
    }

    transcript.push(turn)
    spentCreditsCents += centsFromUsd(turn.usage?.costUsd ?? 0)

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

  yield { type: 'conversation_end', runId, result, timestamp: endedAt }
}

// ── Internals ────────────────────────────────────────────────────────────

type DriverEvent =
  | { kind: 'delta'; text: string; timestamp?: string }
  | { kind: 'end'; aggregator: TurnAggregator }

async function* driveOneTurn(
  speaker: ConversationParticipant,
  participants: readonly ConversationParticipant[],
  input: string,
  turnIndex: number,
  runId: string,
  transcript: readonly ConversationTurn[],
  signal: AbortSignal | undefined,
): AsyncIterable<DriverEvent> {
  const startedAt = nowIso()
  const task: AgentTaskSpec = {
    id: `${runId}-t${turnIndex}`,
    intent: input,
    metadata: {
      runId,
      turnIndex,
      speaker: speaker.name,
      participants: participants.map((p) => p.name),
    },
  }
  const knowledge = passingReadiness(task.id)
  const messages = buildMessagesFor(speaker.name, transcript, input)
  const backendInput: AgentBackendInput = { task, message: input, messages }

  const startCtx: Omit<AgentBackendContext, 'session'> & { requestedSessionId?: string } = {
    task,
    knowledge,
    signal,
  }
  const session: RuntimeSession = speaker.backend.start
    ? touchSession(await speaker.backend.start(backendInput, startCtx))
    : newRuntimeSession(speaker.backend.kind, undefined, {
        runId,
        turnIndex,
        speaker: speaker.name,
      })

  const streamCtx: AgentBackendContext = { task, knowledge, session, signal }

  const aggregator = new TurnAggregator({
    index: turnIndex,
    speaker: speaker.name,
    startedAt,
  })

  for await (const event of speaker.backend.stream(backendInput, streamCtx)) {
    if (signal?.aborted) break
    if (event.type === 'text_delta') {
      aggregator.appendText(event.text)
      yield { kind: 'delta', text: event.text, timestamp: event.timestamp }
    } else if (event.type === 'llm_call') {
      aggregator.recordUsage(event)
    } else if (event.type === 'final') {
      aggregator.adoptFinalText(event.text)
    }
  }

  yield { kind: 'end', aggregator }
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

  toTurn(): ConversationTurn {
    return {
      index: this.base.index,
      speaker: this.base.speaker,
      text: this.text.trim(),
      usage: this.usage,
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
