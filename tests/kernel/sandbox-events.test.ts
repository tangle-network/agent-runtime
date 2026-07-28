import type { SandboxEvent } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  extractLlmCallEvent,
  mapSandboxEvent,
  sumSandboxUsage,
} from '../../src/runtime/sandbox-events'

describe('sumSandboxUsage — meter an openSandboxRun turn', () => {
  it('sums tokens + cost across mixed backend event shapes, ignoring non-cost events', () => {
    const events: SandboxEvent[] = [
      { type: 'delta', data: { text: 'thinking' } } as SandboxEvent,
      { type: 'llm_call', data: { tokensIn: 100, tokensOut: 40, costUsd: 0.01 } } as SandboxEvent,
      {
        type: 'done',
        data: { tokenUsage: { inputTokens: 50, outputTokens: 20 }, totalCostUsd: 0.005 },
      } as SandboxEvent,
    ]
    expect(sumSandboxUsage(events)).toEqual({ input: 150, output: 60, costUsd: 0.015 })
  })

  it('returns zeros for a stream with no cost-bearing events (the honest stub signal)', () => {
    expect(sumSandboxUsage([{ type: 'delta', data: {} } as SandboxEvent])).toEqual({
      input: 0,
      output: 0,
      costUsd: 0,
    })
  })
})

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

  // Regression: sandbox 0.4.0's terminal `done` event carries usage under
  // `tokenUsage` (not `usage`) with cost top-level — without this the in-process
  // loopDispatch ledger read {0,0} and the backend-integrity guard misreported a
  // real sandboxed run as a stub.
  it('extracts cost+tokens from the sandbox 0.4.0 `done` event (reasoning folds into output)', () => {
    expect(
      extractLlmCallEvent(
        {
          type: 'done',
          data: {
            tokenUsage: {
              inputTokens: 17381,
              outputTokens: 1851,
              reasoningTokens: 2119,
              cacheReadInputTokens: 1792,
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
      tokensIn: 17381,
      tokensOut: 1851 + 2119,
      costUsd: 0.0042,
    })
  })

  it('returns undefined for a `done` event with no tokenUsage (no phantom cost)', () => {
    expect(extractLlmCallEvent({ type: 'done', data: { requestId: 'x' } }, 'agent')).toBeUndefined()
  })
})
