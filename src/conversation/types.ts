/**
 * @stable
 *
 * Public types for multi-agent conversations. A `Conversation` is two-or-more
 * participants taking turns through their own `AgentExecutionBackend`s, driven
 * by a `ConversationPolicy` (turn order, halting, hard credit ceiling).
 *
 * Each participant's backend can resolve to any reachable endpoint —
 * in-process iterable, local cli-bridge, sandbox, router, or a remote
 * agent-gateway — so the same `runConversation` call drives same-machine,
 * same-cloud, and cross-cloud orchestration without code change.
 */

import type { AgentExecutionBackend } from '../types'
import type { BackendCallPolicy } from './call-policy'
import type { PropagatedHeaders } from './headers'
import type { ConversationJournal } from './journal'

/** @stable */
export interface ConversationParticipant {
  /**
   * Stable name used as the speaker label in the transcript. Must be unique
   * within a `Conversation`.
   */
  name: string
  /**
   * Backend that runs this participant's turn. Reuses the existing
   * `AgentExecutionBackend` contract from `runAgentTaskStream`, so any
   * registered backend (iterable, sandbox, OpenAI-compatible) works without
   * adaptation.
   */
  backend: AgentExecutionBackend
  /**
   * Optional human label for traces / dashboards. Distinct from `name`, which
   * is the addressing key.
   */
  label?: string
  /**
   * Optional per-participant override of the conversation's default
   * `callPolicy`. Use to tighten the deadline or raise the retry budget for
   * a participant known to be slow or flaky.
   */
  callPolicy?: BackendCallPolicy
}

/** @stable */
export type TurnOrder = 'alternate' | 'round-robin' | ((state: ConversationDriveState) => number)

/** @stable */
export interface ConversationDriveState {
  transcript: readonly ConversationTurn[]
  turnIndex: number
  spentCreditsCents: number
}

/** @stable */
export interface HaltContext extends ConversationDriveState {
  lastTurn: ConversationTurn
}

/** @stable */
export interface HaltSignal {
  halted: true
  reason: string
}

/** @stable */
export type HaltPredicate = (
  ctx: HaltContext,
) => boolean | HaltSignal | Promise<boolean | HaltSignal>

/** @stable */
export type HaltReason =
  | { kind: 'max_turns'; turns: number }
  | { kind: 'max_credits'; spentCents: number; capCents: number }
  | { kind: 'predicate'; reason: string }
  | { kind: 'abort' }
  | { kind: 'participant_error'; participant: string; message: string }

/** @stable */
export interface ConversationPolicy {
  /** Hard cap on speaker-turns. Each call into a participant's backend counts as 1. */
  maxTurns: number
  /**
   * Hard cap on aggregate credit spend across all participants, in cents.
   * Computed by summing `llm_call.costUsd` from every participant's stream.
   * Unset (`undefined`) means no credit ceiling — the run is bounded only by
   * `maxTurns` and `haltOn`.
   */
  maxCreditsCents?: number
  /**
   * Speaker selection. Defaults to `'alternate'` for two-participant
   * conversations and `'round-robin'` for any other arity.
   */
  turnOrder?: TurnOrder
  /**
   * Optional convergence / content-based halt. Called after every turn ends;
   * returning truthy stops the loop with `{ kind: 'predicate', ... }`.
   */
  haltOn?: HaltPredicate
  /**
   * Default per-turn resilience policy applied to every participant call
   * (deadline, retries, circuit breaker). Individual participants may
   * override via `ConversationParticipant.callPolicy`.
   */
  defaultCallPolicy?: BackendCallPolicy
}

/** @stable */
export interface ConversationTurn {
  index: number
  speaker: string
  /**
   * Deterministic turn identifier — stable across retries of the same logical
   * turn so caching gateways and trace backends can dedupe. Shape:
   * `${runId}.t${index}.${speakerSlug}`.
   */
  turnId: string
  text: string
  /**
   * Aggregated backend usage for this turn alone. Populated from any
   * `llm_call` stream events the backend emitted; `undefined` when the
   * backend reports no usage.
   */
  usage?: {
    tokensIn?: number
    tokensOut?: number
    costUsd?: number
    latencyMs?: number
    model?: string
  }
  /**
   * Number of attempts that ran before this turn committed. `1` is the
   * common case; higher means the call policy retried after transient
   * failures.
   */
  attempts: number
  startedAt: string
  endedAt: string
}

/** @stable */
export interface Conversation {
  participants: readonly ConversationParticipant[]
  policy: ConversationPolicy
}

/** @stable */
export interface RunConversationOptions {
  /** First message kicking off the conversation. Routes to the first speaker. */
  seed: string
  /**
   * Optional run identifier for cross-participant trace correlation. Auto-
   * generated when omitted. Reusing a runId against the same `journal`
   * resumes the prior run — the runner replays the persisted transcript and
   * continues from the first un-recorded turn.
   */
  runId?: string
  /** Cancellation signal — aborts mid-stream and halts with `{ kind: 'abort' }`. */
  signal?: AbortSignal
  /**
   * Event sink for per-turn micro-events. Distinct from the result transcript:
   * the sink fires for every text-delta, every turn-start/end, and the
   * conversation-start/end markers. Used to drive SSE / dashboard updates
   * without waiting for the conversation to finish.
   */
  onEvent?: (event: ConversationStreamEvent) => void | Promise<void>
  /**
   * Optional durable transcript. When set, the runner persists every
   * committed turn before yielding `turn_end`. Reusing the same `runId`
   * against the same journal resumes from the last committed turn — so a
   * driver process crash mid-run loses zero acknowledged turns.
   */
  journal?: ConversationJournal
  /**
   * Headers to forward verbatim to every participant backend call (gateway
   * propagation: `X-Tangle-Forwarded-Authorization`, run/turn correlation,
   * depth counter). Backends opt in by reading `propagatedHeaders` from
   * their `AgentBackendContext`; backends that ignore the field still work.
   */
  propagatedHeaders?: PropagatedHeaders
  /**
   * Inbound depth at the point this driver was invoked. The runner
   * increments it on every outbound participant call; gateways refuse at
   * `DEFAULT_MAX_DEPTH`. Default 0 (origin caller).
   */
  inboundDepth?: number
  /**
   * Parent turn id when this conversation is *inside* another turn (i.e. the
   * driver is itself a participant via `createConversationBackend`). The
   * runner stamps each outbound call with this as `X-Tangle-Parent-TurnId`
   * so trace stitching survives nested orchestration.
   */
  parentTurnId?: string
}

/** @stable */
export interface ConversationResult {
  runId: string
  transcript: ConversationTurn[]
  turns: number
  spentCreditsCents: number
  halted: HaltReason
  durationMs: number
  startedAt: string
  endedAt: string
}

/** @stable */
export type ConversationStreamEvent =
  | {
      type: 'conversation_start'
      runId: string
      participants: readonly string[]
      seed: string
      timestamp: string
    }
  | {
      type: 'conversation_resumed'
      runId: string
      participants: readonly string[]
      transcript: readonly ConversationTurn[]
      timestamp: string
    }
  | {
      type: 'turn_start'
      runId: string
      index: number
      speaker: string
      turnId: string
      attempt: number
      timestamp: string
    }
  | {
      type: 'turn_text_delta'
      runId: string
      index: number
      speaker: string
      turnId: string
      text: string
      timestamp?: string
    }
  | {
      type: 'turn_retry'
      runId: string
      index: number
      speaker: string
      turnId: string
      attempt: number
      reason: string
      timestamp: string
    }
  | { type: 'turn_end'; runId: string; turn: ConversationTurn; timestamp: string }
  | { type: 'conversation_end'; runId: string; result: ConversationResult; timestamp: string }
