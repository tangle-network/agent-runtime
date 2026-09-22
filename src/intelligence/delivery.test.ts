import {
  type CertifiedContext,
  type CertifiedContextDelivery,
  type CertifiedContextEntry,
  type CertifiedContextKind,
  certifiedContextContentHash,
  certifiedContextEntryContentHash,
} from '@tangle-network/agent-interface'
import { describe, expect, it, vi } from 'vitest'
import { loadAgentImprovementProposalFixture } from '../testing'
import {
  type CertifiedContextCheckpoint,
  composeCertifiedContext,
  createCertifiedContextSource,
  pullCertifiedContext,
  submitAgentImprovementProposal,
} from './delivery'
import { createAgentImprovementProposal } from './improvement-cycle'

const promotedAt = '2026-07-25T20:00:00.000Z'
const generatedAt = '2026-07-25T20:01:00.000Z'
const expiresAt = '2026-07-25T20:11:00.000Z'
const fixedNowMs = Date.parse('2026-07-25T20:05:00.000Z')
const fixedNow = () => fixedNowMs

function contextEntry(input: {
  id: string
  kind: CertifiedContextKind
  name: string
  delivery: CertifiedContextDelivery
  version: number
}): CertifiedContextEntry {
  const material = {
    id: input.id,
    kind: input.kind,
    name: input.name,
    delivery: input.delivery,
  }
  return {
    ...material,
    provenance: {
      contentHash: certifiedContextEntryContentHash(material),
      version: input.version,
      promotedAt,
    },
  }
}

function certifiedContext(
  entries: readonly CertifiedContextEntry[],
  tenantId = 'tenant-1',
  target = 'support-agent',
  state: CertifiedContext['state'] = 'active',
  revision = '1',
): CertifiedContext {
  const content = { tenantId, target, state, revision, entries }
  return {
    ...content,
    generatedAt,
    expiresAt,
    contentHash: certifiedContextContentHash(content),
  }
}

const CERTIFIED = certifiedContext([
  contextEntry({
    id: 'prompt',
    kind: 'prompt',
    name: 'system prompt',
    delivery: {
      kind: 'inline',
      content: 'When the user reports a billing error, confirm the invoice id before refunding.',
    },
    version: 4,
  }),
  contextEntry({
    id: 'refund-skill',
    kind: 'skill',
    name: 'refunds',
    delivery: {
      kind: 'file',
      path: 'skills/refunds/SKILL.md',
      content: 'Refund flow: verify, then issue.',
    },
    version: 2,
  }),
])

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('composeCertifiedContext', () => {
  it('returns base unchanged when there is no certified context', () => {
    expect(composeCertifiedContext({ systemPrompt: 'BASE' }, null, fixedNow)).toEqual({
      systemPrompt: 'BASE',
      promptAdditions: [],
      files: [],
    })
  })

  it('folds inline context and leaves files for materialization', () => {
    const out = composeCertifiedContext({ systemPrompt: 'BASE PROMPT' }, CERTIFIED, fixedNow)
    expect(out.systemPrompt).toContain('BASE PROMPT')
    expect(out.systemPrompt).toContain('## Certified guidance (Tangle Intelligence)')
    expect(out.systemPrompt).toContain('confirm the invoice id before refunding')
    expect(out.systemPrompt).not.toContain('Refund flow: verify, then issue.')
    expect(out.files).toEqual([
      {
        path: 'skills/refunds/SKILL.md',
        content: 'Refund flow: verify, then issue.',
      },
    ])
  })

  it('is deterministic — same context renders byte-identically', () => {
    expect(composeCertifiedContext({ systemPrompt: 'B' }, CERTIFIED, fixedNow)).toEqual(
      composeCertifiedContext({ systemPrompt: 'B' }, CERTIFIED, fixedNow),
    )
  })

  it('returns base when the certified context has no inline content', () => {
    const fileOnly = certifiedContext(
      CERTIFIED.entries.filter((entry) => entry.delivery.kind === 'file'),
      'tenant-1',
      'support-agent',
      'active',
      '2',
    )
    expect(composeCertifiedContext({ systemPrompt: 'BASE' }, fileOnly, fixedNow)).toEqual({
      systemPrompt: 'BASE',
      promptAdditions: [],
      files: [
        {
          path: 'skills/refunds/SKILL.md',
          content: 'Refund flow: verify, then issue.',
        },
      ],
    })
  })

  it('validates the complete context before materializing files or prompts', () => {
    expect(() =>
      composeCertifiedContext(
        { systemPrompt: 'BASE' },
        { ...CERTIFIED, tenantId: 'tenant-2' },
        fixedNow,
      ),
    ).toThrow(/content hash/)
  })
})

describe('pullCertifiedContext', () => {
  it('GETs /v1/contexts/:target/certified with the Bearer key and returns immutable context', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const outcome = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'support-agent',
      apiKey: 'k_test',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
      now: fixedNow,
    })
    expect(outcome.succeeded).toBe(true)
    if (outcome.succeeded) {
      expect(outcome.value.entries[0]?.provenance.version).toBe(4)
      expect(Object.isFrozen(outcome.value.entries)).toBe(true)
    }
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(call[0]).toBe('https://intelligence.tangle.tools/v1/contexts/support-agent/certified')
    expect(call[1].headers).toMatchObject({ authorization: 'Bearer k_test' })
  })

  it.each([
    'tenantId',
    'target',
    'state',
    'revision',
    'generatedAt',
    'expiresAt',
    'entries',
    'contentHash',
  ] as const)('rejects a response missing required field %s', async (field) => {
    const malformed = { ...CERTIFIED } as Record<string, unknown>
    delete malformed[field]
    const fetchImpl = vi.fn(async () => jsonResponse(malformed)) as unknown as typeof fetch

    const outcome = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'support-agent',
      apiKey: 'k',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
      now: fixedNow,
    })

    expect(outcome).toMatchObject({ succeeded: false })
    if (!outcome.succeeded) {
      expect(outcome.error).toContain(field)
    }
  })

  it.each([
    ['the removed promptSurface field', { ...CERTIFIED, promptSurface: null }, /promptSurface/],
    ['the removed artifacts field', { ...CERTIFIED, artifacts: {} }, /artifacts/],
    [
      'the removed composed-profile fields',
      { ...CERTIFIED, profileDiffs: [], agentProfile: null },
      /profileDiffs|agentProfile/,
    ],
    [
      'a malformed entry',
      {
        ...CERTIFIED,
        entries: [{ ...CERTIFIED.entries[0], kind: 'tool' }],
      },
      /entries/,
    ],
    [
      'an unsupported remote tool',
      {
        ...CERTIFIED,
        entries: [
          {
            ...CERTIFIED.entries[0],
            delivery: { kind: 'http', url: 'https://tools.example.com/prompt' },
          },
        ],
      },
      /entries/,
    ],
  ])('rejects %s', async (_name, response, expectedError) => {
    const fetchImpl = vi.fn(async () => jsonResponse(response)) as unknown as typeof fetch
    const outcome = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'support-agent',
      apiKey: 'k',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
      now: fixedNow,
    })
    expect(outcome.succeeded).toBe(false)
    if (!outcome.succeeded) expect(outcome.error).toMatch(expectedError)
  })

  it('rejects a response for a different tenant', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(certifiedContext(CERTIFIED.entries, 'tenant-2')),
    ) as unknown as typeof fetch
    const outcome = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'support-agent',
      apiKey: 'k',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
      now: fixedNow,
    })
    expect(outcome.succeeded).toBe(false)
    if (!outcome.succeeded) expect(outcome.error).toMatch(/does not match authenticated tenant/)
  })

  it('rejects a response for a different target', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(certifiedContext(CERTIFIED.entries, 'tenant-1', 'other-agent')),
    ) as unknown as typeof fetch
    const outcome = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'support-agent',
      apiKey: 'k',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
      now: fixedNow,
    })
    expect(outcome.succeeded).toBe(false)
    if (!outcome.succeeded) expect(outcome.error).toMatch(/does not match requested target/)
  })

  it('rejects stale digests, expired context, and implausibly future context', async () => {
    const staleDigest = { ...CERTIFIED, contentHash: `sha256:${'0'.repeat(64)}` }
    const stale = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'support-agent',
      apiKey: 'k',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl: vi.fn(async () => jsonResponse(staleDigest)) as unknown as typeof fetch,
      now: fixedNow,
    })
    expect(stale.succeeded).toBe(false)
    if (!stale.succeeded) expect(stale.error).toMatch(/content hash/)

    const expired = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'support-agent',
      apiKey: 'k',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl: vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch,
      now: () => Date.parse(expiresAt),
    })
    expect(expired.succeeded).toBe(false)
    if (!expired.succeeded) expect(expired.error).toMatch(/expired/)

    const future = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'support-agent',
      apiKey: 'k',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl: vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch,
      now: () => Date.parse(generatedAt) - 300_001,
    })
    expect(future.succeeded).toBe(false)
    if (!future.succeeded) expect(future.error).toMatch(/future/)
  })

  it('rejects an oversized context response before parsing it', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('{}', {
          headers: { 'content-length': String(16_777_217) },
        }),
    ) as unknown as typeof fetch
    const outcome = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'support-agent',
      apiKey: 'k',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
      now: fixedNow,
    })
    expect(outcome.succeeded).toBe(false)
    if (!outcome.succeeded) expect(outcome.error).toMatch(/exceeds 16777216 bytes/)
  })

  it('reports a 404 as an incompatible endpoint response', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof fetch
    const outcome = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'p',
      apiKey: 'k',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
    })
    expect(outcome).toMatchObject({
      succeeded: false,
      status: 404,
      error: expect.stringContaining('incompatible certified-context endpoint'),
    })
  })

  it('reports an oversized 404 body as an incompatible endpoint response', async () => {
    const outcome = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'p',
      apiKey: 'k',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl: vi.fn(
        async () =>
          new Response('{}', {
            status: 404,
            headers: { 'content-length': '5000' },
          }),
      ) as unknown as typeof fetch,
    })
    expect(outcome).toMatchObject({
      succeeded: false,
      status: 404,
      error: expect.stringContaining('incompatible certified-context endpoint'),
    })
  })

  it('fails closed (typed error, no throw) when the network errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const outcome = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'p',
      apiKey: 'k',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
    })
    expect(outcome.succeeded).toBe(false)
    if (!outcome.succeeded) expect(outcome.error).toContain('ECONNREFUSED')
  })

  it('errors loudly when no apiKey is available', async () => {
    vi.stubEnv('TANGLE_API_KEY', '')
    try {
      const fetchImpl = (async () => jsonResponse({})) as unknown as typeof fetch
      const outcome = await pullCertifiedContext({
        tenantId: 'tenant-1',
        target: 'p',
        apiKey: '',
        baseUrl: 'https://intelligence.tangle.tools',
        fetchImpl,
      })
      expect(outcome).toMatchObject({ succeeded: false })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('does not fall through to TANGLE_API_KEY when apiKey is explicitly empty', async () => {
    vi.stubEnv('TANGLE_API_KEY', 'env-secret')
    try {
      const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
      const outcome = await pullCertifiedContext({
        tenantId: 'tenant-1',
        target: 'support-agent',
        apiKey: '',
        fetchImpl,
      })
      expect(outcome).toMatchObject({
        succeeded: false,
        error: expect.stringContaining('no apiKey'),
      })
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it.each([
    'http://plane.test',
    'https://user:password@plane.test',
    'https://intelligence.tangle.tools?tenant=other',
    'ftp://plane.test',
  ])('rejects unsafe plane base URL %s before sending credentials', async (baseUrl) => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const outcome = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'p',
      apiKey: 'k',
      baseUrl,
      fetchImpl,
    })
    expect(outcome.succeeded).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('requires an explicit trust decision for a custom HTTPS origin', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const untrusted = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'support-agent',
      apiKey: 'k',
      baseUrl: 'https://plane.test',
      fetchImpl,
      now: fixedNow,
    })
    expect(untrusted).toMatchObject({
      succeeded: false,
      error: expect.stringContaining('not trusted'),
    })
    expect(fetchImpl).not.toHaveBeenCalled()

    const trusted = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'support-agent',
      apiKey: 'k',
      baseUrl: 'https://plane.test',
      trustedBaseOrigins: ['https://plane.test'],
      fetchImpl,
      now: fixedNow,
    })
    expect(trusted).toMatchObject({ succeeded: true })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('requires explicit opt-in before sending credentials to loopback HTTP', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const denied = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'support-agent',
      apiKey: 'k',
      baseUrl: 'http://127.0.0.1:3030',
      fetchImpl,
      now: fixedNow,
    })
    expect(denied).toMatchObject({
      succeeded: false,
      error: expect.stringContaining('allowInsecureLoopback'),
    })
    expect(fetchImpl).not.toHaveBeenCalled()

    const allowed = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'support-agent',
      apiKey: 'k',
      baseUrl: 'http://127.0.0.1:3030',
      allowInsecureLoopback: true,
      fetchImpl,
      now: fixedNow,
    })
    expect(allowed).toMatchObject({ succeeded: true })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it.each([
    ['tenantId', '', 'support-agent'],
    ['tenantId', 'x'.repeat(257), 'support-agent'],
    ['target', 'tenant-1', ''],
    ['target', 'tenant-1', '\ud800'],
  ])('rejects an invalid %s before starting a request', async (_name, tenantId, target) => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const outcome = await pullCertifiedContext({
      tenantId,
      target,
      apiKey: 'k',
      fetchImpl,
    })
    expect(outcome.succeeded).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([0, -1, 300_001, 1.5])(
    'rejects timeoutMs %s before starting a request',
    async (timeoutMs) => {
      const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
      const outcome = await pullCertifiedContext({
        tenantId: 'tenant-1',
        target: 'p',
        apiKey: 'k',
        baseUrl: 'https://intelligence.tangle.tools',
        timeoutMs,
        fetchImpl,
      })
      expect(outcome.succeeded).toBe(false)
      expect(fetchImpl).not.toHaveBeenCalled()
    },
  )

  it('rejects an invalid API key header before starting a request', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const outcome = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'p',
      apiKey: 'key\r\nx-injected: true',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
    })
    expect(outcome.succeeded).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails closed when the plane hangs past timeoutMs', async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('The operation was aborted')),
        )
      })) as unknown as typeof fetch
    const outcome = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'p',
      apiKey: 'k',
      baseUrl: 'https://intelligence.tangle.tools',
      timeoutMs: 20,
      fetchImpl,
    })
    expect(outcome.succeeded).toBe(false)
    if (!outcome.succeeded) expect(outcome.error).toMatch(/abort|fail/i)
  })

  it('returns at the deadline even when an injected fetch ignores abort', async () => {
    const fetchImpl = (() => new Promise<Response>(() => {})) as unknown as typeof fetch
    const startedAt = Date.now()
    const outcome = await pullCertifiedContext({
      tenantId: 'tenant-1',
      target: 'p',
      apiKey: 'k',
      baseUrl: 'https://intelligence.tangle.tools',
      timeoutMs: 10,
      fetchImpl,
    })
    expect(outcome.succeeded).toBe(false)
    expect(Date.now() - startedAt).toBeLessThan(250)
    if (!outcome.succeeded) expect(outcome.error).toMatch(/timed out/)
  })
})

describe('submitAgentImprovementProposal', () => {
  it('POSTs the exact Runtime proposal with tenant auth and returns the recorded proposal', async () => {
    const proposal = loadAgentImprovementProposalFixture()
    const fetchImpl = vi.fn(async () => jsonResponse({ proposal }, 201)) as unknown as typeof fetch

    const outcome = await submitAgentImprovementProposal({
      proposal,
      apiKey: 'k_test',
      baseUrl: 'https://intelligence.tangle.tools/',
      fetchImpl,
    })

    expect(outcome).toMatchObject({ succeeded: true, status: 201, value: proposal })
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(call[0]).toBe('https://intelligence.tangle.tools/v1/improvements/proposals')
    expect(call[1]).toMatchObject({
      method: 'POST',
      headers: {
        authorization: 'Bearer k_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ proposal }),
    })
  })

  it('does not send an invalid proposal', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch

    const outcome = await submitAgentImprovementProposal({
      proposal: {} as ReturnType<typeof loadAgentImprovementProposalFixture>,
      apiKey: 'k_test',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
    })

    expect(outcome).toMatchObject({ succeeded: false, submission: 'not-sent' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not send when no tenant credential is configured', async () => {
    const proposal = loadAgentImprovementProposalFixture()
    const fetchImpl = vi.fn(async () => jsonResponse({ proposal }, 201)) as unknown as typeof fetch
    vi.stubEnv('TANGLE_API_KEY', '')

    try {
      const outcome = await submitAgentImprovementProposal({
        proposal,
        baseUrl: 'https://intelligence.tangle.tools',
        fetchImpl,
      })

      expect(outcome).toMatchObject({ succeeded: false, submission: 'not-sent' })
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it.each([400, 403, 409, 422, 499])(
    'marks a confirmed HTTP %i client rejection as rejected',
    async (status) => {
      const proposal = loadAgentImprovementProposalFixture()
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ error: 'source_changed', message: 'Profile changed.' }, status),
      ) as unknown as typeof fetch

      const outcome = await submitAgentImprovementProposal({
        proposal,
        apiKey: 'k_test',
        baseUrl: 'https://intelligence.tangle.tools',
        fetchImpl,
      })

      expect(outcome).toMatchObject({
        succeeded: false,
        submission: 'rejected',
        status,
        code: 'source_changed',
      })
    },
  )

  it('keeps a known 4xx rejection definitive when its response body cannot be read', async () => {
    const proposal = loadAgentImprovementProposalFixture()
    const fetchImpl = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('response stream failed'))
        },
      })
      return new Response(body, { status: 403 })
    }) as unknown as typeof fetch

    const outcome = await submitAgentImprovementProposal({
      proposal,
      apiKey: 'k_test',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
    })

    expect(outcome).toMatchObject({
      succeeded: false,
      submission: 'rejected',
      status: 403,
      error: expect.stringMatching(/proposal submission 403.*response stream failed/),
    })
  })

  it('caps server-supplied error messages and codes at 200 characters', async () => {
    const proposal = loadAgentImprovementProposalFixture()
    const longMessage = 'm'.repeat(500)
    const longCode = 'c'.repeat(500)
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: longCode, message: longMessage }, 400),
    ) as unknown as typeof fetch

    const outcome = await submitAgentImprovementProposal({
      proposal,
      apiKey: 'k_test',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
    })

    expect(outcome).toEqual({
      succeeded: false,
      submission: 'rejected',
      error: `proposal submission 400: ${longMessage.slice(0, 200)}`,
      status: 400,
      code: longCode.slice(0, 200),
    })
  })

  it('marks a server failure as unconfirmed because the write may have completed', async () => {
    const proposal = loadAgentImprovementProposalFixture()
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'internal_error' }, 500),
    ) as unknown as typeof fetch

    const outcome = await submitAgentImprovementProposal({
      proposal,
      apiKey: 'k_test',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
    })

    expect(outcome).toMatchObject({ succeeded: false, submission: 'unconfirmed', status: 500 })
  })

  it('marks a lost response as unconfirmed so callers retry the same proposal', async () => {
    const proposal = loadAgentImprovementProposalFixture()
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch

    const outcome = await submitAgentImprovementProposal({
      proposal,
      apiKey: 'k_test',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
    })

    expect(outcome).toMatchObject({ succeeded: false, submission: 'unconfirmed' })
  })

  it('marks a timed-out request as unconfirmed so callers retry the same proposal', async () => {
    const proposal = loadAgentImprovementProposalFixture()
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new Error('The operation was aborted')),
          { once: true },
        )
      })) as unknown as typeof fetch

    const outcome = await submitAgentImprovementProposal({
      proposal,
      apiKey: 'k_test',
      baseUrl: 'https://intelligence.tangle.tools',
      timeoutMs: 20,
      fetchImpl,
    })

    expect(outcome).toMatchObject({ succeeded: false, submission: 'unconfirmed' })
    if (!outcome.succeeded) expect(outcome.error).toMatch(/abort|timeout|timed out/i)
  })

  it('marks an unreadable success response as unconfirmed rather than confirming a write', async () => {
    const proposal = loadAgentImprovementProposalFixture()
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ proposal: {} }, 201),
    ) as unknown as typeof fetch

    const outcome = await submitAgentImprovementProposal({
      proposal,
      apiKey: 'k_test',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
    })

    expect(outcome).toMatchObject({ succeeded: false, submission: 'unconfirmed', status: 201 })
  })

  it('does not accept a different valid proposal returned by the server', async () => {
    const proposal = loadAgentImprovementProposalFixture()
    const differentProposal = createAgentImprovementProposal({
      runId: proposal.runId,
      findings: [],
      evaluation: proposal.evaluation,
      now: () => new Date('2030-01-01T00:00:00.000Z'),
    })
    expect(differentProposal.digest).not.toBe(proposal.digest)
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ proposal: differentProposal }, 201),
    ) as unknown as typeof fetch

    const outcome = await submitAgentImprovementProposal({
      proposal,
      apiKey: 'k_test',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
    })

    expect(outcome).toMatchObject({
      succeeded: false,
      submission: 'unconfirmed',
      status: 201,
    })
  })
})

describe('createCertifiedContextSource', () => {
  const opts = {
    tenantId: 'tenant-1',
    target: 'support-agent',
    apiKey: 'k',
    baseUrl: 'https://intelligence.tangle.tools',
    now: fixedNow,
  }

  it('compose pulls once, folds the certified additions, and caches within the window', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const source = createCertifiedContextSource({ ...opts, fetchImpl })
    const first = await source.compose('BASE')
    const second = await source.compose('BASE')
    expect(first).toContain('## Certified guidance (Tangle Intelligence)')
    expect(second).toBe(first)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(source.current()).toEqual(CERTIFIED)
  })

  it('fail-closed: a 404 leaves the base prompt unchanged and current() null', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 404)) as unknown as typeof fetch
    const source = createCertifiedContextSource({ ...opts, fetchImpl })
    expect(await source.compose('BASE')).toBe('BASE')
    expect(source.current()).toBeNull()
  })

  it('keeps the last-known unexpired context when a transient pull fails', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      return calls === 1 ? jsonResponse(CERTIFIED) : jsonResponse({}, 500)
    }) as unknown as typeof fetch
    const source = createCertifiedContextSource({ ...opts, fetchImpl, refreshMs: 0 })
    await source.refresh()
    expect(source.current()).toEqual(CERTIFIED)
    await source.refresh()
    expect(source.current()).toEqual(CERTIFIED)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it.each([401, 403])(
    'clears cached context immediately when authorization returns %i',
    async (status) => {
      let calls = 0
      const fetchImpl = vi.fn(async () => {
        calls += 1
        return calls === 1 ? jsonResponse(CERTIFIED) : jsonResponse({}, status)
      }) as unknown as typeof fetch
      const source = createCertifiedContextSource({ ...opts, fetchImpl, refreshMs: 0 })
      await source.refresh()
      expect(source.current()).toEqual(CERTIFIED)
      await source.refresh()
      expect(source.current()).toBeNull()
    },
  )

  it.each([
    [
      'oversized 401 body',
      () =>
        new Response('{}', {
          status: 401,
          headers: { 'content-length': '5000' },
        }),
    ],
    [
      'hanging 403 body',
      () =>
        new Response(
          new ReadableStream({
            start() {
              // The status is available, but the response body never completes.
            },
          }),
          { status: 403 },
        ),
    ],
  ])('clears cached context when authorization has an %s', async (_name, deniedResponse) => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      return calls === 1 ? jsonResponse(CERTIFIED) : deniedResponse()
    }) as unknown as typeof fetch
    const source = createCertifiedContextSource({
      ...opts,
      fetchImpl,
      refreshMs: 0,
      timeoutMs: 10,
    })

    await source.refresh()
    expect(source.current()).toEqual(CERTIFIED)
    await source.refresh()
    expect(source.current()).toBeNull()
  })

  it('accepts a higher revision revocation and rejects replay of older active context', async () => {
    const revoked = certifiedContext([], 'tenant-1', 'support-agent', 'revoked', '2')
    const responses = [CERTIFIED, revoked, CERTIFIED]
    const fetchImpl = vi.fn(async () => jsonResponse(responses.shift())) as unknown as typeof fetch
    const onReject = vi.fn()
    const source = createCertifiedContextSource({
      ...opts,
      fetchImpl,
      refreshMs: 0,
      onReject,
    })

    await source.refresh()
    expect(source.current()).toEqual(CERTIFIED)
    await source.refresh()
    expect(source.current()).toBeNull()
    await source.refresh()
    expect(source.current()).toBeNull()
    expect(onReject).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/rolled back/) }),
    )
  })

  it('rejects conflicting content at the same revision', async () => {
    const conflicting = certifiedContext(
      [
        contextEntry({
          id: 'changed',
          kind: 'prompt',
          name: 'system prompt',
          delivery: { kind: 'inline', content: 'Changed content.' },
          version: 5,
        }),
      ],
      'tenant-1',
      'support-agent',
      'active',
      '1',
    )
    const responses = [CERTIFIED, conflicting]
    const fetchImpl = vi.fn(async () => jsonResponse(responses.shift())) as unknown as typeof fetch
    const onReject = vi.fn()
    const source = createCertifiedContextSource({
      ...opts,
      fetchImpl,
      refreshMs: 0,
      onReject,
    })

    await source.refresh()
    await source.refresh()
    expect(source.current()).toEqual(CERTIFIED)
    expect(onReject).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/conflicting content or state/) }),
    )
  })

  it('persists a tenant-bound checkpoint before applying and rejects rollback after recreation', async () => {
    let durable: CertifiedContextCheckpoint | null = null
    const loadedKeys: unknown[] = []
    let currentDuringSave: CertifiedContext | null = null
    let firstSource: ReturnType<typeof createCertifiedContextSource> | null = null
    const checkpointStore = {
      async load(key: unknown) {
        loadedKeys.push(key)
        return durable
      },
      async save(checkpoint: CertifiedContextCheckpoint) {
        currentDuringSave = firstSource?.current() ?? null
        durable = checkpoint
      },
    }
    const active = certifiedContext(CERTIFIED.entries, 'tenant-1', 'support-agent', 'active', '2')
    const revoked = certifiedContext([], 'tenant-1', 'support-agent', 'revoked', '3')
    const responses = [active, revoked]
    firstSource = createCertifiedContextSource({
      ...opts,
      refreshMs: 0,
      checkpointStore,
      fetchImpl: vi.fn(async () => jsonResponse(responses.shift())),
    })

    await firstSource.refresh()
    expect(currentDuringSave).toBeNull()
    expect(firstSource.current()).toEqual(active)
    await firstSource.refresh()
    expect(currentDuringSave).toEqual(active)
    expect(firstSource.current()).toBeNull()
    expect(durable).toMatchObject({
      tenantId: 'tenant-1',
      target: 'support-agent',
      revision: '3',
      state: 'revoked',
    })

    const onReject = vi.fn()
    const recreated = createCertifiedContextSource({
      ...opts,
      checkpointStore,
      fetchImpl: vi.fn(async () => jsonResponse(active)),
      onReject,
    })
    await recreated.refresh()

    expect(loadedKeys).toEqual([
      { tenantId: 'tenant-1', target: 'support-agent' },
      { tenantId: 'tenant-1', target: 'support-agent' },
    ])
    expect(recreated.current()).toBeNull()
    expect(onReject).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/rolled back from 3 to 2/) }),
    )
  })

  it('rejects an equal-revision state conflict even when the hash matches', async () => {
    const checkpointStore = {
      async load(): Promise<CertifiedContextCheckpoint> {
        return {
          tenantId: 'tenant-1',
          target: 'support-agent',
          revision: CERTIFIED.revision,
          contentHash: CERTIFIED.contentHash,
          state: 'revoked',
        }
      },
      async save() {},
    }
    const onReject = vi.fn()
    const source = createCertifiedContextSource({
      ...opts,
      checkpointStore,
      fetchImpl: vi.fn(async () => jsonResponse(CERTIFIED)),
      onReject,
    })

    await source.refresh()

    expect(source.current()).toBeNull()
    expect(onReject).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/conflicting content or state/) }),
    )
  })

  it('rejects a checkpoint bound to another target before pulling context', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const onReject = vi.fn()
    const source = createCertifiedContextSource({
      ...opts,
      fetchImpl,
      checkpointStore: {
        async load() {
          return {
            tenantId: 'tenant-1',
            target: 'other-agent',
            revision: '1',
            contentHash: CERTIFIED.contentHash,
            state: 'active' as const,
          }
        },
        async save() {},
      },
      onReject,
    })

    await source.refresh()

    expect(source.current()).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/does not match/) }),
    )
  })

  it.each([
    ['a non-canonical revision', { revision: '01' }],
    ['an invalid content hash', { contentHash: 'sha256:not-a-digest' }],
    ['an invalid state', { state: 'unknown' }],
    ['an unknown field', { extra: true }],
  ])('rejects a checkpoint with %s before pulling context', async (_name, override) => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const onReject = vi.fn()
    const malformed = {
      tenantId: 'tenant-1',
      target: 'support-agent',
      revision: '1',
      contentHash: CERTIFIED.contentHash,
      state: 'active',
      ...override,
    }
    const source = createCertifiedContextSource({
      ...opts,
      fetchImpl,
      checkpointStore: {
        async load() {
          return malformed as unknown as CertifiedContextCheckpoint
        },
        async save() {},
      },
      onReject,
    })

    await source.refresh()

    expect(source.current()).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledOnce()
  })

  it('does not apply a revision when its durable checkpoint write fails', async () => {
    const onReject = vi.fn()
    const source = createCertifiedContextSource({
      ...opts,
      fetchImpl: vi.fn(async () => jsonResponse(CERTIFIED)),
      checkpointStore: {
        async load() {
          return null
        },
        async save() {
          throw new Error('database unavailable')
        },
      },
      onReject,
    })

    await source.refresh()

    expect(source.current()).toBeNull()
    expect(onReject).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/save failed.*database unavailable/),
      }),
    )
  })

  it('treats 404 as an incompatible endpoint, not a revocation', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      return calls === 1 ? jsonResponse(CERTIFIED) : jsonResponse({}, 404)
    }) as unknown as typeof fetch
    const onReject = vi.fn()
    const source = createCertifiedContextSource({
      ...opts,
      fetchImpl,
      refreshMs: 0,
      onReject,
    })
    await source.refresh()
    await source.refresh()
    expect(source.current()).toEqual(CERTIFIED)
    expect(onReject).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/revisioned response/) }),
    )
  })

  it('isolates rejection observer failures from context refresh', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 404)) as unknown as typeof fetch
    const source = createCertifiedContextSource({
      ...opts,
      fetchImpl,
      onReject: () => {
        throw new Error('observer failed')
      },
    })

    await expect(source.refresh()).resolves.toBeUndefined()
    expect(source.current()).toBeNull()
  })

  it('drops expired state and refreshes even inside the normal cache window', async () => {
    let clock = fixedNowMs
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const source = createCertifiedContextSource({
      tenantId: 'tenant-1',
      target: 'support-agent',
      apiKey: 'k',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
      refreshMs: 86_400_000,
      now: () => clock,
    })
    await source.refresh()
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    clock = Date.parse(expiresAt)
    expect(source.current()).toBeNull()
    await source.refresh()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(source.current()).toBeNull()
  })

  it('coalesces concurrent refreshes into one pull', async () => {
    let resolvePull: (r: Response) => void = () => {}
    const fetchImpl = vi.fn(
      () => new Promise<Response>((res) => (resolvePull = res)),
    ) as unknown as typeof fetch
    const source = createCertifiedContextSource({ ...opts, fetchImpl })
    const a = source.refresh()
    const b = source.refresh()
    resolvePull(jsonResponse(CERTIFIED))
    await Promise.all([a, b])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(source.current()).toEqual(CERTIFIED)
  })
})
