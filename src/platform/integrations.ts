/**
 * Server-side client for the Tangle platform's integration hub
 * (`/v1/hub/*`). Consumer apps use this instead of rolling their own
 * OAuth + connection tables.
 *
 * Auth: the caller supplies a bearer (either the user's API key from
 * cross-site exchange, or a platform service token) on construction.
 *
 * Endpoint contract (authoritative): the platform's `src/lib/hub-contract.ts`
 * + `src/routes/hub.ts`. The platform wraps every response in
 * `{ success, data }`; non-2xx or `success:false` surfaces as `PlatformHubError`
 * carrying the real upstream status.
 */

export interface PlatformHubClientOptions {
  /** Platform base URL, e.g. `https://id.tangle.tools`. */
  baseUrl: string
  /** Bearer credential — user API key or service token. */
  bearer: string
  /** Override fetch (tests + edge runtimes). */
  fetchImpl?: typeof fetch
}

/** A live integration connection, as returned by `/v1/hub/connections`. */
export interface PlatformConnection {
  id: string
  providerId: string
  displayName: string
  accountDisplay: string | null
  scopes: string[]
  status: 'active' | 'revoked' | 'unhealthy' | 'reconnect_required' | (string & {})
  health: 'unknown' | 'healthy' | 'unhealthy' | 'rate_limited' | (string & {})
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
}

/** A connectable provider in the catalog (`/v1/hub/providers`). */
export interface PlatformCatalogProvider {
  providerId: string
  title?: string
  authKind?: string
  category?: string
  scopes?: string[]
  capabilityCount?: number
  native?: boolean
  /** Whether the OAuth app's credentials are wired — the UI offers Connect
   *  only when true. */
  configured?: boolean
  [k: string]: unknown
}

export interface CatalogResult {
  providers: PlatformCatalogProvider[]
  /** Count of substrate-bundled connectors behind the catalog. */
  substrateBundled?: number
  [k: string]: unknown
}

export interface StartAuthInput {
  /** The provider to connect (goes in the URL path). */
  providerId: string
  /** Accepted for interface compatibility; the platform's start endpoint is
   *  provider-level and does not consume a connector id. */
  connectorId?: string
  /** Where the platform redirects the user back to after OAuth. */
  returnUrl: string
  /** Accepted for interface compatibility; not consumed by the start endpoint. */
  requestedScopes?: string[]
  /** CLI flow flag — affects the platform's post-auth redirect handling. */
  cli?: boolean
}

export interface StartAuthResult {
  /** The URL to send the user to. Normalized across the platform's two start
   *  branches: github returns `authorizationUrl`, substrate returns
   *  `redirectUrl`. */
  authorizationUrl: string
  state: string
  expiresAt?: string
  scopes?: string[]
}

export interface ConnectionHealth {
  status: 'unknown' | 'healthy' | 'unhealthy' | 'rate_limited' | (string & {})
  checkedAt: string
  error?: { code: string; message: string }
}

export interface ConnectionHealthResult {
  connection: PlatformConnection
  health: ConnectionHealth
}

/** Last-known health for a connection, derived from the connection row. */
export interface HealthCheck {
  connectionId: string
  providerId: string
  /** Mirrors `PlatformConnection.health`. */
  status: ConnectionHealth['status']
  checkedAt?: string
}

export interface MintTokenInput {
  /** The hub action the token authorizes (e.g. `slack.chat.postMessage`). */
  actionPath: string
  /** Bind to a specific connection, or … */
  connectionId?: string
  /** … resolve the connection by provider for the calling user. */
  provider?: string
}

export interface MintTokenResult {
  tokenId: string
  token: string
  expiresAt: string
}

export interface ExecInput {
  /** The hub action path to execute. */
  path: string
  input?: unknown
  connectionId?: string
}

export interface PlatformHubStatus {
  contract?: unknown
  principal: { kind: string; userId: string; [k: string]: unknown }
  connections: { connectedProviderCount: number; unhealthyProviderCount: number }
}

export class PlatformHubError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly body: unknown,
  ) {
    super(message)
    this.name = 'PlatformHubError'
  }
}

interface PlatformEnvelope<T> {
  success: boolean
  data?: T
  error?: { code?: string; message?: string } | string
}

export class PlatformHubClient {
  private readonly baseUrl: string
  private readonly bearer: string
  private readonly fetchImpl: typeof fetch

  constructor(options: PlatformHubClientOptions) {
    if (!options.baseUrl) throw new Error('PlatformHubClient: baseUrl is required')
    if (!options.bearer) throw new Error('PlatformHubClient: bearer is required')
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.bearer = options.bearer
    this.fetchImpl =
      options.fetchImpl ??
      ((url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(url, init))
  }

  /** GET /v1/hub/providers — the connectable provider catalog. */
  catalog(): Promise<CatalogResult> {
    return this.request('GET', '/v1/hub/providers')
  }

  /** GET /v1/hub/connections — the calling user's live connections. */
  async listConnections(): Promise<PlatformConnection[]> {
    const data = await this.request<{ connections: PlatformConnection[] }>(
      'GET',
      '/v1/hub/connections',
    )
    return data.connections
  }

  /** DELETE /v1/hub/connections/:connectionId — revoke + disable a connection. */
  revokeConnection(connectionId: string): Promise<{ connection: PlatformConnection }> {
    return this.request('DELETE', `/v1/hub/connections/${encodeURIComponent(connectionId)}`)
  }

  /**
   * POST /v1/hub/connections/:provider/start — begin OAuth/grant. The provider
   * is taken from the URL; the body carries `returnUrl` (+ `cli`). The platform's
   * two start branches name the URL field differently (github → `authorizationUrl`,
   * substrate → `redirectUrl`); this normalizes to `authorizationUrl`.
   */
  async startAuth(input: StartAuthInput): Promise<StartAuthResult> {
    const body: { returnUrl: string; cli?: boolean } = { returnUrl: input.returnUrl }
    if (input.cli !== undefined) body.cli = input.cli
    const data = await this.request<{
      authorizationUrl?: string
      redirectUrl?: string
      state: string
      expiresAt?: string
      scopes?: string[]
    }>('POST', `/v1/hub/connections/${encodeURIComponent(input.providerId)}/start`, body)
    const authorizationUrl = data.authorizationUrl ?? data.redirectUrl
    if (!authorizationUrl) {
      throw new PlatformHubError(
        'Platform hub start response missing an authorization URL',
        502,
        'HUB_INVALID_START_RESPONSE',
        data,
      )
    }
    return { authorizationUrl, state: data.state, expiresAt: data.expiresAt, scopes: data.scopes }
  }

  /**
   * Last-known health for every connection. The platform has no global
   * healthcheck listing — health rides on each connection row — so this derives
   * the list from `listConnections()` (one request, no extra round-trips).
   */
  async listHealthchecks(): Promise<HealthCheck[]> {
    const connections = await this.listConnections()
    return connections.map((c) => ({
      connectionId: c.id,
      providerId: c.providerId,
      status: c.health,
      checkedAt: c.updatedAt,
    }))
  }

  /**
   * POST /v1/hub/connections/:connectionId/health — trigger a fresh health
   * probe for one connection and return its updated state.
   */
  checkConnectionHealth(connectionId: string): Promise<ConnectionHealthResult> {
    return this.request('POST', `/v1/hub/connections/${encodeURIComponent(connectionId)}/health`)
  }

  /**
   * Trigger a fresh health probe across all of the user's connections. The
   * platform exposes health per-connection only, so this fans out over
   * `listConnections()`. `scheduled` is the number of probes dispatched.
   */
  async runHealthchecks(): Promise<{ scheduled: number }> {
    const connections = await this.listConnections()
    await Promise.allSettled(connections.map((c) => this.checkConnectionHealth(c.id)))
    return { scheduled: connections.length }
  }

  /** GET /v1/hub/status — principal + aggregate connection counts. */
  status(): Promise<PlatformHubStatus> {
    return this.request('GET', '/v1/hub/status')
  }

  /**
   * POST /v1/hub/tokens — mint a short-lived, action-scoped capability token a
   * sandbox can use to invoke one hub action on the user's behalf without
   * seeing the underlying provider credential.
   */
  mintToken(input: MintTokenInput): Promise<MintTokenResult> {
    return this.request('POST', '/v1/hub/tokens', input)
  }

  /** POST /v1/hub/exec — execute a hub action and return its result. */
  async exec(input: ExecInput): Promise<unknown> {
    const data = await this.request<{ result: unknown }>('POST', '/v1/hub/exec', input)
    return data.result
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PUT',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.bearer}`,
      accept: 'application/json',
    }
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
        // fall through to error handling below
      }
    }
    if (!res.ok || (parsed && parsed.success === false)) {
      const code = parsed?.error && typeof parsed.error === 'object' ? parsed.error.code : undefined
      const message =
        (parsed?.error && typeof parsed.error === 'object' && parsed.error.message) ||
        (typeof parsed?.error === 'string' ? parsed.error : `Platform hub error (${res.status})`)
      throw new PlatformHubError(message, res.status, code, parsed ?? text)
    }
    if (!parsed) {
      throw new PlatformHubError(
        `Platform hub returned non-JSON success (${res.status})`,
        res.status,
        undefined,
        text,
      )
    }
    if (parsed.data === undefined) {
      throw new PlatformHubError(
        'Platform hub envelope missing `data`',
        res.status,
        undefined,
        parsed,
      )
    }
    return parsed.data
  }
}
