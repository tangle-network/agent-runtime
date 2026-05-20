/**
 * Durable-run substrate for `@tangle-network/agent-runtime`.
 *
 * Public surface — what consumers import. Implementations live in
 * sibling files (in-memory / file-system / D1). Runner + ctx live in
 * runner.ts. Identity helpers live in identity.ts.
 *
 * See `./types.ts` for the full type contract and concurrency model.
 */

export type { D1DatabaseLike, D1PreparedStatementLike } from './d1-store'
export { D1DurableRunStore } from './d1-store'
export { FileSystemDurableRunStore } from './file-system-store'
export { canonicalHash, canonicalJson, deriveWorkerId, manifestHash, stepId } from './identity'
export { InMemoryDurableRunStore } from './in-memory-store'
export type { DurableContext, RunDurableInput, RunDurableResult } from './runner'
export { runDurable } from './runner'
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
