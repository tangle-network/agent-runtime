import { type AgentProfile, CostLedger } from '@tangle-network/agent-eval'
import type {
  CampaignCostMeter,
  DispatchContext,
  Scenario,
} from '@tangle-network/agent-eval/campaign'
import { describe, expect, it } from 'vitest'
import { createIterableBackend } from '../backends'
import type { AgentExecutionBackend, RuntimeStreamEvent } from '../types'
import { runPersonaConversation, runPersonaDispatch } from './run-persona'
import type { ConversationTurn } from './types'

interface PersonaScenario extends Scenario {
  turns: string[]
}

/** A fake worker: records the system prompt it saw, answers each turn, and
 *  reports token/cost usage via an llm_call event (so metering is exercised). */
function fakeWorker(saw: { prompt?: string; calls: number }): AgentExecutionBackend {
  let n = 0
  return createIterableBackend({
    kind: 'fake-worker',
    async *stream(input, context) {
      saw.calls += 1
      const first = input.messages?.[0]
      if (first?.role === 'system') saw.prompt = first.content
      n += 1
      yield {
        type: 'text_delta',
        task: context.task,
        session: context.session,
        text: `agent-answer-${n}`,
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
      yield {
        type: 'llm_call',
        task: context.task,
        session: context.session,
        model: 'fake',
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0.02,
        latencyMs: 1,
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
    },
  })
}

/** A profile-driven persona (LLM user-sim): emits a user turn AND reports its
 *  OWN (large) llm_call cost — used to prove the runner never attributes the
 *  persona-driver's spend to the worker. */
function fakePersonaDriver(saw: { prompt?: string; calls: number }): AgentExecutionBackend {
  return createIterableBackend({
    kind: 'fake-persona',
    async *stream(input, context) {
      saw.calls += 1
      const first = input.messages?.[0]
      if (first?.role === 'system') saw.prompt = first.content
      yield {
        type: 'text_delta',
        task: context.task,
        session: context.session,
        text: `user-turn-${saw.calls}`,
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
      yield {
        type: 'llm_call',
        task: context.task,
        session: context.session,
        model: 'fake-persona',
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.5,
        latencyMs: 1,
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
    },
  })
}

const PROFILE = { model: { default: 'fake' } } as AgentProfile
const WORKER_PROFILE = {
  model: { default: 'fake' },
  metadata: { tag: 'worker' },
} as AgentProfile
const PERSONA_PROFILE = {
  model: { default: 'fake-persona' },
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
      backendFor: () => fakeWorker(saw),
      systemPromptOf: () => 'WORKER PROMPT',
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
      backendFor: () => fakeWorker(saw),
      systemPromptOf: () => 'SYS',
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
      backendFor: () => fakeWorker(saw),
      systemPromptOf: () => 'PROFILE-PROMPT-XYZ',
    })
    expect(saw.prompt).toBe('PROFILE-PROMPT-XYZ')
  })

  it('requires maxTurns for a profile-driven persona', async () => {
    await expect(
      runPersonaConversation({
        worker: PROFILE,
        persona: { kind: 'profile', profile: PROFILE },
        backendFor: () => fakeWorker({ calls: 0 }),
        systemPromptOf: () => 'SYS',
      }),
    ).rejects.toThrow(/maxTurns is required/)
  })

  it('runs a profile-driven persona end-to-end, injecting each profile prompt into its own side', async () => {
    const workerSaw = { calls: 0 } as { prompt?: string; calls: number }
    const personaSaw = { calls: 0 } as { prompt?: string; calls: number }
    const result = await runPersonaConversation({
      worker: WORKER_PROFILE,
      persona: { kind: 'profile', profile: PERSONA_PROFILE },
      backendFor: (_profile, role) =>
        role === 'worker' ? fakeWorker(workerSaw) : fakePersonaDriver(personaSaw),
      systemPromptOf: (p) => (p.metadata?.tag === 'persona' ? 'PERSONA-PROMPT' : 'WORKER-PROMPT'),
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
      backendFor: (_profile, role) =>
        role === 'worker' ? fakeWorker({ calls: 0 }) : fakePersonaDriver({ calls: 0 }),
      systemPromptOf: () => 'SYS',
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
        backendFor: () => fakeWorker({ calls: 0 }),
        systemPromptOf: () => 'SYS',
      }),
    ).rejects.toThrow(/no turns/)
  })
})

describe('runPersonaDispatch (matrix adapter)', () => {
  it('is a ProfileDispatchFn that meters through ctx.cost and builds the artifact', async () => {
    const saw = { calls: 0 } as { prompt?: string; calls: number }
    const dispatch = runPersonaDispatch<PersonaScenario, number>({
      backendFor: () => fakeWorker(saw),
      systemPromptOf: () => 'SYS',
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
      backendFor: () => fakeWorker(saw),
      systemPromptOf: () => 'SYS',
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
      backendFor: () => fakeWorker({ calls: 0 }),
      systemPromptOf: () => 'SYS',
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
