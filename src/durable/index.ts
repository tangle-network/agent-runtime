/**
 * `/durable` — the chat turn envelope and the records of a supervised run
 * directory. It does not own execution recovery.
 *
 * - Turn envelope: `handleChatTurn` frames one chat turn (NDJSON, `session.run.*`,
 *   persist / post-process / trace-flush hook order) and `deriveExecutionId`
 *   names it. Agent App's `/chat-routes` composes both and owns buffered turn
 *   events, replay, running-turn claims and route persistence.
 * - Run directory: `supervisePursuit` is the operator entrypoint that owns one
 *   directory for a `supervise()` run. It holds `supervise.lock`
 *   (`acquireRunDirectoryLock`), writes `result.json` or `failure.json`
 *   (`readSettleRecord`, `readFailureRecord`), and gives the run a cross-run
 *   pursuit identity, `fork` lineage and judged `versions`. Products do not use
 *   it for durability; they use Agent App turns.
 * - Observation: `FileObserverJournal` is the tamper-evident third-person
 *   history of one execution, and `projectPursuit` is a rebuildable read model
 *   over it. It carries identities, usage, cost provenance, timing and receipts.
 *   It owns no execution or coordination semantics.
 * - `discoverDurableSupervisionRun` and `readRootStream` read an existing
 *   directory without knowing its identities.
 *
 * Execution recovery belongs to `/kernel`. That covers retained provider runs
 * (`startRetainedRun`, `recoverRetainedRun`, `reconnectRetainedRun`), the spawn
 * journal that `supervise` replays, and shared-SQL ownership
 * (`createFencedSqlRunContext`). See `docs/durability.md` for the full owner map.
 */
export {
  ROOT_STREAM_FILE,
  type RootStreamReceipt,
  type RootStreamRecord,
  readRootStream,
  readRootStreamReceipt,
} from '../runtime/supervise/root-stream'
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
  FileObserverJournal,
  type ObserverJournal,
  type ObserverRecord,
  type ObserverRecordKind,
  observerRecordDigest,
  verifyObserverRecords,
} from './observer-journal'
export {
  type PursuitCostProvenance,
  type PursuitNodeCost,
  type PursuitNodePlacement,
  type PursuitNodePlatform,
  type PursuitNodeProjection,
  type PursuitNodeTiming,
  type PursuitNodeUsage,
  type PursuitProjection,
  type PursuitRunProjection,
  type PursuitRunTotals,
  type PursuitStatus,
  projectPursuit,
} from './observer-projection'
export type { PursuitObserverDelivery } from './pursuit-observer-delivery'
export {
  assertPursuitVersions,
  type JudgedPursuitVersion,
  type NextPursuitVersion,
  type NextPursuitVersionInput,
  type PursuitVersionChain,
  type PursuitVersionStop,
  type PursuitVersions,
  type SettledPursuitVersion,
  type VersionJudge,
  type VersionVerdict,
} from './pursuit-versions'
export {
  type PursuitFork,
  RUN_FORK_CORRELATION_KEYS,
} from './run-fork'
export {
  acquireRunDirectoryLock,
  type RunDirectoryHolderLiveness,
  type RunDirectoryLock,
  RunDirectoryLockedError,
  type RunDirectoryLockHolder,
  readRunDirectoryLock,
  runDirectoryHolderIsLive,
} from './run-lock'
export {
  type DurableFailureRecord,
  readFailureRecord,
  readSettleRecord,
  SettledRunDirectoryError,
} from './settle-record'
export {
  type SupervisedPursuitResult,
  SupervisePursuitError,
  type SupervisePursuitOptions,
  supervisePursuit,
} from './supervise-pursuit'
export {
  type DurableCoordinationStreamIdentity,
  type DurableSupervisionDiscovery,
  discoverDurableSupervisionRun,
} from './supervision-discovery'
