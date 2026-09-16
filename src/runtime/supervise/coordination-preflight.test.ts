import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { preflightPublicCoordination } from './coordination-preflight'

const closes: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closes.splice(0).map((close) => close()))
})

async function endpoint(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closes.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test endpoint did not bind')
  return `http://127.0.0.1:${address.port}`
}

function inspect(url: string, signal = new AbortController().signal, requestTimeoutMs = 1000) {
  return preflightPublicCoordination({
    url,
    headers: { Authorization: 'Bearer private-test-credential' },
    signal,
    requestTimeoutMs,
    toolNames: ['stop'],
  })
}

describe('public coordination preflight', () => {
  it('performs authenticated initialization and checks the exact granted tool names', async () => {
    const methods: string[] = []
    const url = await endpoint((request, response) => {
      expect(request.headers.authorization).toBe('Bearer private-test-credential')
      let body = ''
      request.on('data', (chunk) => {
        body += String(chunk)
      })
      request.on('end', () => {
        const rpc = JSON.parse(body)
        methods.push(rpc.method)
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result:
              rpc.method === 'initialize'
                ? {
                    protocolVersion: '2024-11-05',
                    serverInfo: { name: 'coordination' },
                    capabilities: { tools: {} },
                  }
                : { tools: [{ name: 'stop' }] },
          }),
        )
      })
    })
    await inspect(url)
    expect(methods).toEqual(['initialize', 'tools/list'])
  })

  it.each([401, 403, 404, 503])(
    'refuses HTTP %s without retaining echoed secrets',
    async (status) => {
      const url = await endpoint((_request, response) => {
        response.writeHead(status).end('private-test-credential private-response')
      })
      await expect(inspect(url)).rejects.toThrow(
        `coordination public endpoint preflight failed: HTTP ${status}`,
      )
      try {
        await inspect(url)
      } catch (error) {
        expect(String(error)).not.toContain('private-')
        expect(String(error)).not.toContain(url)
        expect(error).not.toHaveProperty('cause')
      }
    },
  )

  it('refuses redirects instead of forwarding actor credentials to another endpoint', async () => {
    let redirected = 0
    const target = await endpoint((_request, response) => {
      redirected++
      response.end('{}')
    })
    const url = await endpoint((_request, response) =>
      response.writeHead(307, { location: target }).end(),
    )
    await expect(inspect(url)).rejects.toThrow('HTTP 307')
    expect(redirected).toBe(0)
  })

  it.each(['not-json', '{}', '{"jsonrpc":"2.0","id":"other","result":{}}'])(
    'refuses malformed MCP response %s',
    async (body) => {
      const url = await endpoint((_request, response) => response.end(body))
      await expect(inspect(url)).rejects.toThrow('invalid MCP response')
    },
  )

  it('bounds a hanging response body and distinguishes timeout from cancellation', async () => {
    const url = await endpoint((_request, response) => {
      response.writeHead(200)
      response.write('{')
    })
    await expect(inspect(url, undefined, 40)).rejects.toThrow('timed out')
    const controller = new AbortController()
    const pending = inspect(url, controller.signal)
    controller.abort('private-test-credential in a caller reason')
    await expect(pending).rejects.toThrow('preflight failed: cancelled')
  })

  it('bounds response bytes before decoding or retaining an upstream body', async () => {
    const url = await endpoint((_request, response) => response.end('x'.repeat(1024 * 1024 + 1)))
    await expect(inspect(url)).rejects.toThrow('response too large')
  })

  it('rejects incomplete or extra tool grants', async () => {
    const url = await endpoint((request, response) => {
      let body = ''
      request.on('data', (chunk) => {
        body += String(chunk)
      })
      request.on('end', () => {
        const rpc = JSON.parse(body)
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result:
              rpc.method === 'initialize'
                ? {
                    protocolVersion: '2024-11-05',
                    serverInfo: { name: 'coordination' },
                    capabilities: { tools: {} },
                  }
                : { tools: [{ name: 'spawn_worker' }] },
          }),
        )
      })
    })
    await expect(inspect(url)).rejects.toThrow('coordination tool grants differ')
  })
})
