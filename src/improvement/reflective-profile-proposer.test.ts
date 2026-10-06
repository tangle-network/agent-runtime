import { CostLedger } from '@tangle-network/agent-eval'
import type {
  ProposeContext,
  SearchProposerView,
  SearchScoredCell,
} from '@tangle-network/agent-eval/campaign'
import { describe, expect, it, vi } from 'vitest'
import { optimizerMethod } from './optimizer-prompt'
import {
  type ReflectiveProposerChat,
  reflectiveProfileProposer,
} from './reflective-profile-proposer'

const PRICING = { inputUsdPerMillion: 0.3, outputUsdPerMillion: 1.2 }
const cells: SearchScoredCell[] = [
  { cellId: 'c1', unitId: 'task-a', attempt: 1, score: 0.2 },
  { cellId: 'c2', unitId: 'task-b', attempt: 1, score: 1 },
]

/** A train view that retires on the first await, as the search's does. */
function retiringTrain(): SearchProposerView {
  let live = true
  queueMicrotask(() => {
    live = false
  })
  return {
    searchId: 's',
    direction: 'maximize',
    scoredCells: (nodeId) => {
      if (!live) throw new Error('the train view retired')
      return nodeId === 'node-1' ? cells : []
    },
    unitScores: () => [],
  }
}

function context(
  ledger: CostLedger,
  surface: ProposeContext['currentSurface'] = 'Answer the question.',
): ProposeContext {
  return {
    currentSurface: surface,
    operator: 'improve',
    parents: [{ nodeId: 'node-1', artifact: surface }],
    train: retiringTrain(),
    summary: 'node-1 leads on train',
    history: [],
    findings: [],
    populationSize: 1,
    generation: 0,
    signal: new AbortController().signal,
    costLedger: ledger,
    costPhase: 'search.proposal',
  }
}

const reply = (content: string, usage = { inputTokens: 1000, outputTokens: 200 }) =>
  vi.fn<ReflectiveProposerChat>(async () => ({ content, usage }))

describe('reflectiveProfileProposer', () => {
  it('proposes one replacement surface from the parent and its train results, as a priced call', async () => {
    const chat = reply(
      'Here it is:\n{"label":"show the arithmetic","hypothesis":"answers skip the unit conversion","surface":"Answer the question. Convert units first."}',
    )
    const evidence = vi.fn(async ({ trainCells }: { trainCells: readonly SearchScoredCell[] }) =>
      trainCells.map((cell) => `train ${cell.unitId}: expected 4, got ${cell.score}`),
    )
    const ledger = new CostLedger({ costCeilingUsd: 1 })
    const proposer = reflectiveProfileProposer({
      model: 'deepseek/deepseek-v4.1-flash',
      chat,
      pricing: PRICING,
      maxOutputTokens: 4000,
      frame: 'You improve the system prompt of an analyst agent scored against published answers.',
      evidence,
    })

    const proposed = await proposer.propose(context(ledger))

    expect(proposed).toEqual([
      {
        surface: 'Answer the question. Convert units first.',
        label: 'show the arithmetic',
        rationale: 'answers skip the unit conversion',
      },
    ])
    expect(evidence).toHaveBeenCalledWith({
      nodeId: 'node-1',
      surface: 'Answer the question.',
      trainCells: cells,
    })
    const request = chat.mock.calls[0]![0]
    expect(request.messages[0]!.content).toContain(optimizerMethod)
    expect(request.messages[0]!.content).toContain('published answers')
    expect(request.messages[1]!.content).toContain('OPERATOR: improve')
    expect(request.messages[1]!.content).toContain('train task-a: expected 4, got 0.2')
    expect(request.messages[1]!.content).toContain('node-1 leads on train')
    expect(request.maxOutputTokens).toBe(4000)

    const [receipt] = ledger.list()
    expect(receipt).toMatchObject({
      channel: 'proposer',
      phase: 'search.proposal',
      model: 'deepseek/deepseek-v4.1-flash',
      inputTokens: 1000,
      outputTokens: 200,
      costUnknown: false,
    })
    expect(receipt!.costUsd).toBeCloseTo((1000 * 0.3 + 200 * 1.2) / 1e6, 12)
    // The maximum is every prompt byte as a token plus the output allowance.
    const bytes = request.messages.reduce((n, m) => n + Buffer.byteLength(m.content, 'utf8'), 0)
    expect(receipt!.maximumCostUsd).toBeCloseTo(((bytes + 32) * 0.3 + 4000 * 1.2) / 1e6, 12)
  })

  it('proposes every named component of a component surface', async () => {
    const chat = reply(
      '{"label":"tighten both","hypothesis":"h","surface":{"instructions":"new instructions","systemPrompt":"new prompt"}}',
    )
    const proposer = reflectiveProfileProposer({
      model: 'm',
      chat,
      pricing: PRICING,
      frame: 'frame',
    })
    const surface = {
      kind: 'components' as const,
      components: { systemPrompt: 'old prompt', instructions: 'old instructions' },
    }
    const proposed = await proposer.propose(context(new CostLedger(), surface))
    expect(proposed).toEqual([
      {
        surface: {
          kind: 'components',
          components: { instructions: 'new instructions', systemPrompt: 'new prompt' },
        },
        label: 'tighten both',
        rationale: 'h',
      },
    ])
  })

  it('proposes nothing for a reply without a usable surface, and keeps its cost', async () => {
    const ledger = new CostLedger()
    for (const content of [
      'I cannot help with that.',
      '{"label":"x","surface":""}',
      `{"label":"x","surface":"${'a'.repeat(50)}"}`,
    ]) {
      const proposer = reflectiveProfileProposer({
        model: 'm',
        chat: reply(content),
        pricing: PRICING,
        frame: 'frame',
        maxSurfaceChars: 40,
      })
      expect(await proposer.propose(context(ledger))).toEqual([])
    }
    expect(ledger.list()).toHaveLength(3)
  })

  it('records a reply without usage as unknown cost under its declared maximum', async () => {
    const ledger = new CostLedger({ costCeilingUsd: 1 })
    const proposer = reflectiveProfileProposer({
      model: 'm',
      chat: vi.fn(async () => ({ content: '{"surface":"x"}', usage: null })),
      pricing: PRICING,
      frame: 'frame',
    })
    await proposer.propose(context(ledger))
    const [receipt] = ledger.list()
    expect(receipt).toMatchObject({ costUnknown: true, usageUnknown: true })
    expect(receipt!.maximumCostUsd).toBeGreaterThan(0)
  })

  it('refuses a code surface and a proposal with no cost ledger', async () => {
    const proposer = reflectiveProfileProposer({
      model: 'm',
      chat: reply('{}'),
      pricing: PRICING,
      frame: 'frame',
    })
    await expect(
      proposer.propose({ ...context(new CostLedger()), costLedger: undefined }),
    ).rejects.toThrow('no cost ledger')
    const code = {
      kind: 'code' as const,
      worktreeRef: 'w',
      baseRef: 'main',
      baseCommit: 'a',
      baseTree: 'b',
      candidateCommit: 'c',
    }
    await expect(proposer.propose(context(new CostLedger(), code as never))).rejects.toThrow(
      'code surface',
    )
  })
})
