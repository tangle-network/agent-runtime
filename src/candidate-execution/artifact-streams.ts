import { createHash } from 'node:crypto'
import {
  type AgentCandidateArtifactRef,
  type AgentCandidateCapturedArtifact,
  agentCandidateArtifactRefSchema,
} from '@tangle-network/agent-interface'
import { immutableCandidateValue } from './digest'
import type {
  AgentCandidateArtifactPort,
  AgentCandidateOutputArtifactPort,
  AgentCandidateOutputPurpose,
} from './types'

/** Verify the complete stream, including its final digest, before accepting its consumer's result. */
export async function* verifiedArtifactChunks(
  artifact: AgentCandidateCapturedArtifact,
  port: AgentCandidateArtifactPort,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  signal?.throwIfAborted()
  if (!('content' in artifact) && !port.readStream) {
    throw new Error('streaming workspace artifacts require readStream')
  }
  const chunks =
    'content' in artifact
      ? [Buffer.from(artifact.content, 'base64')]
      : port.readStream!(artifact, { signal })
  const hash = createHash('sha256')
  let byteLength = 0
  for await (const chunk of chunks) {
    signal?.throwIfAborted()
    if (!(chunk instanceof Uint8Array))
      throw new Error('candidate artifact emitted a non-byte chunk')
    byteLength += chunk.byteLength
    if (byteLength > artifact.byteLength)
      throw new Error('candidate artifact exceeds its declared length')
    hash.update(chunk)
    yield chunk
  }
  signal?.throwIfAborted()
  if (byteLength !== artifact.byteLength || `sha256:${hash.digest('hex')}` !== artifact.sha256) {
    throw new Error('candidate artifact failed digest or length verification')
  }
}

/** Stream evaluator evidence into its existing store and verify durable readback before returning. */
export async function persistCandidateOutputArtifactStream(
  port: AgentCandidateOutputArtifactPort,
  input: {
    executionId: string
    purpose: AgentCandidateOutputPurpose
    chunks: AsyncIterable<Uint8Array>
    maxBytes: number
    signal?: AbortSignal
  },
): Promise<AgentCandidateArtifactRef> {
  if (!port.putStream || !port.readStream) {
    throw new Error('streaming workspace persistence requires putStream and readStream')
  }
  input.signal?.throwIfAborted()
  const hash = createHash('sha256')
  let byteLength = 0
  let consumed = false
  async function* checked(): AsyncGenerator<Uint8Array> {
    for await (const chunk of input.chunks) {
      input.signal?.throwIfAborted()
      if (!(chunk instanceof Uint8Array))
        throw new Error('candidate artifact emitted a non-byte chunk')
      byteLength += chunk.byteLength
      if (byteLength > input.maxBytes)
        throw new Error('candidate workspace archive exceeds maxArchiveBytes')
      hash.update(chunk)
      yield chunk
    }
    consumed = true
    input.signal?.throwIfAborted()
  }
  const chunks = checked()
  try {
    const ref = agentCandidateArtifactRefSchema.parse(
      await port.putStream({
        executionId: input.executionId,
        purpose: input.purpose,
        chunks,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    )
    input.signal?.throwIfAborted()
    if (
      !consumed ||
      ref.sha256 !== `sha256:${hash.digest('hex')}` ||
      ref.byteLength !== byteLength
    ) {
      throw new Error('candidate output locator does not identify the submitted bytes')
    }
    for await (const _chunk of verifiedArtifactChunks(ref, port, input.signal)) {
      // Verification consumes the durable object without retaining it.
    }
    return immutableCandidateValue(ref)
  } finally {
    await chunks.return(undefined)
  }
}
