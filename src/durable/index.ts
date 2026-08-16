/**
 * Turn-lifecycle helpers for `@tangle-network/agent-runtime`.
 *
 * Long-running execution, reconnect, replay, and duplicate-dispatch
 * protection live in `@tangle-network/sandbox` and its orchestrator.
 * agent-runtime owns:
 *
 *   - `handleChatTurn`: framework-neutral turn lifecycle with NDJSON framing,
 *     `session.run.*` envelope, persist / post-process / trace-flush
 *     hook ordering.
 *   - `deriveExecutionId`: convention helper for the stable id products
 *     persist and pass as both execution and turn identity on dispatch.
 *   - `discoverDurableSupervisionRun`: inspect a durable supervision directory
 *     without already knowing the root/run identities written inside it.
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
export {
  type DurableCoordinationStreamIdentity,
  type DurableSupervisionDiscovery,
  discoverDurableSupervisionRun,
} from './supervision-discovery'
