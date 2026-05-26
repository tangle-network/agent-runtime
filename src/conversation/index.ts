/**
 * @tangle-network/agent-runtime/conversation
 *
 * Multi-agent conversation primitive. `defineConversation` + `runConversation`
 * + `createConversationBackend` compose any reachable agent endpoints into a
 * driven dialogue with turn-order policy, halting policy, and a hard credit
 * ceiling. Backends are unchanged from `runAgentTaskStream`, so the same
 * driver works against in-process iterables, local cli-bridge, sandboxes,
 * router, or remote agent-gateway endpoints.
 */

export { createConversationBackend } from './conversation-backend'
export { defineConversation } from './define-conversation'
export { runConversation, runConversationStream } from './run-conversation'
export type {
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
