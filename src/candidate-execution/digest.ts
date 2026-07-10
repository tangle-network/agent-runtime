import { createHash } from 'node:crypto'
import { canonicalJson } from '@tangle-network/agent-eval'
import type { AgentCandidateEmbeddedArtifact, Sha256Digest } from '@tangle-network/agent-interface'

import { contentAddress } from '../durable/spawn-journal'
import type { CanonicalCandidateDocument } from './types'

export function sha256Bytes(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

export function canonicalCandidateBytes(value: unknown): Uint8Array {
  return Buffer.from(canonicalJson(value), 'utf8')
}

export function canonicalCandidateDigest(value: unknown): Sha256Digest {
  return contentAddress(value) as Sha256Digest
}

export function canonicalCandidateDocument<T extends { digest: Sha256Digest }>(
  valueWithoutDigest: Omit<T, 'digest'>,
): CanonicalCandidateDocument<T> {
  const bytes = canonicalCandidateBytes(valueWithoutDigest)
  const digest = canonicalCandidateDigest(valueWithoutDigest)
  if (sha256Bytes(bytes) !== digest) {
    throw new Error('canonical candidate serializers disagree on document digest')
  }
  return {
    value: { ...valueWithoutDigest, digest } as T,
    bytes,
    digest,
  }
}

export function embeddedCandidateArtifact(bytes: Uint8Array): AgentCandidateEmbeddedArtifact {
  return {
    encoding: 'base64',
    content: Buffer.from(bytes).toString('base64'),
    sha256: sha256Bytes(bytes),
    byteLength: bytes.byteLength,
  }
}

export function omitTopLevelDigest<T extends { digest: Sha256Digest }>(
  value: T,
): Omit<T, 'digest'> {
  const { digest: _digest, ...rest } = value
  return rest
}
