import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoopTraceEvent } from '../runtime/types'
import {
  compileEffort,
  createIntelligenceClient,
  defaultRedactor,
  isIntelligenceOff,
  resolveEffort,
  type UsageSplit,
} from './index'

const baseUrl = 'https://intelligence.test'
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

/** Stub away any ambient tenant key so a "no apiKey" client truly has none. */
function stubNoApiKey(): void {
  vi.stubEnv('TANGLE_API_KEY', '')
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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
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

  it('redacts secret assignments embedded in serialized text', () => {
    const redacted = defaultRedactor('judge note: {"password":"hunter2"} token=plain-secret')
    expect(redacted).toBe('judge note: {"password":[redacted]} token=[redacted]')
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
    const client = createIntelligenceClient({ project: 'support-agent', apiKey, baseUrl })
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
    const client = createIntelligenceClient({ project: 'support-agent', apiKey, baseUrl })
    const result = await client.traceRun({ input: { q: 'hi' } }, async (trace) => {
      trace.recordOutput({ answer: 'still here' })
      return 42
    })
    await expect(client.flush()).resolves.toBeUndefined()
    expect(result).toBe(42)
  })

  it('propagates an error thrown by the agent body (not swallowed)', async () => {
    installFetchSpy('ok')
    const client = createIntelligenceClient({ project: 'support-agent', apiKey, baseUrl })
    await expect(
      client.traceRun({ input: {} }, async () => {
        throw new Error('agent exploded')
      }),
    ).rejects.toThrow('agent exploded')
  })

  it('redacts secrets in the exported input/output', async () => {
    const { calls } = installFetchSpy('ok')
    const client = createIntelligenceClient({ project: 'p', apiKey, baseUrl })
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

  it('is a no-op (no fetch) when no tenant apiKey is present', async () => {
    stubNoApiKey()
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const client = createIntelligenceClient({ project: 'p', baseUrl })
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
      baseUrl,
      effort: 'off',
    })
    await client.traceRun({ input: { q: 'x' } }, async (trace) => {
      trace.recordOutcome({
        usage: { inferenceUsd: 0.01, intelligenceUsd: 0.05 } satisfies UsageSplit,
      })
      return 'ok'
    })
    await client.flush()
    const attrs = attrsOf(calls[0]?.body)
    expect(attrs['tangle.effort.intelligence_off']).toBe(true)
    expect(attrs['tangle.usage.intelligence_usd']).toBe(0)
    expect(attrs['tangle.usage.inference_usd']).toBe(0.01)
  })

  it('a non-off tier preserves a reported intelligence split', async () => {
    const { calls } = installFetchSpy('ok')
    const client = createIntelligenceClient({ project: 'p', apiKey, baseUrl, effort: 'standard' })
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

describe('doctor()', () => {
  it('reports observe always reachable, pr blocked without checks/surfaces/repo', () => {
    const client = createIntelligenceClient({ project: 'p', apiKey, baseUrl })
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
      baseUrl,
      checks: ['pnpm test'],
      surfaces: ['src/**'],
      repo: { owner: 'acme', name: 'p', baseBranch: 'main' },
    })
    const report = client.doctor()
    expect(report.modes.pr.ready).toBe(true)
    expect(report.modes.pr.missing).toEqual([])
  })

  it('flags recommend as blocked at the off floor', () => {
    const client = createIntelligenceClient({ project: 'p', apiKey, baseUrl, effort: 'off' })
    const report = client.doctor()
    expect(report.modes.recommend.ready).toBe(false)
    expect(report.modes.recommend.missing).toContain('effort above off')
  })

  it('reports exportConfigured:false when no tenant apiKey resolves', () => {
    stubNoApiKey()
    const client = createIntelligenceClient({ project: 'p', baseUrl })
    expect(client.doctor().exportConfigured).toBe(false)
  })
})

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
    const client = createIntelligenceClient({ project: 'support-agent', apiKey, baseUrl })
    const traceId = client.recordTrace(loopStream(), { traceId: 'a'.repeat(32) })
    await client.flush()

    expect(traceId).toBe('a'.repeat(32))
    const spans = calls.flatMap((c) => spansOf(c.body))
    const names = spans.map((s) => s.name)
    expect(names).toContain('loop')
    expect(names).toContain('loop.round')
    expect(names.filter((n) => n === 'loop.iteration').length).toBe(2)
    const traceIds = new Set(spans.map((s) => s.traceId))
    expect(traceIds.size).toBe(1)
    expect([...traceIds][0]).toBe('a'.repeat(32))
  })

  it('mints a fresh traceId when none is supplied and survives a dead endpoint', async () => {
    installFetchSpy('throw')
    const client = createIntelligenceClient({ project: 'p', apiKey, baseUrl })
    const traceId = client.recordTrace(loopStream())
    expect(traceId).toMatch(/^[0-9a-f]{32}$/)
    await expect(client.flush()).resolves.toBeUndefined()
  })

  it('is a no-op (no fetch) on an empty event stream or with no tenant key', async () => {
    stubNoApiKey()
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const withKey = createIntelligenceClient({ project: 'p', apiKey, baseUrl })
    withKey.recordTrace([])
    await withKey.flush()
    const noKey = createIntelligenceClient({ project: 'p', baseUrl })
    noKey.recordTrace(loopStream())
    await noKey.flush()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('exportRunRecord — typed RunRecord send (the withIntelligence SEND path)', () => {
  it('ships one flat run span with target/usage/model + the loop topology under one traceId', async () => {
    const { calls } = installFetchSpy('ok')
    const client = createIntelligenceClient({ project: 'support-agent', apiKey, baseUrl })
    const traceId = client.exportRunRecord({
      runId: 'run-1',
      traceId: 'b'.repeat(32),
      project: 'support-agent',
      target: 'support-agent',
      input: { q: 'hi' },
      output: { a: 'ok' },
      outcome: {
        success: true,
        score: 0.9,
        usage: { inferenceUsd: 0.002, intelligenceUsd: 0.001 },
      },
      model: 'kimi-k2',
      provider: 'moonshot',
      loopEvents: loopStream(),
    })
    await client.flush()

    expect(traceId).toBe('b'.repeat(32))
    const attrs = attrsOf(calls[0]?.body)
    expect(attrs['tangle.target']).toBe('support-agent')
    expect(attrs['tangle.usage.inference_usd']).toBe(0.002)
    expect(attrs['tangle.usage.intelligence_usd']).toBe(0.001)
    expect(attrs['tangle.outcome.success']).toBe(true)
    expect(attrs['gen_ai.request.model']).toBe('kimi-k2')

    const spans = calls.flatMap((c) => spansOf(c.body))
    const names = spans.map((s) => s.name)
    expect(names).toContain('tangle.intelligence.run')
    expect(names).toContain('loop')
    const traceIds = new Set(spans.map((s) => s.traceId))
    expect(traceIds.size).toBe(1)
  })

  it('clamps intelligence_usd to 0 at the OFF tier even if the record reports spend', async () => {
    const { calls } = installFetchSpy('ok')
    const client = createIntelligenceClient({ project: 'p', apiKey, baseUrl, effort: 'off' })
    client.exportRunRecord({
      runId: 'r',
      traceId: 'c'.repeat(32),
      project: 'p',
      target: 'p',
      input: {},
      output: {},
      outcome: { usage: { inferenceUsd: 0.01, intelligenceUsd: 0.05 } },
    })
    await client.flush()
    const attrs = attrsOf(calls[0]?.body)
    expect(attrs['tangle.usage.intelligence_usd']).toBe(0)
    expect(attrs['tangle.usage.inference_usd']).toBe(0.01)
  })

  it('is a no-op (no fetch) when no tenant apiKey is present', async () => {
    stubNoApiKey()
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const client = createIntelligenceClient({ project: 'p', baseUrl })
    const traceId = client.exportRunRecord({
      runId: 'r',
      traceId: 'd'.repeat(32),
      project: 'p',
      target: 'p',
      input: {},
      output: {},
      outcome: { usage: { inferenceUsd: 0, intelligenceUsd: 0 } },
    })
    await client.flush()
    expect(traceId).toBe('d'.repeat(32))
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
    const compiled = compileEffort(resolveEffort('off', { analysts: true, fanout: 4 }))
    expect(compiled.withAnalyst).toBe(true)
    expect(compiled.fanout).toBe(4)
  })

  it('max compiles to an uncapped intelligence budget', () => {
    expect(compileEffort(resolveEffort('max')).intelligenceBudgetUsd).toBeNull()
  })
})
