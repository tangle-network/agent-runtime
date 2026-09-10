import { AgentTurnResultSchema } from '@tangle-network/agent-interface'
import type { ExecutorResult } from './types'

const outcomeSchema = AgentTurnResultSchema.pick({ success: true, error: true }).strict()

/** Read only the executor envelope; application output and grades are not execution status. */
export function executorFailureReason(
  result: Pick<ExecutorResult<unknown>, 'outcome'>,
): string | undefined {
  if (result.outcome === undefined) return undefined
  const outcome = outcomeSchema.parse(result.outcome)
  return outcome.success ? undefined : (outcome.error ?? 'Agent execution failed')
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
