import { describe, expect, it } from 'vitest'
import {
  mergeObservedModelIdentity,
  observedModelHasSnapshot,
  observedModelMatchesDeclared,
} from './model-identity'

describe('served model identity', () => {
  it.each([
    ['deepseek-v4-flash', 'deepseek/deepseek-v4-flash@fp_a', true],
    ['tangle-router/deepseek-v4-flash', 'deepseek/deepseek-v4-flash@fp_a', true],
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

  it.each([
    ['deepseek-v4-flash', false],
    ['pi/tangle-router/deepseek-v4-flash', false],
    ['deepseek/deepseek-v4-flash@fp_a', true],
    ['deepseek/deepseek-v4-flash@', false],
  ])('identifies snapshot-bearing observations in %s as %s', (model, expected) => {
    expect(observedModelHasSnapshot(model)).toBe(expected)
  })

  it.each([
    ['deepseek/deepseek-v4-flash@fp_a', 'deepseek/deepseek-v4-flash@fp_b'],
    ['deepseek/deepseek-v4-flash@fp_a', 'deepseek/other-model@fp_a'],
    ['deepseek/deepseek-v4-flash@fp_a', 'deepseek/deepseek-v4-flash@'],
  ])('refuses conflicting stream identities %s and %s', (current, next) => {
    expect(mergeObservedModelIdentity(current, next)).toBeUndefined()
  })
})
