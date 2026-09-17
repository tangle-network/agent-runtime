import { AgentTurnResultSchema } from '@tangle-network/agent-interface'
import type { ExecutorResult } from './types'

// `errorCode` reuses the interface's own optional-string schema, so the envelope stays strict
// without this package importing a second copy of zod.
const outcomeSchema = AgentTurnResultSchema.pick({ success: true, error: true })
  .extend({ errorCode: AgentTurnResultSchema.shape.error })
  .strict()

/** Why an executor's own envelope says the execution failed, with the provider's machine code
 *  when it reported one. */
export interface ExecutorFailure {
  readonly error: string
  readonly errorCode?: string
}

/** Read only the executor envelope; application output and grades are not execution status. */
export function executorFailure(
  result: Pick<ExecutorResult<unknown>, 'outcome'>,
): ExecutorFailure | undefined {
  if (result.outcome === undefined) return undefined
  const outcome = outcomeSchema.parse(result.outcome)
  if (outcome.success) return undefined
  return {
    error: outcome.error ?? 'Agent execution failed',
    ...(outcome.errorCode === undefined ? {} : { errorCode: outcome.errorCode }),
  }
}

/** The failure text alone, for callers that record a settlement reason. */
export function executorFailureReason(
  result: Pick<ExecutorResult<unknown>, 'outcome'>,
): string | undefined {
  return executorFailure(result)?.error
}

/** Preserve deterministic result pointers across built-in executors and replay.
 * FNV-1a is an identity convention here, not a cryptographic integrity check. */
export function contentRef(prefix: string, value: unknown): string {
  let str: string
  try {
    str = JSON.stringify(value) ?? String(value)
  } catch {
    str = String(value)
  }
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${prefix}:${(h >>> 0).toString(16).padStart(8, '0')}`
}
