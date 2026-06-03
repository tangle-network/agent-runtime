import { describe, expect, it, vi } from 'vitest'
import {
  PlatformAppsClient,
  PlatformAppsError,
  PlatformAuthClient,
  PlatformAuthError,
  PlatformHubClient,
  PlatformHubError,
} from '../src/platform'

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(typeof input === 'string' ? input : input.toString(), init),
  ) as unknown as typeof fetch
}

describe('PlatformAuthClient', () => {
  it('builds an /authorize URL with required state + optional hints', () => {
    const client = new PlatformAuthClient({
      baseUrl: 'https://id.tangle.tools/',
      appId: 'gtm-agent',
    })
    const url = new URL(
      client.authorizeUrl({
        state: 'csrf-abc',
        redirectUri: 'https://gtm.tangle.tools/auth/callback',
        prompt: 'login',
        email: 'me@example.com',
      }),
    )
    expect(url.origin).toBe('https://id.tangle.tools')
    expect(url.pathname).toBe('/cross-site/authorize')
    expect(url.searchParams.get('app')).toBe('gtm-agent')
    expect(url.searchParams.get('state')).toBe('csrf-abc')
    expect(url.searchParams.get('redirect')).toBe('https://gtm.tangle.tools/auth/callback')
    expect(url.searchParams.get('prompt')).toBe('login')
    expect(url.searchParams.get('email')).toBe('me@example.com')
  })

  it('refuses to build an authorize URL without a state token (CSRF defence)', () => {
    const client = new PlatformAuthClient({ baseUrl: 'https://id.tangle.tools', appId: 'x' })
    expect(() => client.authorizeUrl({ state: '' })).toThrow(/state is required/)
  })

  it('exchanges a code and returns apiKey + user identity', async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe('https://id.tangle.tools/cross-site/exchange')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ code: 'c-1', app: 'gtm-agent' })
      return new Response(
        JSON.stringify({
          apiKey: 'sk-tan-xyz',
          user: { id: 'user_1', email: 'a@b.com', name: 'A' },
          plan: { tier: 'pro' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const client = new PlatformAuthClient({
      baseUrl: 'https://id.tangle.tools',
      appId: 'gtm-agent',
      fetchImpl,
    })
    const out = await client.exchange('c-1')
    expect(out.apiKey).toBe('sk-tan-xyz')
    expect(out.user.id).toBe('user_1')
    expect(out.plan.tier).toBe('pro')
  })

  it('raises PlatformAuthError on platform-side errors', async () => {
    const fetchImpl = mockFetch(
      () => new Response(JSON.stringify({ error: 'Invalid or expired code' }), { status: 401 }),
    )
    const client = new PlatformAuthClient({
      baseUrl: 'https://id.tangle.tools',
      appId: 'gtm-agent',
      fetchImpl,
    })
    const err = await client.exchange('c-1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlatformAuthError)
    expect((err as PlatformAuthError).status).toBe(401)
    expect((err as PlatformAuthError).message).toBe('Invalid or expired code')
  })

  it('raises PlatformAuthError when the response is missing apiKey/user', async () => {
    const fetchImpl = mockFetch(
      () => new Response(JSON.stringify({ apiKey: 'k', user: {} }), { status: 200 }),
    )
    const client = new PlatformAuthClient({
      baseUrl: 'https://id.tangle.tools',
      appId: 'gtm-agent',
      fetchImpl,
    })
    await expect(client.exchange('c-1')).rejects.toBeInstanceOf(PlatformAuthError)
  })

  it('rejects construction without baseUrl + appId', () => {
    expect(() => new PlatformAuthClient({ baseUrl: '', appId: 'x' })).toThrow(/baseUrl is required/)
    expect(() => new PlatformAuthClient({ baseUrl: 'x', appId: '' })).toThrow(/appId is required/)
  })
})

describe('PlatformHubClient', () => {
  function makeClient(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    return new PlatformHubClient({
      baseUrl: 'https://id.tangle.tools',
      bearer: 'sk-tan-xyz',
      fetchImpl: mockFetch(handler),
    })
  }

  it('lists connections via /v1/integrations/connections with bearer auth', async () => {
    const client = makeClient((url, init) => {
      expect(url).toBe('https://id.tangle.tools/v1/integrations/connections')
      expect(init?.method).toBe('GET')
      const headers = init?.headers as Record<string, string>
      expect(headers.authorization).toBe('Bearer sk-tan-xyz')
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            connections: [
              { id: 'c1', providerId: 'google', connectorId: 'gmail', status: 'connected' },
            ],
          },
        }),
        { status: 200 },
      )
    })
    const conns = await client.listConnections()
    expect(conns).toHaveLength(1)
    expect(conns[0].id).toBe('c1')
  })

  it('posts to /auth/start with the OAuth start payload', async () => {
    const client = makeClient((url, init) => {
      expect(url).toBe('https://id.tangle.tools/v1/integrations/auth/start')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({
        providerId: 'google',
        connectorId: 'gmail',
        returnUrl: 'https://gtm.tangle.tools/integrations',
        requestedScopes: ['gmail.readonly'],
      })
      return new Response(
        JSON.stringify({
          success: true,
          data: { authorizationUrl: 'https://accounts.google.com/...', state: 's' },
        }),
        { status: 200 },
      )
    })
    const out = await client.startAuth({
      providerId: 'google',
      connectorId: 'gmail',
      returnUrl: 'https://gtm.tangle.tools/integrations',
      requestedScopes: ['gmail.readonly'],
    })
    expect(out.state).toBe('s')
    expect(out.authorizationUrl).toContain('accounts.google.com')
  })

  it('revokes a connection via DELETE /v1/integrations/connections/{id}', async () => {
    const client = makeClient((url, init) => {
      expect(url).toBe('https://id.tangle.tools/v1/integrations/connections/c1')
      expect(init?.method).toBe('DELETE')
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            connection: { id: 'c1', providerId: 'google', connectorId: 'gmail', status: 'revoked' },
            revokedGrants: [],
            providerRevocation: { ok: true },
          },
        }),
        { status: 200 },
      )
    })
    const out = await client.revokeConnection('c1')
    expect(out.connection.status).toBe('revoked')
  })

  it('throws PlatformHubError on a wrapped error envelope', async () => {
    const client = makeClient(
      () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'OAuth returnUrl is not allowed' },
          }),
          { status: 400 },
        ),
    )
    const err = await client
      .startAuth({
        providerId: 'google',
        connectorId: 'gmail',
        returnUrl: 'https://evil.example.com/cb',
      })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlatformHubError)
    expect((err as PlatformHubError).status).toBe(400)
    expect((err as PlatformHubError).code).toBe('VALIDATION_ERROR')
    expect((err as PlatformHubError).message).toBe('OAuth returnUrl is not allowed')
  })

  it('throws PlatformHubError when the envelope is missing data on success', async () => {
    const client = makeClient(
      () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    )
    await expect(client.listConnections()).rejects.toBeInstanceOf(PlatformHubError)
  })

  it('rejects construction without baseUrl + bearer', () => {
    expect(() => new PlatformHubClient({ baseUrl: '', bearer: 'x' })).toThrow(/baseUrl is required/)
    expect(() => new PlatformHubClient({ baseUrl: 'x', bearer: '' })).toThrow(/bearer is required/)
  })
})

const APPS_BASE = 'https://id.tangle.tools'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('PlatformAppsClient', () => {
  it('registerApp posts to /v1/apps with the owner bearer and returns the once-shown secret', async () => {
    let captured: { url: string; init?: RequestInit } | undefined
    const client = new PlatformAppsClient({
      baseUrl: APPS_BASE,
      fetchImpl: mockFetch((url, init) => {
        captured = { url, init }
        return jsonResponse({
          success: true,
          data: {
            app: {
              id: 'app_1',
              clientId: 'appcid_x',
              name: 'insurance-agent',
              redirectUris: ['https://insurance.tangle.tools/cb'],
              allowedScopes: ['gmail.messages_read'],
            },
            clientSecret: 'appcs_secret',
          },
        })
      }),
    })

    const app = await client.registerApp(
      {
        name: 'insurance-agent',
        redirectUris: ['https://insurance.tangle.tools/cb'],
        allowedScopes: ['gmail.messages_read'],
      },
      'sk-tan-owner',
    )

    expect(captured?.url).toBe(`${APPS_BASE}/v1/apps`)
    expect(new Headers(captured?.init?.headers).get('authorization')).toBe('Bearer sk-tan-owner')
    expect(app.clientId).toBe('appcid_x')
    expect(app.clientSecret).toBe('appcs_secret')
  })

  it('mintBrokerToken uses app credentials (no user bearer) and returns a sk-tan-broker- token', async () => {
    let captured: { url: string; init?: RequestInit } | undefined
    const client = new PlatformAppsClient({
      baseUrl: APPS_BASE,
      fetchImpl: mockFetch((url, init) => {
        captured = { url, init }
        return jsonResponse({
          success: true,
          data: { access_token: 'sk-tan-broker-abc', expires_in: 900, scope: 'gmail.messages_read', connection_id: 'conn_1' },
        })
      }),
    })

    const tok = await client.mintBrokerToken({ clientId: 'appcid_x', clientSecret: 'appcs_secret', grantId: 'grant_42', ttlSeconds: 300 })

    expect(captured?.url).toBe(`${APPS_BASE}/v1/apps/grants/grant_42/mint-broker-token`)
    expect(new Headers(captured?.init?.headers).get('authorization')).toBeNull()
    expect(JSON.parse(String(captured?.init?.body))).toMatchObject({
      client_id: 'appcid_x',
      client_secret: 'appcs_secret',
      grant_id: 'grant_42',
      ttl_seconds: 300,
    })
    expect(tok.accessToken).toBe('sk-tan-broker-abc')
    expect(tok.accessToken.startsWith('sk-tan-broker-')).toBe(true)
    expect(tok.expiresIn).toBe(900)
    expect(tok.connectionId).toBe('conn_1')
  })

  it('exchangeAuthCode posts the agc_ code on the flat OAuth token endpoint', async () => {
    let body: Record<string, unknown> | undefined
    const client = new PlatformAppsClient({
      baseUrl: APPS_BASE,
      fetchImpl: mockFetch((_url, init) => {
        body = JSON.parse(String(init?.body))
        // Flat (non-{data}) OAuth-style response.
        return jsonResponse({ access_token: 'sk-tan-broker-first', token_type: 'Bearer', expires_in: 3600, scope: 'gmail.messages_read' })
      }),
    })

    const tok = await client.exchangeAuthCode({ clientId: 'appcid_x', clientSecret: 'appcs_secret', code: 'agc_code', redirectUri: 'https://insurance.tangle.tools/cb' })

    expect(body).toMatchObject({ grant_type: 'authorization_code', code: 'agc_code', client_id: 'appcid_x' })
    expect(tok.accessToken).toBe('sk-tan-broker-first')
    expect(tok.expiresIn).toBe(3600)
  })

  it('surfaces the platform error envelope as PlatformAppsError', async () => {
    const client = new PlatformAppsClient({
      baseUrl: APPS_BASE,
      fetchImpl: mockFetch(() => jsonResponse({ success: false, error: { message: 'broker disabled', code: 'BROKER_DISABLED' } }, 503)),
    })
    await expect(client.mintBrokerToken({ clientId: 'a', clientSecret: 'b', grantId: 'g' })).rejects.toMatchObject({
      name: 'PlatformAppsError',
      status: 503,
      code: 'BROKER_DISABLED',
    })
  })

  it('requires baseUrl', () => {
    expect(() => new PlatformAppsClient({ baseUrl: '' })).toThrow(/baseUrl is required/)
  })
})
