import type { AgentProfile } from '@tangle-network/agent-eval'
import type { DispatchContext, Scenario } from '@tangle-network/agent-eval/campaign'
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

const PROFILE = {} as AgentProfile

function fakeCtx(): DispatchContext & {
  observed: { costUsd: number; tokensIn: number; tokensOut: number }
} {
  const observed = { costUsd: 0, tokensIn: 0, tokensOut: 0 }
  return {
    observed,
    signal: new AbortController().signal,
    cost: {
      observe(usd: number) {
        observed.costUsd += usd
      },
      observeTokens(t: { input: number; output: number }) {
        observed.tokensIn += t.input
        observed.tokensOut += t.output
      },
    },
  } as unknown as DispatchContext & { observed: typeof observed }
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
    expect(ctx.observed.tokensIn).toBe(20)
    expect(ctx.observed.costUsd).toBeCloseTo(0.04, 5)
  })
})
