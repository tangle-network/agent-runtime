import { describe, expect, it } from 'vitest'
import { enforceTokenLimits, profileModelExecutionSettings } from './model-policy'

const model = { provider: 'tangle-router', default: 'glm-5.2' } as const

describe('separate completion ceilings', () => {
  it('reads the three ceilings from the exact profile and refuses the retired metadata path', () => {
    const settings = profileModelExecutionSettings(
      { model: { ...model, maxVisibleOutputTokens: 8, maxTotalOutputTokens: 256 } },
      'test',
    )
    expect(settings.tokenLimits).toEqual({ visible: 8, total: 256 })

    expect(() =>
      profileModelExecutionSettings({ model: { ...model, metadata: { maxTokens: 8 } } }, 'test'),
    ).toThrow(/maxVisibleOutputTokens, maxReasoningTokens, or maxTotalOutputTokens/)
  })

  it('refuses a single ceiling above the total instead of silently clamping it', () => {
    expect(() =>
      profileModelExecutionSettings(
        { model: { ...model, maxVisibleOutputTokens: 512, maxTotalOutputTokens: 256 } },
        'test',
      ),
    ).toThrow(/maxVisibleOutputTokens \(512\) exceeds maxTotalOutputTokens \(256\)/)
  })

  it('maps visible to max_tokens and total to max_completion_tokens on an OpenAI-compatible route', () => {
    // Measured 2026-08-10: glm-5.2 accepted max_tokens 8 and still billed 135 completion tokens
    // (132 reasoning, 3 visible); max_completion_tokens is what bounds the billed total.
    const decision = enforceTokenLimits({ visible: 8, total: 256 }, 'router', 'test')
    expect(decision).toEqual({
      requested: { visible: 8, total: 256 },
      applied: { maxTokens: 8, maxCompletionTokens: 256 },
    })
  })

  it('carries only the total on the bridge and refuses a visible-only ceiling there', () => {
    expect(enforceTokenLimits({ total: 1_000 }, 'bridge', 'test').applied).toEqual({
      maxTokens: 1_000,
    })
    expect(() => enforceTokenLimits({ visible: 100 }, 'bridge', 'test')).toThrow(
      /maxVisibleOutputTokens cannot be enforced on the bridge path/,
    )
  })

  it('refuses every ceiling on paths whose backend accepts none', () => {
    for (const path of ['sandbox', 'provider'] as const) {
      expect(() => enforceTokenLimits({ total: 100 }, path, 'test')).toThrow(
        /maxTotalOutputTokens cannot be enforced/,
      )
      expect(() => enforceTokenLimits({ visible: 100 }, path, 'test')).toThrow(
        /maxVisibleOutputTokens cannot be enforced/,
      )
      expect(enforceTokenLimits({}, path, 'test')).toEqual({ requested: {}, applied: {} })
    }
  })

  it('refuses a reasoning ceiling on every path, because no route publishes that budget', () => {
    for (const path of ['router', 'bridge', 'sandbox', 'provider'] as const) {
      expect(() => enforceTokenLimits({ reasoning: 64 }, path, 'test')).toThrow(
        /maxReasoningTokens cannot be enforced/,
      )
    }
  })
})
