/**
 * Durable-run substrate for `@tangle-network/agent-runtime`.
 *
 * Public surface — what consumers import. Implementations live in
 * sibling files (in-memory / file-system / D1). Runner + ctx live in
 * runner.ts. Identity helpers live in identity.ts.
 *
 * See `./types.ts` for the full type contract and concurrency model.
 */

// ── Durable chat-turn engine ──────────────────────────────────────────
// Framework-neutral chat-turn orchestrator: durable turn + NDJSON
// streaming + session.run.* lifecycle + product persist/post-process
// hooks. Every product chat handler routes through this.
export type {
  ChatStreamEvent,
  ChatTurnHooks,
  ChatTurnIdentity,
  ChatTurnResult,
  RunChatTurnInput,
} from './chat-engine'
export { DurableChatTurnEngine, durableChatTurnEngine } from './chat-engine'
export type { D1DatabaseLike, D1PreparedStatementLike } from './d1-store'
export { D1DurableRunStore } from './d1-store'
export { FileSystemDurableRunStore } from './file-system-store'
export { canonicalHash, canonicalJson, deriveWorkerId, manifestHash, stepId } from './identity'
export { InMemoryDurableRunStore } from './in-memory-store'
export type { DurableContext, RunDurableInput, RunDurableResult } from './runner'
export { runDurable } from './runner'
// Canonical D1 schema string + current version. Consumers wire via
//   await env.DB.exec(DURABLE_SCHEMA_SQL)
// during one-time bootstrap. `src/durable/schema.sql` is the source of
// truth; `schema.ts` is the build-bundled string that ships in dist/.
export { DURABLE_SCHEMA_SQL, DURABLE_SCHEMA_VERSION } from './schema'
// ── Durable turn primitive ────────────────────────────────────────────
// Streaming, backend-agnostic, checkpoint+replay durable turn. The single
// reusable primitive every product chat handler routes through.
export type {
  DurableTurnHandle,
  DurableTurnProducer,
  RunDurableTurnOptions,
} from './turn'
export { runDurableTurn } from './turn'
// ── Cross-worker sandbox-reconnect durability ─────────────────────────
// Checkpoints a substrate run handle at turn start so a fresh worker can
// re-attach to an in-flight sandbox run instead of re-running a long turn.
export type {
  ReconnectableTurnHandle,
  ReconnectableTurnMode,
  ReconnectableTurnProducer,
  ReconnectProduce,
  ReconnectableProduce,
  RunHandle,
  RunReconnectableTurnOptions,
} from './run-handle'
export { runReconnectableTurn } from './run-handle'
export type {
  DurableRunManifest,
  DurableRunStore,
  EventRecord,
  RunOutcome,
  RunRecord,
  RunStatus,
  StepError,
  StepKind,
  StepRecord,
  StepStatus,
} from './types'
export {
  DurableAwaitEventTimeoutError,
  DurableRunDivergenceError,
  DurableRunError,
  DurableRunInputMismatchError,
  DurableRunLeaseHeldError,
} from './types'

// ── Cloudflare Workflows integration ──────────────────────────────────
export type {
  RunOnWorkflowStepInput,
  WorkflowStepConfig,
  WorkflowStepLike,
} from './workflows'
export { runOnWorkflowStep } from './workflows'
