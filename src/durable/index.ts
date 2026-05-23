/**
 * Turn-lifecycle helpers for `@tangle-network/agent-runtime`.
 *
 * Execution state — long-running execution, reconnect, replay, dedup —
 * lives in the substrate (`@tangle-network/sandbox` + orchestrator).
 * agent-runtime owns:
 *
 *   - `handleChatTurn` — framework-neutral turn lifecycle: NDJSON framing,
 *     `session.run.*` envelope, persist / post-process / trace-flush
 *     hook ordering.
 *   - `deriveExecutionId` — convention helper for the stable id products
 *     persist so a retry of the same turn lands on the same execution.
 */

export type {
  ChatStreamEvent,
  ChatTurnHooks,
  ChatTurnIdentity,
  ChatTurnProducer,
  ChatTurnResult,
  RunChatTurnInput,
} from './chat-engine'
export { handleChatTurn } from './chat-engine'
export { deriveExecutionId } from './execution-handle'
