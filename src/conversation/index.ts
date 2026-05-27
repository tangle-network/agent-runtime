/**
 * @tangle-network/agent-runtime/conversation
 *
 * Multi-agent conversation primitive. `defineConversation` + `runConversation`
 * + `createConversationBackend` compose any reachable agent endpoints into a
 * driven dialogue with turn-order policy, halting policy, hard credit ceiling,
 * deterministic turn ids, optional durable journal, per-turn deadline +
 * retry + circuit breaker, and cross-gateway header propagation.
 *
 * Backends are unchanged from `runAgentTaskStream`, so the same driver works
 * against in-process iterables, local cli-bridge, sandboxes, router, or
 * remote agent-gateway endpoints.
 *
 * See `docs/agent-bus-protocol.md` for the cross-gateway header contract.
 */

export {
  type BackendCallPolicy,
  type CircuitBreakerConfig,
  CircuitBreakerState,
  CircuitOpenError,
  computeBackoff,
  DeadlineExceededError,
  defaultIsRetryable,
  makePerAttemptSignal,
  type RetryableErrorPredicate,
  type RetryBackoff,
  sleep,
} from './call-policy'
export { createConversationBackend } from './conversation-backend'
export { defineConversation } from './define-conversation'
export {
  buildForwardHeaders,
  DEFAULT_MAX_DEPTH,
  FORWARD_HEADERS,
  type ForwardHeaderName,
  isDepthExceeded,
  type PropagatedHeaders,
  readDepth,
} from './headers'
export {
  type ConversationJournal,
  type ConversationJournalEntry,
  FileConversationJournal,
  InMemoryConversationJournal,
} from './journal'
export {
  type D1DatabaseLike,
  type D1StmtLike,
  d1ToSqlAdapter,
  type SqlAdapter,
  SqlConversationJournal,
} from './journal-sql'
export { runConversation, runConversationStream } from './run-conversation'
export { slugifySpeaker, turnId } from './turn-id'
export type {
  AuthSource,
  Conversation,
  ConversationDriveState,
  ConversationParticipant,
  ConversationPolicy,
  ConversationResult,
  ConversationStreamEvent,
  ConversationTurn,
  HaltContext,
  HaltPredicate,
  HaltReason,
  HaltSignal,
  RunConversationOptions,
  TurnOrder,
} from './types'
