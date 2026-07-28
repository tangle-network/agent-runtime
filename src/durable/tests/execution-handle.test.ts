import { describe, expect, it } from 'vitest'

import { deriveExecutionId } from '../execution-handle'

describe('deriveExecutionId', () => {
  it('is stable for the same identity tuple', () => {
    const input = { projectId: 'gtm-agent', sessionId: 'thread-1', turnIndex: 0 }
    expect(deriveExecutionId(input)).toBe('gtm-agent:thread-1:0')
    expect(deriveExecutionId(input)).toBe(deriveExecutionId(input))
  })

  it('differs across turnIndex', () => {
    expect(deriveExecutionId({ projectId: 'p', sessionId: 's', turnIndex: 0 })).not.toBe(
      deriveExecutionId({ projectId: 'p', sessionId: 's', turnIndex: 1 }),
    )
  })

  it('differs across projectId', () => {
    expect(deriveExecutionId({ projectId: 'a', sessionId: 's', turnIndex: 0 })).not.toBe(
      deriveExecutionId({ projectId: 'b', sessionId: 's', turnIndex: 0 }),
    )
  })

  it('differs across sessionId', () => {
    expect(deriveExecutionId({ projectId: 'p', sessionId: 's1', turnIndex: 0 })).not.toBe(
      deriveExecutionId({ projectId: 'p', sessionId: 's2', turnIndex: 0 }),
    )
  })

  it('encodes tuple components without separator collisions', () => {
    expect(deriveExecutionId({ projectId: 'a:b', sessionId: 'c', turnIndex: 0 })).toBe('a%3Ab:c:0')
    expect(deriveExecutionId({ projectId: 'a:b', sessionId: 'c', turnIndex: 0 })).not.toBe(
      deriveExecutionId({ projectId: 'a', sessionId: 'b:c', turnIndex: 0 }),
    )
  })

  it.each([
    [{ projectId: '', sessionId: 's', turnIndex: 0 }, 'projectId'],
    [{ projectId: 'p', sessionId: ' ', turnIndex: 0 }, 'sessionId'],
    [{ projectId: 'p', sessionId: 's', turnIndex: -1 }, 'turnIndex'],
    [{ projectId: 'p', sessionId: 's', turnIndex: 1.5 }, 'turnIndex'],
    [{ projectId: 'p', sessionId: 's', turnIndex: Number.MAX_SAFE_INTEGER + 1 }, 'turnIndex'],
  ])('rejects invalid identity input %o', (input, field) => {
    expect(() => deriveExecutionId(input)).toThrow(field)
  })

  it('rejects ids the replay route would truncate', () => {
    expect(() =>
      deriveExecutionId({ projectId: 'p', sessionId: 's'.repeat(253), turnIndex: 0 }),
    ).toThrow('must not exceed 256 bytes')
  })
})
