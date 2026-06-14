import { describe, expect, it, vi } from 'vitest'
import {
  type CertifiedProfile,
  composeCertifiedPrompt,
  pullCertified,
  withCertifiedDelivery,
} from './delivery'

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
    const empty: CertifiedProfile = {
      target: 't',
      generatedAt: 'x',
      promptSurface: null,
      artifacts: {},
    }
    expect(composeCertifiedPrompt('BASE', empty)).toBe('BASE')
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
    // Stub the env so the test holds on machines/CI where TANGLE_API_KEY is set
    // (resolveApiKey falls back to it when the passed key is empty).
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
    // A fetch that rejects when its abort signal fires (what a hung request +
    // AbortSignal.timeout produces) must surface as a typed fail-closed result.
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

describe('withCertifiedDelivery', () => {
  it('delivers the certified profile to the agent and composes it into the prompt', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    let seenPrompt = ''
    const agent = withCertifiedDelivery(
      async (input: { q: string }, applied) => {
        seenPrompt = applied.composePrompt('BASE SYSTEM PROMPT')
        return `answer:${input.q}:v${applied.certified?.promptSurface?.version}`
      },
      { project: 'support-agent', apiKey: 'k', baseUrl: 'https://plane.test', fetchImpl },
    )
    const out = await agent({ q: 'refund' })
    expect(out).toBe('answer:refund:v4')
    expect(seenPrompt).toContain('confirm the invoice id before refunding')
    expect(seenPrompt).toContain('BASE SYSTEM PROMPT')
  })

  it('runs fail-closed on the base surface when the pull 404s (nothing promoted)', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof fetch
    let seenPrompt = ''
    let seenCertified: unknown = 'unset'
    const agent = withCertifiedDelivery(
      async (_input: null, applied) => {
        seenPrompt = applied.composePrompt('BASE')
        seenCertified = applied.certified
        return 'ok'
      },
      { project: 'p', apiKey: 'k', baseUrl: 'https://plane.test', fetchImpl },
    )
    expect(await agent(null)).toBe('ok')
    expect(seenPrompt).toBe('BASE')
    expect(seenCertified).toBeNull()
  })

  it('does not break the agent when Intelligence is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const agent = withCertifiedDelivery(async (input: number) => input * 2, {
      project: 'p',
      apiKey: 'k',
      baseUrl: 'https://plane.test',
      fetchImpl,
    })
    await expect(agent(21)).resolves.toBe(42)
  })

  it('caches the certified pull across calls within refreshMs (one pull, N runs)', async () => {
    const calls = { n: 0 }
    const fetchImpl = vi.fn(async () => {
      calls.n += 1
      return jsonResponse(CERTIFIED)
    }) as unknown as typeof fetch
    const agent = withCertifiedDelivery(async (_i: null, _a) => 'ok', {
      project: 'support-agent',
      apiKey: 'k',
      baseUrl: 'https://plane.test',
      refreshMs: 60_000,
      fetchImpl,
    })
    await agent(null)
    await agent(null)
    await agent(null)
    expect(calls.n).toBe(1)
  })

  it('propagates the agent error (delivery never swallows the live path)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const agent = withCertifiedDelivery(
      async (_i: null) => {
        throw new Error('agent boom')
      },
      { project: 'support-agent', apiKey: 'k', baseUrl: 'https://plane.test', fetchImpl },
    )
    await expect(agent(null)).rejects.toThrow('agent boom')
  })
})
