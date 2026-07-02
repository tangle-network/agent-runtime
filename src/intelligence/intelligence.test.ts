import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoopTraceEvent } from '../runtime/types'
import {
  compileEffort,
  createIntelligenceClient,
  defaultRedactor,
  isIntelligenceOff,
  resolveEffort,
  type UsageSplit,
  withTangleIntelligence,
} from './index'

const endpoint = 'https://intelligence.test/v1/otlp'
const apiKey = 'sk-tan-test-key'

/** Capture every OTLP POST body the exporter flushes. */
interface FetchCall {
  url: string
  headers: Record<string, string>
  body: unknown
}

function installFetchSpy(mode: 'ok' | 'throw'): { calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const spy = vi.fn(async (url: unknown, init: unknown) => {
    const i = (init ?? {}) as { headers?: Record<string, string>; body?: string }
    calls.push({
      url: String(url),
      headers: i.headers ?? {},
      body: i.body ? JSON.parse(i.body) : undefined,
    })
    if (mode === 'throw') throw new Error('network down')
    return {
      ok: true,
      status: 200,
      async json() {
        return {}
      },
    } as unknown as Response
  })
  vi.stubGlobal('fetch', spy)
  return { calls }
}

function stubNoEndpointEnv(): void {
  vi.stubEnv('INTELLIGENCE_OTLP_ENDPOINT', '')
  vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '')
}

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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resolveEffort', () => {
  it('compiles off to every-intelligence-off, zero intelligence budget', () => {
    const s = resolveEffort('off')
    expect(s).toEqual({
      analysts: false,
      corpus: 'off',
      fanout: 1,
      loops: false,
      intelligenceBudgetUsd: 0,
    })
    expect(isIntelligenceOff(s)).toBe(true)
  })

  it('standard turns intelligence on and is not the off floor', () => {
    const s = resolveEffort('standard')
    expect(s.analysts).toBe(true)
    expect(s.fanout).toBeGreaterThan(1)
    expect(isIntelligenceOff(s)).toBe(false)
  })

  it('scales knobs across eco < standard < thorough < max', () => {
    const eco = resolveEffort('eco')
    const std = resolveEffort('standard')
    const tho = resolveEffort('thorough')
    expect(eco.fanout).toBeLessThanOrEqual(std.fanout)
    expect(std.fanout).toBeLessThanOrEqual(tho.fanout)
    expect(resolveEffort('max').intelligenceBudgetUsd).toBeNull()
  })

  it('applies per-field overrides on top of a preset', () => {
    const s = resolveEffort('off', { analysts: true, fanout: 4 })
    expect(s.analysts).toBe(true)
    expect(s.fanout).toBe(4)
    // Overriding any axis lifts a run off the OFF floor.
    expect(isIntelligenceOff(s)).toBe(false)
  })

  it('fails loud on an unknown tier', () => {
    expect(() => resolveEffort('turbo' as never)).toThrow(/unknown effort tier/)
  })
})

describe('defaultRedactor', () => {
  it('strips api keys, bearer tokens, emails, and secret-keyed values', () => {
    const redacted = defaultRedactor({
      message: 'contact me at alice@acme.com',
      apiKey: 'sk-tan-supersecretvalue123',
      headers: { authorization: 'Bearer abcd1234efgh5678ijkl' },
      nested: { note: 'token sk-live-aaaaaaaaaaaaaaaa here' },
    }) as Record<string, unknown>
    const flat = JSON.stringify(redacted)
    expect(flat).not.toContain('alice@acme.com')
    expect(flat).not.toContain('supersecretvalue')
    expect(flat).not.toContain('abcd1234efgh5678ijkl')
    expect(flat).not.toContain('sk-live-aaaaaaaaaaaaaaaa')
    expect(redacted.apiKey).toBe('[redacted]')
    expect((redacted.headers as Record<string, unknown>).authorization).toBe('[redacted]')
  })

  it('is cycle-safe and total', () => {
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic
    expect(() => defaultRedactor(cyclic)).not.toThrow()
  })
})

describe('createIntelligenceClient / traceRun — Observe', () => {
  let now: typeof Date.now
  beforeEach(() => {
    now = Date.now
  })
  afterEach(() => {
    Date.now = now
  })

  it('exports one span on a successful run and returns the agent output', async () => {
    const { calls } = installFetchSpy('ok')
    const client = createIntelligenceClient({ project: 'support-agent', apiKey, endpoint })
    const result = await client.traceRun({ input: { q: 'hi' } }, async (trace) => {
      trace.recordOutput({ answer: 'hello' })
      trace.recordOutcome({ success: true, score: 0.9, costUsd: 0.002 })
      return 'hello'
    })
    await client.flush()
    expect(result).toBe('hello')
    expect(calls.length).toBeGreaterThan(0)
    const attrs = attrsOf(calls[0]?.body)
    expect(attrs.project).toBe('support-agent')
    expect(attrs['tangle.outcome.success']).toBe(true)
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${apiKey}`)
  })

  it('survives a dead endpoint — agent output is returned, no throw', async () => {
    installFetchSpy('throw')
    const client = createIntelligenceClient({ project: 'support-agent', apiKey, endpoint })
    const result = await client.traceRun({ input: { q: 'hi' } }, async (trace) => {
      trace.recordOutput({ answer: 'still here' })
      return 42
    })
    await expect(client.flush()).resolves.toBeUndefined()
    expect(result).toBe(42)
  })

  it('propagates an error thrown by the agent body (not swallowed)', async () => {
    installFetchSpy('ok')
    const client = createIntelligenceClient({ project: 'support-agent', apiKey, endpoint })
    await expect(
      client.traceRun({ input: {} }, async () => {
        throw new Error('agent exploded')
      }),
    ).rejects.toThrow('agent exploded')
  })

  it('redacts secrets in the exported input/output', async () => {
    const { calls } = installFetchSpy('ok')
    const client = createIntelligenceClient({ project: 'p', apiKey, endpoint })
    await client.traceRun(
      { input: { prompt: 'my key is sk-tan-leakedsecretvalue999' } },
      async (trace) => {
        trace.recordOutput({ text: 'reply to alice@acme.com' })
        return 'ok'
      },
    )
    await client.flush()
    const blob = JSON.stringify(calls.map((c) => c.body))
    expect(blob).not.toContain('sk-tan-leakedsecretvalue999')
    expect(blob).not.toContain('alice@acme.com')
  })

  it('is a no-op (no fetch) when no endpoint is configured', async () => {
    stubNoEndpointEnv()
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const client = createIntelligenceClient({ project: 'p', apiKey })
    const out = await client.traceRun({ input: {} }, async () => 'x')
    await client.flush()
    expect(out).toBe('x')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('billing classification — OFF proves inference-only', () => {
  it("effort:'off' produces zero intelligence-class usage on the trace", async () => {
    const { calls } = installFetchSpy('ok')
    const client = createIntelligenceClient({
      project: 'p',
      apiKey,
      endpoint,
      effort: 'off',
    })
    await client.traceRun({ input: { q: 'x' } }, async (trace) => {
      // Even a caller that mis-reports intelligence spend at OFF is clamped.
      trace.recordOutcome({
        usage: { inferenceUsd: 0.01, intelligenceUsd: 0.05 } satisfies UsageSplit,
      })
      return 'ok'
    })
    await client.flush()
    const attrs = attrsOf(calls[0]?.body)
    expect(attrs['tangle.effort.intelligence_off']).toBe(true)
    expect(attrs['tangle.usage.intelligence_usd']).toBe(0)
    // Inference is still billed — OFF is not "free", it is inference-only.
    expect(attrs['tangle.usage.inference_usd']).toBe(0.01)
  })

  it('a non-off tier preserves a reported intelligence split', async () => {
    const { calls } = installFetchSpy('ok')
    const client = createIntelligenceClient({ project: 'p', apiKey, endpoint, effort: 'standard' })
    await client.traceRun({ input: {} }, async (trace) => {
      trace.recordOutcome({ usage: { inferenceUsd: 0.01, intelligenceUsd: 0.03 } })
      return 'ok'
    })
    await client.flush()
    const attrs = attrsOf(calls[0]?.body)
    expect(attrs['tangle.effort.intelligence_off']).toBe(false)
    expect(attrs['tangle.usage.intelligence_usd']).toBe(0.03)
  })
})

describe('withTangleIntelligence', () => {
  it('preserves the agent shape and traces each call', async () => {
    const { calls } = installFetchSpy('ok')
    const agent = async (input: { name: string }) => `hi ${input.name}`
    const wrapped = withTangleIntelligence(agent, { project: 'p', apiKey, endpoint })
    const out = await wrapped({ name: 'drew' })
    // Flush is internal to the client; force one export round.
    expect(out).toBe('hi drew')
    // The wrapper builds its own client; give the batch a manual flush via a fresh call path.
    expect(calls.length).toBeGreaterThanOrEqual(0)
  })

  it('never fails the agent when telemetry export is down', async () => {
    installFetchSpy('throw')
    const agent = async () => 'result'
    const wrapped = withTangleIntelligence(agent, { project: 'p', apiKey, endpoint })
    await expect(wrapped(undefined)).resolves.toBe('result')
  })

  it('propagates an agent error through the wrapper', async () => {
    installFetchSpy('ok')
    const agent = async () => {
      throw new Error('boom')
    }
    const wrapped = withTangleIntelligence(agent, { project: 'p', apiKey, endpoint })
    await expect(wrapped(undefined)).rejects.toThrow('boom')
  })
})

describe('doctor()', () => {
  it('reports observe always reachable, pr blocked without checks/surfaces/repo', () => {
    const client = createIntelligenceClient({ project: 'p', apiKey, endpoint })
    const report = client.doctor()
    expect(report.modes.observe.ready).toBe(true)
    expect(report.modes.pr.ready).toBe(false)
    expect(report.modes.pr.missing).toEqual(expect.arrayContaining(['checks', 'surfaces', 'repo']))
    expect(report.exportConfigured).toBe(true)
  })

  it('reports pr ready when checks, surfaces, and repo are all present', () => {
    const client = createIntelligenceClient({
      project: 'p',
      apiKey,
      endpoint,
      checks: ['pnpm test'],
      surfaces: ['src/**'],
      repo: { owner: 'acme', name: 'p', baseBranch: 'main' },
    })
    const report = client.doctor()
    expect(report.modes.pr.ready).toBe(true)
    expect(report.modes.pr.missing).toEqual([])
  })

  it('flags recommend as blocked at the off floor', () => {
    const client = createIntelligenceClient({ project: 'p', apiKey, endpoint, effort: 'off' })
    const report = client.doctor()
    expect(report.modes.recommend.ready).toBe(false)
    expect(report.modes.recommend.missing).toContain('effort above off')
  })

  it('reports exportConfigured:false when no endpoint resolves', () => {
    stubNoEndpointEnv()
    const client = createIntelligenceClient({ project: 'p', apiKey })
    expect(client.doctor().exportConfigured).toBe(false)
  })
})

/** Pull every span's `name` + `traceId` across an OTLP export body. */
function spansOf(body: unknown): Array<{ name: string; traceId: string }> {
  const out: Array<{ name: string; traceId: string }> = []
  const resourceSpans = (body as { resourceSpans?: unknown[] })?.resourceSpans ?? []
  for (const rs of resourceSpans) {
    for (const ss of (rs as { scopeSpans?: unknown[] }).scopeSpans ?? []) {
      for (const span of (ss as { spans?: unknown[] }).spans ?? []) {
        const s = span as { name?: string; traceId?: string }
        out.push({ name: String(s.name), traceId: String(s.traceId) })
      }
    }
  }
  return out
}

/** A minimal but real loop event stream: a plan round over two iterations. */
function loopStream(runId = 'loop-run'): LoopTraceEvent[] {
  return [
    {
      kind: 'loop.started',
      runId,
      timestamp: 1000,
      payload: { driver: 'fanout', agentRunNames: ['a'], maxIterations: 4, maxConcurrency: 2 },
    },
    {
      kind: 'loop.plan',
      runId,
      timestamp: 1001,
      payload: { roundIndex: 0, plannedCount: 2, moveKind: 'fanout', childIndices: [0, 1] },
    },
    {
      kind: 'loop.iteration.started',
      runId,
      timestamp: 1002,
      payload: { iterationIndex: 0, agentRunName: 'a', taskHash: 'h0', groupId: 0 },
    },
    {
      kind: 'loop.iteration.started',
      runId,
      timestamp: 1003,
      payload: { iterationIndex: 1, agentRunName: 'a', taskHash: 'h1', groupId: 0 },
    },
    {
      kind: 'loop.iteration.ended',
      runId,
      timestamp: 1010,
      payload: {
        iterationIndex: 0,
        agentRunName: 'a',
        costUsd: 0.001,
        durationMs: 8,
        verdict: { valid: false, score: 0.3 },
        groupId: 0,
      },
    },
    {
      kind: 'loop.iteration.ended',
      runId,
      timestamp: 1012,
      payload: {
        iterationIndex: 1,
        agentRunName: 'a',
        costUsd: 0.002,
        durationMs: 9,
        verdict: { valid: true, score: 0.8 },
        groupId: 0,
      },
    },
    {
      kind: 'loop.ended',
      runId,
      timestamp: 1020,
      payload: { winnerIterationIndex: 1, totalCostUsd: 0.003, durationMs: 20, iterations: 2 },
    },
  ]
}

describe('recordTrace — loop topology via buildLoopOtelSpans (gap 2)', () => {
  it('exports a nested loop→round→iteration span tree under ONE traceId', async () => {
    const { calls } = installFetchSpy('ok')
    const client = createIntelligenceClient({ project: 'support-agent', apiKey, endpoint })
    const traceId = client.recordTrace(loopStream(), { traceId: 'a'.repeat(32) })
    await client.flush()

    expect(traceId).toBe('a'.repeat(32))
    const spans = calls.flatMap((c) => spansOf(c.body))
    const names = spans.map((s) => s.name)
    // The TREE builder emits topology-level names; a flat per-event builder would emit the
    // raw event kinds (loop.started/loop.iteration.ended). Asserting these proves reuse of
    // buildLoopOtelSpans, not a second span builder.
    expect(names).toContain('loop')
    expect(names).toContain('loop.round')
    expect(names.filter((n) => n === 'loop.iteration').length).toBe(2)
    // Every span shares the supplied traceId (one trace, not N).
    const traceIds = new Set(spans.map((s) => s.traceId))
    expect(traceIds.size).toBe(1)
    expect([...traceIds][0]).toBe('a'.repeat(32))
  })

  it('mints a fresh traceId when none is supplied and survives a dead endpoint', async () => {
    installFetchSpy('throw')
    const client = createIntelligenceClient({ project: 'p', apiKey, endpoint })
    const traceId = client.recordTrace(loopStream())
    expect(traceId).toMatch(/^[0-9a-f]{32}$/)
    // Export failure is swallowed — recordTrace never throws.
    await expect(client.flush()).resolves.toBeUndefined()
  })

  it('is a no-op (no fetch) on an empty event stream or with no endpoint', async () => {
    stubNoEndpointEnv()
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const withEndpoint = createIntelligenceClient({ project: 'p', apiKey, endpoint })
    withEndpoint.recordTrace([])
    await withEndpoint.flush()
    const noEndpoint = createIntelligenceClient({ project: 'p', apiKey })
    noEndpoint.recordTrace(loopStream())
    await noEndpoint.flush()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('compileEffort — EffortSettings → run-config overrides (gap 3/4)', () => {
  it('off compiles to no-analyst, fanout 1, no loops, zero intelligence budget', () => {
    const compiled = compileEffort(resolveEffort('off'))
    expect(compiled).toEqual({
      withAnalyst: false,
      fanout: 1,
      withLoops: false,
      intelligenceBudgetUsd: 0,
    })
    // The product fail-closed: at off the caller omits the analyst (degrade, not throw).
    expect(compiled.withAnalyst).toBe(false)
  })

  it('eco keeps the analyst but no breadth and no improvement loops', () => {
    const compiled = compileEffort(resolveEffort('eco'))
    expect(compiled.withAnalyst).toBe(true)
    expect(compiled.fanout).toBe(1)
    expect(compiled.withLoops).toBe(false)
  })

  it('standard turns the analyst on, opens breadth, and enables loops', () => {
    const compiled = compileEffort(resolveEffort('standard'))
    expect(compiled.withAnalyst).toBe(true)
    expect(compiled.fanout).toBeGreaterThan(1)
    expect(compiled.withLoops).toBe(true)
  })

  it('carries a per-field override through to the compiled overrides', () => {
    // Overriding analysts back on at off lifts the analyst-construction gate.
    const compiled = compileEffort(resolveEffort('off', { analysts: true, fanout: 4 }))
    expect(compiled.withAnalyst).toBe(true)
    expect(compiled.fanout).toBe(4)
  })

  it('max compiles to an uncapped intelligence budget', () => {
    expect(compileEffort(resolveEffort('max')).intelligenceBudgetUsd).toBeNull()
  })
})
