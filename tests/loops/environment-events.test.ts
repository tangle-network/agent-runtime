import type { AgentEnvironmentEvent } from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import {
  extractEnvironmentTurnText,
  extractLlmCallEvent,
  mapAgentEnvironmentEvent,
  sumEnvironmentUsage,
} from '../../src/runtime/environment-events'

describe('extractEnvironmentTurnText', () => {
  it('prefers terminal text over streamed deltas', () => {
    expect(
      extractEnvironmentTurnText([
        { type: 'message.part.updated', data: { part: { type: 'text' }, delta: 'partial' } },
        { type: 'result', data: { finalText: 'complete answer' } },
      ]),
    ).toBe('complete answer')
  })

  it('reads nested provider results and rejects empty output', () => {
    expect(
      extractEnvironmentTurnText([{ type: 'result', data: { result: { text: 'nested' } } }]),
    ).toBe('nested')
    expect(() => extractEnvironmentTurnText([{ type: 'result', data: {} }])).toThrow(
      'completed without text',
    )
  })
})

describe('sumEnvironmentUsage', () => {
  it('sums tokens and cost across mixed provider event shapes', () => {
    const events: AgentEnvironmentEvent[] = [
      { type: 'delta', data: { text: 'thinking' } },
      { type: 'llm_call', data: { tokensIn: 100, tokensOut: 40, costUsd: 0.01 } },
      {
        type: 'done',
        data: {
          tokenUsage: { inputTokens: 50, outputTokens: 20 },
          totalCostUsd: 0.005,
        },
      },
    ]

    expect(sumEnvironmentUsage(events)).toEqual({
      input: 150,
      output: 60,
      costUsd: 0.015,
    })
  })

  it('returns zeros for a stream without cost-bearing events', () => {
    expect(sumEnvironmentUsage([{ type: 'delta', data: {} }])).toEqual({
      input: 0,
      output: 0,
      costUsd: 0,
    })
  })
})

describe('mapAgentEnvironmentEvent', () => {
  it('maps the official CLI Bridge delta shape without a part type', () => {
    expect(
      mapAgentEnvironmentEvent({
        type: 'message.part.updated',
        data: { delta: 'hello' },
      }),
    ).toEqual({ type: 'text_delta', text: 'hello' })
  })

  it('maps a text part to text_delta, preferring the incremental delta', () => {
    expect(
      mapAgentEnvironmentEvent({
        type: 'message.part.updated',
        data: {
          part: { type: 'text', text: 'hello world' },
          delta: ' world',
        },
      }),
    ).toEqual({ type: 'text_delta', text: ' world' })
  })

  it('falls back to part.text when no delta is present', () => {
    expect(
      mapAgentEnvironmentEvent({
        type: 'message.part.updated',
        data: { part: { type: 'text', text: 'hi' } },
      }),
    ).toEqual({ type: 'text_delta', text: 'hi' })
  })

  it('maps reasoning and thinking parts to reasoning_delta', () => {
    expect(
      mapAgentEnvironmentEvent({
        type: 'message.part.updated',
        data: { part: { type: 'reasoning' }, delta: 'because' },
      }),
    ).toEqual({ type: 'reasoning_delta', text: 'because' })
    expect(
      mapAgentEnvironmentEvent({
        type: 'message.part.updated',
        data: { part: { type: 'thinking' }, delta: 'hmm' },
      }),
    ).toEqual({ type: 'reasoning_delta', text: 'hmm' })
  })

  it('returns undefined for an unknown part type', () => {
    expect(
      mapAgentEnvironmentEvent({
        type: 'message.part.updated',
        data: { part: { type: 'tool', toolName: 'x' } },
      }),
    ).toBeUndefined()
  })

  it('returns undefined for a text part without text', () => {
    expect(
      mapAgentEnvironmentEvent({
        type: 'message.part.updated',
        data: { part: { type: 'text' } },
      }),
    ).toBeUndefined()
  })

  it('maps cost-bearing events to llm_call', () => {
    expect(
      mapAgentEnvironmentEvent({
        type: 'llm_call',
        data: {
          model: 'm',
          tokensIn: 10,
          tokensOut: 5,
          costUsd: 0.01,
        },
      }),
    ).toEqual({
      type: 'llm_call',
      model: 'm',
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.01,
    })
  })

  it('maps a result with usage and ignores a bare result', () => {
    expect(
      mapAgentEnvironmentEvent(
        {
          type: 'result',
          data: { usage: { inputTokens: 3, outputTokens: 4 } },
        },
        { agentRunName: 'researcher' },
      ),
    ).toEqual({
      type: 'llm_call',
      model: 'researcher',
      tokensIn: 3,
      tokensOut: 4,
    })
    expect(
      mapAgentEnvironmentEvent({
        type: 'result',
        data: { finalText: 'done' },
      }),
    ).toBeUndefined()
  })

  it('returns undefined for a non-object event', () => {
    expect(mapAgentEnvironmentEvent(undefined as unknown as AgentEnvironmentEvent)).toBeUndefined()
  })
})

describe('extractLlmCallEvent numeric handling', () => {
  it('rejects a NaN token count', () => {
    expect(
      extractLlmCallEvent(
        {
          type: 'llm_call',
          data: { model: 'm', tokensIn: Number.NaN },
        },
        'agent',
      ),
    ).toBeUndefined()
  })

  it('coerces OpenAI-style usage keys', () => {
    expect(
      extractLlmCallEvent(
        {
          type: 'usage',
          data: { prompt_tokens: 100, completion_tokens: 20 },
        },
        'agent',
      ),
    ).toEqual({
      type: 'llm_call',
      model: 'agent',
      tokensIn: 100,
      tokensOut: 20,
    })
  })

  it('extracts tokens and cost from a done event', () => {
    expect(
      extractLlmCallEvent(
        {
          type: 'done',
          data: {
            tokenUsage: {
              inputTokens: 17_381,
              outputTokens: 1_851,
              reasoningTokens: 2_119,
              cacheReadInputTokens: 1_792,
            },
            totalCostUsd: 0.0042,
            model: 'deepseek-v4-pro',
          },
        },
        'agent',
      ),
    ).toEqual({
      type: 'llm_call',
      model: 'deepseek-v4-pro',
      tokensIn: 17_381,
      tokensOut: 1_851 + 2_119,
      costUsd: 0.0042,
    })
  })

  it('returns undefined for a done event without token usage', () => {
    expect(
      extractLlmCallEvent(
        {
          type: 'done',
          data: { requestId: 'x' },
        },
        'agent',
      ),
    ).toBeUndefined()
  })
})
