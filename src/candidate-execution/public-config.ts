import type { AgentCandidateConfigValue } from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'

/** Candidate execution has no private secret resolver; never lower a reference to argv or env. */
export function requirePublicCandidateConfigValue(
  value: AgentCandidateConfigValue,
  path: string,
): string {
  if (value.kind !== 'public') {
    throw new ValidationError(`candidate ${path} requires a public value; secret references are unsupported`)
  }
  return value.value
}
