import { describe, expect, it } from 'vitest'

import { redactProtectedValue } from '../src/candidate-execution/protected-redaction'

describe('candidate protected-value redaction', () => {
  it('redacts overlapping credentials longest-first without retaining a suffix', () => {
    const redacted = redactProtectedValue({ short: 'secret123', long: 'secret123456' }, [
      'secret123',
      'secret123456',
    ])
    expect(redacted.value).toEqual({
      short: '[redacted:candidate-access]',
      long: '[redacted:candidate-access]',
    })
  })
})
