import { describe, expect, it } from 'vitest'

import { deriveExecutionId } from '../execution-handle'

describe('deriveExecutionId', () => {
  it('is stable for the same identity tuple — a client retry of the same turn lands on the same substrate execution', () => {
    const a = deriveExecutionId({ projectId: 'gtm-agent', sessionId: 'thread-1', turnIndex: 0 })
    const b = deriveExecutionId({ projectId: 'gtm-agent', sessionId: 'thread-1', turnIndex: 0 })
    expect(a).toBe(b)
  })

  it('differs across turnIndex — turn N+1 cannot collide with turn N', () => {
    expect(deriveExecutionId({ projectId: 'p', sessionId: 's', turnIndex: 0 })).not.toBe(
      deriveExecutionId({ projectId: 'p', sessionId: 's', turnIndex: 1 }),
    )
  })

  it('differs across projectId — two products sharing a sessionId do not collide', () => {
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
