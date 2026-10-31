import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { DEFAULT_MAX_EXECUTION_TTL_MS } from '@tangle-network/sandbox'
import { ConfigError } from '../../errors'
import type { CoordinationAuthentication } from './coordination-mcp'

export const coordinationControlToolNames = Object.freeze([
  'observe_agent',
  'read_journal',
  'steer_agent',
  'cancel_worker',
] as const)

type Headers = Readonly<Record<string, string>>
export interface CoordinationCredentials {
  rotate(): void
  /** Both bearers remain valid until the trusted holder acknowledges installation. */
  replace(install: (headers: Headers) => Promise<void>): Promise<void>
  setAudience(audience: string): void
  refused(supplied: Buffer): 'scope-stopped' | 'credential-refused' | undefined
  readerRefused(supplied: Buffer): boolean
  controllerRefused(supplied: Buffer): 'scope-stopped' | 'credential-refused' | undefined
  readonly headers: Headers
  readonly expiresAt: number | undefined
  readonly readerToken: Buffer
  readonly controllerHeaders: Headers
}

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
  readonly lifetimeExpiresAt?: number
  readonly isClosed: () => boolean
  /** This actor's signed bearer arrived expired: no renewal reached its holder. */
  readonly onExpiredBearer?: () => void
}): CoordinationCredentials {
  const auth = typeof input.authentication === 'object' ? input.authentication : undefined
  const signingKeys = auth?.signingKeys
    ? { activeKeyId: auth.signingKeys.activeKeyId, keys: { ...auth.signingKeys.keys } }
    : undefined
  const randomToken = () => Buffer.from(randomBytes(32).toString('base64url'))
  let readerToken = randomToken(),
    controllerToken = randomToken(),
    audience = ''
  // A renewal never shortens a lease: an acknowledged installation can miss the bearer's holder.
  let current: ReturnType<typeof issue> | undefined,
    staged: ReturnType<typeof issue> | undefined,
    prior: ReturnType<typeof issue> | undefined
  let allowLegacy = true
  const revoked = new Map<string, number>()
  const grants = createHash('sha256')
    .update(JSON.stringify([...input.toolNames].sort()))
    .digest('hex')
  const { runId: run, actorId: actor } = input.identity
  function issue() {
    if (!input.authentication || input.isClosed())
      throw new ConfigError('coordination authentication is unavailable')
    const expiresAt = Math.min(
      Date.now() + (auth?.ttlMs ?? DEFAULT_MAX_EXECUTION_TTL_MS),
      input.lifetimeExpiresAt ?? Number.POSITIVE_INFINITY,
    )
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
      throw new ConfigError('coordination credential expiry is not in the future')
    for (const [credential, expiry] of revoked) if (expiry <= Date.now()) revoked.delete(credential)
    let text = randomBytes(32).toString('base64url')
    if (signingKeys) {
      const key = signingKeys.activeKeyId,
        expires = expiresAt,
        nonce = text
      const payload = Buffer.from(
        JSON.stringify({ key, run, actor, audience, grants, expires, nonce }),
      ).toString('base64url')
      const signature = createHmac('sha256', signingKeys.keys[key]!)
        .update(payload)
        .digest('base64url')
      text = `${payload}.${signature}`
    }
    return {
      token: Buffer.from(text),
      expiresAt,
      headers: Object.freeze({ Authorization: `Bearer ${text}` }),
    }
  }
  const commit = (next: ReturnType<typeof issue>, renewal = false) => {
    if (current && !renewal) {
      for (const value of [current, prior])
        if (value) revoked.set(value.token.toString(), value.expiresAt)
      allowLegacy = false
    }
    prior = renewal ? current : undefined
    current = next
    staged = undefined
  }
  const rotate = () => {
    if (staged) throw new ConfigError('coordination credential replacement is pending')
    commit(issue())
    readerToken = randomToken()
    controllerToken = randomToken()
  }
  const replace = async (install: (headers: Headers) => Promise<void>) => {
    if (staged) throw new ConfigError('coordination credential replacement is pending')
    const next = issue()
    staged = next
    try {
      await install(next.headers)
      commit(next, true)
    } catch (error) {
      staged = undefined
      revoked.set(next.token.toString(), next.expiresAt)
      throw error
    }
  }
  const matches = (supplied: Buffer, expected: Buffer) =>
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  const valid = (supplied: Buffer): boolean => {
    if (revoked.has(supplied.toString())) return false
    for (const value of [current, staged, prior])
      if (value && Date.now() < value.expiresAt && matches(supplied, value.token)) return true
    if (!signingKeys || !allowLegacy || supplied.length > 8192) return false
    try {
      const parts = supplied.toString().split('.')
      if (parts.length !== 2) return false
      const payload = parts[0]!,
        claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      if (!claims || typeof claims.key !== 'string' || !Object.hasOwn(signingKeys.keys, claims.key))
        return false
      const expected = createHmac('sha256', signingKeys.keys[claims.key]!).update(payload).digest()
      const signature = Buffer.from(parts[1]!, 'base64url')
      const expiry =
        claims.expires ??
        (allowLegacy && auth?.ttlMs === undefined ? current?.expiresAt : undefined)
      const ours =
        signature.toString('base64url') === parts[1] &&
        matches(signature, expected) &&
        claims.run === run &&
        claims.actor === actor &&
        claims.audience === audience &&
        claims.grants === grants &&
        Number.isSafeInteger(expiry)
      if (ours && expiry <= Date.now()) input.onExpiredBearer?.()
      return (
        ours &&
        expiry > Date.now() &&
        (input.lifetimeExpiresAt === undefined || expiry <= input.lifetimeExpiresAt)
      )
    } catch {
      return false
    }
  }
  const capabilityRefused = (supplied: Buffer, expected: Buffer) =>
    input.isClosed() ||
    !matches(supplied, expected) ||
    (current !== undefined && current.expiresAt <= Date.now())
  const stopped = () => input.scopeSignal.aborted || input.lifetimeSignal?.aborted === true
  return {
    rotate,
    replace,
    setAudience: (next) => {
      audience = next
    },
    refused(supplied) {
      if (input.scopeSignal.aborted) return 'scope-stopped'
      return valid(supplied) ? undefined : 'credential-refused'
    },
    readerRefused: (supplied) => stopped() || capabilityRefused(supplied, readerToken),
    controllerRefused(supplied) {
      if (stopped()) return 'scope-stopped'
      return capabilityRefused(supplied, controllerToken) ? 'credential-refused' : undefined
    },
    get headers() {
      return current?.headers ?? Object.freeze({})
    },
    get expiresAt() {
      return current?.expiresAt
    },
    get readerToken() {
      return readerToken
    },
    get controllerHeaders() {
      return Object.freeze({ Authorization: `Bearer ${controllerToken.toString()}` })
    },
  }
}
