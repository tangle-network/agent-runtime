import { describe, expect, it } from 'vitest'

import { candidateMaterializerHarness } from '../src/candidate-execution/profile'

describe('candidate profile materialization', () => {
  it('accepts only harnesses supported by the profile materializer', () => {
    expect(candidateMaterializerHarness('claude-code')).toBe('claude-code')
    expect(() => candidateMaterializerHarness('amp')).toThrow(/unsupported for harness amp/)
  })
})
