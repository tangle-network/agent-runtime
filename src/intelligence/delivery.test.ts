import type { AgentProfileDiff } from '@tangle-network/agent-interface'
import { describe, expect, it, vi } from 'vitest'
import { loadAgentImprovementProposalFixture } from '../testing'
import {
  type CertifiedProfile,
  composeCertifiedPrompt,
  createCertifiedPromptSource,
  pullCertified,
  submitAgentImprovementProposal,
} from './delivery'
import { createAgentImprovementProposal } from './improvement-cycle'

const CERTIFIED: CertifiedProfile = {
  target: 'support-agent',
  generatedAt: '2026-06-13T00:00:00.000Z',
  promptSurface: {
    surface: 'When the user reports a billing error, confirm the invoice id before refunding.',
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
  agentProfileDiffs: [],
  capabilities: [],
  agentProfile: null,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('composeCertifiedPrompt', () => {
  it('returns base unchanged when there is no certified profile', () => {
    expect(composeCertifiedPrompt('BASE', null)).toBe('BASE')
  })

  it('folds the certified prompt surface AND skill artifacts under a marked section', () => {
    const out = composeCertifiedPrompt('BASE PROMPT', CERTIFIED)
    expect(out).toContain('BASE PROMPT')
    expect(out).toContain('## Certified guidance (Tangle Intelligence)')
    expect(out).toContain('confirm the invoice id before refunding')
    expect(out).toContain('Refund flow: verify, then issue.')
  })

  it('is deterministic — same profile renders byte-identically', () => {
    expect(composeCertifiedPrompt('B', CERTIFIED)).toBe(composeCertifiedPrompt('B', CERTIFIED))
  })

  it('returns base when the certified profile has no usable content', () => {
    expect(composeCertifiedPrompt('BASE', { promptSurface: null, artifacts: {} })).toBe('BASE')
  })
})

describe('pullCertified', () => {
  it('GETs /v1/profiles/:target/composed with the Bearer key and returns the profile', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const outcome = await pullCertified({
      target: 'support-agent',
      apiKey: 'k_test',
      baseUrl: 'https://plane.test',
      fetchImpl,
    })
    expect(outcome.succeeded).toBe(true)
    if (outcome.succeeded) expect(outcome.value.promptSurface?.version).toBe(4)
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(call[0]).toBe('https://plane.test/v1/profiles/support-agent/composed')
    expect(call[1].headers).toMatchObject({ authorization: 'Bearer k_test' })
  })

  it('deserializes the typed agentProfileDiffs the composed endpoint returns', async () => {
    const diff: AgentProfileDiff = {
      kind: 'agent-profile-diff',
      set: { tools: { refund: true } },
    }
    const composed = {
      ...CERTIFIED,
      agentProfileDiffs: [
        {
          diff,
          provenance: {
            version: 7,
            lift: '+2.2pp',
            contentHash: 'deadbeef',
            promotedAt: '2026-06-12T00:00:00.000Z',
          },
        },
      ],
      agentProfile: { name: 'support-agent', tools: { refund: true } },
    }
    const fetchImpl = vi.fn(async () => jsonResponse(composed)) as unknown as typeof fetch
    const outcome = await pullCertified({
      target: 'support-agent',
      apiKey: 'k',
      baseUrl: 'https://plane.test',
      fetchImpl,
    })
    expect(outcome.succeeded).toBe(true)
    if (outcome.succeeded) {
      expect(outcome.value.agentProfileDiffs).toEqual(composed.agentProfileDiffs)
      expect(outcome.value.agentProfile).toEqual(composed.agentProfile)
    }
  })

  it('normalizes a legacy response with no diffs to empty arrays (fail-closed)', async () => {
    const legacy = {
      target: 't',
      generatedAt: 'x',
      promptSurface: null,
      artifacts: {},
    }
    const fetchImpl = vi.fn(async () => jsonResponse(legacy)) as unknown as typeof fetch
    const outcome = await pullCertified({
      target: 't',
      apiKey: 'k',
      baseUrl: 'https://plane.test',
      fetchImpl,
    })
    expect(outcome.succeeded).toBe(true)
    if (outcome.succeeded) {
      expect(outcome.value.agentProfileDiffs).toEqual([])
      expect(outcome.value.capabilities).toEqual([])
      expect(outcome.value.agentProfile).toBeNull()
    }
  })

  it('treats 404 (nothing promoted yet) as a non-error succeeded:false with status', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof fetch
    const outcome = await pullCertified({
      target: 'p',
      apiKey: 'k',
      baseUrl: 'https://plane.test',
      fetchImpl,
    })
    expect(outcome).toMatchObject({ succeeded: false, status: 404 })
  })

  it('fails closed (typed error, no throw) when the network errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const outcome = await pullCertified({
      target: 'p',
      apiKey: 'k',
      baseUrl: 'https://plane.test',
      fetchImpl,
    })
    expect(outcome.succeeded).toBe(false)
    if (!outcome.succeeded) expect(outcome.error).toContain('ECONNREFUSED')
  })

  it('errors loudly when no apiKey is available', async () => {
    vi.stubEnv('TANGLE_API_KEY', '')
    try {
      const fetchImpl = (async () => jsonResponse({})) as unknown as typeof fetch
      const outcome = await pullCertified({
        target: 'p',
        apiKey: '',
        baseUrl: 'https://plane.test',
        fetchImpl,
      })
      expect(outcome).toMatchObject({ succeeded: false })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('fails closed when the plane hangs past timeoutMs', async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('The operation was aborted')),
        )
      })) as unknown as typeof fetch
    const outcome = await pullCertified({
      target: 'p',
      apiKey: 'k',
      baseUrl: 'https://plane.test',
      timeoutMs: 20,
      fetchImpl,
    })
    expect(outcome.succeeded).toBe(false)
    if (!outcome.succeeded) expect(outcome.error).toMatch(/abort|fail/i)
  })
})

describe('submitAgentImprovementProposal', () => {
  it('POSTs the exact Runtime proposal with tenant auth and returns the recorded proposal', async () => {
    const proposal = loadAgentImprovementProposalFixture()
    const fetchImpl = vi.fn(async () => jsonResponse({ proposal }, 201)) as unknown as typeof fetch

    const outcome = await submitAgentImprovementProposal({
      proposal,
      apiKey: 'k_test',
      baseUrl: 'https://plane.test/',
      fetchImpl,
    })

    expect(outcome).toMatchObject({ succeeded: true, status: 201, value: proposal })
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(call[0]).toBe('https://plane.test/v1/improvements/proposals')
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
      baseUrl: 'https://plane.test',
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
        baseUrl: 'https://plane.test',
        fetchImpl,
      })

      expect(outcome).toMatchObject({ succeeded: false, submission: 'not-sent' })
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it.each([
    400, 403, 409, 422, 499,
  ])('marks a confirmed HTTP %i client rejection as rejected', async (status) => {
    const proposal = loadAgentImprovementProposalFixture()
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'source_changed', message: 'Profile changed.' }, status),
    ) as unknown as typeof fetch

    const outcome = await submitAgentImprovementProposal({
      proposal,
      apiKey: 'k_test',
      baseUrl: 'https://plane.test',
      fetchImpl,
    })

    expect(outcome).toMatchObject({
      succeeded: false,
      submission: 'rejected',
      status,
      code: 'source_changed',
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
      baseUrl: 'https://plane.test',
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
      baseUrl: 'https://plane.test',
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
      baseUrl: 'https://plane.test',
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
      baseUrl: 'https://plane.test',
      timeoutMs: 20,
      fetchImpl,
    })

    expect(outcome).toMatchObject({ succeeded: false, submission: 'unconfirmed' })
    if (!outcome.succeeded) expect(outcome.error).toMatch(/abort|timeout/i)
  })

  it('marks an unreadable success response as unconfirmed rather than confirming a write', async () => {
    const proposal = loadAgentImprovementProposalFixture()
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ proposal: {} }, 201),
    ) as unknown as typeof fetch

    const outcome = await submitAgentImprovementProposal({
      proposal,
      apiKey: 'k_test',
      baseUrl: 'https://plane.test',
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
      baseUrl: 'https://plane.test',
      fetchImpl,
    })

    expect(outcome).toMatchObject({
      succeeded: false,
      submission: 'unconfirmed',
      status: 201,
    })
  })
})

describe('createCertifiedPromptSource', () => {
  const opts = { target: 'support-agent', apiKey: 'k', baseUrl: 'https://plane.test' }

  it('compose pulls once, folds the certified additions, and caches within the window', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const source = createCertifiedPromptSource({ ...opts, fetchImpl })
    const first = await source.compose('BASE')
    const second = await source.compose('BASE')
    expect(first).toContain('## Certified guidance (Tangle Intelligence)')
    expect(second).toBe(first)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(source.current()).toEqual(CERTIFIED)
  })

  it('fail-closed: a 404 leaves the base prompt unchanged and current() null', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 404)) as unknown as typeof fetch
    const source = createCertifiedPromptSource({ ...opts, fetchImpl })
    expect(await source.compose('BASE')).toBe('BASE')
    expect(source.current()).toBeNull()
  })

  it('keeps the last-known profile when a later pull fails', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      return calls === 1 ? jsonResponse(CERTIFIED) : jsonResponse({}, 500)
    }) as unknown as typeof fetch
    const source = createCertifiedPromptSource({ ...opts, fetchImpl, refreshMs: 0 })
    await source.refresh()
    expect(source.current()).toEqual(CERTIFIED)
    await source.refresh()
    expect(source.current()).toEqual(CERTIFIED)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent refreshes into one pull', async () => {
    let resolvePull: (r: Response) => void = () => {}
    const fetchImpl = vi.fn(
      () => new Promise<Response>((res) => (resolvePull = res)),
    ) as unknown as typeof fetch
    const source = createCertifiedPromptSource({ ...opts, fetchImpl })
    const a = source.refresh()
    const b = source.refresh()
    resolvePull(jsonResponse(CERTIFIED))
    await Promise.all([a, b])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(source.current()).toEqual(CERTIFIED)
  })
})
