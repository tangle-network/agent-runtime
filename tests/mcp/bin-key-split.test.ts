/**
 * The `agent-runtime-mcp` bin over real sockets: a spawned bin speaks MCP on stdio, its supervisor
 * brain calls a local router, and its Sandbox SDK client calls a local Sandbox API. A platform key
 * serves one product, so a caller holding a router key and a separate sandbox key must see each key
 * reach only its own product.
 */
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ROUTER_KEY = 'router-key-0123456789abcdef'
const SANDBOX_KEY = 'sandbox-key-fedcba9876543210'

interface SeenRequest {
  method: string
  url: string
  authorization: string | undefined
  body: string
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function listen(
  handler: (req: SeenRequest, res: ServerResponse) => void,
  seen: SeenRequest[],
): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    const request: SeenRequest = {
      method: req.method ?? '',
      url: req.url ?? '',
      authorization: req.headers.authorization,
      body: await readBody(req),
    }
    seen.push(request)
    handler(request, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}` }
}

/** Answer the supervisor brain: first a `spawn_worker` call for one sandbox worker, then a final
 *  text turn. Streams when the request asks to. */
function routerReply(req: SeenRequest, res: ServerResponse, turn: number): void {
  if (!req.url.includes('/chat/completions')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'not found' } }))
    return
  }
  const body = JSON.parse(req.body) as {
    stream?: boolean
    tools?: Array<{ function?: { name?: string } }>
  }
  const spawnTool = body.tools
    ?.map((tool) => tool.function?.name)
    .find((name): name is string => typeof name === 'string' && name.endsWith('spawn_worker'))
  const toolCall =
    turn === 0 && spawnTool
      ? {
          id: 'call-spawn-1',
          type: 'function',
          function: {
            name: spawnTool,
            arguments: JSON.stringify({
              profile: {
                name: 'answer-worker',
                harness: 'opencode',
                model: { provider: 'tangle-router', default: 'test-worker-model' },
                prompt: { systemPrompt: 'Answer the task in one line.' },
              },
              task: 'Reply with DELEGATED-391.',
            }),
          },
        }
      : undefined
  const message = toolCall
    ? { role: 'assistant', content: null, tool_calls: [toolCall] }
    : { role: 'assistant', content: 'done' }
  const finish = toolCall ? 'tool_calls' : 'stop'
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  if (body.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const delta = toolCall
      ? { role: 'assistant', tool_calls: [{ index: 0, ...toolCall }] }
      : { role: 'assistant', content: 'done' }
    res.write(`data: ${JSON.stringify({ id: 'c', choices: [{ index: 0, delta }] })}\n\n`)
    res.write(
      `data: ${JSON.stringify({ id: 'c', choices: [{ index: 0, delta: {}, finish_reason: finish }], usage })}\n\n`,
    )
    res.end('data: [DONE]\n\n')
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({
      id: 'c',
      model: 'test-brain',
      choices: [{ index: 0, message, finish_reason: finish }],
      usage,
    }),
  )
}

/** One newline-delimited JSON-RPC exchange with the spawned bin. */
function rpc(child: ChildProcessWithoutNullStreams) {
  let buffer = ''
  const waiters = new Map<number, (message: Record<string, unknown>) => void>()
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
      if (!line) continue
      const message = JSON.parse(line) as Record<string, unknown>
      if (typeof message.id === 'number') waiters.get(message.id)?.(message)
    }
  })
  let nextId = 1
  return (method: string, params: unknown): Promise<Record<string, unknown>> => {
    const id = nextId++
    const reply = new Promise<Record<string, unknown>>((resolve) => waiters.set(id, resolve))
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    return reply
  }
}

describe('agent-runtime-mcp bin: one key per product', () => {
  const servers: Server[] = []
  let child: ChildProcessWithoutNullStreams | undefined

  afterEach(async () => {
    child?.kill('SIGKILL')
    child = undefined
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))))
  })

  it('builds the Sandbox client from TANGLE_SANDBOX_API_KEY and keeps the router key on the router', async () => {
    const routerSeen: SeenRequest[] = []
    const sandboxSeen: SeenRequest[] = []
    let routerTurn = 0
    const router = await listen((req, res) => {
      const turn = req.url.includes('/chat/completions') ? routerTurn++ : routerTurn
      routerReply(req, res, turn)
    }, routerSeen)
    const sandbox = await listen((_req, res) => {
      // Refuse every create: this test is about which key reached the Sandbox API, not a box.
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'TEST_REFUSED', message: 'test sandbox refuses' } }))
    }, sandboxSeen)
    servers.push(router.server, sandbox.server)

    const stderr: string[] = []
    child = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src/mcp/bin.ts')], {
      cwd: repoRoot,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        MCP_ENABLE_DELEGATE: '1',
        // The legacy single key is set to the router key, so a client built from it would show up
        // at the Sandbox API with the wrong bearer.
        TANGLE_API_KEY: ROUTER_KEY,
        TANGLE_SANDBOX_API_KEY: SANDBOX_KEY,
        SANDBOX_BASE_URL: sandbox.url,
        MCP_SUPERVISOR_ROUTER_KEY: ROUTER_KEY,
        MCP_SUPERVISOR_ROUTER_BASE_URL: router.url,
        MCP_SUPERVISOR_MODEL: 'test-brain',
      },
    })
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')))
    const call = rpc(child)

    await call('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'bin-key-split-test', version: '0' },
    })
    const listed = await call('tools/list', {})
    const toolNames = ((listed.result as { tools: Array<{ name: string }> }).tools ?? []).map(
      (tool) => tool.name,
    )
    expect(toolNames, stderr.join('')).toContain('delegate')

    await call('tools/call', {
      name: 'delegate',
      arguments: { intent: 'Reply with DELEGATED-391.' },
    })

    const chats = routerSeen.filter((req) => req.url.includes('/chat/completions'))
    expect(chats.length, stderr.join('')).toBeGreaterThan(0)
    for (const req of chats) expect(req.authorization).toBe(`Bearer ${ROUTER_KEY}`)

    expect(sandboxSeen.length, stderr.join('')).toBeGreaterThan(0)
    for (const req of sandboxSeen) {
      expect(req.authorization).toBe(`Bearer ${SANDBOX_KEY}`)
      // The worker box is created with the authored profile; neither key rides in its request.
      expect(req.body).not.toContain(SANDBOX_KEY)
      expect(req.body).not.toContain(ROUTER_KEY)
    }
    for (const req of routerSeen) expect(JSON.stringify(req)).not.toContain(SANDBOX_KEY)
  }, 60_000)

  it('falls back to TANGLE_API_KEY for the Sandbox client when no sandbox key is set', async () => {
    const sandboxSeen: SeenRequest[] = []
    let routerTurn = 0
    const router = await listen((req, res) => {
      const turn = req.url.includes('/chat/completions') ? routerTurn++ : routerTurn
      routerReply(req, res, turn)
    }, [])
    const sandbox = await listen((_req, res) => {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'TEST_REFUSED', message: 'test sandbox refuses' } }))
    }, sandboxSeen)
    servers.push(router.server, sandbox.server)

    const stderr: string[] = []
    child = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src/mcp/bin.ts')], {
      cwd: repoRoot,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        MCP_ENABLE_DELEGATE: '1',
        TANGLE_API_KEY: SANDBOX_KEY,
        SANDBOX_BASE_URL: sandbox.url,
        MCP_SUPERVISOR_ROUTER_KEY: ROUTER_KEY,
        MCP_SUPERVISOR_ROUTER_BASE_URL: router.url,
        MCP_SUPERVISOR_MODEL: 'test-brain',
      },
    })
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')))
    const call = rpc(child)
    await call('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'bin-key-split-test', version: '0' },
    })
    await call('tools/call', {
      name: 'delegate',
      arguments: { intent: 'Reply with DELEGATED-391.' },
    })

    expect(sandboxSeen.length, stderr.join('')).toBeGreaterThan(0)
    for (const req of sandboxSeen) expect(req.authorization).toBe(`Bearer ${SANDBOX_KEY}`)
  }, 60_000)
})
