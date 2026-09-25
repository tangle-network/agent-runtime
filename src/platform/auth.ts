/** Standard OpenID Connect client for the Tangle authorization server. */

export interface PlatformAuthClientOptions {
  /** Platform base URL, e.g. `https://id.tangle.tools`. */
  baseUrl: string
  /** OIDC client id from the platform oauthClient registry. */
  clientId: string
  /** Registered callback URI. */
  redirectUri: string
  /** Override the global fetch (useful for tests + edge runtimes). */
  fetchImpl?: typeof fetch
}

export interface AuthorizeUrlOptions {
  /** Required CSRF token; the consumer verifies it on the callback. */
  state: string
  /** RFC 7636 S256 code challenge. */
  codeChallenge: string
  /** Force the login screen even if a session is already active. */
  prompt?: 'login'
  /** Pre-fill the email field on the login screen. */
  email?: string
}

export interface ExchangeCodeResult {
  accessToken: string
  refreshToken?: string
  idToken?: string
  expiresIn?: number
  scope?: string
  emailVerified: true
  user: {
    id: string
    email: string
    name?: string | null
  }
  /** Null when the platform could not provide a subscription. This is not a paid-access grant. */
  plan: {
    tier: string
  } | null
}

/** Thrown when a `PlatformAuthClient` request returns a non-success status. */
export class PlatformAuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message)
    this.name = 'PlatformAuthError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Validate the platform's verified identity before consumers create a local session. */
function parseExchangeResult(body: unknown, status: number): ExchangeCodeResult {
  const invalid = (): never => {
    // A successful but malformed response can contain the one-time API secret.
    throw new PlatformAuthError(
      'Platform exchange response has no valid verified identity',
      status,
      { code: 'INVALID_EXCHANGE_RESPONSE' },
    )
  }
  if (
    !isRecord(body) ||
    !isNonemptyString(body.access_token) ||
    !isRecord(body.user)
  )
    return invalid()
  const user = body.user
  if (!isNonemptyString(user.id) || !isNonemptyString(user.email)) return invalid()
  const email = user.email.trim()
  if (
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    /(?:@users\.noreply\.tangle\.tools$|^0x[a-f0-9]{40}@tangle\.tools$)/i.test(email)
  )
    return invalid()
  if (user.name !== undefined && user.name !== null && typeof user.name !== 'string')
    return invalid()
  let plan: ExchangeCodeResult['plan'] = null
  if (body.subscription !== undefined) {
    if (!isRecord(body.subscription) || !isNonemptyString(body.subscription.plan)) return invalid()
    plan = { tier: body.subscription.plan }
  }
  return {
    accessToken: body.access_token,
    ...(isNonemptyString(body.refresh_token) ? { refreshToken: body.refresh_token } : {}),
    ...(isNonemptyString(body.id_token) ? { idToken: body.id_token } : {}),
    ...(typeof body.expires_in === 'number' ? { expiresIn: body.expires_in } : {}),
    ...(isNonemptyString(body.scope) ? { scope: body.scope } : {}),
    emailVerified: true,
    user: { id: user.id, email, ...(user.name !== undefined ? { name: user.name } : {}) },
    plan,
  }
}

/** HTTP client for the Tangle Platform SSO: builds authorize URLs and exchanges auth codes for API keys. */
export class PlatformAuthClient {
  private readonly baseUrl: string
  private readonly clientId: string
  private readonly redirectUri: string
  private readonly fetchImpl: typeof fetch

  constructor(options: PlatformAuthClientOptions) {
    if (!options.baseUrl) throw new Error('PlatformAuthClient: baseUrl is required')
    if (!options.clientId) throw new Error('PlatformAuthClient: clientId is required')
    if (!options.redirectUri) throw new Error('PlatformAuthClient: redirectUri is required')
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.clientId = options.clientId
    this.redirectUri = options.redirectUri
    this.fetchImpl =
      options.fetchImpl ??
      ((url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(url, init))
  }

  /**
   * Build the URL the user is redirected to in order to start SSO.
   * The platform redirects back to one of `appId`'s registered
   * `redirectUris` with `?code=...&app=...&state=...`.
   */
  authorizeUrl(options: AuthorizeUrlOptions): string {
    if (!options.state) {
      throw new Error('PlatformAuthClient.authorizeUrl: state is required for CSRF')
    }
    if (!options.codeChallenge) throw new Error('PlatformAuthClient.authorizeUrl: codeChallenge is required for PKCE')
    const url = new URL('/api/auth/oauth2/authorize', this.baseUrl)
    url.searchParams.set('client_id', this.clientId)
    url.searchParams.set('redirect_uri', this.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'openid profile email offline_access')
    url.searchParams.set('state', options.state)
    url.searchParams.set('code_challenge', options.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    if (options.prompt) url.searchParams.set('prompt', options.prompt)
    if (options.email) url.searchParams.set('email', options.email)
    return url.toString()
  }

  /**
   * Exchange a single-use auth code (delivered to the consumer's
   * callback by the platform) for an API key + the user's identity.
   * Codes are single-use and expire ~5 minutes after issue.
   */
  async exchange(code: string, codeVerifier: string): Promise<ExchangeCodeResult> {
    if (!code) throw new Error('PlatformAuthClient.exchange: code is required')
    if (!codeVerifier) throw new Error('PlatformAuthClient.exchange: codeVerifier is required for PKCE')
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      code_verifier: codeVerifier,
    })
    const res = await this.fetchImpl(`${this.baseUrl}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    const responseBody = await res.json().catch(() => null)
    if (!res.ok) {
      const message =
        responseBody && typeof responseBody === 'object' && 'error' in responseBody && typeof responseBody.error === 'string'
          ? responseBody.error
          : `Platform exchange failed (${res.status})`
      throw new PlatformAuthError(message, res.status, responseBody)
    }
    return parseExchangeResult(responseBody, res.status)
  }
}
