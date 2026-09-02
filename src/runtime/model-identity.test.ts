import { describe, expect, it } from 'vitest'
import {
  canonicalObservedModel,
  mergeObservedModelIdentity,
  observedModelHasSnapshot,
  observedModelMatchesDeclared,
} from './model-identity'

describe('served model identity', () => {
  it.each([
    ['deepseek-v4-flash', 'deepseek/deepseek-v4-flash@fp_a', true],
    ['tangle-router/deepseek-v4-flash', 'deepseek/deepseek-v4-flash@fp_a', true],
    ['gpt-5.2', 'gpt-5.2-2025-12-11', true],
    ['gpt-5.2', 'gpt-5.2-20251211', true],
    ['jamba-large-1.7', 'ai21/jamba-large-1.7-2025-07', true],
    ['gpt-5.2', 'openai/gpt-5.2-2025-12-11', true],
    ['gpt-5.2@2025-12-11', 'gpt-5.2@2025-12-11', true],
    ['gpt-5.2@2025-12-11', 'gpt-5.2-2025-12-11', false],
    ['tangle-router/gpt-5.2', 'anthropic/gpt-5.2-2025-12-11', true],
    ['openai/gpt-5.2', 'anthropic/gpt-5.2-2025-12-11', false],
    ['gpt-5.2@2025-12-11', 'gpt-5.2-2025-12-12', false],
    ['gpt-5.2', 'gpt-5.2-mini-2025-12-11', false],
    ['gpt-5.2', 'gpt-5.2-2025-13-11', false],
    ['gpt-5.2-2025-13-11', 'gpt-5.2-2025-13-11', false],
    ['gpt-5.2', 'gpt-5.2-2025-02-29', false],
    ['gpt-5.2', 'gpt-5.2-2025-13', false],
    ['gpt-5.2', 'gpt-5.2-1999-12-01', false],
    ['tangle-router/deepseek-v4-flash', 'deepseek/other-model@fp_a', false],
    ['tangle-router/deepseek-v4-flash@fp_a', 'deepseek/deepseek-v4-flash@fp_b', false],
    ['tangle-router/deepseek-v4-flash@fp_a', 'deepseek/deepseek-v4-flash', false],
    ['tangle-router/deepseek-v4-flash', 'deepseek/deepseek-v4-flash@', false],
    ['tangle-router/', 'deepseek/', false],
    ['tangle-router/deepseek-v4-flash', 'deepseek/@fp_a', false],
  ])('matches declared %s against observed %s as %s', (declared, observed, expected) => {
    expect(observedModelMatchesDeclared(observed, declared)).toBe(expected)
  })

  it('retains the provider-qualified snapshot when stream observations gain detail', () => {
    expect(
      mergeObservedModelIdentity(
        'deepseek-v4-flash',
        'deepseek/deepseek-v4-flash@fp_a18b46594c_prod0820_fp8_kvcache_20260402',
      ),
    ).toBe('deepseek/deepseek-v4-flash@fp_a18b46594c_prod0820_fp8_kvcache_20260402')
  })

  it('retains a provider date snapshot when stream observations gain detail', () => {
    expect(mergeObservedModelIdentity('gpt-5.2', 'openai/gpt-5.2-2025-12-11')).toBe(
      'openai/gpt-5.2-2025-12-11',
    )
  })

  it('merges compact and ISO spellings of the same dated snapshot', () => {
    expect(mergeObservedModelIdentity('gpt-5.2-2025-12-11', 'gpt-5.2-20251211')).toBe(
      'gpt-5.2-2025-12-11',
    )
  })

  it.each([
    ['deepseek-v4-flash', false],
    ['pi/tangle-router/deepseek-v4-flash', false],
    ['deepseek/deepseek-v4-flash@fp_a', true],
    ['gpt-5.2-2025-12-11', true],
    ['gpt-5.2-20251211', true],
    ['jamba-large-1.7-2025-07', true],
    ['gpt-5.2-2025-13-11', false],
    ['gpt-5.2-2025-02-29', false],
    ['gpt-5.2-2025-13', false],
    ['deepseek/deepseek-v4-flash@', false],
  ])('identifies snapshot-bearing observations in %s as %s', (model, expected) => {
    expect(observedModelHasSnapshot(model)).toBe(expected)
  })

  it.each([
    ['deepseek/deepseek-v4-flash@fp_a', 'deepseek/deepseek-v4-flash@fp_b'],
    ['deepseek/deepseek-v4-flash@fp_a', 'deepseek/other-model@fp_a'],
    ['deepseek/deepseek-v4-flash@fp_a', 'deepseek/deepseek-v4-flash@'],
    ['gpt-5.2@2025-12-11', 'gpt-5.2-2025-12-11'],
  ])('refuses conflicting stream identities %s and %s', (current, next) => {
    expect(mergeObservedModelIdentity(current, next)).toBeUndefined()
  })

  it('canonicalizes a provider date snapshot without retaining its provider prefix', () => {
    expect(canonicalObservedModel('openai/gpt-5.2-2025-12-11')).toBe('gpt-5.2-2025-12-11')
    expect(canonicalObservedModel('openai/gpt-5.2-20251211')).toBe('gpt-5.2-2025-12-11')
    expect(canonicalObservedModel('ai21/jamba-large-1.7-2025-07')).toBe('jamba-large-1.7-2025-07')
  })
})
