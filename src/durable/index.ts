/**
 * Durable-run substrate for `@tangle-network/agent-runtime`.
 *
 * Public surface — what consumers import. Implementations live in
 * sibling files (in-memory / file-system / D1). Runner + ctx live in
 * runner.ts. Identity helpers live in identity.ts.
 *
 * See `./types.ts` for the full type contract and concurrency model.
 */

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

export { canonicalHash, canonicalJson, deriveWorkerId, manifestHash, stepId } from './identity'

export { InMemoryDurableRunStore } from './in-memory-store'
export { FileSystemDurableRunStore } from './file-system-store'

export type { DurableContext, RunDurableInput, RunDurableResult } from './runner'
export { runDurable } from './runner'
