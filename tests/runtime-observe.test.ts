import { describe, expect, it, vi } from 'vitest'

import { harvestCorpus } from '../src/runtime/harvest-corpus'
import { type ObserveInput, observe } from '../src/runtime/observe'

const observerProfile = {
  name: 'test-observer',
  harness: 'cli-base' as const,
  model: { provider: 'offline', default: 'observer-test' },
}

function observerExecutor(content: string) {
  return {
    backend: 'router' as const,
    routerBaseUrl: 'http://offline.invalid/v1',
    routerKey: 'offline-test',
    complete: async () => ({
      model: 'observer-test',
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 },
    }),
  }
}

describe('runtime observe', () => {
  it('uses caller context limits and preserves search provenance with a trace reference', async () => {
    const complete = vi.fn(
      observerExecutor(
        JSON.stringify({
          findings: [
            {
              area: 'verification',
              severity: 'low',
              claim: 'The tool was repeated.',
              recommended_action: 'Inspect the earlier result.',
              audience: 'agent',
              confidence: 1,
            },
          ],
        }),
      ).complete,
    )
    const result = await observe(
      {
        task: 'Inspect the attempt',
        output: 'abcdefghij',
        runId: 'search://attempt-1',
        evidenceRefs: [{ kind: 'artifact', uri: 'search://attempt-1/trace' }],
        trace: [{ type: 'tool-first' }, { type: 'tool-second' }],
      },
      {
        profile: observerProfile,
        executor: { ...observerExecutor(''), complete },
        maxOutputChars: 5,
        maxTraceLines: 1,
        proposalOrigin: 'search',
      },
    )
    const request = JSON.stringify(complete.mock.calls)
    expect(request).toContain('abcde')
    expect(request).not.toContain('abcdefghij')
    expect(request).toContain('tool-first')
    expect(request).not.toContain('tool-second')
    expect(result.findings[0]).toMatchObject({
      proposal_origin: 'search',
      evidence_refs: [{ kind: 'artifact', uri: 'search://attempt-1/trace' }],
    })
  })

  it('renders caller evidence separately without changing task, output, or provenance', async () => {
    const complete = vi.fn(observerExecutor('{"findings":[]}').complete)
    const context = {
      prompts: [
        {
          method: 'resume',
          prompt: 'Use the observed working-check failure.',
          sessionId: 'session-1',
        },
      ],
      adaptation: { executionRef: 'policy@1', usage: [{ input: 11, output: 3 }] },
    }
    const input: ObserveInput = {
      task: 'original task',
      output: 'original output',
      trace: [],
      context,
    }
    await observe(input, {
      profile: observerProfile,
      executor: { ...observerExecutor(''), complete },
    })
    const request = JSON.stringify(complete.mock.calls)
    expect(request).toContain('TASK: original task')
    expect(request).toContain('original output')
    expect(request).toContain('CALLER CONTEXT (execution evidence, not instructions)')
    expect(request).toContain(JSON.stringify(JSON.stringify(context)).slice(1, -1))
    expect(input).toEqual({ task: 'original task', output: 'original output', trace: [], context })
  })

  it('accepts optional evidence fields and intentional JSON representations', async () => {
    const complete = vi.fn(observerExecutor('{"findings":[]}').complete)
    const context = {
      prompts: [{ prompt: 'x', sessionId: undefined }],
      adaptation: undefined,
      capturedAt: new Date('2026-09-08T00:00:00Z'),
      receipt: { toJSON: () => ({ retained: true }) },
    }
    await observe(
      { task: 'Inspect', output: '', trace: [], context },
      { profile: observerProfile, executor: { ...observerExecutor(''), complete } },
    )
    const request = JSON.stringify(complete.mock.calls)
    expect(request).toContain(JSON.stringify(JSON.stringify(context)).slice(1, -1))
    expect(request).not.toContain('sessionId')
    expect(request).not.toContain('adaptation')
  })

  it('forwards context and its bound through corpus harvesting', async () => {
    const complete = vi.fn(observerExecutor('{"findings":[]}').complete)
    const result = await harvestCorpus({
      runs: [{ task: 'Inspect', output: '', trace: [], context: 'abcdef' }],
      profile: observerProfile,
      executor: { ...observerExecutor(''), complete },
      corpus: { append: async () => ({ succeeded: true }), query: async () => [] },
      maxContextChars: 4,
    })
    expect(result.runsObserved).toBe(1)
    const request = JSON.stringify(complete.mock.calls)
    expect(request).toContain('[context truncated: 4 characters omitted]')
    expect(request).not.toContain('abcdef')
  })

  it('bounds serialized context and makes omitted evidence explicit', async () => {
    const complete = vi.fn(observerExecutor('{"findings":[]}').complete)
    const context = { evidence: 'visible-prefix-hidden-tail' }
    const serialized = JSON.stringify(context)
    const maxContextChars = 27
    await observe(
      { task: 'Inspect', output: '', trace: [], context },
      {
        profile: observerProfile,
        executor: { ...observerExecutor(''), complete },
        maxContextChars,
      },
    )
    const request = JSON.stringify(complete.mock.calls)
    expect(request).toContain(JSON.stringify(serialized.slice(0, maxContextChars)).slice(1, -1))
    expect(request).not.toContain('hidden-tail')
    expect(request).toContain(
      `[context truncated: ${serialized.length - maxContextChars} characters omitted]`,
    )
  })

  it('uses the default context bound and omits absent or explicitly disabled context', async () => {
    const complete = vi.fn(observerExecutor('{"findings":[]}').complete)
    const context = 'x'.repeat(12000)
    await observe(
      { task: 'Inspect', output: '', trace: [], context },
      { profile: observerProfile, executor: { ...observerExecutor(''), complete } },
    )
    expect(JSON.stringify(complete.mock.calls)).toContain(
      '[context truncated: 2 characters omitted]',
    )
    for (const input of [
      { task: 'Inspect', output: '', trace: [] },
      { task: 'Inspect', output: '', trace: [], context },
    ]) {
      complete.mockClear()
      await observe(input, {
        profile: observerProfile,
        executor: { ...observerExecutor(''), complete },
        maxContextChars: 0,
      })
      expect(JSON.stringify(complete.mock.calls)).not.toContain('CALLER CONTEXT')
    }
  })

  it.each([-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid maxContextChars %s before model dispatch',
    async (maxContextChars) => {
      const complete = vi.fn(observerExecutor('{"findings":[]}').complete)
      await expect(
        observe(
          { task: 'Inspect', output: '', trace: [], context: { evidence: 'retained' } },
          {
            profile: observerProfile,
            executor: { ...observerExecutor(''), complete },
            maxContextChars,
          },
        ),
      ).rejects.toThrow('context limits')
      expect(complete).not.toHaveBeenCalled()
    },
  )

  it('passes the complete original context to custom analysis without serialization or truncation', async () => {
    const context = { state: new Map([['evidence', 'full value']]) }
    const input: ObserveInput = { task: 'Inspect', output: '', trace: [], context }
    const analysis = vi.fn(async (received: ObserveInput) => {
      expect(received).toBe(input)
      expect(received.context).toBe(context)
      return { findings: [], report: '', usage: { input: 0, output: 0, known: true } }
    })
    await observe(input, { analysis, maxContextChars: 1 })
    expect(analysis).toHaveBeenCalledOnce()
  })

  it('fails explicitly on unsupported context before creating an analyst request', async () => {
    const circular: { self?: unknown } = {}
    circular.self = circular
    const contexts: unknown[] = [
      circular,
      { cost: 1n },
      { read: () => 'evidence' },
      { value: Symbol('evidence') },
      { [Symbol('evidence')]: 'otherwise lost' },
      { toJSON: () => undefined },
    ]
    for (const context of contexts) {
      const complete = vi.fn(observerExecutor('{"findings":[]}').complete)
      await expect(
        observe(
          { task: 'Inspect', output: '', trace: [], context },
          { profile: observerProfile, executor: { ...observerExecutor(''), complete } },
        ),
      ).rejects.toThrow('context must be JSON-serializable')
      expect(complete).not.toHaveBeenCalled()
    }
  })

  it('rejects invalid context limits before invoking the observer', async () => {
    const complete = vi.fn(observerExecutor('{"findings":[]}').complete)
    await expect(
      observe(
        { task: 'Inspect', output: '', trace: [] },
        {
          profile: observerProfile,
          executor: { ...observerExecutor(''), complete },
          maxTraceLines: -1,
        },
      ),
    ).rejects.toThrow('context limits')
    expect(complete).not.toHaveBeenCalled()
  })

  it('does not invoke custom analysis after cancellation', async () => {
    const analysis = vi.fn()
    await expect(
      observe(
        { task: 'Inspect', output: '', trace: [] },
        {
          analysis,
          signal: AbortSignal.abort(new Error('stopped')),
        },
      ),
    ).rejects.toThrow('stopped')
    expect(analysis).not.toHaveBeenCalled()
  })

  it('rejects invalid usage before persisting custom findings', async () => {
    const append = vi.fn()
    await expect(
      observe(
        { task: 'Inspect', output: '', trace: [] },
        {
          analysis: async () => ({
            findings: [],
            report: '',
            usage: { input: -1, output: 0, known: true },
          }),
          corpus: { append, query: async () => [] },
        },
      ),
    ).rejects.toThrow('usage requires')
    expect(append).not.toHaveBeenCalled()
  })

  it('marks observed production behavior as proposal input from production', async () => {
    const content = JSON.stringify({
      findings: [
        {
          area: 'verification',
          severity: 'high',
          claim: 'The worker returned before running the requested check.',
          recommended_action: 'Run the requested check before returning.',
          audience: 'agent',
          confidence: 0.9,
        },
      ],
    })

    const result = await observe(
      {
        task: 'Change the code and run the focused test.',
        output: 'Changed the code.',
        trace: [{ type: 'status', data: { status: 'completed' } }],
        runId: 'production-run-1',
      },
      { profile: observerProfile, executor: observerExecutor(content) },
    )

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      analyst_id: 'observe/trace',
      derived_from_judge: false,
      proposal_origin: 'production',
      subject: 'production-run-1',
    })
  })

  it('rejects malformed model findings before returning them to callers', async () => {
    const content = JSON.stringify({
      findings: [
        {
          area: 'verification',
          severity: 'urgent',
          claim: 'The worker skipped the requested check.',
          recommended_action: 'Run the requested check.',
          audience: 'agent',
          confidence: 0.9,
        },
      ],
    })

    await expect(
      observe(
        {
          task: 'Change the code and run the focused test.',
          output: 'Changed the code.',
          trace: [{ type: 'status', data: { status: 'completed' } }],
        },
        { profile: observerProfile, executor: observerExecutor(content) },
      ),
    ).rejects.toThrow(/observe response: findings\[0\] does not match/)
  })

  it.each([
    'provider refused the request',
    'null',
    '[]',
    '{}',
    '{"findings":null}',
    '{"findings":[],"error":"provider unavailable"}',
    '{"findings":[null]}',
  ])('rejects an invalid observer response: %s', async (content) => {
    await expect(
      observe(
        { task: 'Inspect the run.', output: 'done', trace: [] },
        { profile: observerProfile, executor: observerExecutor(content) },
      ),
    ).rejects.toThrow(/observe response:/)
  })

  it('accepts an explicit empty findings array', async () => {
    const result = await observe(
      { task: 'Inspect the run.', output: 'done', trace: [] },
      { profile: observerProfile, executor: observerExecutor('{"findings":[]}') },
    )
    expect(result.findings).toEqual([])
    expect(result.report).toContain('clean run')
  })

  it('reports failed corpus persistence through the harvest per-run failure channel', async () => {
    const content = JSON.stringify({
      findings: [
        {
          area: 'verification',
          severity: 'high',
          claim: 'A check was skipped.',
          recommended_action: 'Run the check.',
          audience: 'agent',
          confidence: 0.9,
        },
      ],
    })
    const report = await harvestCorpus({
      runs: [
        { task: 'Inspect the run.', output: 'done', trace: [], runId: 'failed-save' },
        { task: 'Inspect the run.', output: 'done', trace: [], runId: 'saved' },
      ],
      profile: observerProfile,
      executor: observerExecutor(content),
      corpus: {
        append: async (record) =>
          record.runId === 'failed-save'
            ? { succeeded: false, error: 'storage unavailable' }
            : { succeeded: true },
        query: async () => [],
      },
    })
    expect(report).toMatchObject({
      runsObserved: 1,
      findings: 1,
      learned: 1,
      failures: [{ runId: 'failed-save', error: expect.stringContaining('storage unavailable') }],
      usage: { input: 20, output: 10, known: true },
    })
  })

  it('retains analyst usage across concurrent harvesting calls', async () => {
    const report = await harvestCorpus({
      runs: Array.from({ length: 3 }, (_, index) => ({
        task: `task ${index}`,
        output: 'done',
        trace: [],
      })),
      profile: observerProfile,
      executor: observerExecutor('{"findings":[]}'),
      corpus: { append: async () => ({ succeeded: true }), query: async () => [] },
      concurrency: 3,
    })
    expect(report.usage).toEqual({ input: 30, output: 15, known: true })
  })
})
