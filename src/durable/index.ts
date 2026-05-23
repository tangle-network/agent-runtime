/**
 * Turn-lifecycle helpers for `@tangle-network/agent-runtime`.
 *
 * Execution state — long-running agent execution, reconnect, replay,
 * dedup — lives in the substrate (`@tangle-network/sandbox` SDK +
 * orchestrator). agent-runtime owns the layer above:
 *
 *   - `AgentExecutionHandle` — the typed pointer products persist so a
 *     reconnect lands on the same substrate execution instead of starting
 *     a second prompt.
 *   - `ChatTurnEngine` — the framework-neutral turn lifecycle: NDJSON
 *     framing, `session.run.*` envelope, persist / post-process / trace-
 *     flush hook ordering. Wraps any producer; the producer talks to the
 *     substrate.
 */

// ── Chat-turn engine ──────────────────────────────────────────────────
export type {
  ChatStreamEvent,
  ChatTurnHooks,
  ChatTurnIdentity,
  ChatTurnProducer,
  ChatTurnResult,
  RunChatTurnInput,
} from './chat-engine'
export { ChatTurnEngine, chatTurnEngine } from './chat-engine'
// ── Execution-continuity contract ─────────────────────────────────────
export type { AgentExecutionHandle, ReconnectableAgentStream } from './execution-handle'
export { deriveExecutionId } from './execution-handle'
