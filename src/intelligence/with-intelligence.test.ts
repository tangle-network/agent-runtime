import type {
  AgentProfile,
  AgentProfileDiff,
  CandidateExecutionEvidence,
} from '@tangle-network/agent-interface'
import { applyAgentProfileDiff } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProposedProfileDiff } from './delivery'
import type { AppliedIntelligence } from './with-intelligence'
import { withIntelligence } from './with-intelligence'

/** A valid, promoted profile diff — the previously-DROPPED typed artifact the
 *  composed endpoint returns alongside prompt/skill artifacts. */
const DIFF: AgentProfileDiff = {
  kind: 'agent-profile-diff',
  id: 'diff-1',
  title: 'certified refund tool',
  set: { tools: { refund: true }, metadata: { certified: true } },
}

/** The composed-endpoint fixture, carrying `agentProfileDiffs[]`. */
const COMPOSED = {
  target: 'support-agent',
  generatedAt: '2026-06-13T00:00:00.000Z',
  promptSurface: {
    surface: 'Confirm the invoice id before refunding.',
    surfaceHash: 'abc123',
    version: 4,
    lift: '+3.1pp',
  },
  artifacts: {},
  capabilities: [
    {
      id: 'prompt-surface',
      iface: { surface: 'context' },
      binding: { path: null, content: 'Confirm the invoice id before refunding.' },
      provenance: {
        contentHash: 'abc123',
        version: 4,
        lift: '+3.1pp',
        promotedAt: '2026-06-12T00:00:00.000Z',
      },
    },
  ],
  agentProfileDiffs: [
    {
      diff: DIFF,
      provenance: {
        version: 7,
        lift: '+2.2pp',
        contentHash: 'deadbeef',
        promotedAt: '2026-06-12T00:00:00.000Z',
      },
    },
  ],
  agentProfile: { name: 'support-agent', tools: { refund: true }, metadata: { certified: true } },
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

describe('withIntelligence — RECEIVE (the previously-dropped typed diffs)', () => {
  it('deserializes agentProfileDiffs and surfaces them as proposals (round-trip)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(COMPOSED)) as unknown as typeof fetch
    let applied: AppliedIntelligence | undefined
    const agent = withIntelligence(
      async (_input: null, a) => {
        applied = a
        return 'ok'
      },
      { project: 'support-agent', apiKey: 'k', baseUrl: 'https://plane.test', fetchImpl },
    )
    await agent(null)

    // The typed diffs the OLD receive path dropped now round-trip verbatim.
    expect(agent.proposals()).toEqual(COMPOSED.agentProfileDiffs)
    expect(applied?.proposals).toEqual(COMPOSED.agentProfileDiffs)
  })

  it('applyProfile folds the proposals exactly as applyAgentProfileDiff would', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(COMPOSED)) as unknown as typeof fetch
    let applied: AppliedIntelligence | undefined
    const agent = withIntelligence(
      async (_input: null, a) => {
        applied = a
        return 'ok'
      },
      { project: 'support-agent', apiKey: 'k', baseUrl: 'https://plane.test', fetchImpl },
    )
    await agent(null)

    const base: AgentProfile = { name: 'support-agent' }
    // The hook's fold == the canonical single-diff application.
    expect(applied?.applyProfile(base)).toEqual(applyAgentProfileDiff(base, DIFF))
  })

  it('fires onProposals once with the promoted set (silent on an unchanged refresh)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(COMPOSED)) as unknown as typeof fetch
    const seen: ProposedProfileDiff[][] = []
    const agent = withIntelligence(async () => 'ok', {
      project: 'support-agent',
      apiKey: 'k',
      baseUrl: 'https://plane.test',
      fetchImpl,
      onProposals: (p) => seen.push(p),
    })
    await agent(null)
    await agent(null)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual(COMPOSED.agentProfileDiffs)
  })
})

describe('withIntelligence — SAFETY (observe + deliver only, never auto-apply)', () => {
  it('delivers ONLY the certified prompt surface into the prompt, never the raw diff', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(COMPOSED)) as unknown as typeof fetch
    let composed = ''
    const agent = withIntelligence(
      async (_input: null, a) => {
        composed = a.composePrompt('BASE PROMPT')
        return 'ok'
      },
      { project: 'support-agent', apiKey: 'k', baseUrl: 'https://plane.test', fetchImpl },
    )
    await agent(null)

    expect(composed).toContain('BASE PROMPT')
    expect(composed).toContain('Confirm the invoice id before refunding')
    // The typed diff is a PROPOSAL — it must not leak into the delivered prompt.
    expect(composed).not.toContain('agent-profile-diff')
    // Proposals are surfaced, but the hook applied nothing on the run path.
    expect(agent.proposals()).toHaveLength(1)
  })

  it('runs fail-closed on the base surface when the pull 404s (nothing promoted)', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof fetch
    let sawCertified: unknown = 'unset'
    const agent = withIntelligence(
      async (_input: null, a) => {
        sawCertified = a.certified
        return a.certified === null && a.proposals.length === 0 ? 'base' : 'x'
      },
      { project: 'p', apiKey: 'k', baseUrl: 'https://plane.test', fetchImpl },
    )
    expect(await agent(null)).toBe('base')
    expect(sawCertified).toBeNull()
    expect(agent.proposals()).toEqual([])
  })

  it('never breaks the agent when Intelligence is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const agent = withIntelligence(async (input: number) => input * 2, {
      project: 'p',
      apiKey: 'k',
      baseUrl: 'https://plane.test',
      fetchImpl,
    })
    await expect(agent(21)).resolves.toBe(42)
  })

  it('propagates an agent error (delivery never swallows the live path)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(COMPOSED)) as unknown as typeof fetch
    const agent = withIntelligence(
      async (_i: null) => {
        throw new Error('agent boom')
      },
      { project: 'support-agent', apiKey: 'k', baseUrl: 'https://plane.test', fetchImpl },
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
      const pull = vi.fn(async () => jsonResponse(COMPOSED)) as unknown as typeof fetch
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
          project: 'support-agent',
          target: 'support-agent',
          apiKey: 'k',
          baseUrl: 'https://plane.test',
          fetchImpl: pull,
          profile: {
            name: 'support-agent',
            prompt: { systemPrompt: 'Handle support requests.' },
            tools: { mcp__linear__linear_graphql: true },
          },
          commitSha: 'a'.repeat(40),
          repo: { owner: 'tangle-network', name: 'support', baseBranch: 'main' },
          runtimeTelemetry: { includeControlPayloads: true },
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
        project: 'p',
        baseUrl: 'https://plane.test',
        fetchImpl: pull,
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
      const pull = vi.fn(async () => jsonResponse(COMPOSED)) as unknown as typeof fetch
      const agent = withIntelligence(async () => 'private output', {
        project: 'support-agent',
        apiKey: 'k',
        baseUrl: 'https://plane.test',
        fetchImpl: pull,
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
      const pull = vi.fn(async () => jsonResponse(COMPOSED)) as unknown as typeof fetch
      const agent = withIntelligence(
        async () => {
          throw Object.assign(new Error('provider exhausted'), { code: 'rate_limit' })
        },
        { project: 'support-agent', apiKey: 'k', baseUrl: 'https://plane.test', fetchImpl: pull },
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
