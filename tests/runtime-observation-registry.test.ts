import { makeFinding } from '@tangle-network/agent-eval'
import { AnalystRegistry } from '@tangle-network/agent-eval/analyst'
import { describe, expect, it, vi } from 'vitest'
import { HarvestError, harvestCorpus } from '../src/runtime/harvest-corpus'
import { observationFromRegistry } from '../src/runtime/observation-registry'
import { type ObserveInput, observe } from '../src/runtime/observe'
import { InMemoryCorpus } from '../src/runtime/personify/corpus'

describe('registry observation', () => {
  it('settles in-flight analysis and retains its cost after the source fails', async () => {
    let release: () => void = () => {}
    const analyzing = new Promise<void>((resolve) => {
      release = resolve
    })
    let pulls = 0
    const running = harvestCorpus({
      runs: {
        [Symbol.asyncIterator]: () => ({
          async next() {
            if (++pulls === 1)
              return { done: false, value: { task: 'Inspect', output: '', trace: [] } }
            throw new Error('source unavailable')
          },
        }),
      },
      corpus: new InMemoryCorpus(),
      concurrency: 2,
      analysis: async () => {
        await analyzing
        return { findings: [], report: '', usage: { input: 11, output: 17, known: true } }
      },
    })
    let settled = false
    void running.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    await new Promise((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)
    release()
    const result = await running
    expect(result.usage).toEqual({ input: 11, output: 17, known: true })
    expect(result.failures).toEqual([
      { runId: 'source-2', error: 'trace source: source unavailable' },
    ])
  })

  it('reserves harvest slots before concurrent iterator reads', async () => {
    const analysis = vi.fn(async () => ({
      findings: [],
      report: '',
      usage: { input: 2, output: 3, known: true },
    }))
    const result = await harvestCorpus({
      runs: Array.from({ length: 8 }, () => ({ task: 'Inspect', output: '', trace: [] })),
      corpus: new InMemoryCorpus(),
      analysis,
      concurrency: 4,
      maxRuns: 1,
    })
    expect(analysis).toHaveBeenCalledTimes(1)
    expect(result.usage).toEqual({ input: 2, output: 3, known: true })
  })

  it('retains late analysis costs without writing after cancellation', async () => {
    const controller = new AbortController()
    const append = vi.fn()
    await expect(
      observe(
        { task: 'Inspect', output: '', trace: [] },
        {
          signal: controller.signal,
          analysis: async () => {
            controller.abort(new Error('stopped during analysis'))
            return { findings: [], report: '', usage: { input: 2, output: 3, known: true } }
          },
          corpus: { append, query: async () => [] },
        },
      ),
    ).rejects.toMatchObject({
      message: 'stopped during analysis',
      usage: { input: 2, output: 3, known: true },
    })
    expect(append).not.toHaveBeenCalled()
  })

  it('passes full evidence to selected analysts and retains citations, provenance, and usage', async () => {
    const registry = new AnalystRegistry()
    const input: ObserveInput = {
      task: 'Inspect the entire artifact and event sequence',
      output: 'x'.repeat(4000),
      trace: Array.from({ length: 100 }, (_, index) => ({ index })),
      runId: 'development-attempt',
    }
    registry.register({
      id: 'custom-investigation',
      version: '1',
      description: 'Inspect supplied evidence',
      inputKind: 'custom',
      cost: { kind: 'llm' },
      async analyze(received: ObserveInput, context) {
        expect(received).toEqual(input)
        context.recordUsage?.({
          calls: 1,
          tokens: { input: 17, output: 11 },
          cost: { kind: 'observed', usd: 0.2 },
        })
        return [
          makeFinding({
            analyst_id: 'custom-investigation',
            area: 'verification',
            severity: 'high',
            claim: 'The independent check failed',
            confidence: 1,
            evidence_refs: [
              { kind: 'artifact', uri: 'artifact://retained-check', excerpt: 'FAIL' },
            ],
            derived_from_judge: true,
          }),
        ]
      },
    })
    const corpus = new InMemoryCorpus()
    const result = await observe(input, {
      corpus,
      analysis: observationFromRegistry(registry, {
        inputs: (run) => ({ custom: { 'custom-investigation': run } }),
        proposalOrigin: 'search',
      }),
    })
    expect(result.usage).toEqual({ input: 17, output: 11, known: true })
    expect(result.findings[0]).toMatchObject({
      proposal_origin: 'search',
      derived_from_judge: true,
    })
    expect(result.learned[0]?.evidence).toContainEqual({
      kind: 'artifact',
      uri: 'artifact://retained-check',
      excerpt: 'FAIL',
    })
  })

  it('retains failed analyst receipts through an entirely failed harvest', async () => {
    const registry = new AnalystRegistry()
    registry.register({
      id: 'failed-analysis',
      version: '1',
      description: 'Failure after observed usage',
      inputKind: 'custom',
      cost: { kind: 'llm' },
      async analyze(_input, context) {
        context.recordUsage?.({
          calls: 1,
          tokens: { input: 11, output: 17 },
          cost: { kind: 'observed', usd: 0.2 },
        })
        throw new Error('analysis failed after inference')
      },
    })
    const reports: unknown[] = []
    let failed: unknown
    try {
      await harvestCorpus({
        runs: [{ task: 'inspect', output: '', trace: [], runId: 'failed-run' }],
        corpus: new InMemoryCorpus(),
        analysis: observationFromRegistry(registry, {
          proposalOrigin: 'production',
          inputs: { custom: { 'failed-analysis': {} } },
          record: (result) => {
            reports.push(result)
          },
        }),
      })
    } catch (error) {
      failed = error
    }
    expect(failed).toBeInstanceOf(HarvestError)
    if (!(failed instanceof HarvestError)) throw failed
    expect(failed.report.usage).toEqual({ input: 11, output: 17, known: true })
    expect(reports).toHaveLength(1)
  })

  it('preserves custom analysis cost when corpus persistence fails', async () => {
    const finding = makeFinding({
      analyst_id: 'custom',
      area: 'verification',
      severity: 'low',
      claim: 'Check observed',
      confidence: 1,
      evidence_refs: [],
    })
    await expect(
      observe(
        { task: 'inspect', output: '', trace: [] },
        {
          analysis: async () => ({
            findings: [{ ...finding, proposal_origin: 'production' }],
            report: '',
            usage: { input: 2, output: 3, known: true },
          }),
          corpus: {
            query: async () => [],
            append: async () => ({ succeeded: false, error: 'disk full' }),
          },
        },
      ),
    ).rejects.toMatchObject({ usage: { input: 2, output: 3, known: true } })
  })
})
