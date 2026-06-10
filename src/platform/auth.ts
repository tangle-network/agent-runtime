/**
 * Server-side client for the Tangle platform's cross-site SSO bridge.
 *
 * Consumer apps (gtm-agent, tax-agent, legal-agent, creative-agent, …)
 * use this to:
 *   1. Build an /authorize URL that lands the user on id.tangle.tools
 *      and brings them back with a single-use code.
 *   2. Exchange that code for an API key + the user's identity.
 *
 * The platform endpoint contract is documented in
 * `products/platform/api/src/routes/cross-site.ts`. This client only
 * speaks HTTP — no SDK weight, no transitive deps.
 */

export interface PlatformAuthClientOptions {
  /** Platform base URL, e.g. `https://id.tangle.tools`. */
  baseUrl: string
  /** App id as registered in the platform's TRUSTED_APPS registry. */
  appId: string
  /** Override the global fetch (useful for tests + edge runtimes). */
  fetchImpl?: typeof fetch
}

export interface AuthorizeUrlOptions {
  /** Required CSRF token; the consumer verifies it on the callback. */
  state: string
  /**
   * Final redirect URI. Must be one of the URIs registered for `appId`
   * on the platform. Omit to use the first registered URI.
   */
  redirectUri?: string
  /** Force the login screen even if a session is already active. */
  prompt?: 'login'
  /** Pre-fill the email field on the login screen. */
  email?: string
}

export interface ExchangeCodeResult {
  apiKey: string
  user: {
    id: string
    email: string
    name?: string
  }
  plan: {
    tier: string
  }
}

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

export class PlatformAuthClient {
  private readonly baseUrl: string
  private readonly appId: string
  private readonly fetchImpl: typeof fetch

  constructor(options: PlatformAuthClientOptions) {
    if (!options.baseUrl) throw new Error('PlatformAuthClient: baseUrl is required')
    if (!options.appId) throw new Error('PlatformAuthClient: appId is required')
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.appId = options.appId
    this.fetchImpl = options.fetchImpl ?? ((url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(url, init))
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
    const url = new URL('/cross-site/authorize', this.baseUrl)
    url.searchParams.set('app', this.appId)
    url.searchParams.set('state', options.state)
    if (options.redirectUri) url.searchParams.set('redirect', options.redirectUri)
    if (options.prompt) url.searchParams.set('prompt', options.prompt)
    if (options.email) url.searchParams.set('email', options.email)
    return url.toString()
  }

  /**
   * Exchange a single-use auth code (delivered to the consumer's
   * callback by the platform) for an API key + the user's identity.
   * Codes are single-use and expire ~5 minutes after issue.
   */
  async exchange(code: string): Promise<ExchangeCodeResult> {
    if (!code) throw new Error('PlatformAuthClient.exchange: code is required')
    const res = await this.fetchImpl(`${this.baseUrl}/cross-site/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, app: this.appId }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : `Platform exchange failed (${res.status})`
      throw new PlatformAuthError(message, res.status, body)
    }
    const result = body as Partial<ExchangeCodeResult>
    if (!result.apiKey || !result.user?.id) {
      throw new PlatformAuthError(
        'Platform exchange response is missing apiKey or user',
        res.status,
        body,
      )
    }
    return result as ExchangeCodeResult
  }
}
