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
}

/** @stable */
export interface ConversationTurn {
  index: number
  speaker: string
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
  /** Optional run identifier for cross-participant trace correlation. Auto-generated when omitted. */
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
  | { type: 'turn_start'; runId: string; index: number; speaker: string; timestamp: string }
  | {
      type: 'turn_text_delta'
      runId: string
      index: number
      speaker: string
      text: string
      timestamp?: string
    }
  | { type: 'turn_end'; runId: string; turn: ConversationTurn; timestamp: string }
  | { type: 'conversation_end'; runId: string; result: ConversationResult; timestamp: string }
