import {
  type CandidateExecutionEvidence,
  type CertifiedContext,
  type CertifiedContextEntry,
  certifiedContextContentHash,
  certifiedContextEntryContentHash,
} from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppliedIntelligence } from './with-intelligence'
import { withIntelligence } from './with-intelligence'

const generatedAt = '2026-07-25T20:01:00.000Z'
const expiresAt = '2026-07-25T20:11:00.000Z'
const fixedNow = () => Date.parse('2026-07-25T20:05:00.000Z')

function certifiedContext(content: string): CertifiedContext {
  const entryMaterial = {
    id: 'prompt-surface',
    kind: 'prompt' as const,
    name: 'system prompt',
    delivery: { kind: 'inline', content } as const,
  }
  const entry: CertifiedContextEntry = {
    ...entryMaterial,
    provenance: {
      contentHash: certifiedContextEntryContentHash(entryMaterial),
      version: 4,
      promotedAt: '2026-07-25T20:00:00.000Z',
    },
  }
  const contentMaterial = {
    tenantId: 'tenant-1',
    target: 'support-agent',
    state: 'active' as const,
    revision: '1',
    entries: [entry],
  }
  return {
    ...contentMaterial,
    generatedAt,
    expiresAt,
    contentHash: certifiedContextContentHash(contentMaterial),
  }
}

const CERTIFIED = certifiedContext('Confirm the invoice id before refunding.')
const REVOKED: CertifiedContext = {
  tenantId: 'tenant-1',
  target: 'support-agent',
  state: 'revoked',
  revision: '2',
  generatedAt,
  expiresAt,
  entries: [],
  contentHash: certifiedContextContentHash({
    tenantId: 'tenant-1',
    target: 'support-agent',
    state: 'revoked',
    revision: '2',
    entries: [],
  }),
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('withIntelligence — RECEIVE', () => {
  it('exposes the exact immutable certified context without rewriting it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    let applied: AppliedIntelligence | undefined
    const agent = withIntelligence(
      async (_input: null, a) => {
        applied = a
        return 'ok'
      },
      {
        tenantId: 'tenant-1',
        project: 'support-agent',
        apiKey: 'k',
        baseUrl: 'https://intelligence.tangle.tools',
        fetchImpl,
        now: fixedNow,
      },
    )
    await agent(null)

    expect(agent.currentCertifiedContext()).toEqual(CERTIFIED)
    expect(applied?.certifiedContext).toEqual(CERTIFIED)
    expect(Object.isFrozen(applied?.certifiedContext?.entries)).toBe(true)
  })

  it('fires onCertifiedContext once for unchanged context and again on revocation', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      return calls < 3 ? jsonResponse(CERTIFIED) : jsonResponse(REVOKED)
    }) as unknown as typeof fetch
    const seen: Array<CertifiedContext | null> = []
    const agent = withIntelligence(async () => 'ok', {
      tenantId: 'tenant-1',
      project: 'support-agent',
      apiKey: 'k',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
      now: fixedNow,
      refreshMs: 0,
      onCertifiedContext: (context) => seen.push(context),
    })
    await agent(null)
    await agent(null)
    await agent(null)
    expect(seen).toEqual([CERTIFIED, null])
  })

  it('surfaces a durable checkpoint rollback through onCertifiedContextReject', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const save = vi.fn(async () => {})
    const onCertifiedContextReject = vi.fn()
    let received: CertifiedContext | null | undefined
    const agent = withIntelligence(
      async (_input: null, applied) => {
        received = applied.certifiedContext
        return 'ok'
      },
      {
        tenantId: 'tenant-1',
        project: 'support-agent',
        apiKey: 'k',
        baseUrl: 'https://intelligence.tangle.tools',
        fetchImpl,
        now: fixedNow,
        checkpointStore: {
          async load() {
            return {
              tenantId: REVOKED.tenantId,
              target: REVOKED.target,
              revision: REVOKED.revision,
              contentHash: REVOKED.contentHash,
              state: REVOKED.state,
            }
          },
          save,
        },
        onCertifiedContextReject,
      },
    )

    await expect(agent(null)).resolves.toBe('ok')

    expect(received).toBeNull()
    expect(save).not.toHaveBeenCalled()
    expect(onCertifiedContextReject).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/rolled back from 2 to 1/) }),
    )
  })
})

describe('withIntelligence — SAFETY (observe + deliver only, never auto-apply)', () => {
  it('delivers only certified context into the prompt', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    let composed = ''
    const agent = withIntelligence(
      async (_input: null, a) => {
        composed = a.composePrompt('BASE PROMPT')
        return 'ok'
      },
      {
        tenantId: 'tenant-1',
        project: 'support-agent',
        apiKey: 'k',
        baseUrl: 'https://intelligence.tangle.tools',
        fetchImpl,
        now: fixedNow,
      },
    )
    await agent(null)

    expect(composed).toContain('BASE PROMPT')
    expect(composed).toContain('Confirm the invoice id before refunding')
    expect(composed).not.toContain('profileDiffs')
    expect(agent.currentCertifiedContext()).toEqual(CERTIFIED)
  })

  it('does not compose certified context after it expires during a run', async () => {
    let nowMs = fixedNow()
    let exposedAfterExpiry: CertifiedContext | null | undefined
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const agent = withIntelligence(
      async (_input: null, applied) => {
        nowMs = Date.parse(expiresAt)
        exposedAfterExpiry = applied.certifiedContext
        return applied.composePrompt('BASE PROMPT')
      },
      {
        tenantId: 'tenant-1',
        project: 'support-agent',
        apiKey: 'k',
        baseUrl: 'https://intelligence.tangle.tools',
        fetchImpl,
        now: () => nowMs,
      },
    )

    await expect(agent(null)).resolves.toBe('BASE PROMPT')
    expect(exposedAfterExpiry).toBeNull()
  })

  it('isolates certified-context observer failures from delivery and the agent run', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const agent = withIntelligence(
      async (_input: null, applied) => applied.composePrompt('BASE PROMPT'),
      {
        tenantId: 'tenant-1',
        project: 'support-agent',
        apiKey: 'k',
        baseUrl: 'https://intelligence.tangle.tools',
        fetchImpl,
        now: fixedNow,
        onCertifiedContext: () => {
          throw new Error('observer failed')
        },
      },
    )

    await expect(agent(null)).resolves.toContain('Confirm the invoice id before refunding')
    expect(agent.currentCertifiedContext()).toEqual(CERTIFIED)
  })

  it('runs on the base surface when the context endpoint is incompatible', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof fetch
    let sawCertified: unknown = 'unset'
    const agent = withIntelligence(
      async (_input: null, a) => {
        sawCertified = a.certifiedContext
        return a.certifiedContext === null ? 'base' : 'x'
      },
      {
        tenantId: 'tenant-1',
        project: 'p',
        apiKey: 'k',
        baseUrl: 'https://intelligence.tangle.tools',
        fetchImpl,
        now: fixedNow,
      },
    )
    expect(await agent(null)).toBe('base')
    expect(sawCertified).toBeNull()
    expect(agent.currentCertifiedContext()).toBeNull()
  })

  it('never breaks the agent when Intelligence is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const agent = withIntelligence(async (input: number) => input * 2, {
      tenantId: 'tenant-1',
      project: 'p',
      apiKey: 'k',
      baseUrl: 'https://intelligence.tangle.tools',
      fetchImpl,
      now: fixedNow,
    })
    await expect(agent(21)).resolves.toBe(42)
  })

  it('propagates an agent error (delivery never swallows the live path)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
    const agent = withIntelligence(
      async (_i: null) => {
        throw new Error('agent boom')
      },
      {
        tenantId: 'tenant-1',
        project: 'support-agent',
        apiKey: 'k',
        baseUrl: 'https://intelligence.tangle.tools',
        fetchImpl,
        now: fixedNow,
      },
    )
    await expect(agent(null)).rejects.toThrow('agent boom')
  })
})

/** Pull every span attribute across an OTLP export body into one flat map. */
function attrsOf(body: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const resourceSpans = (body as { resourceSpans?: unknown[] })?.resourceSpans ?? []
  for (const rs of resourceSpans) {
    for (const ss of (rs as { scopeSpans?: unknown[] }).scopeSpans ?? []) {
      for (const span of (ss as { spans?: unknown[] }).spans ?? []) {
        for (const a of (span as { attributes?: unknown[] }).attributes ?? []) {
          const attr = a as { key: string; value: Record<string, unknown> }
          const v = attr.value
          out[attr.key] =
            v.stringValue ??
            (v.intValue !== undefined ? Number(v.intValue) : undefined) ??
            v.doubleValue ??
            v.boolValue
        }
      }
    }
  }
  return out
}

describe('withIntelligence — SEND (a typed RunRecord to /v1/otlp)', () => {
  it('ships one run span carrying target + usage split + model, best-effort', async () => {
    vi.useFakeTimers()
    try {
      const longInput = 'x'.repeat(5000)
      const posts: unknown[] = []
      const otlpSpy = vi.fn(async (_url: unknown, init: unknown) => {
        const body = (init as { body?: string })?.body
        if (body) posts.push(JSON.parse(body))
        return { ok: true, status: 200, async json() {} } as unknown as Response
      })
      vi.stubGlobal('fetch', otlpSpy)
      // The pull rides its own fetchImpl; SEND rides global fetch (the exporter).
      const pull = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
      const agent = withIntelligence(
        async (_input: { q: string }, a) => {
          expect(a.runId).toMatch(/^run-/)
          expect(a.traceId).toHaveLength(32)
          a.record({
            success: true,
            usage: { inferenceUsd: 0.002, intelligenceUsd: 0 },
            model: 'kimi-k2',
            provider: 'moonshot',
            sessionId: 'session-1',
            runtimeEvents: [
              {
                type: 'tool_call',
                toolName: 'mcp__linear__linear_graphql',
                toolCallId: 'call-1',
                args: { query: longInput },
              },
              {
                type: 'llm_call',
                model: 'kimi-k2',
                tokensIn: 11,
                tokensOut: 7,
                costUsd: 0.002,
                latencyMs: 250,
              },
            ],
            candidateExecution: {
              kind: 'agent-candidate-execution-evidence',
              materializationReceipt: {
                executionPlan: {
                  material: {
                    executionId: 'candidate-execution-1',
                    runCell: { experimentDigest: `sha256:${'1'.repeat(64)}` },
                  },
                },
              },
              receipt: {
                bundleDigest: `sha256:${'3'.repeat(64)}`,
                executionPlanDigest: `sha256:${'4'.repeat(64)}`,
                materializationReceiptDigest: `sha256:${'5'.repeat(64)}`,
                termination: { kind: 'exit', exitCode: 0 },
                benchmarkResult: { material: { passed: true } },
                digest: `sha256:${'6'.repeat(64)}`,
              },
              digest: `sha256:${'7'.repeat(64)}`,
            } as CandidateExecutionEvidence,
          })
          return 'answer'
        },
        {
          tenantId: 'tenant-1',
          project: 'support-agent',
          target: 'support-agent',
          apiKey: 'k',
          baseUrl: 'https://intelligence.tangle.tools',
          fetchImpl: pull,
          now: fixedNow,
          profile: {
            name: 'support-agent',
            prompt: { systemPrompt: 'Handle support requests.' },
            tools: { mcp__linear__linear_graphql: true },
          },
          commitSha: 'a'.repeat(40),
          repo: { owner: 'tangle-network', name: 'support', baseBranch: 'main' },
          runtimeTelemetry: { includeEventData: true },
          payloadAttributes: 'full',
        },
      )
      await agent({ q: longInput })
      await agent.flush()

      expect(posts.length).toBeGreaterThan(0)
      const attrs = attrsOf(posts[0])
      expect(attrs.project).toBe('support-agent')
      expect(attrs['tangle.target']).toBe('support-agent')
      expect(attrs['tangle.usage.inference_usd']).toBe(0.002)
      expect(attrs['tangle.usage.intelligence_usd']).toBe(0)
      expect(attrs['tangle.outcome.success']).toBe(true)
      expect(attrs['gen_ai.request.model']).toBe('kimi-k2')
      expect(attrs['tangle.sessionId']).toBe('session-1')
      expect(attrs['vcs.repository.name']).toBe('tangle-network/support')
      expect(attrs['vcs.ref.head.revision']).toBe('a'.repeat(40))
      expect(attrs['gen_ai.usage.input_tokens']).toBe(11)
      expect(attrs['gen_ai.usage.output_tokens']).toBe(7)
      expect(String(attrs['tangle.input'])).toContain(longInput)
      expect(String(attrs['tangle.input'])).not.toContain('[truncated]')
      expect(attrs['tangle.input_hash']).toEqual(expect.any(String))
      expect(attrs['tangle.input_bytes']).toBeGreaterThan(5000)
      expect(JSON.parse(String(attrs['tangle.agent.profile']))).toMatchObject({
        name: 'support-agent',
        tools: { mcp__linear__linear_graphql: true },
      })
      expect(attrs['tangle.agent.profile_hash']).toEqual(expect.any(String))
      expect(attrs['tool.name']).toBe('mcp__linear__linear_graphql')
      expect(String(attrs['tool.input'])).toContain(longInput)
      expect(attrs['tangle.candidate.execution_id']).toBe('candidate-execution-1')
      expect(attrs['tangle.candidate.experiment_digest']).toBe(`sha256:${'1'.repeat(64)}`)
      expect(attrs['tangle.candidate.run_receipt_digest']).toBe(`sha256:${'6'.repeat(64)}`)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not send when no tenant apiKey is present', async () => {
    const otlpSpy = vi.fn()
    vi.stubGlobal('fetch', otlpSpy)
    vi.stubEnv('TANGLE_API_KEY', '')
    try {
      const pull = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch
      const agent = withIntelligence(async () => 'ok', {
        tenantId: 'tenant-1',
        project: 'p',
        baseUrl: 'https://intelligence.tangle.tools',
        fetchImpl: pull,
        now: fixedNow,
      })
      expect(await agent(null)).toBe('ok')
      expect(otlpSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('exports payload hashes and byte counts without content by default', async () => {
    vi.useFakeTimers()
    try {
      const posts: unknown[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: unknown, init: unknown) => {
          const body = (init as { body?: string })?.body
          if (body) posts.push(JSON.parse(body))
          return { ok: true, status: 200, async json() {} } as unknown as Response
        }),
      )
      const pull = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
      const agent = withIntelligence(async () => 'private output', {
        tenantId: 'tenant-1',
        project: 'support-agent',
        apiKey: 'k',
        baseUrl: 'https://intelligence.tangle.tools',
        fetchImpl: pull,
        now: fixedNow,
        profile: { name: 'support-agent' },
      })

      await agent('private input')
      await agent.flush()

      const attrs = attrsOf(posts[0])
      expect(attrs['tangle.input']).toBeUndefined()
      expect(attrs['tangle.output']).toBeUndefined()
      expect(attrs['tangle.agent.profile']).toBeUndefined()
      expect(attrs['tangle.input_hash']).toEqual(expect.any(String))
      expect(attrs['tangle.input_bytes']).toBeGreaterThan(0)
      expect(attrs['tangle.output_hash']).toEqual(expect.any(String))
      expect(attrs['tangle.agent.profile_hash']).toEqual(expect.any(String))
    } finally {
      vi.useRealTimers()
    }
  })

  it('exports a failed run before rethrowing the agent error', async () => {
    vi.useFakeTimers()
    try {
      const posts: unknown[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: unknown, init: unknown) => {
          const body = (init as { body?: string })?.body
          if (body) posts.push(JSON.parse(body))
          return { ok: true, status: 200, async json() {} } as unknown as Response
        }),
      )
      const pull = vi.fn(async () => jsonResponse(CERTIFIED)) as unknown as typeof fetch
      const agent = withIntelligence(
        async () => {
          throw Object.assign(new Error('provider exhausted'), { code: 'rate_limit' })
        },
        {
          tenantId: 'tenant-1',
          project: 'support-agent',
          apiKey: 'k',
          baseUrl: 'https://intelligence.tangle.tools',
          fetchImpl: pull,
          now: fixedNow,
        },
      )

      await expect(agent(null)).rejects.toThrow('provider exhausted')
      await agent.flush()

      const attrs = attrsOf(posts[0])
      expect(attrs['tangle.outcome.success']).toBe(false)
      expect(attrs['error.type']).toBe('rate_limit')
      expect(attrs['error.message']).toBe('provider exhausted')
      expect(attrs['tangle.duration_ms']).toEqual(expect.any(Number))
    } finally {
      vi.useRealTimers()
    }
  })
})
