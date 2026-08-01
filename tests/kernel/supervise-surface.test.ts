import type { TraceAnalysisStore } from '@tangle-network/agent-eval'
import { toolSpansToTraceAnalysisStore } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'
import type { AgenticSurface, AgenticTask } from '../../src/runtime/strategy'
import { failuresAnalyst, traceSurfaceCalls } from '../../src/runtime/supervise-surface'

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
