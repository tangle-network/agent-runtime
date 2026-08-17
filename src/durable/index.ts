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
 *   - `FileObserverJournal`: tamper-evident, append-only third-person history
 *     for a pursuit, fed by Runtime's existing hook stream.
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
  createFileObserverHooks,
  FileObserverJournal,
  type ObserverJournal,
  type ObserverRecord,
  type ObserverRecordKind,
  observerRecordDigest,
  verifyObserverRecords,
} from './observer-journal'
export {
  type DurableCoordinationStreamIdentity,
  type DurableSupervisionDiscovery,
  discoverDurableSupervisionRun,
} from './supervision-discovery'
