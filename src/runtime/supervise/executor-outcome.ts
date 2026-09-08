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
