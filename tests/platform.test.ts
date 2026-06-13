import { describe, expect, it, vi } from 'vitest'
import {
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

  function connection(over: Record<string, unknown> = {}) {
    return {
      id: 'c1',
      providerId: 'google',
      displayName: 'Google',
      accountDisplay: 'ada@x.co',
      scopes: ['gmail.readonly'],
      status: 'active',
      health: 'healthy',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      lastUsedAt: null,
      ...over,
    }
  }

  it('lists the catalog via GET /v1/hub/providers', async () => {
    const client = makeClient((url, init) => {
      expect(url).toBe('https://id.tangle.tools/v1/hub/providers')
      expect(init?.method).toBe('GET')
      return new Response(
        JSON.stringify({
          success: true,
          data: { providers: [{ providerId: 'github', title: 'GitHub' }], substrateBundled: 12 },
        }),
        { status: 200 },
      )
    })
    const cat = await client.catalog()
    expect(cat.providers).toHaveLength(1)
    expect(cat.substrateBundled).toBe(12)
  })

  it('lists connections via /v1/hub/connections with bearer auth', async () => {
    const client = makeClient((url, init) => {
      expect(url).toBe('https://id.tangle.tools/v1/hub/connections')
      expect(init?.method).toBe('GET')
      const headers = init?.headers as Record<string, string>
      expect(headers.authorization).toBe('Bearer sk-tan-xyz')
      return new Response(
        JSON.stringify({ success: true, data: { connections: [connection()] } }),
        { status: 200 },
      )
    })
    const conns = await client.listConnections()
    expect(conns).toHaveLength(1)
    expect(conns[0].id).toBe('c1')
    expect(conns[0].health).toBe('healthy')
  })

  it('starts auth at /v1/hub/connections/:provider/start with provider in the URL', async () => {
    const client = makeClient((url, init) => {
      expect(url).toBe('https://id.tangle.tools/v1/hub/connections/google/start')
      expect(init?.method).toBe('POST')
      // provider rides in the URL; the body carries only returnUrl (+ cli).
      expect(JSON.parse(String(init?.body))).toEqual({
        returnUrl: 'https://gtm.tangle.tools/integrations',
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

  it('normalizes the substrate start branch (redirectUrl) to authorizationUrl', async () => {
    const client = makeClient(
      () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              provider: 'slack',
              redirectUrl: 'https://slack.com/oauth/authorize?...',
              state: 's2',
              expiresAt: '2026-01-01T00:10:00.000Z',
              scopes: ['chat:write'],
            },
          }),
          { status: 200 },
        ),
    )
    const out = await client.startAuth({
      providerId: 'slack',
      connectorId: 'slack',
      returnUrl: 'https://gtm.tangle.tools/integrations',
    })
    expect(out.authorizationUrl).toContain('slack.com/oauth')
    expect(out.state).toBe('s2')
    expect(out.scopes).toEqual(['chat:write'])
  })

  it('fails loud when a start response carries no URL on either field', async () => {
    const client = makeClient(
      () => new Response(JSON.stringify({ success: true, data: { state: 's' } }), { status: 200 }),
    )
    await expect(
      client.startAuth({ providerId: 'x', connectorId: 'x', returnUrl: 'https://app/cb' }),
    ).rejects.toMatchObject({ name: 'PlatformHubError', code: 'HUB_INVALID_START_RESPONSE' })
  })

  it('revokes a connection via DELETE /v1/hub/connections/{id}', async () => {
    const client = makeClient((url, init) => {
      expect(url).toBe('https://id.tangle.tools/v1/hub/connections/c1')
      expect(init?.method).toBe('DELETE')
      return new Response(
        JSON.stringify({ success: true, data: { connection: connection({ status: 'revoked' }) } }),
        { status: 200 },
      )
    })
    const out = await client.revokeConnection('c1')
    expect(out.connection.status).toBe('revoked')
  })

  it('derives listHealthchecks from the connection rows (no global endpoint)', async () => {
    const client = makeClient((url) => {
      expect(url).toBe('https://id.tangle.tools/v1/hub/connections')
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            connections: [connection({ id: 'c2', providerId: 'slack', health: 'rate_limited' })],
          },
        }),
        { status: 200 },
      )
    })
    const checks = await client.listHealthchecks()
    expect(checks).toEqual([
      {
        connectionId: 'c2',
        providerId: 'slack',
        status: 'rate_limited',
        checkedAt: '2026-01-02T00:00:00.000Z',
      },
    ])
  })

  it('probes one connection via POST /v1/hub/connections/:id/health', async () => {
    const client = makeClient((url, init) => {
      expect(url).toBe('https://id.tangle.tools/v1/hub/connections/c1/health')
      expect(init?.method).toBe('POST')
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            connection: connection(),
            health: { status: 'healthy', checkedAt: '2026-01-03T00:00:00.000Z' },
          },
        }),
        { status: 200 },
      )
    })
    const out = await client.checkConnectionHealth('c1')
    expect(out.health.status).toBe('healthy')
  })

  it('mints an action-scoped token via POST /v1/hub/tokens', async () => {
    const client = makeClient((url, init) => {
      expect(url).toBe('https://id.tangle.tools/v1/hub/tokens')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({
        actionPath: 'slack.chat.postMessage',
        provider: 'slack',
      })
      return new Response(
        JSON.stringify({
          success: true,
          data: { tokenId: 't1', token: 'cap_abc', expiresAt: '2026-01-01T00:05:00.000Z' },
        }),
        { status: 200 },
      )
    })
    const out = await client.mintToken({ actionPath: 'slack.chat.postMessage', provider: 'slack' })
    expect(out.token).toBe('cap_abc')
  })

  it('executes an action via POST /v1/hub/exec and unwraps result', async () => {
    const client = makeClient((url, init) => {
      expect(url).toBe('https://id.tangle.tools/v1/hub/exec')
      expect(init?.method).toBe('POST')
      return new Response(
        JSON.stringify({ success: true, data: { result: { ok: true, ts: '123' } } }),
        { status: 200 },
      )
    })
    const out = (await client.exec({ path: 'slack.chat.postMessage', input: { text: 'hi' } })) as {
      ok: boolean
    }
    expect(out.ok).toBe(true)
  })

  it('throws PlatformHubError on a wrapped error envelope', async () => {
    const client = makeClient(
      () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'HUB_INVALID_INPUT', message: 'OAuth returnUrl is not allowed' },
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
    expect((err as PlatformHubError).code).toBe('HUB_INVALID_INPUT')
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
