/**
 * The credentials one coordination listener accepts: the manager's bearer token (random, or an HMAC
 * claim set under caller-owned signing keys), separate read-only and control tokens, rotation and the
 * revocation of every token it replaces.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { ConfigError } from '../../errors'
import type { CoordinationAuthentication } from './coordination-mcp'

/** Exact operator authority, independent of the manager's authored tool grants. */
export const coordinationControlToolNames = Object.freeze([
  'observe_agent',
  'read_journal',
  'steer_agent',
  'cancel_worker',
] as const)

export interface CoordinationCredentials {
  /** Revoke the current token and mint another. */
  rotate(): void
  /** Bind tokens to the endpoint they were minted for; set once the address is known. */
  setAudience(audience: string): void
  /**
   * Why a supplied credential is refused, or undefined when valid. It lives as long as the scope
   * it fronts: until the scope's signal aborts (cancellation, the run's deadline, a lead stopping
   * its child), within an explicit `ttlMs`, and until rotation revokes it. A child's own time box
   * does not abort it: the check-in (`deadline.ts` `DeadlineCheckIn`) asks it to submit through
   * these very tools, and refusing at the time box blocked that (eu-datacenter-power-2030-
   * 20261010b:s3, every call for its last 41 minutes).
   */
  refused(supplied: Buffer): 'scope-stopped' | 'credential-refused' | undefined
  /** Whether a supplied read-only credential is refused. */
  readerRefused(supplied: Buffer): boolean
  /** The independent operator capability never authorizes the manager endpoint. */
  controllerRefused(supplied: Buffer): 'scope-stopped' | 'credential-refused' | undefined
  readonly headers: Readonly<Record<string, string>>
  readonly expiresAt: number | undefined
  readonly readerToken: Buffer
  readonly controllerHeaders: Readonly<Record<string, string>>
}

/** The bearer token in an `Authorization` header, or an empty buffer. */
export function bearerToken(authorization: string | undefined): Buffer {
  return typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? Buffer.from(authorization.slice(7))
    : Buffer.alloc(0)
}

export function createCoordinationCredentials(input: {
  readonly authentication: true | CoordinationAuthentication | undefined
  readonly identity: { readonly runId: string; readonly actorId: string }
  readonly toolNames: ReadonlyArray<string>
  readonly scopeSignal: AbortSignal
  readonly lifetimeSignal?: AbortSignal
  readonly isClosed: () => boolean
}): CoordinationCredentials {
  const { identity } = input
  const auth = typeof input.authentication === 'object' ? input.authentication : undefined
  const signingKeys = auth?.signingKeys
    ? { activeKeyId: auth.signingKeys.activeKeyId, keys: { ...auth.signingKeys.keys } }
    : undefined
  let readerToken = Buffer.from(randomBytes(32).toString('base64url'))
  let controllerToken = Buffer.from(randomBytes(32).toString('base64url'))
  let token: Buffer | undefined
  let expiresAt: number | undefined
  let headers: Readonly<Record<string, string>> = Object.freeze({})
  let audience = ''
  const revoked = new Map<string, number>()
  const grantDigest = createHash('sha256')
    .update(JSON.stringify([...input.toolNames].sort()))
    .digest('hex')

  const rotate = () => {
    if (!input.authentication)
      throw new ConfigError('coordination authentication is not configured')
    if (input.isClosed()) throw new ConfigError('coordination server is closed')
    // Without `ttlMs` the credential carries no expiry: it lives as long as the scope
    // (`refused`), and a scope's deadline is not always its stop.
    const nextExpiry = auth?.ttlMs === undefined ? undefined : Date.now() + auth.ttlMs
    if (nextExpiry !== undefined && !Number.isSafeInteger(nextExpiry)) {
      throw new ConfigError('coordination credential expiry must remain a safe integer')
    }
    for (const [credential, expiry] of revoked) {
      if (expiry <= Date.now()) revoked.delete(credential)
    }
    if (token) revoked.set(token.toString(), expiresAt ?? Number.POSITIVE_INFINITY)
    expiresAt = nextExpiry
    const nonce = randomBytes(32).toString('base64url')
    let text = nonce
    if (signingKeys) {
      const payload = Buffer.from(
        JSON.stringify({
          key: signingKeys.activeKeyId,
          run: identity.runId,
          actor: identity.actorId,
          audience,
          grants: grantDigest,
          expires: expiresAt ?? null,
          nonce,
        }),
      ).toString('base64url')
      const signature = createHmac('sha256', signingKeys.keys[signingKeys.activeKeyId]!)
        .update(payload)
        .digest('base64url')
      text = `${payload}.${signature}`
    }
    readerToken = Buffer.from(randomBytes(32).toString('base64url'))
    controllerToken = Buffer.from(randomBytes(32).toString('base64url'))
    token = Buffer.from(text)
    headers = Object.freeze({ Authorization: `Bearer ${text}` })
  }

  const valid = (supplied: Buffer): boolean => {
    if (revoked.has(supplied.toString())) return false
    if (!signingKeys)
      return (
        token !== undefined &&
        (expiresAt === undefined || Date.now() < expiresAt) &&
        supplied.length === token.length &&
        timingSafeEqual(supplied, token)
      )
    if (supplied.length > 8192) return false
    try {
      const parts = supplied.toString().split('.')
      if (parts.length !== 2) return false
      const payload = parts[0]!
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      if (!claims || typeof claims.key !== 'string' || !Object.hasOwn(signingKeys.keys, claims.key))
        return false
      const expected = createHmac('sha256', signingKeys.keys[claims.key]!).update(payload).digest()
      const signature = Buffer.from(parts[1]!, 'base64url')
      return (
        // Revocation keys use the wire token; alternate encodings must not alias it.
        signature.toString('base64url') === parts[1] &&
        signature.length === expected.length &&
        timingSafeEqual(signature, expected) &&
        claims.run === identity.runId &&
        claims.actor === identity.actorId &&
        claims.audience === audience &&
        claims.grants === grantDigest &&
        ((claims.expires === null && auth?.ttlMs === undefined) ||
          (Number.isSafeInteger(claims.expires) && claims.expires > Date.now()))
      )
    } catch {
      return false
    }
  }

  const capabilityRefused = (supplied: Buffer, expected: Buffer) =>
    input.isClosed() ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected) ||
    (expiresAt !== undefined && expiresAt <= Date.now())

  return {
    rotate,
    setAudience: (next) => {
      audience = next
    },
    refused: (supplied) => {
      if (input.scopeSignal.aborted) return 'scope-stopped'
      return valid(supplied) ? undefined : 'credential-refused'
    },
    readerRefused: (supplied) =>
      input.scopeSignal.aborted ||
      input.lifetimeSignal?.aborted === true ||
      capabilityRefused(supplied, readerToken),
    controllerRefused: (supplied) => {
      if (input.scopeSignal.aborted || input.lifetimeSignal?.aborted) return 'scope-stopped'
      return capabilityRefused(supplied, controllerToken) ? 'credential-refused' : undefined
    },
    get headers() {
      return headers
    },
    get expiresAt() {
      return expiresAt
    },
    get readerToken() {
      return readerToken
    },
    get controllerHeaders() {
      return Object.freeze({ Authorization: `Bearer ${controllerToken.toString()}` })
    },
  }
}
