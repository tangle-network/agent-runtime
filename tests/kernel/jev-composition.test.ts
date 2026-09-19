import { type AnalystContext, CostLedger } from '@tangle-network/agent-eval'
import { AnalystRegistry } from '@tangle-network/agent-eval/analyst'
import { describe, expect, it } from 'vitest'
import { shotLoop } from '../../examples/graphs/shot-loop'
import { analystsFromRegistry } from '../../src/runtime/supervise-surface'
import { runBrainLoop } from '../../src/runtime/tool-loop'
import { runGraphWithTestBrain } from '../../src/testing'

// These are composition proofs over deterministic fixtures, not live Jev quality tests.
describe('native decision composition without another runtime', () => {
  it('delivers an ordinary Eval analyst through the existing graph and ledger', async () => {
    const contexts: AnalystContext[] = []
    const registry = new AnalystRegistry()
    const sharedCostLedger = new CostLedger()
    const controller = new AbortController()
    registry.register({
      id: 'verify',
      description: 'Fixture for a native evidence-review analyst',
      inputKind: 'trace-store',
      version: 'native-fixture-v1',
      // No network or real model runs in this fixture.
      cost: { kind: 'deterministic' },
      async analyze(store, context) {
        expect(store).toBeDefined()
        contexts.push(context)
        const answer = { type: 'noul', noul: 0.75 } as const
        return [
          {
            schema_version: '1.0.0',
            finding_id: `fixture-${context.runId}`,
            analyst_id: 'verify',
            produced_at: new Date(0).toISOString(),
            severity: 'info',
            area: 'verification',
            claim: 'Injected native-answer fixture reached the graph reviewer',
            confidence: answer.noul,
            evidence_refs: [],
            derived_from_judge: true,
            metadata: { fixture: true, nativeAnswer: answer },
          },
        ]
      },
    })
    const { graph, opts } = shotLoop()
    const analysts = analystsFromRegistry(
      registry,
      [
        {
          id: 'verify',
          description: 'Native-answer fixture',
          area: 'verification',
        },
      ],
      {
        runOpts: {
          signal: controller.signal,
          costLedger: sharedCostLedger,
          costPhase: 'graph-review',
          tags: { policy: 'native-fixture-v1' },
        },
      },
    )
    const result = await runGraphWithTestBrain(graph, {
      ...opts,
      runId: 'jev-composition-fixture',
      analysts,
    })
    expect(contexts.length).toBeGreaterThan(0)
    expect(contexts.every((context) => context.costLedger === sharedCostLedger)).toBe(true)
    expect(contexts.every((context) => context.costPhase === 'graph-review')).toBe(true)
    expect(contexts.every((context) => context.tags?.policy === 'native-fixture-v1')).toBe(true)
    expect(result.ledger.some((edge) => edge.kind === 'analyzes')).toBe(true)
    expect(result.ledger.some((edge) => edge.edge === 'analyzes:verify:coder->reviewer')).toBe(true)
    expect(graph.nodes.map((node) => node.id)).toEqual(['reviewer', 'coder'])
  })

  it('prepares before compaction and observes the exact post-compaction request', async () => {
    const order: string[] = []
    const result = await runBrainLoop({
      initialMessages: [
        { role: 'system', content: 'Keep mandatory instructions.' },
        { role: 'user', content: 'Original task.' },
        { role: 'assistant', content: 'Prior work.' },
      ],
      tools: [],
      maxTurns: 1,
      hooks: {
        async beforeTurn(_turn, messages) {
          order.push('prepare')
          messages.push({ role: 'user', content: 'Selected optional context.' })
        },
      },
      compaction: {
        thresholdTokens: 1,
        preserveHead: 2,
        distill: async () => {
          order.push('compact')
          return 'Retained progress.'
        },
      },
      chat: async (messages) => {
        order.push('inference')
        expect(messages[0]?.content).toBe('Keep mandatory instructions.')
        expect(messages[1]?.content).toBe('Original task.')
        expect(messages.at(-1)?.content).toContain('Retained progress.')
        const response = { content: 'answer', toolCalls: [], usage: { input: 10, output: 2 } }
        // Awaited caller composition, not RuntimeHooks or a second loop.
        await Promise.resolve().then(() => {
          order.push('inspect')
        })
        return response
      },
      execute: async () => {
        throw new Error('No tool should execute')
      },
    })
    expect(order).toEqual(['prepare', 'compact', 'inference', 'inspect'])
    expect(result.final).toBe('answer')
    expect(result.usage).toEqual({ input: 10, output: 2 })
  })
})
