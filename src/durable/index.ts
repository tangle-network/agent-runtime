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
 *     for one concrete Runtime execution.
 *   - `projectPursuit`: a rebuildable operator read model over that history;
 *     it owns no execution or coordination semantics.
 *   - `supervisePursuit`: one-call adapter over canonical `supervise()` that
 *     gives each isolated run a stable cross-run pursuit identity.
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
  type PursuitNodeProjection,
  type PursuitNodeStatus,
  type PursuitProjection,
  type PursuitRunProjection,
  type PursuitRunStatus,
  projectPursuit,
} from './observer-projection'
export {
  SupervisePursuitError,
  type SupervisedPursuitResult,
  type SupervisePursuitOptions,
  supervisePursuit,
} from './supervise-pursuit'
export {
  type DurableCoordinationStreamIdentity,
  type DurableSupervisionDiscovery,
  discoverDurableSupervisionRun,
} from './supervision-discovery'
