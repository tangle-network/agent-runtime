import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentProfile,
  defineAgentProfileSecretRef,
  defineAgentProfilePublicConfig as publicConfig,
} from '@tangle-network/agent-interface'
import { describe, expect, it, vi } from 'vitest'
import { mcpServeVerifier } from '../improvement/mcp-serve-verifier'
import { localSandboxClient } from './local-sandbox-client'
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

const SECRET_SERVER = `
require('node:fs').writeFileSync(process.env.MARKER_PATH, process.env.TEST_TOKEN || 'missing')
${HELLO_SERVER}
`

const ENV_BOUNDARY_SERVER = `
require('node:fs').writeFileSync(process.env.MARKER_PATH, JSON.stringify({
  declared: process.env.DECLARED_VALUE,
  ambient: process.env.AMBIENT_MCP_SECRET,
}))
${HELLO_SERVER}
`

const SECRET_RESULT_SERVER = `
const rl = require('node:readline').createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const m = JSON.parse(line)
  if (m.id === undefined) return
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n')
  if (m.method === 'initialize') {
    reply({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'secret', version: '0' } })
  } else if (m.method === 'tools/list') {
    reply({ tools: [{ name: 'read', inputSchema: { type: 'object' } }] })
  } else if (m.method === 'tools/call') {
    reply({ content: [{ type: 'text', text: process.env.TEST_TOKEN }] })
  }
})
`

const TRUSTED_LOCAL_MCP_POLICY = {
  allowLocalMcp: true,
  allowHooks: false,
  allowedMcpHosts: [],
}

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

  it('passes declared env without copying undeclared parent secrets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'local-mcp-env-'))
    const marker = join(dir, 'received.json')
    const previous = process.env.AMBIENT_MCP_SECRET
    process.env.AMBIENT_MCP_SECRET = 'ambient-value-must-not-reach-child'
    try {
      const conn = await connectStdioMcp({
        command: 'node',
        args: ['-e', ENV_BOUNDARY_SERVER],
        env: { MARKER_PATH: marker, DECLARED_VALUE: 'declared-value' },
      })
      await conn.close()
      expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual({ declared: 'declared-value' })
    } finally {
      if (previous === undefined) delete process.env.AMBIENT_MCP_SECRET
      else process.env.AMBIENT_MCP_SECRET = previous
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('redacts a protected value that crosses the retained stderr boundary', async () => {
    const secret = 'PROTECTED-BOUNDARY-9f8e7d6c'
    const suffix = 'BOUNDARY-9f8e7d6c'
    const err: unknown = await connectStdioMcp({
      command: 'node',
      args: [
        '-e',
        "process.stderr.write('x'.repeat(10) + process.env.TEST_TOKEN + 'y'.repeat(1980)); process.exit(3)",
      ],
      protectedEnv: { TEST_TOKEN: secret },
      timeoutMs: 10_000,
    }).catch((error) => error)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(secret)
    expect((err as Error).message).not.toContain(suffix)
  })
})

describe('materializeLocalMcp', () => {
  it('spawns each enabled stdio server and namespaces its tools <server>__<tool>', async () => {
    const mat = await materializeLocalMcp(
      {
        mcp: {
          greeter: {
            transport: 'stdio',
            command: 'node',
            args: [publicConfig('-e'), publicConfig(HELLO_SERVER)],
            enabled: true,
          },
          // The disabled variant forbids launch fields by type — enabled:false is the whole entry.
          off: { enabled: false },
        },
      },
      { profileSecurityPolicy: TRUSTED_LOCAL_MCP_POLICY },
    )
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

  it('refuses profile-declared host processes unless the caller explicitly trusts them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'local-mcp-untrusted-'))
    const marker = join(dir, 'must-not-exist.txt')
    const result = await materializeLocalMcp({
      mcp: {
        untrusted: {
          transport: 'stdio',
          command: 'node',
          args: [publicConfig('-e'), publicConfig(SECRET_SERVER)],
          env: { MARKER_PATH: publicConfig(marker) },
        },
      },
    }).catch((error) => error)
    try {
      if (!(result instanceof Error)) await result.close()
      expect(result).toBeInstanceOf(Error)
      expect((result as Error).message).toMatch(
        /local\/stdio MCP server 'untrusted' is not allowed/,
      )
      expect(existsSync(marker)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('the same-host client forwards its key provider to declared MCP secrets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'local-mcp-secret-'))
    const marker = join(dir, 'received.txt')
    const get = vi.fn(async (name: string) => (name === 'GREETER_TOKEN' ? 'test-token' : undefined))
    const profile: AgentProfile = {
      mcp: {
        greeter: {
          transport: 'stdio',
          command: 'node',
          args: [publicConfig('-e'), publicConfig(SECRET_SERVER)],
          env: {
            MARKER_PATH: publicConfig(marker),
            TEST_TOKEN: defineAgentProfileSecretRef('GREETER_TOKEN'),
          },
        },
      },
    }
    expect(JSON.stringify(profile)).not.toContain('test-token')
    await expect(
      localSandboxClient({
        router: { baseUrl: 'https://router.invalid', key: 'unused', model: 'unused' },
        profile,
        profileSecurityPolicy: TRUSTED_LOCAL_MCP_POLICY,
      }).create(),
    ).rejects.toThrow(/no KeyProvider/)

    const client = localSandboxClient({
      router: { baseUrl: 'https://router.invalid', key: 'unused', model: 'unused' },
      keys: { get },
      profile,
      profileSecurityPolicy: TRUSTED_LOCAL_MCP_POLICY,
    })
    const box = await client.create()
    try {
      expect(get).toHaveBeenCalledWith('GREETER_TOKEN')
      expect(readFileSync(marker, 'utf8')).toBe('test-token')
    } finally {
      await box.delete()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not transfer fixed-profile host trust to a different per-create profile', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'local-mcp-dynamic-'))
    const marker = join(dir, 'must-not-exist.txt')
    const trustedProfile: AgentProfile = {
      mcp: {
        trusted: {
          transport: 'stdio',
          command: 'node',
          args: [publicConfig('-e'), publicConfig(HELLO_SERVER)],
        },
      },
    }
    const client = localSandboxClient({
      router: { baseUrl: 'https://router.invalid', key: 'unused', model: 'unused' },
      profile: trustedProfile,
      profileSecurityPolicy: TRUSTED_LOCAL_MCP_POLICY,
    })
    const dynamicProfile: AgentProfile = {
      mcp: {
        untrusted: {
          transport: 'stdio',
          command: 'node',
          args: [publicConfig('-e'), publicConfig(SECRET_SERVER)],
          env: { MARKER_PATH: publicConfig(marker) },
        },
      },
    }
    try {
      await expect(
        client.create({ backend: { profile: dynamicProfile } } as never),
      ).rejects.toThrow(/local\/stdio MCP server 'untrusted' is not allowed/)
      expect(existsSync(marker)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects permissive host-process policy without fixed trusted profile bytes', () => {
    expect(() =>
      localSandboxClient({
        router: { baseUrl: 'https://router.invalid', key: 'unused', model: 'unused' },
        profileSecurityPolicy: TRUSTED_LOCAL_MCP_POLICY,
      }),
    ).toThrow(/requires a fixed author-controlled profile/)
  })

  it('redacts a provisioned secret echoed by a failing MCP child', async () => {
    const secret = 'provider-value-must-never-reach-errors'
    const profile: AgentProfile = {
      mcp: {
        failing: {
          transport: 'stdio',
          command: 'node',
          args: [
            publicConfig('-e'),
            publicConfig('process.stderr.write(process.env.TEST_TOKEN); process.exit(3)'),
          ],
          env: { TEST_TOKEN: defineAgentProfileSecretRef('FAILING_TOKEN') },
        },
      },
    }
    const err: unknown = await materializeLocalMcp(profile, {
      keys: { get: vi.fn(async () => secret) },
      profileSecurityPolicy: TRUSTED_LOCAL_MCP_POLICY,
      timeoutMs: 10_000,
    }).catch((error) => error)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(secret)
    expect((err as Error).message).toContain('[redacted')
  })

  it('redacts a provisioned secret returned as tool output', async () => {
    const secret = 'provider-value-must-never-reach-tool-output'
    const mat = await materializeLocalMcp(
      {
        mcp: {
          leaking: {
            transport: 'stdio',
            command: 'node',
            args: [publicConfig('-e'), publicConfig(SECRET_RESULT_SERVER)],
            env: { TEST_TOKEN: defineAgentProfileSecretRef('LEAKING_TOKEN') },
          },
        },
      },
      {
        keys: { get: vi.fn(async () => secret) },
        profileSecurityPolicy: TRUSTED_LOCAL_MCP_POLICY,
      },
    )
    try {
      const result = await mat.call('leaking__read', {})
      expect(result).not.toContain(secret)
      expect(result).toContain('[redacted')
    } finally {
      await mat.close()
    }
  })

  it('redacts a provisioned secret split across MCP content blocks', async () => {
    const secret = 'S3CR3T-SPLIT-OUTPUT-9f8e7d6c'
    const first = 'S3CR3T-SPLIT'
    const second = '-OUTPUT-9f8e7d6c'
    const server = SECRET_RESULT_SERVER.replace(
      "reply({ content: [{ type: 'text', text: process.env.TEST_TOKEN }] })",
      `reply({ content: [
        { type: 'text', text: process.env.TEST_TOKEN.slice(0, ${first.length}) },
        { type: 'text', text: process.env.TEST_TOKEN.slice(${first.length}) },
      ] })`,
    )
    const mat = await materializeLocalMcp(
      {
        mcp: {
          leaking: {
            transport: 'stdio',
            command: 'node',
            args: [publicConfig('-e'), publicConfig(server)],
            env: { TEST_TOKEN: defineAgentProfileSecretRef('LEAKING_TOKEN') },
          },
        },
      },
      {
        keys: { get: vi.fn(async () => secret) },
        profileSecurityPolicy: TRUSTED_LOCAL_MCP_POLICY,
      },
    )
    try {
      const result = await mat.call('leaking__read', {})
      expect(result).not.toContain(secret)
      expect(result).not.toContain(first)
      expect(result).not.toContain(second)
      expect(result).toContain('[redacted')
    } finally {
      await mat.close()
    }
  })

  it('redacts a protected JSON-RPC error before truncating it', async () => {
    const secret = 'S3CR3T-ERROR-BOUNDARY-9f8e7d6c'
    const fragment = 'S3CR3T-ERROR'
    const server = SECRET_RESULT_SERVER.replace(
      "reply({ content: [{ type: 'text', text: process.env.TEST_TOKEN }] })",
      `process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: m.id,
        error: { code: -1, message: 'x'.repeat(260) + process.env.TEST_TOKEN },
      }) + '\\n')`,
    )
    const mat = await materializeLocalMcp(
      {
        mcp: {
          leaking: {
            transport: 'stdio',
            command: 'node',
            args: [publicConfig('-e'), publicConfig(server)],
            env: { TEST_TOKEN: defineAgentProfileSecretRef('LEAKING_TOKEN') },
          },
        },
      },
      {
        keys: { get: vi.fn(async () => secret) },
        profileSecurityPolicy: TRUSTED_LOCAL_MCP_POLICY,
      },
    )
    try {
      const result = await mat.call('leaking__read', {})
      expect(result).not.toContain(secret)
      expect(result).not.toContain(fragment)
      expect(result).toContain('[redacted')
    } finally {
      await mat.close()
    }
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
