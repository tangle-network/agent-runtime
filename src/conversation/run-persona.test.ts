import { type AgentProfile, CostLedger } from '@tangle-network/agent-eval'
import type {
  CampaignCostMeter,
  DispatchContext,
  Scenario,
} from '@tangle-network/agent-eval/campaign'
import { describe, expect, it } from 'vitest'
import { createExecutor } from '../runtime/supervise/runtime'
import type { ExecutorFactory } from '../runtime/supervise/types'
import { runPersonaConversation, runPersonaDispatch } from './run-persona'
import type { ConversationTurn } from './types'

interface PersonaScenario extends Scenario {
  turns: string[]
}

/** An injected Router transport: the paid path still goes through the exact profile and Runtime. */
function fakeExecutor(
  saw: { prompt?: string; calls: number },
  options: { role?: 'worker' | 'persona' } = {},
): ExecutorFactory<unknown> {
  return createExecutor({
    backend: 'router',
    routerBaseUrl: 'https://router.test/v1',
    routerKey: 'test-key',
    complete: async (body) => {
      saw.calls += 1
      const first = (body.messages as Array<{ role?: string; content?: unknown }> | undefined)?.[0]
      if (first?.role === 'system' && typeof first.content === 'string') saw.prompt = first.content
      const persona = options.role === 'persona'
      return {
        model: body.model,
        choices: [
          {
            message: { content: persona ? `user-turn-${saw.calls}` : `agent-answer-${saw.calls}` },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: persona ? 100 : 10,
          completion_tokens: persona ? 50 : 5,
          cost_usd: persona ? 0.5 : 0.02,
        },
      }
    },
  })
}

const PROFILE = {
  name: 'worker',
  harness: 'cli-base',
  model: { provider: 'test', default: 'fake' },
  prompt: { systemPrompt: 'WORKER PROMPT' },
} as AgentProfile
const WORKER_PROFILE = {
  name: 'worker',
  harness: 'cli-base',
  model: { provider: 'test', default: 'fake' },
  prompt: { systemPrompt: 'WORKER-PROMPT' },
  metadata: { tag: 'worker' },
} as AgentProfile
const PERSONA_PROFILE = {
  name: 'persona',
  harness: 'cli-base',
  model: { provider: 'test', default: 'fake-persona' },
  prompt: { systemPrompt: 'PERSONA-PROMPT' },
  metadata: { tag: 'persona' },
} as AgentProfile

function fakeCtx(costCeilingUsd?: number): DispatchContext & {
  ledger: CostLedger
} {
  const ledger = new CostLedger(costCeilingUsd === undefined ? {} : { costCeilingUsd })
  const cost: CampaignCostMeter = {
    runPaidCall(input) {
      return ledger.runPaidCall({
        ...input,
        channel: input.channel ?? 'agent',
        phase: 'persona-test',
        tags: { cellId: 'persona-cell' },
      })
    },
  }
  return {
    ledger,
    signal: new AbortController().signal,
    cost,
  } as unknown as DispatchContext & { ledger: CostLedger }
}

describe('runPersonaConversation', () => {
  it('runs multi-round: persona leads each turn, worker answers each', async () => {
    const saw = { calls: 0 } as { prompt?: string; calls: number }
    const result = await runPersonaConversation({
      worker: PROFILE,
      persona: { kind: 'scripted', turns: ['intake question', 'follow-up question'] },
      executorFor: () => fakeExecutor(saw),
    })
    const agentTurns = result.transcript.filter((t: ConversationTurn) => t.speaker === 'agent')
    expect(agentTurns).toHaveLength(2)
    const flat = result.transcript.map((t) => `${t.speaker}:${t.text}`).join(' | ')
    expect(flat).toContain('user:intake question')
    expect(flat).toContain('agent:agent-answer-1')
    expect(flat).toContain('user:follow-up question')
    expect(saw.calls).toBe(2)
  })

  it('meters ONLY the worker, from its llm_call events', async () => {
    const saw = { calls: 0 } as { prompt?: string; calls: number }
    const result = await runPersonaConversation({
      worker: PROFILE,
      persona: { kind: 'scripted', turns: ['q1', 'q2'] },
      executorFor: () => fakeExecutor(saw),
    })
    expect(result.tokensIn).toBe(20)
    expect(result.tokensOut).toBe(10)
    expect(result.costUsd).toBeCloseTo(0.04, 5)
  })

  it('injects the worker profile prompt into the worker', async () => {
    const saw = { calls: 0 } as { prompt?: string; calls: number }
    await runPersonaConversation({
      worker: PROFILE,
      persona: { kind: 'scripted', turns: ['hi'] },
      executorFor: () => fakeExecutor(saw),
    })
    expect(saw.prompt).toBe('WORKER PROMPT')
  })

  it('requires maxTurns for a profile-driven persona', async () => {
    await expect(
      runPersonaConversation({
        worker: PROFILE,
        persona: { kind: 'profile', profile: PROFILE },
        executorFor: () => fakeExecutor({ calls: 0 }),
      }),
    ).rejects.toThrow(/maxTurns is required/)
  })

  it('runs a profile-driven persona end-to-end, injecting each profile prompt into its own side', async () => {
    const workerSaw = { calls: 0 } as { prompt?: string; calls: number }
    const personaSaw = { calls: 0 } as { prompt?: string; calls: number }
    const result = await runPersonaConversation({
      worker: WORKER_PROFILE,
      persona: { kind: 'profile', profile: PERSONA_PROFILE },
      executorFor: (_profile, role) =>
        role === 'worker' ? fakeExecutor(workerSaw) : fakeExecutor(personaSaw, { role: 'persona' }),
      maxTurns: 4,
    })
    // alternate, persona leads: persona, worker, persona, worker.
    expect(personaSaw.calls).toBe(2)
    expect(workerSaw.calls).toBe(2)
    // each side received ITS OWN profile prompt.
    expect(workerSaw.prompt).toBe('WORKER-PROMPT')
    expect(personaSaw.prompt).toBe('PERSONA-PROMPT')
    const agentTurns = result.transcript.filter((t) => t.speaker === 'agent')
    expect(agentTurns).toHaveLength(2)
  })

  it('meters ONLY the worker for a profile-driven persona (excludes persona-driver spend)', async () => {
    const result = await runPersonaConversation({
      worker: WORKER_PROFILE,
      persona: { kind: 'profile', profile: PERSONA_PROFILE },
      executorFor: (_profile, role) =>
        role === 'worker'
          ? fakeExecutor({ calls: 0 })
          : fakeExecutor({ calls: 0 }, { role: 'persona' }),
      maxTurns: 4,
    })
    // worker: 2 calls × {in:10,out:5,$0.02}. persona-driver's 2×{in:100,out:50,$0.5}
    // must NOT leak into the worker's metered usage.
    expect(result.tokensIn).toBe(20)
    expect(result.tokensOut).toBe(10)
    expect(result.costUsd).toBeCloseTo(0.04, 5)
  })

  it('fails loud on an empty scripted persona', async () => {
    await expect(
      runPersonaConversation({
        worker: PROFILE,
        persona: { kind: 'scripted', turns: [] },
        executorFor: () => fakeExecutor({ calls: 0 }),
      }),
    ).rejects.toThrow(/no turns/)
  })
})

describe('runPersonaDispatch (matrix adapter)', () => {
  it('is a ProfileDispatchFn that meters through ctx.cost and builds the artifact', async () => {
    const saw = { calls: 0 } as { prompt?: string; calls: number }
    const dispatch = runPersonaDispatch<PersonaScenario, number>({
      executorFor: () => fakeExecutor(saw),
      personaOf: (s) => ({ kind: 'scripted', turns: s.turns }),
      artifactOf: (transcript) => transcript.filter((t) => t.speaker === 'agent').length,
    })
    const ctx = fakeCtx()
    const artifact = await dispatch(
      PROFILE,
      { id: 'p1', kind: 'persona', turns: ['q1', 'q2'] },
      ctx,
    )
    expect(artifact).toBe(2)
    expect(ctx.ledger.list()).toEqual([
      expect.objectContaining({
        actor: 'persona-conversation',
        model: 'fake',
        inputTokens: 20,
        outputTokens: 10,
        actualCostUsd: 0.04,
        costUsd: 0.04,
      }),
    ])
  })

  it('refuses a capped conversation before the worker runs when no hard maximum is supplied', async () => {
    const saw = { calls: 0 } as { prompt?: string; calls: number }
    const dispatch = runPersonaDispatch<PersonaScenario, number>({
      executorFor: () => fakeExecutor(saw),
      personaOf: (scenario) => ({ kind: 'scripted', turns: scenario.turns }),
      artifactOf: () => 0,
    })
    const ctx = fakeCtx(1)

    await expect(
      dispatch(PROFILE, { id: 'bounded', kind: 'persona', turns: ['q1'] }, ctx),
    ).rejects.toThrow(/hard maximumCharge before execution/)
    expect(saw.calls).toBe(0)
    expect(ctx.ledger.list()).toHaveLength(0)
  })

  it('admits a capped conversation with an executor-enforced maximum', async () => {
    const dispatch = runPersonaDispatch<PersonaScenario, number>({
      executorFor: () => fakeExecutor({ calls: 0 }),
      personaOf: (scenario) => ({ kind: 'scripted', turns: scenario.turns }),
      artifactOf: (transcript) => transcript.length,
      maximumCharge: { externallyEnforcedMaximumUsd: 0.05 },
    })
    const ctx = fakeCtx(1)

    await expect(
      dispatch(PROFILE, { id: 'bounded', kind: 'persona', turns: ['q1'] }, ctx),
    ).resolves.toBe(2)
    expect(ctx.ledger.list()).toEqual([
      expect.objectContaining({ maximumCostUsd: 0.05, actualCostUsd: 0.02, costUsd: 0.02 }),
    ])
  })
})
