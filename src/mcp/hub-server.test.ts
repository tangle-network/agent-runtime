import { describe, expect, it, vi } from 'vitest'
import type { PlatformConnection } from '../platform/integrations'
import { PlatformHubError } from '../platform/integrations'
import {
  createHubIntegrationToolServer,
  HUB_DATA_PROVIDER_KINDS,
  type HubIntegrationClient,
  hubIntegrationTools,
} from './hub-server'

function connection(
  overrides: Partial<PlatformConnection> & { providerId: string; id: string },
): PlatformConnection {
  return {
    displayName: overrides.providerId,
    accountDisplay: null,
    scopes: [],
    status: 'active',
    health: 'unknown',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    lastUsedAt: null,
    ...overrides,
  } as PlatformConnection
}

function clientWith(
  connections: PlatformConnection[],
  exec: HubIntegrationClient['exec'] = vi.fn(async () => ({ ok: true })),
): HubIntegrationClient {
  return { listConnections: vi.fn(async () => connections), exec }
}

describe('hubIntegrationTools', () => {
  it('exposes one tool per active data-provider connection and excludes everything else', async () => {
    const client = clientWith([
      connection({ id: 'conn_pc_1', providerId: 'pinecone', displayName: 'Pinecone prod' }),
      connection({ id: 'conn_qd_1', providerId: 'qdrant' }),
      // Slack is a comms provider — not in the data set.
      connection({ id: 'conn_sl_1', providerId: 'slack' }),
      // Revoked connections never become tools.
      connection({ id: 'conn_pc_2', providerId: 'pinecone', status: 'revoked' }),
      // Unhealthy ones are omitted unless explicitly included.
      connection({ id: 'conn_nb_1', providerId: 'neon', health: 'unhealthy' }),
    ])

    const tools = await hubIntegrationTools({ client })
    expect(tools.map((tool) => tool.name).sort()).toEqual(['hub_pinecone', 'hub_qdrant'])

    const pinecone = tools.find((tool) => tool.name === 'hub_pinecone')!
    expect(pinecone.description).toContain('Pinecone prod')
    expect(pinecone.description).toContain('policy-gated')
    expect(pinecone.inputSchema).toMatchObject({
      type: 'object',
      required: ['action'],
      additionalProperties: false,
    })
  })

  it('serves unhealthy connections when includeUnhealthy is set', async () => {
    const client = clientWith([
      connection({ id: 'conn_nb_1', providerId: 'neon', health: 'unhealthy' }),
    ])
    const tools = await hubIntegrationTools({ client, includeUnhealthy: true })
    expect(tools.map((tool) => tool.name)).toEqual(['hub_neon'])
  })

  it('honors an explicit provider allowlist', async () => {
    const client = clientWith([
      connection({ id: 'conn_pc_1', providerId: 'pinecone' }),
      connection({ id: 'conn_pg_1', providerId: 'postgres' }),
    ])
    const tools = await hubIntegrationTools({ client, providers: ['postgres'] })
    expect(tools.map((tool) => tool.name)).toEqual(['hub_postgres'])
  })

  it('dedupes tool names when one provider has multiple connections', async () => {
    const client = clientWith([
      connection({ id: 'conn_pc_1', providerId: 'pinecone', displayName: 'Prod' }),
      connection({ id: 'conn_pc_2', providerId: 'pinecone', displayName: 'Staging' }),
    ])
    const tools = await hubIntegrationTools({ client })
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(2)
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'hub_pinecone',
      'hub_pinecone-conn_pc_2',
    ])
  })

  it('routes a tool call through the hub exec endpoint with the provider-prefixed path and connection id', async () => {
    const exec = vi.fn(async () => ({ matches: [] }))
    const client = clientWith([connection({ id: 'conn_pc_1', providerId: 'pinecone' })], exec)
    const tools = await hubIntegrationTools({ client })
    const result = await tools[0]!.handler({
      action: 'vectors.query',
      input: { top_k: 5, vector: [0.1, 0.2] },
    })

    expect(result).toEqual({ matches: [] })
    expect(exec).toHaveBeenCalledWith({
      path: 'pinecone.vectors.query',
      input: { top_k: 5, vector: [0.1, 0.2] },
      connectionId: 'conn_pc_1',
    })
  })

  it('rejects malformed action names and inputs before any hub round-trip', async () => {
    const exec = vi.fn(async () => ({}))
    const client = clientWith([connection({ id: 'conn_pc_1', providerId: 'pinecone' })], exec)
    const tools = await hubIntegrationTools({ client })
    const handler = tools[0]!.handler

    await expect(handler({ action: 'vectors.query' })).resolves.toBeDefined() // no input → {}
    await expect(handler({ action: '../admin/exec' })).rejects.toThrow(TypeError)
    await expect(handler({ action: 'vectors query' })).rejects.toThrow(TypeError)
    await expect(handler({})).rejects.toThrow(TypeError)
    await expect(handler({ action: 'vectors.query', input: ['array'] })).rejects.toThrow(TypeError)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('surfaces a hub policy denial as a clear tool error with the hub code', async () => {
    const exec = vi.fn(async () => {
      throw new PlatformHubError(
        'Action pinecone.vectors.query is denied by policy for this connection',
        403,
        'POLICY_DENIED',
        {},
      )
    })
    const client = clientWith([connection({ id: 'conn_pc_1', providerId: 'pinecone' })], exec)
    const tools = await hubIntegrationTools({ client })

    await expect(tools[0]!.handler({ action: 'vectors.query', input: {} })).rejects.toThrow(
      /hub_pinecone: hub exec 'pinecone\.vectors\.query' failed \(403 POLICY_DENIED\): .*denied by policy/,
    )
  })
})

describe('createHubIntegrationToolServer', () => {
  it('serves the hub tools on the shared stdio JSON-RPC core and routes tools/call through exec', async () => {
    const exec = vi.fn(async () => ({ branch: { id: 'br_new' } }))
    const client = clientWith([connection({ id: 'conn_nb_1', providerId: 'neon' })], exec)
    const server = await createHubIntegrationToolServer({ client })

    const listed = await server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    })
    const tools = (listed?.result as { tools: Array<{ name: string }> }).tools
    expect(tools.map((tool) => tool.name)).toEqual(['hub_neon'])

    const called = await server.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'hub_neon',
        arguments: { action: 'branches.get', input: { project_id: 'p', branch_id: 'b' } },
      },
    })
    expect((called?.result as { content: unknown[] }).content).toBeDefined()
    expect(exec).toHaveBeenCalledWith({
      path: 'neon.branches.get',
      input: { project_id: 'p', branch_id: 'b' },
      connectionId: 'conn_nb_1',
    })

    const denied = await server.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'hub_neon', arguments: { action: 'not a name' } },
    })
    expect(denied?.error?.code).toBe(-32602) // TypeError → invalid params
    expect(denied?.error?.message).toMatch(/action must be a provider action name/)
  })

  it('serves zero tools when the user has no active data-provider connections', async () => {
    const client = clientWith([connection({ id: 'conn_sl_1', providerId: 'slack' })])
    const server = await createHubIntegrationToolServer({ client })
    const listed = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect((listed?.result as { tools: unknown[] }).tools).toEqual([])
  })

  it('includes neon in the default data-provider kinds', () => {
    expect(HUB_DATA_PROVIDER_KINDS).toContain('neon')
    expect(HUB_DATA_PROVIDER_KINDS).toContain('pinecone')
  })
})
