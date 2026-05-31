import type { SandboxEvent } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { extractLlmCallEvent, mapSandboxEvent } from '../../src/loops/sandbox-events'

describe('mapSandboxEvent — SandboxEvent → RuntimeStreamEvent', () => {
  it('maps a text part to text_delta, preferring the incremental delta', () => {
    expect(
      mapSandboxEvent({
        type: 'message.part.updated',
        data: { part: { type: 'text', text: 'hello world' }, delta: ' world' },
      }),
    ).toEqual({ type: 'text_delta', text: ' world' })
  })

  it('falls back to part.text when no delta is present', () => {
    expect(
      mapSandboxEvent({
        type: 'message.part.updated',
        data: { part: { type: 'text', text: 'hi' } },
      }),
    ).toEqual({ type: 'text_delta', text: 'hi' })
  })

  it('maps reasoning and thinking parts to reasoning_delta', () => {
    expect(
      mapSandboxEvent({
        type: 'message.part.updated',
        data: { part: { type: 'reasoning' }, delta: 'because' },
      }),
    ).toEqual({ type: 'reasoning_delta', text: 'because' })
    expect(
      mapSandboxEvent({
        type: 'message.part.updated',
        data: { part: { type: 'thinking' }, delta: 'hmm' },
      }),
    ).toEqual({ type: 'reasoning_delta', text: 'hmm' })
  })

  it('returns undefined for an unknown part type rather than guessing a shape', () => {
    expect(
      mapSandboxEvent({
        type: 'message.part.updated',
        data: { part: { type: 'tool', toolName: 'x' } },
      }),
    ).toBeUndefined()
  })

  it('returns undefined for a text part with no text payload', () => {
    expect(
      mapSandboxEvent({ type: 'message.part.updated', data: { part: { type: 'text' } } }),
    ).toBeUndefined()
  })

  it('maps cost-bearing events to llm_call', () => {
    expect(
      mapSandboxEvent({
        type: 'llm_call',
        data: { model: 'm', tokensIn: 10, tokensOut: 5, costUsd: 0.01 },
      }),
    ).toEqual({ type: 'llm_call', model: 'm', tokensIn: 10, tokensOut: 5, costUsd: 0.01 })
  })

  it('maps a result carrying usage to llm_call, and a bare result to undefined', () => {
    expect(
      mapSandboxEvent(
        { type: 'result', data: { usage: { inputTokens: 3, outputTokens: 4 } } },
        { agentRunName: 'r' },
      ),
    ).toEqual({ type: 'llm_call', model: 'r', tokensIn: 3, tokensOut: 4 })
    expect(mapSandboxEvent({ type: 'result', data: { finalText: 'done' } })).toBeUndefined()
  })

  it('returns undefined for a non-object event', () => {
    expect(mapSandboxEvent(undefined as unknown as SandboxEvent)).toBeUndefined()
  })
})

describe('extractLlmCallEvent — strict numeric coercion', () => {
  it('rejects a NaN token count rather than poisoning the ledger', () => {
    expect(
      extractLlmCallEvent(
        { type: 'llm_call', data: { model: 'm', tokensIn: Number.NaN } },
        'agent',
      ),
    ).toBeUndefined()
  })

  it('coerces openai-style usage keys', () => {
    expect(
      extractLlmCallEvent(
        { type: 'usage', data: { prompt_tokens: 100, completion_tokens: 20 } },
        'agent',
      ),
    ).toEqual({ type: 'llm_call', model: 'agent', tokensIn: 100, tokensOut: 20 })
  })
})
