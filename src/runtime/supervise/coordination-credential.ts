import { createHmac, randomBytes } from 'node:crypto'
import { type ProxySecretResolvedIdentity, ProxySecretResolvedIdentitySchema } from '@tangle-network/agent-interface/environment-provider'
import { type ProxySecretIssuerPolicy, validateSecretCreateOptions } from '@tangle-network/sandbox'
import { z } from 'zod'
import { ConfigError } from '../../errors'
import { detachedSnapshot } from './snapshot'

/** Host-owned replay metadata. Its nonce is public only because the credential is signed. */
const signedGeneration = z.object({
  runId: z.string().min(1),
  actorId: z.string().min(1),
  audience: z.string().url(),
  grants: z.string().regex(/^[a-f0-9]{64}$/),
  keyId: z.string().min(1),
  expiresAt: z.number().int().safe().positive().nullable(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict()

export type CoordinationSignedCredentialGeneration = z.infer<typeof signedGeneration>

export function captureCoordinationSignedCredentialGeneration(value: unknown): CoordinationSignedCredentialGeneration {
  const parsed = signedGeneration.safeParse(value)
  if (!parsed.success || Buffer.from(parsed.data.nonce, 'base64url').toString('base64url') !== parsed.data.nonce) {
    throw new ConfigError('coordination signed credential generation is invalid')
  }
  return Object.freeze(parsed.data)
}

export function createCoordinationSignedCredentialGeneration(
  declaration: Omit<CoordinationSignedCredentialGeneration, 'nonce'>,
): CoordinationSignedCredentialGeneration {
  return captureCoordinationSignedCredentialGeneration({ ...declaration, nonce: randomBytes(32).toString('base64url') })
}

export function signCoordinationCredentialGeneration(
  generation: CoordinationSignedCredentialGeneration,
  keys: Readonly<Record<string, string>>,
  expected: Pick<CoordinationSignedCredentialGeneration, 'runId' | 'actorId' | 'audience' | 'grants'>,
  ttlMs: number | undefined,
): string {
  const credential = captureCoordinationSignedCredentialGeneration(generation)
  const key = Object.hasOwn(keys, credential.keyId) ? keys[credential.keyId] : undefined
  if (!key || credential.runId !== expected.runId || credential.actorId !== expected.actorId ||
      credential.audience !== expected.audience || credential.grants !== expected.grants ||
      (ttlMs === undefined ? credential.expiresAt !== null : credential.expiresAt === null ||
        credential.expiresAt <= Date.now() || credential.expiresAt > Date.now() + ttlMs)) {
    throw new ConfigError('coordination signed credential generation does not match the live actor')
  }
  const payload = Buffer.from(JSON.stringify({
    key: credential.keyId,
    run: credential.runId,
    actor: credential.actorId,
    audience: credential.audience,
    grants: credential.grants,
    expires: credential.expiresAt,
    nonce: credential.nonce,
  })).toString('base64url')
  const signature = createHmac('sha256', key).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

/** Immutable, metadata-only identity of the existing encrypted source, supplied by its owner. */
export interface CoordinationProxySecretSourceIdentity {
  readonly identity: ProxySecretResolvedIdentity
  readonly key: string
  readonly sourceValidUntil: string
  readonly proxyPolicy: ProxySecretIssuerPolicy
  readonly expiresAt: string
}

const sourceIdentity = z.object({
  identity: ProxySecretResolvedIdentitySchema,
  key: z.string().min(1),
  sourceValidUntil: z.iso.datetime(),
  proxyPolicy: z.unknown(),
  expiresAt: z.iso.datetime(),
}).strict()

export function captureCoordinationProxySecretSourceIdentity(value: unknown): CoordinationProxySecretSourceIdentity {
  const parsed = sourceIdentity.safeParse(value)
  if (!parsed.success) throw new ConfigError('coordination proxy source identity is invalid')
  try {
    const registration = validateSecretCreateOptions({
      sourceValidUntil: parsed.data.sourceValidUntil,
      proxyPolicy: parsed.data.proxyPolicy,
    })
    if (!registration.proxyPolicy || registration.sourceValidUntil !== parsed.data.sourceValidUntil ||
        Date.parse(parsed.data.expiresAt) > Date.parse(parsed.data.sourceValidUntil)) {
      throw new Error('unbounded source')
    }
    return detachedSnapshot({
      ...parsed.data,
      proxyPolicy: registration.proxyPolicy,
    }, 'coordination proxy source identity')
  } catch {
    throw new ConfigError('coordination proxy source identity is invalid')
  }
}
