import { describe, expect, it, vi } from 'vitest'
import {
  type CapabilityManifest,
  CapabilityNotAdmittedError,
  type CertifiedCapability,
  manifestFromProfile,
} from './capability'
import { type CertifiedProfile, composeCertifiedPrompt } from './delivery'
import {
  composeCertifiedProfile,
  composeCertifiedProfileFromWire,
  type ResolveCtx,
} from './resolver'

const provenance = {
  contentHash: 'h1',
  version: 1,
  lift: '+2.0pp',
  promotedAt: '2026-06-13T00:00:00.000Z',
  sourcePath: null,
}

const wireProfile: CertifiedProfile = {
  target: 'support-agent',
  generatedAt: '2026-06-13T00:00:00.000Z',
  agentProfileDiffs: [],
  capabilities: [],
  agentProfile: null,
  promptSurface: {
    surface: 'Confirm the invoice id before refunding.',
    surfaceHash: 'abc123',
    version: 4,
    lift: '+3.1pp',
  },
  artifacts: {
    skill: [
      {
        path: 'skills/refunds/SKILL.md',
        content: 'Refund flow: verify, then issue.',
        contentHash: 'd1',
        version: 2,
        lift: '+1.2pp',
        promotedAt: '2026-06-12T00:00:00.000Z',
      },
    ],
  },
}

function toolCapability(overrides: Partial<CertifiedCapability> = {}): CertifiedCapability {
  return {
    id: 'fx.convert',
    iface: {
      surface: 'tool',
      name: 'fx_convert',
      description: 'convert currency',
      parameters: { type: 'object', properties: { amount: { type: 'number' } } },
    },
    binding: { kind: 'http', url: 'https://fx.test/convert' },
    auth: { mode: 'none' },
    provenance,
    ...overrides,
  }
}

function manifest(capabilities: CertifiedCapability[]): CapabilityManifest {
  return {
    target: 'support-agent',
    generatedAt: '2026-06-13T00:00:00.000Z',
    promptSurface: wireProfile.promptSurface,
    capabilities,
  }
}

describe('manifestFromProfile', () => {
  it('round-trips a CertifiedProfile into context capabilities + carries promptSurface', () => {
    const m = manifestFromProfile(wireProfile)
    expect(m.target).toBe('support-agent')
    expect(m.promptSurface?.version).toBe(4)
    expect(m.capabilities).toHaveLength(1)
    const cap = m.capabilities[0]!
    expect(cap.iface).toMatchObject({ surface: 'context', kind: 'skill' })
    expect(cap.binding.kind).toBe('inline')
    expect(cap.provenance.contentHash).toBe('d1')
    expect(cap.provenance.sourcePath).toBe('skills/refunds/SKILL.md')
  })

  it('infers an http tool from a tool-shaped artifact', () => {
    const profile: CertifiedProfile = {
      target: 't',
      generatedAt: 'g',
      promptSurface: null,
      agentProfileDiffs: [],
      capabilities: [],
      agentProfile: null,
      artifacts: {
        tool: [
          {
            path: 'tools/fx.json',
            content: JSON.stringify({
              name: 'fx_convert',
              parameters: { type: 'object' },
              url: 'https://fx.test/convert',
            }),
            contentHash: 'd2',
            version: 1,
            lift: null,
            promotedAt: 'p',
          },
        ],
      },
    }
    const cap = manifestFromProfile(profile).capabilities[0]!
    expect(cap.iface.surface).toBe('tool')
    expect(cap.binding.kind).toBe('http')
  })

  it('infers an mcp-stdio binding from a command-shaped artifact', () => {
    const profile: CertifiedProfile = {
      target: 't',
      generatedAt: 'g',
      promptSurface: null,
      agentProfileDiffs: [],
      capabilities: [],
      agentProfile: null,
      artifacts: {
        mcp: [
          {
            path: 'mcp/ticketing.json',
            content: JSON.stringify({ name: 'ticketing', command: 'node', args: ['server.js'] }),
            contentHash: 'd3',
            version: 1,
            lift: null,
            promotedAt: 'p',
          },
        ],
      },
    }
    const cap = manifestFromProfile(profile).capabilities[0]!
    expect(cap.iface).toMatchObject({ surface: 'mcp', serverName: 'ticketing' })
    expect(cap.binding.kind).toBe('mcp-stdio')
  })

  it('falls back to context/inline for an unparseable artifact', () => {
    const profile: CertifiedProfile = {
      target: 't',
      generatedAt: 'g',
      promptSurface: null,
      agentProfileDiffs: [],
      capabilities: [],
      agentProfile: null,
      artifacts: {
        notes: [
          {
            path: 'n.txt',
            content: 'free text',
            contentHash: 'd',
            version: null,
            lift: null,
            promotedAt: 'p',
          },
        ],
      },
    }
    const cap = manifestFromProfile(profile).capabilities[0]!
    expect(cap.iface.surface).toBe('context')
    expect(cap.binding.kind).toBe('inline')
  })
})

describe('composeCertifiedProfile — prompt fold regression lock', () => {
  it('folds inline/context byte-IDENTICALLY to composeCertifiedPrompt for the same inputs', async () => {
    const base = { systemPrompt: 'BASE SYSTEM PROMPT' }
    const surface = await composeCertifiedProfile(base, manifestFromProfile(wireProfile))
    const reference = composeCertifiedPrompt('BASE SYSTEM PROMPT', wireProfile)
    expect(surface.systemPrompt).toBe(reference)
    expect(surface.promptAdditions).toEqual([
      'Confirm the invoice id before refunding.',
      'Refund flow: verify, then issue.',
    ])
  })

  it('fromWire matches the manual manifest path', async () => {
    const base = { systemPrompt: 'B' }
    const a = await composeCertifiedProfileFromWire(base, wireProfile)
    const b = await composeCertifiedProfile(base, manifestFromProfile(wireProfile))
    expect(a.systemPrompt).toBe(b.systemPrompt)
  })

  it('preserves byte-stable fold order for a mix of null-path and non-null-path skill artifacts', async () => {
    // A null path sorts as '' (first); the manifest→resolve→fold round-trip must
    // preserve that order, not rebuild the path from iface.name and flip it.
    const profile: CertifiedProfile = {
      target: 't',
      generatedAt: 'g',
      promptSurface: null,
      agentProfileDiffs: [],
      capabilities: [],
      agentProfile: null,
      artifacts: {
        skill: [
          {
            path: null,
            content: 'ZZZ',
            contentHash: 'h1',
            version: 1,
            lift: null,
            promotedAt: 'p',
          },
          {
            path: 'a.md',
            content: 'AAA',
            contentHash: 'h2',
            version: 1,
            lift: null,
            promotedAt: 'p',
          },
        ],
      },
    }
    const reference = composeCertifiedPrompt('BASE SYSTEM PROMPT', profile)
    const surface = await composeCertifiedProfile(
      { systemPrompt: 'BASE SYSTEM PROMPT' },
      manifestFromProfile(profile),
    )
    expect(surface.systemPrompt).toBe(reference)
    expect(surface.promptAdditions).toEqual(['ZZZ', 'AAA'])
  })

  it('fail-closed: a null manifest returns the base surface only', async () => {
    const surface = await composeCertifiedProfile({ systemPrompt: 'BASE' }, null)
    expect(surface.systemPrompt).toBe('BASE')
    expect(surface.tools).toEqual([])
    expect(surface.mcpConnections).toEqual({})
    expect(surface.promptAdditions).toEqual([])
  })

  it('delivers free-text (instructions) context into the prompt, never silently dropped', async () => {
    // A non-skill/prompt-surface artifact lowers to an `instructions` context.
    // It must reach the agent — folded into the prompt — not vanish (no file, no
    // tool, no silent erasure).
    const profile: CertifiedProfile = {
      target: 't',
      generatedAt: 'g',
      promptSurface: null,
      agentProfileDiffs: [],
      capabilities: [],
      agentProfile: null,
      artifacts: {
        notes: [
          {
            path: 'n.txt',
            content: 'CRITICAL FREE TEXT',
            contentHash: 'h',
            version: null,
            lift: null,
            promotedAt: 'p',
          },
        ],
      },
    }
    const drops: string[] = []
    const surface = await composeCertifiedProfile(
      { systemPrompt: 'BASE' },
      manifestFromProfile(profile),
      { onDrop: (id) => drops.push(id) },
    )
    expect(drops).toEqual([])
    expect(surface.systemPrompt).toContain('CRITICAL FREE TEXT')
    expect(surface.promptAdditions).toEqual(['CRITICAL FREE TEXT'])
    expect(surface.files).toEqual([])
    expect(surface.tools).toEqual([])
  })
})

describe('composeCertifiedProfile — mcp lowering', () => {
  it('lowers an mcp-stdio binding to a flat AgentProfileMcpServer (stdio shape)', async () => {
    const cap: CertifiedCapability = {
      id: 'ticketing',
      iface: { surface: 'mcp', serverName: 'ticketing', toolset: ['ticket_open'] },
      binding: { kind: 'mcp-stdio', command: 'node', args: ['server.js'], env: { K: 'v' } },
      auth: { mode: 'none' },
      provenance,
    }
    const surface = await composeCertifiedProfile({ systemPrompt: 'B' }, manifest([cap]))
    const server = surface.mcpConnections.ticketing
    expect(server).toMatchObject({
      transport: 'stdio',
      command: 'node',
      // Interface >=0.40: profile MCP args/env are AgentProfileConfigValue
      // entries; the resolver wraps certified binding strings as public config.
      args: [{ kind: 'public', value: 'server.js' }],
      env: { K: { kind: 'public', value: 'v' } },
      enabled: true,
    })
  })

  it('lowers an mcp-remote binding to a flat AgentProfileMcpServer (http transport)', async () => {
    const cap: CertifiedCapability = {
      id: 'remote-mcp',
      iface: { surface: 'mcp', serverName: 'remote' },
      binding: {
        kind: 'mcp-remote',
        url: 'https://mcp.test',
        transport: 'http',
        headers: { authorization: 'Bearer x' },
      },
      auth: { mode: 'none' },
      provenance,
    }
    const surface = await composeCertifiedProfile({ systemPrompt: 'B' }, manifest([cap]))
    expect(surface.mcpConnections.remote).toMatchObject({
      transport: 'http',
      url: 'https://mcp.test',
    })
  })
})

describe('composeCertifiedProfile — http tool execution', () => {
  it('exposes a ToolSpec and executes via a mocked fetch', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('42', { status: 200 }),
    ) as unknown as typeof fetch
    const surface = await composeCertifiedProfile(
      { systemPrompt: 'B' },
      manifest([toolCapability()]),
      {
        fetchImpl,
      },
    )
    expect(surface.tools).toHaveLength(1)
    expect(surface.tools[0]).toMatchObject({ type: 'function', function: { name: 'fx_convert' } })
    const out = await surface.execute('fx_convert', { amount: 10 }, null)
    expect(out).toBe('42')
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(call[0]).toBe('https://fx.test/convert')
    expect(call[1].body).toBe(JSON.stringify({ amount: 10 }))
  })

  it('resolves a per-tenant secret for an authed http tool', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('ok', { status: 200 }),
    ) as unknown as typeof fetch
    const resolveSecret: ResolveCtx['resolveSecret'] = async () => ({
      succeeded: true,
      value: 'SK',
    })
    const cap = toolCapability({
      binding: { kind: 'http', url: 'https://fx.test/c', auth: { mode: 'secret-ref', key: 'FX' } },
    })
    const surface = await composeCertifiedProfile({ systemPrompt: 'B' }, manifest([cap]), {
      fetchImpl,
      resolveSecret,
    })
    await surface.execute('fx_convert', {}, null)
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect((call[1].headers as Record<string, string>).authorization).toBe('Bearer SK')
  })

  it('fails loud on a non-2xx http response (never a silent empty tool result)', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch
    const surface = await composeCertifiedProfile(
      { systemPrompt: 'B' },
      manifest([toolCapability()]),
      {
        fetchImpl,
      },
    )
    await expect(surface.execute('fx_convert', {}, null)).rejects.toThrow(/http 500/)
  })

  it('execute throws on an unknown tool name', async () => {
    const surface = await composeCertifiedProfile(
      { systemPrompt: 'B' },
      manifest([toolCapability()]),
      {
        fetchImpl: (async () => new Response('x')) as unknown as typeof fetch,
      },
    )
    await expect(surface.execute('nope', {}, null)).rejects.toThrow(/unknown tool/)
  })
})

describe('composeCertifiedProfile — drift drop (fail-closed)', () => {
  it('drops an http tool whose live names diverge from the certified interface', async () => {
    const probeLiveToolNames = vi.fn(async () => ['something_else'])
    const surface = await composeCertifiedProfile(
      { systemPrompt: 'B' },
      manifest([toolCapability()]),
      {
        fetchImpl: (async () => new Response('x')) as unknown as typeof fetch,
        probeLiveToolNames,
      },
    )
    expect(surface.tools).toHaveLength(0)
    await expect(surface.execute('fx_convert', {}, null)).rejects.toThrow(/unknown tool/)
  })

  it('keeps a tool whose live names match the certified interface', async () => {
    const probeLiveToolNames = vi.fn(async () => ['fx_convert'])
    const surface = await composeCertifiedProfile(
      { systemPrompt: 'B' },
      manifest([toolCapability()]),
      {
        fetchImpl: (async () => new Response('x')) as unknown as typeof fetch,
        probeLiveToolNames,
      },
    )
    expect(surface.tools).toHaveLength(1)
  })

  it('drops an mcp connection whose live tools/list differs from the certified toolset', async () => {
    const cap: CertifiedCapability = {
      id: 'ticketing',
      iface: { surface: 'mcp', serverName: 'ticketing', toolset: ['ticket_open', 'ticket_close'] },
      binding: { kind: 'mcp-stdio', command: 'node' },
      auth: { mode: 'none' },
      provenance,
    }
    const probeLiveToolNames = vi.fn(async () => ['ticket_open']) // missing ticket_close
    const surface = await composeCertifiedProfile({ systemPrompt: 'B' }, manifest([cap]), {
      probeLiveToolNames,
    })
    expect(surface.mcpConnections.ticketing).toBeUndefined()
  })
})

describe('composeCertifiedProfile — not-yet-admitted bindings', () => {
  it('throws CapabilityNotAdmittedError for a rag-index binding', async () => {
    const cap: CertifiedCapability = {
      id: 'kb',
      iface: { surface: 'retrieval', name: 'kb' },
      binding: { kind: 'rag-index', index: { kind: 'inline', content: '[]' }, embedModel: 'x' },
      auth: { mode: 'none' },
      provenance,
    }
    await expect(
      composeCertifiedProfile({ systemPrompt: 'B' }, manifest([cap])),
    ).rejects.toBeInstanceOf(CapabilityNotAdmittedError)
  })

  it('throws CapabilityNotAdmittedError for a memory-store binding (E3 admission gate)', async () => {
    const cap: CertifiedCapability = {
      id: 'mem',
      iface: { surface: 'retrieval', name: 'mem' },
      binding: { kind: 'memory-store', provision: 'sqlite' },
      auth: { mode: 'none' },
      provenance,
    }
    await expect(composeCertifiedProfile({ systemPrompt: 'B' }, manifest([cap]))).rejects.toThrow(
      /e3-certified-memory-verdict/,
    )
  })
})

describe('composeCertifiedProfile — process-on-infra recursion', () => {
  it('provisions the host before the inner mcp and wires the connection + teardown', async () => {
    const order: string[] = []
    const teardown = vi.fn(async () => {
      order.push('teardown')
    })
    const provisionHost: ResolveCtx['provisionHost'] = async (host, inner) => {
      order.push(`provision:${host.backend}:${inner.kind}`)
      return {
        mcpConnection: { transport: 'stdio', command: 'node', enabled: true },
        teardown,
      }
    }
    const cap: CertifiedCapability = {
      id: 'ticketing',
      iface: { surface: 'mcp', serverName: 'ticketing' },
      binding: {
        kind: 'process-on-infra',
        host: { backend: 'sandbox', image: 'cli-base', costTag: 'mcp/ticketing' },
        inner: { kind: 'mcp-stdio', command: 'node', args: ['server.js'] },
      },
      auth: { mode: 'none' },
      provenance,
    }
    const surface = await composeCertifiedProfile({ systemPrompt: 'B' }, manifest([cap]), {
      provisionHost,
    })
    expect(order).toEqual(['provision:sandbox:mcp-stdio'])
    expect(surface.mcpConnections.ticketing).toMatchObject({ transport: 'stdio', command: 'node' })
    await surface.dispose()
    expect(order).toEqual(['provision:sandbox:mcp-stdio', 'teardown'])
  })

  it('fails loud when a process-on-infra binding has no provisionHost wired', async () => {
    const cap: CertifiedCapability = {
      id: 'x',
      iface: { surface: 'mcp', serverName: 'x' },
      binding: {
        kind: 'process-on-infra',
        host: { backend: 'sandbox' },
        inner: { kind: 'mcp-stdio', command: 'node' },
      },
      auth: { mode: 'none' },
      provenance,
    }
    // A per-capability provision failure DROPS the capability — the surface is
    // consistent (no half-wired mcp), never a thrown error for a missing provider.
    // The diagnostic is surfaced via onDrop, never silently erased.
    const drops: Array<{ id: string; message: string }> = []
    const surface = await composeCertifiedProfile({ systemPrompt: 'B' }, manifest([cap]), {
      onDrop: (id, error) => drops.push({ id, message: error.message }),
    })
    expect(surface.mcpConnections).toEqual({})
    expect(drops).toEqual([{ id: 'x', message: expect.stringContaining('provisionHost') }])
  })
})

describe('composeCertifiedProfile — sandbox-code', () => {
  it('routes a sandbox-code tool through the injected runSandboxCode', async () => {
    const runSandboxCode = vi.fn(async () => 'sandbox-result')
    const cap: CertifiedCapability = {
      id: 'pdf.extract',
      iface: { surface: 'tool', name: 'pdf_extract', parameters: { type: 'object' } },
      binding: {
        kind: 'sandbox-code',
        entry: 'extract.py',
        code: { kind: 'inline', content: 'print(1)' },
        runtime: 'python',
      },
      auth: { mode: 'none' },
      provenance,
    }
    const surface = await composeCertifiedProfile({ systemPrompt: 'B' }, manifest([cap]), {
      runSandboxCode,
    })
    expect(surface.tools).toHaveLength(1)
    const out = await surface.execute('pdf_extract', { file: 'a.pdf' }, null)
    expect(out).toBe('sandbox-result')
    expect(runSandboxCode).toHaveBeenCalledOnce()
  })
})
