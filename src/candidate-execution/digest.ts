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

/** Returns a detached, deeply frozen JSON value with canonical number normalization. */
export function immutableCandidateValue<T>(value: T): T {
  return deepFreezeCandidate(
    JSON.parse(Buffer.from(canonicalCandidateBytes(value)).toString('utf8')) as T,
  )
}

export function canonicalCandidateDocument<T extends { digest: Sha256Digest }>(
  valueWithoutDigest: Omit<T, 'digest'>,
): CanonicalCandidateDocument<T> {
  const bytes = canonicalCandidateBytes(valueWithoutDigest)
  const digest = canonicalCandidateDigest(valueWithoutDigest)
  if (sha256Bytes(bytes) !== digest) {
    throw new Error('canonical candidate serializers disagree on document digest')
  }
  const storedBytes = Uint8Array.from(bytes)
  const value = immutableCandidateValue({ ...valueWithoutDigest, digest }) as T
  return Object.freeze({
    value,
    get bytes(): Uint8Array {
      return Uint8Array.from(storedBytes)
    },
    digest,
  })
}

export function verifyCanonicalCandidateDocument<T extends { digest: Sha256Digest }>(
  value: T,
  label: string,
): T {
  if (canonicalCandidateDigest(omitTopLevelDigest(value)) !== value.digest) {
    throw new Error(`${label} digest does not match`)
  }
  return immutableCandidateValue(value)
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

export function deepFreezeCandidate<T>(value: T, seen = new Set<object>()): T {
  if (
    value === null ||
    typeof value !== 'object' ||
    ArrayBuffer.isView(value) ||
    seen.has(value as object)
  ) {
    return value
  }
  seen.add(value as object)
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeCandidate(child, seen)
  }
  return Object.freeze(value)
}
