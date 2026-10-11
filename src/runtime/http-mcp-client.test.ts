import { createServer, type Server } from 'node:http'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectHttpMcp, type HttpMcpServerSpec, type McpConnectFault } from './http-mcp-client'
import { materializeLocalMcp } from './stdio-mcp-client'

/**
 * A minimal in-test streamable-HTTP MCP server: JSON bodies, the SSE variant on
 * one route, session ids, and the protected-header redaction oracle.
 */
function startTestServer(): Promise<{
  server: Server
  url: string
  state: { sessionId?: string; authHeader?: string; deletes: number }
}> {
  const state: { sessionId?: string; authHeader?: string; deletes: number } = { deletes: 0 }
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => {
      if (!req.url || !req.url.startsWith('/mcp')) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'not found' }))
        return
      }
      const body = chunks.length
        ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>)
        : undefined
      state.authHeader = req.headers.authorization as string | undefined
      if (req.method === 'DELETE') {
        state.deletes += 1
        res.writeHead(200).end()
        return
      }
      if (body?.method === 'initialize') {
        state.sessionId = `sess-${Date.now()}`
        res.writeHead(200, {
          'content-type': 'application/json',
          'mcp-session-id': state.sessionId,
        })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'test', version: '0' },
            },
          }),
        )
        return
      }
      if (state.sessionId && req.headers['mcp-session-id'] !== state.sessionId) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body?.id ?? null,
            error: { code: -32600, message: 'session required' },
          }),
        )
        return
      }
      if (body?.method === 'tools/list') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              tools: [{ name: 'echo', description: 'Echo.', inputSchema: { type: 'object' } }],
            },
          }),
        )
        return
      }
      if (body?.method === 'tools/call') {
        const args = (body.params as { arguments?: Record<string, unknown> })?.arguments ?? {}
        if (args.fail === true) {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          res.end(
            `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'boom see-secret-value' }], isError: true } })}\n\n`,
          )
          return
        }
        // The SSE answer shape: the streamable transport's other content type.
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: `echo:${JSON.stringify(args)}` }] } })}\n\n`,
        )
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body?.id ?? null, result: {} }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number }
      resolve({ server, url: `http://127.0.0.1:${address.port}/mcp`, state })
    })
  })
}

let testServer: Awaited<ReturnType<typeof startTestServer>>

beforeAll(async () => {
  testServer = await startTestServer()
})

afterAll(async () => {
  await new Promise<void>((resolve) => testServer.server.close(() => resolve()))
})

function spec(overrides: Partial<HttpMcpServerSpec> = {}): HttpMcpServerSpec {
  return { url: testServer.url, timeoutMs: 5_000, ...overrides }
}

describe('connectHttpMcp', () => {
  it('handshakes, captures the session id, and lists tools', async () => {
    const conn = await connectHttpMcp(spec())
    try {
      expect(conn.tools.map((t) => t.name)).toEqual(['echo'])
      expect(testServer.state.sessionId).toBeDefined()
    } finally {
      await conn.close()
    }
    expect(testServer.state.deletes).toBe(1)
  })

  it('replays the session id on later requests and answers SSE-shaped tool calls', async () => {
    const conn = await connectHttpMcp(spec())
    try {
      const out = await conn.callTool('echo', { hello: 'world' })
      expect(out).toBe('echo:{"hello":"world"}')
    } finally {
      await conn.close()
    }
  })

  it('maps an isError tool result to the ERROR: outcome string and redacts protected header values', async () => {
    const conn = await connectHttpMcp(
      spec({ protectedHeaders: { authorization: 'see-secret-value' } }),
    )
    try {
      expect(testServer.state.authHeader).toBe('see-secret-value') // sent to the server…
      const out = await conn.callTool('echo', { fail: true })
      expect(out.startsWith('ERROR:')).toBe(true)
      expect(out).not.toContain('see-secret-value') // …but never back out
      expect(out).toContain('[redacted]')
    } finally {
      await conn.close()
    }
  })

  it('refuses non-HTTPS endpoints outside localhost', async () => {
    await expect(connectHttpMcp({ url: 'http://remote.example.com/mcp' })).rejects.toThrow(
      /non-HTTPS/,
    )
  })

  it('surfaces a non-2xx handshake as a connect fault with the status', async () => {
    await expect(
      connectHttpMcp(spec({ url: `${testServer.url.replace('/mcp', '')}/missing` })),
    ).rejects.toMatchObject({ name: 'McpConnectFault' } satisfies Partial<McpConnectFault>)
  })
})

describe('materializeLocalMcp with a remote server', () => {
  const profileWithRemote = (headers?: Record<string, unknown>): AgentProfile =>
    ({
      name: 'remote-mcp-worker',
      harness: null,
      model: { provider: 'tangle-router', default: 'test-model' },
      mcp: {
        hindsight: {
          transport: 'http',
          url: testServer.url,
          ...(headers ? { headers } : {}),
        },
      },
    }) as unknown as AgentProfile

  it('surfaces the remote tools under the namespaced name and routes calls over HTTP', async () => {
    const materialized = await materializeLocalMcp(profileWithRemote())
    try {
      expect(materialized.tools.map((t) => t.function.name)).toEqual(['hindsight__echo'])
      expect(materialized.owns('hindsight__echo')).toBe(true)
      expect(await materialized.call('hindsight__echo', { x: 1 })).toBe('echo:{"x":1}')
    } finally {
      await materialized.close()
    }
  })

  it('resolves secret-ref headers through the KeyProvider and keeps them redacted', async () => {
    const materialized = await materializeLocalMcp(
      profileWithRemote({
        authorization: { kind: 'secret-ref', key: 'HINDSIGHT_TOKEN', format: 'bearer' },
      }),
      {
        keys: {
          async get(name) {
            return name === 'HINDSIGHT_TOKEN' ? 'tok-abc123' : undefined
          },
        },
      },
    )
    try {
      expect(testServer.state.authHeader).toBe('Bearer tok-abc123')
      const out = await materialized.call('hindsight__echo', { fail: true })
      expect(out).not.toContain('tok-abc123')
    } finally {
      await materialized.close()
    }
  })

  it('fails closed when a secret header has no KeyProvider behind it', async () => {
    await expect(
      materializeLocalMcp(
        profileWithRemote({
          authorization: { kind: 'secret-ref', key: 'HINDSIGHT_TOKEN' },
        }),
      ),
    ).rejects.toThrow(/no KeyProvider was supplied/)
  })
})
