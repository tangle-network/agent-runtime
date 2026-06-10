/**
 * Server-side client for the Tangle platform's integrations hub
 * (`/v1/integrations/*`). Consumer apps use this instead of rolling
 * their own OAuth + connection tables.
 *
 * Auth: the caller supplies a bearer (either the user's API key from
 * cross-site exchange, or a platform service token) on construction.
 * Per-request override via `headers` is supported.
 *
 * Endpoint contract: `products/platform/api/src/routes/integrations.ts`.
 */

export interface PlatformHubClientOptions {
  /** Platform base URL, e.g. `https://id.tangle.tools`. */
  baseUrl: string
  /** Bearer credential — user API key or service token. */
  bearer: string
  /** Override fetch (tests + edge runtimes). */
  fetchImpl?: typeof fetch
}

export interface PlatformConnection {
  id: string
  providerId: string
  connectorId: string
  status: 'connected' | 'pending' | 'revoked' | 'expired' | string
  grantedScopes?: string[]
  account?: { identity?: string; displayName?: string } & Record<string, unknown>
  metadata?: Record<string, unknown>
  expiresAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface PlatformCatalogProvider {
  providerId: string
  displayName?: string
  description?: string
  authMode?: string
  connectors?: PlatformCatalogConnector[]
  [k: string]: unknown
}

export interface PlatformCatalogConnector {
  connectorId: string
  displayName?: string
  description?: string
  scopes?: string[]
  [k: string]: unknown
}

export interface StartAuthInput {
  providerId: string
  connectorId: string
  /** Where the platform redirects the user back to after OAuth. */
  returnUrl: string
  requestedScopes?: string[]
  state?: string
  metadata?: Record<string, unknown>
  /** Required when the bearer is a service token impersonating a user. */
  ownerUserId?: string
}

export interface StartAuthResult {
  authorizationUrl: string
  state: string
}

export interface BundleCapabilityInput {
  manifestId?: string
  grantIds?: string[]
  subject: { type: 'user' | 'team' | 'app'; id: string }
  ttlMs: number
}

export interface BundleCapabilityResult {
  bundle: Record<string, unknown>
  env: Record<string, string>
}

export interface HealthCheck {
  connectionId: string
  providerId: string
  connectorId: string
  status: 'ok' | 'degraded' | 'failing' | 'unknown' | string
  checks?: Record<string, unknown>
  checkedAt?: string
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
    this.fetchImpl = options.fetchImpl ?? ((url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(url, init))
  }

  /** List the integration catalog (providers + connectors). */
  catalog(): Promise<{ providers: PlatformCatalogProvider[] } & Record<string, unknown>> {
    return this.request('GET', '/v1/integrations/catalog')
  }

  /** List the calling user's integration connections. */
  async listConnections(): Promise<PlatformConnection[]> {
    const data = await this.request<{ connections: PlatformConnection[] }>(
      'GET',
      '/v1/integrations/connections',
    )
    return data.connections
  }

  /** Revoke (and disable) a connection by id. */
  revokeConnection(connectionId: string): Promise<{
    connection: PlatformConnection
    revokedGrants: unknown[]
    providerRevocation: { ok: boolean }
  }> {
    return this.request(
      'DELETE',
      `/v1/integrations/connections/${encodeURIComponent(connectionId)}`,
    )
  }

  /** Begin OAuth — returns the URL to send the user to. */
  startAuth(input: StartAuthInput): Promise<StartAuthResult> {
    return this.request('POST', '/v1/integrations/auth/start', input)
  }

  /** List connection healthchecks (last known state). */
  async listHealthchecks(): Promise<HealthCheck[]> {
    const data = await this.request<{ healthchecks: HealthCheck[] }>(
      'GET',
      '/v1/integrations/healthchecks',
    )
    return data.healthchecks
  }

  /** Trigger a fresh healthcheck pass. */
  runHealthchecks(): Promise<{ scheduled: number }> {
    return this.request('POST', '/v1/integrations/healthchecks/run', {})
  }

  /**
   * Mint a sandbox-injectable capability bundle (env vars + scoped
   * capability tokens) so a sandbox can invoke integrations on the
   * user's behalf without seeing the underlying provider tokens.
   */
  bundleCapabilities(input: BundleCapabilityInput): Promise<BundleCapabilityResult> {
    return this.request('POST', '/v1/integrations/capabilities/bundle', input)
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
