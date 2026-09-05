import { createHash } from 'node:crypto'
import {
  type AgentCandidateEmbeddedArtifact,
  canonicalCandidateBytes,
  type Sha256Digest,
} from '@tangle-network/agent-interface'

import type { CanonicalCandidateDocument } from './types'

export { canonicalCandidateBytes }

/** Use native hashing for workspace archives. */
export function sha256Bytes(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

export function canonicalCandidateDigest(value: unknown): Sha256Digest {
  return sha256Bytes(canonicalCandidateBytes(value))
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
  const digest = sha256Bytes(bytes)
  const value = deepFreezeCandidate({
    ...JSON.parse(Buffer.from(bytes).toString('utf8')),
    digest,
  }) as T
  return Object.freeze({
    value,
    get bytes(): Uint8Array {
      return Uint8Array.from(bytes)
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
