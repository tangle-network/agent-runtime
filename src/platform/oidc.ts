/**
 * OpenID Connect client for the Tangle authorization server. Identity tokens
 * are not platform API keys. Resource scopes and audiences must be registered
 * by the provider before a consumer can use these tokens at a paid API.
 */
import { PlatformAuthError } from './auth.js'

export interface PlatformOidcClientOptions {
  baseUrl: string
  clientId: string
  /** Omit only for clients registered with token_endpoint_auth_method=none. */
  clientSecret?: string
  /** Required for authorization code; not required for the device grant. */
  redirectUri?: string
  scope?: string
  /** RFC 8707 resource identifiers registered at the authorization server. */
  resources?: readonly string[]
  fetchImpl?: typeof fetch
}

export interface OidcAuthorizeUrlOptions {
  state: string
  codeChallenge: string
  /** Only supply a nonce when the consumer also validates the ID token. */
  nonce?: string
  prompt?: 'login' | 'consent' | 'none'
  loginHint?: string
}

export interface OidcTokens {
  accessToken: string
  tokenType: string
  expiresIn?: number
  refreshToken?: string
  idToken?: string
  scope?: string
}

export interface OidcUser {
  id: string
  email: string
  emailVerified: true
  name?: string
}

export interface OidcExchangeResult {
  tokens: OidcTokens
  user: OidcUser
}

/** Keep deviceCode secret. Only userCode and the verification URLs are displayed. */
export interface OidcDeviceAuthorization {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresIn: number
  /** Absolute deadline preserves expiry when a polling process resumes. */
  expiresAt: number
  interval: number
}

const DEFAULT_SCOPE = 'openid profile email offline_access'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Create an RFC 7636 verifier and its S256 challenge with Web Crypto. */
export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

function oauthError(body: unknown, fallback: string): string {
  if (!isRecord(body)) return fallback
  if (isNonemptyString(body.error_description)) return body.error_description
  if (isNonemptyString(body.error)) return body.error
  return fallback
}

function parseTokens(body: unknown, status: number): OidcTokens {
  if (!isRecord(body) || !isNonemptyString(body.access_token)) {
    throw new PlatformAuthError('Platform token response is malformed', status, {
      code: 'INVALID_TOKEN_RESPONSE',
    })
  }
  return {
    accessToken: body.access_token,
    tokenType: isNonemptyString(body.token_type) ? body.token_type : 'Bearer',
    ...(typeof body.expires_in === 'number' ? { expiresIn: body.expires_in } : {}),
    ...(isNonemptyString(body.refresh_token) ? { refreshToken: body.refresh_token } : {}),
    ...(isNonemptyString(body.id_token) ? { idToken: body.id_token } : {}),
    ...(isNonemptyString(body.scope) ? { scope: body.scope } : {}),
  }
}

function formComponent(value: string): string {
  return new URLSearchParams({ v: value }).toString().slice(2)
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(signal?.reason ?? new Error('Device authorization cancelled'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** OIDC code + PKCE, refresh/revoke and discovery-bound RFC 8628 device grants. */
export class PlatformOidcClient {
  private readonly baseUrl: string
  private readonly clientId: string
  private readonly clientSecret: string | undefined
  private readonly redirectUri: string | undefined
  private readonly scope: string
  private readonly resources: readonly string[]
  private readonly fetchImpl: typeof fetch

  constructor(options: PlatformOidcClientOptions) {
    if (!options.baseUrl) throw new Error('PlatformOidcClient: baseUrl is required')
    if (!options.clientId) throw new Error('PlatformOidcClient: clientId is required')
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret || undefined
    this.redirectUri = options.redirectUri
    this.scope = options.scope ?? DEFAULT_SCOPE
    this.resources = [...new Set(options.resources ?? [])]
    for (const resource of this.resources) {
      const url = new URL(resource)
      if (url.hash || url.username || url.password) {
        throw new Error('PlatformOidcClient: resource must not contain a fragment or credentials')
      }
    }
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  }

  authorizeUrl(options: OidcAuthorizeUrlOptions): string {
    if (!this.redirectUri) throw new Error('PlatformOidcClient: redirectUri is required for authorization code')
    if (!options.state) throw new Error('PlatformOidcClient.authorizeUrl: state is required for CSRF')
    if (!options.codeChallenge) throw new Error('PlatformOidcClient.authorizeUrl: codeChallenge is required for PKCE')
    const url = new URL('/api/auth/oauth2/authorize', this.baseUrl)
    url.searchParams.set('client_id', this.clientId)
    url.searchParams.set('redirect_uri', this.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', this.scope)
    url.searchParams.set('state', options.state)
    url.searchParams.set('code_challenge', options.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    for (const resource of this.resources) url.searchParams.append('resource', resource)
    if (options.nonce) url.searchParams.set('nonce', options.nonce)
    if (options.prompt) url.searchParams.set('prompt', options.prompt)
    if (options.loginHint) url.searchParams.set('login_hint', options.loginHint)
    return url.toString()
  }

  async exchange(code: string, codeVerifier: string): Promise<OidcExchangeResult> {
    if (!this.redirectUri) throw new Error('PlatformOidcClient: redirectUri is required for authorization code')
    if (!code) throw new Error('PlatformOidcClient.exchange: code is required')
    if (!codeVerifier) throw new Error('PlatformOidcClient.exchange: codeVerifier is required for PKCE')
    const tokens = await this.token({
      grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, code_verifier: codeVerifier,
    })
    return { tokens, user: await this.userinfo(tokens.accessToken) }
  }

  /** Save the replacement refresh token. Never retry an old token as a new grant. */
  async refresh(refreshToken: string): Promise<OidcTokens> {
    if (!refreshToken) throw new Error('PlatformOidcClient.refresh: refreshToken is required')
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken })
  }

  async userinfo(accessToken: string): Promise<OidcUser> {
    if (!accessToken) throw new Error('PlatformOidcClient.userinfo: accessToken is required')
    const res = await this.fetchImpl(`${this.baseUrl}/api/auth/oauth2/userinfo`, {
      headers: { authorization: `Bearer ${accessToken}` }, redirect: 'error',
    })
    const body: unknown = await res.json().catch(() => null)
    if (!res.ok) throw new PlatformAuthError(oauthError(body, `Platform userinfo failed (${res.status})`), res.status, body)
    if (!isRecord(body) || !isNonemptyString(body.sub) || !isNonemptyString(body.email) || body.email_verified !== true) {
      throw new PlatformAuthError('Platform userinfo has no verified identity', res.status, { code: 'INVALID_USERINFO_RESPONSE' })
    }
    return { id: body.sub, email: body.email, emailVerified: true, ...(isNonemptyString(body.name) ? { name: body.name } : {}) }
  }

  /** RFC 7009. A local logout alone is not a provider disconnect. */
  async revoke(token: string, tokenTypeHint?: 'access_token' | 'refresh_token'): Promise<void> {
    if (!token) throw new Error('PlatformOidcClient.revoke: token is required')
    const res = await this.post(`${this.baseUrl}/api/auth/oauth2/revoke`, {
      token, ...(tokenTypeHint ? { token_type_hint: tokenTypeHint } : {}),
    }, undefined, false)
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null)
      throw new PlatformAuthError(oauthError(body, `Platform revoke failed (${res.status})`), res.status, body)
    }
  }

  /**
   * Start a device grant only when this issuer advertises the OAuth-integrated
   * device endpoint. No fallback to /cross-site/device or a standalone session
   * device endpoint: those issue different credentials.
   */
  async deviceAuthorize(options: { signal?: AbortSignal } = {}): Promise<OidcDeviceAuthorization> {
    const discovery = await this.fetchImpl(`${this.baseUrl}/api/auth/.well-known/openid-configuration`, {
      redirect: 'error', signal: options.signal,
    })
    const metadata: unknown = await discovery.json().catch(() => null)
    const issuer = `${this.baseUrl}/api/auth`
    if (!discovery.ok || !isRecord(metadata) || metadata.issuer !== issuer ||
        metadata.token_endpoint !== `${issuer}/oauth2/token` ||
        !Array.isArray(metadata.grant_types_supported) || !metadata.grant_types_supported.includes(DEVICE_GRANT) ||
        !isNonemptyString(metadata.device_authorization_endpoint)) {
      throw new PlatformAuthError('Issuer does not advertise an OAuth device grant', discovery.status, { code: 'OAUTH_DEVICE_GRANT_UNAVAILABLE' })
    }
    const endpoint = new URL(metadata.device_authorization_endpoint)
    const origin = new URL(this.baseUrl).origin
    if (endpoint.origin !== origin || endpoint.username || endpoint.password || endpoint.hash) {
      throw new PlatformAuthError('Device endpoint is outside the configured issuer', 400, { code: 'INVALID_DEVICE_ENDPOINT' })
    }
    const startedAt = Date.now()
    const res = await this.post(endpoint.href, { scope: this.scope }, options.signal)
    const body: unknown = await res.json().catch(() => null)
    if (!res.ok) throw new PlatformAuthError(oauthError(body, `Device authorization failed (${res.status})`), res.status, body)
    if (!isRecord(body) || !isNonemptyString(body.device_code) || !isNonemptyString(body.user_code) ||
        !isNonemptyString(body.verification_uri) || typeof body.expires_in !== 'number' ||
        !Number.isSafeInteger(body.expires_in) || body.expires_in <= 0 ||
        (body.interval !== undefined && (typeof body.interval !== 'number' || !Number.isSafeInteger(body.interval) || body.interval <= 0))) {
      throw new PlatformAuthError('Malformed device authorization response', res.status, { code: 'INVALID_DEVICE_RESPONSE' })
    }
    for (const value of [body.verification_uri, body.verification_uri_complete]) {
      if (value === undefined) continue
      if (!isNonemptyString(value)) throw new PlatformAuthError('Invalid device verification URI', 400, { code: 'INVALID_DEVICE_RESPONSE' })
      const uri = new URL(value)
      if (uri.origin !== origin || uri.username || uri.password || uri.hash) {
        throw new PlatformAuthError('Device verification URI is outside the issuer', 400, { code: 'INVALID_DEVICE_RESPONSE' })
      }
    }
    return {
      deviceCode: body.device_code, userCode: body.user_code, verificationUri: body.verification_uri,
      ...(isNonemptyString(body.verification_uri_complete) ? { verificationUriComplete: body.verification_uri_complete } : {}),
      expiresIn: body.expires_in, expiresAt: startedAt + body.expires_in * 1000,
      interval: typeof body.interval === 'number' ? body.interval : 5,
    }
  }

  /** RFC 8628 pending/slow_down handling, expiry, cancellation and timeout backoff. */
  async pollDeviceAuthorization(
    grant: OidcDeviceAuthorization,
    options: { signal?: AbortSignal } = {},
  ): Promise<OidcTokens> {
    if (!grant.deviceCode || !Number.isFinite(grant.expiresAt) || !Number.isFinite(grant.interval) || grant.interval <= 0) {
      throw new Error('PlatformOidcClient.pollDeviceAuthorization: invalid device grant')
    }
    let intervalMs = grant.interval * 1000
    while (Date.now() < grant.expiresAt) {
      options.signal?.throwIfAborted()
      await pause(Math.min(intervalMs, Math.max(0, grant.expiresAt - Date.now())), options.signal)
      const remaining = grant.expiresAt - Date.now()
      if (remaining <= 0) break
      const timeout = AbortSignal.timeout(Math.max(1, Math.min(30_000, Math.floor(remaining))))
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
      try {
        return await this.token({ grant_type: DEVICE_GRANT, device_code: grant.deviceCode }, signal)
      } catch (error) {
        options.signal?.throwIfAborted()
        if (timeout.aborted) {
          intervalMs *= 2
          continue
        }
        if (!(error instanceof PlatformAuthError) || !isRecord(error.body)) throw error
        if (error.body.error === 'authorization_pending') continue
        if (error.body.error === 'slow_down') {
          intervalMs += 5_000
          continue
        }
        throw error
      }
    }
    throw new PlatformAuthError('Device authorization expired', 400, { error: 'expired_token' })
  }

  private async token(params: Record<string, string>, signal?: AbortSignal): Promise<OidcTokens> {
    const res = await this.post(`${this.baseUrl}/api/auth/oauth2/token`, params, signal)
    const body: unknown = await res.json().catch(() => null)
    if (!res.ok) throw new PlatformAuthError(oauthError(body, `Platform token request failed (${res.status})`), res.status, body)
    return parseTokens(body, res.status)
  }

  private post(url: string, params: Record<string, string>, signal?: AbortSignal, includeResources = true): Promise<Response> {
    const body = new URLSearchParams(params)
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
    if (this.clientSecret) {
      // RFC 6749 section 2.3.1: form-encode each component before HTTP Basic.
      headers.authorization = `Basic ${btoa(`${formComponent(this.clientId)}:${formComponent(this.clientSecret)}`)}`
    } else body.set('client_id', this.clientId)
    if (includeResources) for (const resource of this.resources) body.append('resource', resource)
    return this.fetchImpl(url, { method: 'POST', headers, body, redirect: 'error', signal })
  }
}
