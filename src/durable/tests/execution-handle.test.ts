import { describe, expect, it } from 'vitest'

import { deriveExecutionId } from '../execution-handle'

describe('deriveExecutionId', () => {
  it('is stable for the same identity tuple', () => {
    expect(deriveExecutionId({ projectId: 'gtm-agent', sessionId: 'thread-1', turnIndex: 0 })).toBe(
      deriveExecutionId({ projectId: 'gtm-agent', sessionId: 'thread-1', turnIndex: 0 }),
    )
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
})
