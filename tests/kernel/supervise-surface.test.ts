import type {
  AnalystFinding,
  TraceAnalysisEngine,
  TraceAnalysisStore,
} from '@tangle-network/agent-eval'
import {
  buildDefaultAnalystRegistry,
  DEFAULT_TRACE_ANALYST_KINDS,
  toolSpansToTraceAnalysisStore,
} from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'
import type { AnalystRegistryLike } from '../../src/analyst-loop/types'
import type { AgenticSurface, AgenticTask } from '../../src/runtime/strategy'
import {
  analystsFromRegistry,
  failuresAnalyst,
  traceSurfaceCalls,
} from '../../src/runtime/supervise-surface'

const task: AgenticTask = {
  id: 'surface-trace-test',
  systemPrompt: 'Fix every failing test.',
  userPrompt: 'Make the suite pass.',
}

function fakeSurface(): AgenticSurface {
  let testRuns = 0
  return {
    name: 'trace-test',
    open: async () => ({ id: 'artifact-1', surface: 'trace-test' }),
    tools: async () => [],
    async call(_handle, name) {
      if (name === 'run_tests') {
        testRuns += 1
        return testRuns === 1
          ? '2/5 tests passed. FAILING: stale_failure'
          : '3/5 tests passed. FAILING: test_alpha, test_beta'
      }
      if (name === 'explode') throw new Error('tool exploded')
      return 'Worker prose claims FAILING: fabricated_from_prose'
    },
    score: async () => ({ passes: 3, total: 5, errored: 0 }),
    close: async () => undefined,
  }
}

describe('superviseSurface trace evidence', () => {
  it('records real surface-call success/error spans and derives exact failures from run_tests only', async () => {
    const traced = traceSurfaceCalls(fakeSurface())
    const handle = await traced.surface.open(task)

    await traced.surface.call(handle, 'read_file', { path: 'tests.ts' })
    await traced.surface.call(handle, 'run_tests', {})
    await traced.surface.call(handle, 'run_tests', {})
    await expect(traced.surface.call(handle, 'explode', { reason: 'test' })).rejects.toThrow(
      'tool exploded',
    )

    const spans = await traced.traceSource.collect()
    expect(
      spans.map((span) => ({
        toolName: span.toolName,
        status: span.status,
        result: span.result,
      })),
    ).toEqual([
      {
        toolName: 'read_file',
        status: 'ok',
        result: 'Worker prose claims FAILING: fabricated_from_prose',
      },
      {
        toolName: 'run_tests',
        status: 'ok',
        result: '2/5 tests passed. FAILING: stale_failure',
      },
      {
        toolName: 'run_tests',
        status: 'ok',
        result: '3/5 tests passed. FAILING: test_alpha, test_beta',
      },
      { toolName: 'explode', status: 'error', result: 'ERROR: tool exploded' },
    ])

    const result = (await failuresAnalyst().run(
      'failures',
      toolSpansToTraceAnalysisStore(spans),
    )) as { summary: string }
    expect(result.summary).toContain('STILL FAILING (2): test_alpha, test_beta')
    expect(result.summary).not.toContain('stale_failure')
    expect(result.summary).not.toContain('fabricated_from_prose')
  })

  it('refuses to infer failures from the legacy worker prose object', async () => {
    const proseOnly = {
      resolved: false,
      score: 0.4,
      shots: 2,
      summary: 'STILL FAILING: invented_one',
      failing: ['invented_one'],
    }

    const result = (await failuresAnalyst().run(
      'failures',
      proseOnly as unknown as TraceAnalysisStore,
    )) as { summary: string }

    expect(result.summary).toMatch(/Missing structured run_tests span evidence.*Refusing/)
    expect(result.summary).not.toContain('invented_one')
  })

  it('treats prose in non-run_tests spans as missing failure evidence', async () => {
    const proseOnlyStore = toolSpansToTraceAnalysisStore([
      {
        spanId: 'prose-1',
        runId: 'surface-worker-prose',
        kind: 'tool',
        name: 'read_file',
        toolName: 'read_file',
        args: { path: 'worker-summary.txt' },
        result: 'Worker says FAILING: fabricated_from_span_prose',
        status: 'ok',
        startedAt: 1,
        endedAt: 2,
      },
    ])

    const result = (await failuresAnalyst().run('failures', proseOnlyStore)) as {
      summary: string
    }

    expect(result.summary).toMatch(/Missing structured run_tests span evidence.*Refusing/)
    expect(result.summary).not.toContain('fabricated_from_span_prose')
  })
})

describe('analystsFromRegistry — the eval registry as a supervise lens', () => {
  const span = {
    spanId: 's0',
    runId: 'run-1',
    kind: 'tool',
    name: 'read',
    toolName: 'read',
    args: {},
    result: {},
    status: 'ok',
    startedAt: 0,
    endedAt: 1,
  } as const

  const finding: AnalystFinding = {
    schema_version: 1,
    finding_id: 'f-1',
    analyst_id: 'failure-mode',
    area: 'failure-mode',
    severity: 'high',
    claim: 'the worker repeated one read three times',
    confidence: 0.9,
    evidence: [],
    produced_at: new Date(0).toISOString(),
    subject: { kind: 'run', id: 'run-1' },
  } as unknown as AnalystFinding

  function fakeRegistry(): AnalystRegistryLike & {
    calls: Array<{ runId: string; only: unknown; hasStore: boolean }>
  } {
    const calls: Array<{ runId: string; only: unknown; hasStore: boolean }> = []
    return {
      calls,
      list: () => DEFAULT_TRACE_ANALYST_KINDS.map((kind) => ({ id: kind.id })),
      run: async (runId, inputs, opts) => {
        calls.push({ runId, only: opts?.only, hasStore: inputs.traceStore !== undefined })
        return { findings: [finding] } as never
      },
    }
  }

  it('adapts list()+run() into the kinds+run(kindId, trace) lens supervise takes', async () => {
    const registry = fakeRegistry()
    const lens = analystsFromRegistry(registry)
    // The reproducer in the issue: `'kinds' in buildDefaultAnalystRegistry()` is false, so the
    // registry could not be passed to `supervise({ analysts })` at all.
    expect('kinds' in lens).toBe(true)
    expect(lens.kinds.map((kind) => kind.id)).toEqual(
      DEFAULT_TRACE_ANALYST_KINDS.map((kind) => kind.id),
    )
    expect(lens.kinds.every((kind) => typeof kind.area === 'string' && kind.area.length > 0)).toBe(
      true,
    )

    const store = toolSpansToTraceAnalysisStore([span])
    const findings = await lens.run('failure-mode', store)
    expect(findings).toEqual([finding])
    // Exactly the one requested lens runs, over the worker's trace store.
    expect(registry.calls).toHaveLength(1)
    expect(registry.calls[0]?.only).toEqual(['failure-mode'])
    expect(registry.calls[0]?.hasStore).toBe(true)
  })

  it('refuses a kind the registry does not have, at adapt time', () => {
    expect(() =>
      analystsFromRegistry(fakeRegistry(), [
        { id: 'not-registered', description: 'ghost', area: 'qa' },
      ]),
    ).toThrow(/"not-registered" is not registered/)
  })

  it('forwards runOpts and adapts the real default registry', async () => {
    const engine: TraceAnalysisEngine = {
      id: 'mock-engine',
      description: 'deterministic test engine',
      version: '1',
      executionConfig: { mode: 'test' },
      analyze: async () => ({
        answer: 'ok',
        findings: [],
        steps: [],
        usage: { input_tokens: 1, output_tokens: 1, cost_usd: 0 },
      }),
    }
    const lens = analystsFromRegistry(buildDefaultAnalystRegistry({ engine }))
    expect(lens.kinds).toHaveLength(DEFAULT_TRACE_ANALYST_KINDS.length)
    const findings = await lens.run('failure-mode', toolSpansToTraceAnalysisStore([span]))
    expect(Array.isArray(findings)).toBe(true)
  })
})
