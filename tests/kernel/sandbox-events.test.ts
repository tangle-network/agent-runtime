import type { SandboxEvent } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  assertSandboxServedModel,
  extractLlmCallEvent,
  mapSandboxEvent,
  sandboxEventServedBackend,
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
      tokensKnown: false,
      usdKnown: false,
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
    ).toEqual({
      type: 'llm_call',
      model: 'r',
      tokensIn: 3,
      tokensOut: 4,
      usdKnown: false,
    })
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
    ).toEqual({
      type: 'llm_call',
      model: 'agent',
      tokensIn: 100,
      tokensOut: 20,
      usdKnown: false,
    })
  })

  it.each([
    {
      type: 'result',
      data: { usage: { inputTokens: 2, outputTokens: 3, reasoningTokens: 7 } },
    },
    {
      type: 'usage',
      data: { inputTokens: 2, outputTokens: 3, reasoningTokens: 7 },
    },
  ] as const)('folds separate reasoning tokens into output for $type events', (event) => {
    expect(extractLlmCallEvent(event, 'agent')).toEqual({
      type: 'llm_call',
      model: 'agent',
      tokensIn: 2,
      tokensOut: 10,
      usdKnown: false,
    })
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
      // The same record states what the provider served from cache. Without it the budget
      // charges a re-read prefix at the price of new work.
      promptCache: { readTokens: 1792 },
    })
  })

  it('returns undefined for a `done` event with no tokenUsage (no phantom cost)', () => {
    expect(extractLlmCallEvent({ type: 'done', data: { requestId: 'x' } }, 'agent')).toBeUndefined()
  })
})

describe('the event decoders stay pure so a failed run can still be read', () => {
  // A failed turn is exactly the turn whose events matter most: the analyst trace store
  // (`iterations-to-trace-store`), `sumSandboxUsage` inside a `receipt:` callback, and the chat
  // projection all walk stored events AFTER the run settled. If reading an error event threw,
  // every one of those readers would lose the failure it exists to report.
  const failedTurn: SandboxEvent[] = [
    { type: 'llm_call', data: { tokensIn: 100, tokensOut: 40, costUsd: 0.01 } } as SandboxEvent,
    {
      type: 'error',
      data: { success: false, error: { message: 'No API key found for anthropic' } },
    } as SandboxEvent,
    { type: 'done', data: { status: 'failed' } } as SandboxEvent,
  ]

  it('extractLlmCallEvent returns undefined for an error event instead of throwing', () => {
    expect(extractLlmCallEvent(failedTurn[1]!, 'agent')).toBeUndefined()
  })

  it('mapSandboxEvent returns undefined for an error event instead of throwing', () => {
    expect(mapSandboxEvent(failedTurn[1]!)).toBeUndefined()
  })

  it('sumSandboxUsage still meters the spend of a turn that ended in failure', () => {
    expect(sumSandboxUsage(failedTurn)).toEqual({ input: 100, output: 40, costUsd: 0.01 })
  })
})

describe('sandboxEventServedBackend — a request is not a receipt', () => {
  it('decodes the platform report', () => {
    expect(
      sandboxEventServedBackend({
        type: 'execution.started',
        data: {
          effectiveBackend: {
            provider: 'openai-compat',
            model: 'deepseek/deepseek-v4-flash',
            source: 'environment',
          },
        },
      } as SandboxEvent),
    ).toEqual({
      provider: 'openai-compat',
      model: 'deepseek/deepseek-v4-flash',
      source: 'environment',
    })
  })

  it('returns undefined when the platform reported no identity', () => {
    expect(
      sandboxEventServedBackend({ type: 'execution.started', data: {} } as SandboxEvent),
    ).toBeUndefined()
  })

  it('assertSandboxServedModel makes no claim when nothing was served', () => {
    expect(() =>
      assertSandboxServedModel({ type: 'done', data: {} } as SandboxEvent, {
        provider: 'zai-coding-plan',
        model: 'glm-5.2',
      }),
    ).not.toThrow()
  })

  it('assertSandboxServedModel makes no claim when nothing was requested', () => {
    // Nothing to compare against is not permission to accept: it is the caller's own unknown,
    // and this decoder must not convert one unknown into a verdict about the other.
    expect(() =>
      assertSandboxServedModel(
        {
          type: 'done',
          data: { effectiveBackend: { model: 'deepseek/deepseek-v4-flash' } },
        } as SandboxEvent,
        undefined,
      ),
    ).not.toThrow()
  })

  it('accepts a route-qualified spelling of the same leaf model', () => {
    // The platform may report the model bare, provider-qualified, or route-qualified, and it
    // reports the provider in its own field. A longer route to the SAME leaf is a routing
    // difference; failing on it would ground every run over a spelling.
    for (const model of ['glm-5.2', 'zai-coding-plan/glm-5.2', 'openai-compat/zai/glm-5.2']) {
      expect(() =>
        assertSandboxServedModel(
          { type: 'done', data: { effectiveBackend: { model } } } as SandboxEvent,
          { provider: 'zai-coding-plan', model: 'glm-5.2' },
        ),
      ).not.toThrow()
    }
  })

  it('refuses a different version of the same model family', () => {
    // Measured directly against the provider API: a request for glm-5.2 was served glm-5.3. A
    // version suffix is the whole difference between two instruments, never noise to absorb.
    expect(() =>
      assertSandboxServedModel(
        {
          type: 'done',
          data: { effectiveBackend: { model: 'zai-coding-plan/glm-5.3' } },
        } as SandboxEvent,
        { provider: 'zai-coding-plan', model: 'glm-5.2' },
      ),
    ).toThrow(/sandbox served model "zai-coding-plan\/glm-5.3"/)
  })

  it('assertSandboxServedModel refuses the measured substitution', () => {
    expect(() =>
      assertSandboxServedModel(
        {
          type: 'execution.started',
          data: {
            effectiveBackend: {
              provider: 'openai-compat',
              model: 'deepseek/deepseek-v4-flash',
              source: 'environment',
            },
          },
        } as SandboxEvent,
        { provider: 'zai-coding-plan', model: 'glm-5.2' },
      ),
    ).toThrow(/sandbox served model "deepseek\/deepseek-v4-flash"/)
  })
})
