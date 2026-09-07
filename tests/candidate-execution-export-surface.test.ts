import { describe, expect, it } from 'vitest'
import {
  freezeGenericAgentCandidateProfile as fromCandidateExecution,
  omitUndefinedObjectFields as omitFromCandidateExecution,
  parseExactCandidateProfile as parseFromCandidateExecution,
  runProtectedAgentCandidateModelGrant as runFromCandidateExecution,
} from '../src/candidate-execution'

describe('candidate profile conversion public surface', () => {
  it('exports the canonical conversion and exact parser from its public barrel', () => {
    expect(runFromCandidateExecution).toBeTypeOf('function')
    const candidate = fromCandidateExecution({
      name: 'public-seed',
      prompt: { systemPrompt: 'Lead the pursuit.' },
    })
    expect(parseFromCandidateExecution(candidate)).toEqual(candidate)
    expect(omitFromCandidateExecution({ keep: 1, drop: undefined }, 'profile')).toEqual({ keep: 1 })
  })
})
