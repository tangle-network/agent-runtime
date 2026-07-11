import type { AgentCandidateBundle } from '@tangle-network/agent-interface'
import { agentCandidateBundleSchema } from '@tangle-network/agent-interface'

import { canonicalCandidateDigest, immutableCandidateValue, omitTopLevelDigest } from './digest'

/** Exact candidate wire shape before the runtime computes its canonical digest. */
export type AgentCandidateBundleInput = Omit<AgentCandidateBundle, 'digest'>

/** Validate and content-address a candidate bundle before it crosses an approval boundary. */
export function sealAgentCandidateBundle(input: AgentCandidateBundleInput): AgentCandidateBundle {
  const digest = canonicalCandidateDigest(input)
  const parsed = agentCandidateBundleSchema.parse({ ...input, digest })
  const parsedDigest = canonicalCandidateDigest(omitTopLevelDigest(parsed))
  if (parsedDigest !== digest) {
    throw new Error('candidate bundle changed while validating its canonical wire shape')
  }
  return immutableCandidateValue(parsed)
}
