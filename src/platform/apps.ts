/**
 * `@tangle-network/agent-runtime/platform` — self-service external-apps client.
 *
 * The brokered-hub-exec path: a product registers itself ONCE (`registerApp`
 * → client_id/secret), the end user consents ONCE per connection from their
 * Tangle session (a browser step on the platform — not done here), and the
 * product then mints short-lived `sk-tan-broker-…` tokens unattended
 * (`mintBrokerToken`) for each `/v1/hub/exec` call. The durable grant means
 * only the first consent needs a user; everything after is app-credential-only.
 *
 * This is the operator-allowlist-free alternative to the legacy `TRUSTED_APPS`
 * cross-site-key flow ({@link PlatformAuthClient}) — any external developer can
 * self-register and integrate the hub. Mirrors {@link PlatformHubClient}'s
 * shape (`baseUrl` + `fetchImpl` seam, `{success,data}` envelope handling).
 */

export interface PlatformAppsClientOptions {
  /** Platform base URL (e.g. https://id.tangle.tools). */
  baseUrl: string
  /** Test seam. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch
}

export interface RegisteredApp {
  id: string
  clientId: string
  /** Shown ONCE at registration — persist it as a secret immediately. */
  clientSecret: string
  name: string
  redirectUris: string[]
  allowedScopes: string[]
  homepageUrl?: string
  createdAt?: string
}

export interface AppSummary {
  id: string
  clientId: string
  name: string
  redirectUris: string[]
  allowedScopes: string[]
  homepageUrl?: string
  createdAt?: string
}

export interface BrokerToken {
  /** The `sk-tan-broker-…` bearer for a single `/v1/hub/exec` call. */
  accessToken: string
  expiresIn: number
  scope: string
  connectionId?: string
}

export interface RegisterAppInput {
  name: string
  redirectUris: string[]
  allowedScopes: string[]
  homepageUrl?: string
}

export class PlatformAppsError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly body: unknown,
  ) {
    super(message)
    this.name = 'PlatformAppsError'
  }
}

interface PlatformEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string } | string
}

export class PlatformAppsClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: PlatformAppsClientOptions) {
    if (!options.baseUrl) throw new Error('PlatformAppsClient: baseUrl is required')
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /**
   * Register a product as an app (ONE-TIME, with the owner's bearer — a user
   * session or `sk-tan-*` key). Returns the client_id + the once-shown
   * client_secret; persist the secret immediately (never retrievable again).
   */
  async registerApp(input: RegisterAppInput, ownerBearer: string): Promise<RegisteredApp> {
    const data = await this.request<{ app: AppSummary; clientSecret: string }>(
      'POST',
      '/v1/apps',
      input,
      ownerBearer,
    )
    return { ...data.app, clientSecret: data.clientSecret }
  }

  /** List the caller's registered apps (no secrets). */
  async listApps(ownerBearer: string): Promise<AppSummary[]> {
    const data = await this.request<{ apps: AppSummary[] }>('GET', '/v1/apps', undefined, ownerBearer)
    return data.apps
  }

  /** Revoke an app and cascade-kill its grants + tokens. */
  revokeApp(appId: string, ownerBearer: string): Promise<{ revoked: boolean }> {
    return this.request('POST', `/v1/apps/${encodeURIComponent(appId)}/revoke`, {}, ownerBearer)
  }

  /**
   * Durable re-mint: mint a fresh single-use `sk-tan-broker-` token against an
   * existing consented grant using ONLY the app credentials — no user session,
   * no `agc_` code. The runtime path: one call per `/v1/hub/exec`.
   */
  async mintBrokerToken(input: {
    clientId: string
    clientSecret: string
    grantId: string
    ttlSeconds?: number
  }): Promise<BrokerToken> {
    const data = await this.request<TokenResponse>(
      'POST',
      `/v1/apps/grants/${encodeURIComponent(input.grantId)}/mint-broker-token`,
      {
        client_id: input.clientId,
        client_secret: input.clientSecret,
        grant_id: input.grantId,
        ...(input.ttlSeconds ? { ttl_seconds: input.ttlSeconds } : {}),
      },
    )
    return toBrokerToken(data)
  }

  /**
   * Exchange an `agc_` authorization code (from the user's one-time consent)
   * for the first broker token + the durable grant. Use on the consent
   * callback; afterward `mintBrokerToken` is enough.
   */
  async exchangeAuthCode(input: {
    clientId: string
    clientSecret: string
    code: string
    redirectUri: string
    connectionId?: string
  }): Promise<BrokerToken> {
    const data = await this.request<TokenResponse>('POST', '/v1/apps/oauth/token', {
      grant_type: 'authorization_code',
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      ...(input.connectionId ? { connection_id: input.connectionId } : {}),
    })
    return toBrokerToken(data)
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PUT',
    path: string,
    body?: unknown,
    bearer?: string,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (bearer) headers.authorization = `Bearer ${bearer}`
    if (body !== undefined) headers['content-type'] = 'application/json'

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let parsed: PlatformEnvelope<T> | null = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        /* fall through */
      }
    }
    if (!res.ok || (parsed && parsed.success === false)) {
      const code = parsed?.error && typeof parsed.error === 'object' ? parsed.error.code : undefined
      const message =
        (parsed?.error && typeof parsed.error === 'object' && parsed.error.message) ||
        (typeof parsed?.error === 'string' ? parsed.error : `Platform apps error (${res.status})`)
      throw new PlatformAppsError(message, res.status, code, parsed ?? text)
    }
    // The /v1/apps surface wraps in { success, data }; the OAuth token endpoint
    // (/v1/apps/oauth/token) is flat. Accept either.
    return ((parsed && 'data' in parsed ? parsed.data : parsed) ?? ({} as T)) as T
  }
}

/** Flat token-endpoint response shape (RFC-6749-ish). */
interface TokenResponse {
  access_token: string
  expires_in: number
  scope: string
  connection_id?: string
}

function toBrokerToken(data: TokenResponse): BrokerToken {
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    scope: data.scope,
    connectionId: data.connection_id,
  }
}
