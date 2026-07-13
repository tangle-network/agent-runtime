import { describe, expect, it } from 'vitest'
import { mcpServeVerifier } from '../improvement/mcp-serve-verifier'
import { connectStdioMcp, McpSpawnFault, materializeLocalMcp } from './stdio-mcp-client'

/** A minimal stdio MCP server (newline JSON-RPC 2.0): initialize / tools/list /
 *  tools/call, one `hello` tool — the smallest real server the protocol allows. */
const HELLO_SERVER = `
const rl = require('node:readline').createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.id === undefined) return
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n')
  if (m.method === 'initialize') {
    reply({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'hello', version: '0' } })
  } else if (m.method === 'tools/list') {
    reply({ tools: [{ name: 'hello', description: 'say hello', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } }] })
  } else if (m.method === 'tools/call') {
    reply({ content: [{ type: 'text', text: 'hello ' + ((m.params && m.params.arguments && m.params.arguments.name) || 'world') }] })
  }
})
`

describe('connectStdioMcp', () => {
  it('handshakes, lists tools, round-trips tools/call, closes', async () => {
    const conn = await connectStdioMcp({ command: 'node', args: ['-e', HELLO_SERVER] })
    try {
      expect(conn.tools.map((t) => t.name)).toEqual(['hello'])
      await expect(conn.callTool('hello', { name: 'drew' })).resolves.toBe('hello drew')
    } finally {
      await conn.close()
    }
  })

  it('throws McpSpawnFault for a missing binary (setup bug, not a failed candidate)', async () => {
    await expect(
      connectStdioMcp({ command: 'definitely-not-a-real-binary-xyz', timeoutMs: 5_000 }),
    ).rejects.toBeInstanceOf(McpSpawnFault)
  })

  it('a server that exits before serving fails with a plain Error carrying stderr', async () => {
    const err: unknown = await connectStdioMcp({
      command: 'node',
      args: ['-e', 'process.stderr.write("boom"); process.exit(3)'],
      timeoutMs: 10_000,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(McpSpawnFault)
    expect((err as Error).message).toMatch(/exited/)
    expect((err as Error).message).toMatch(/boom/)
  })
})

describe('materializeLocalMcp', () => {
  it('spawns each enabled stdio server and namespaces its tools <server>__<tool>', async () => {
    const mat = await materializeLocalMcp({
      mcp: {
        greeter: { transport: 'stdio', command: 'node', args: ['-e', HELLO_SERVER], enabled: true },
        off: { transport: 'stdio', command: 'node', args: ['-e', HELLO_SERVER], enabled: false },
      },
    })
    try {
      expect(mat.tools.map((t) => t.function.name)).toEqual(['greeter__hello'])
      expect(mat.owns('greeter__hello')).toBe(true)
      expect(mat.owns('hello')).toBe(false)
      await expect(mat.call('greeter__hello', { name: 'phase3' })).resolves.toBe('hello phase3')
    } finally {
      await mat.close()
    }
  })

  it('fails closed on a non-stdio transport (the same-host client cannot fake a remote server)', async () => {
    await expect(
      materializeLocalMcp({ mcp: { remote: { transport: 'http', url: 'https://example.test' } } }),
    ).rejects.toThrow(/transport 'http'/)
  })

  it('a profile with no MCP surface materializes zero tools and closes cleanly', async () => {
    const mat = await materializeLocalMcp({})
    expect(mat.tools).toEqual([])
    await mat.close()
  })
})

describe('mcpServeVerifier (rebased on connectStdioMcp)', () => {
  it('passes a server that boots and lists >= minTools tools', async () => {
    const verify = mcpServeVerifier({ command: 'node', args: ['-e', HELLO_SERVER] })
    await expect(verify(process.cwd())).resolves.toEqual({ ok: true })
  })

  it('fails a candidate that lists fewer tools than minTools', async () => {
    const verify = mcpServeVerifier({ command: 'node', args: ['-e', HELLO_SERVER], minTools: 2 })
    const r = await verify(process.cwd())
    expect(r.ok).toBe(false)
    expect(r.feedback).toMatch(/1 tool/)
  })

  it('throws on a missing start binary (setup bug, never a silent fallback)', async () => {
    const verify = mcpServeVerifier({
      command: 'definitely-not-a-real-binary-xyz',
      timeoutMs: 5_000,
    })
    await expect(verify(process.cwd())).rejects.toThrow(/not found in PATH/)
  })
})
