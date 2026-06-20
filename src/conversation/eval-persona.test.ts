import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { createIterableBackend } from '../backends'
import type { AgentExecutionBackend, RuntimeStreamEvent } from '../types'
import { evalPersona } from './eval-persona'

/** A fake worker: records the system prompt it saw, answers each turn, and reports usage. */
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

const workerProfile: AgentProfile = { prompt: { systemPrompt: 'WORKER-SYSTEM-PROMPT' } }

describe('evalPersona — the one-call user-sim facade', () => {
  it('runs a scripted persona offline, defaulting systemPromptOf to the profile prompt', async () => {
    const saw = { calls: 0 } as { prompt?: string; calls: number }
    const result = await evalPersona(
      workerProfile,
      { kind: 'scripted', turns: ['intake question', 'follow-up'] },
      { backendFor: () => fakeWorker(saw) },
    )
    const agentTurns = result.transcript.filter((t) => t.speaker === 'agent')
    expect(agentTurns).toHaveLength(2)
    // The default systemPromptOf pulled prompt.systemPrompt off the profile.
    expect(saw.prompt).toBe('WORKER-SYSTEM-PROMPT')
    // Worker-only metering flows through.
    expect(result.tokensIn).toBe(20)
    expect(result.costUsd).toBeCloseTo(0.04, 5)
  })

  it('passes haltOn through as the until-satisfied early stop', async () => {
    const saw = { calls: 0 } as { prompt?: string; calls: number }
    const result = await evalPersona(
      workerProfile,
      { kind: 'scripted', turns: ['q1', 'q2', 'q3'] },
      {
        backendFor: () => fakeWorker(saw),
        // Stop after the worker's first answer — before the scripted turns are exhausted.
        haltOn: (ctx) => ctx.lastTurn.speaker === 'agent',
      },
    )
    expect(result.halted.kind).toBe('predicate')
    expect(saw.calls).toBe(1)
  })

  it('fails loud when neither default creds nor a backendFor override is given', () => {
    expect(() => evalPersona(workerProfile, { kind: 'scripted', turns: ['hi'] }, {})).toThrow(
      /apiKey,baseUrl,model.*backendFor/,
    )
  })
})
