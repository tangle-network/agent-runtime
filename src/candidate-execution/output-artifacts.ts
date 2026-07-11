import {
  type AgentCandidateArtifactRef,
  agentCandidateArtifactRefSchema,
} from '@tangle-network/agent-interface'

import { verifyBytes } from './artifacts'
import { immutableCandidateValue, sha256Bytes } from './digest'
import type { AgentCandidateOutputArtifactPort, AgentCandidateOutputPurpose } from './types'

/** Persist evaluator evidence, read it back, and bind the returned locator to the exact bytes. */
export async function persistCandidateOutputArtifact(
  port: AgentCandidateOutputArtifactPort,
  input: {
    executionId: string
    purpose: AgentCandidateOutputPurpose
    bytes: Uint8Array
    signal?: AbortSignal
  },
): Promise<AgentCandidateArtifactRef> {
  input.signal?.throwIfAborted()
  const bytes = Uint8Array.from(input.bytes)
  const expectedDigest = sha256Bytes(bytes)
  const ref = agentCandidateArtifactRefSchema.parse(
    await port.put({
      executionId: input.executionId,
      purpose: input.purpose,
      bytes: Uint8Array.from(bytes),
      ...(input.signal ? { signal: input.signal } : {}),
    }),
  )
  input.signal?.throwIfAborted()
  if (ref.sha256 !== expectedDigest || ref.byteLength !== bytes.byteLength) {
    throw new Error('candidate output locator does not identify the submitted bytes')
  }
  const stored = await port.read(ref)
  input.signal?.throwIfAborted()
  verifyBytes(stored, expectedDigest, bytes.byteLength, 'persisted candidate output')
  return immutableCandidateValue(ref)
}
