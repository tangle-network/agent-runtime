import { describe, expect, it } from 'vitest'
import {
  freezeGenericAgentCandidateProfile as fromCandidateExecution,
  omitUndefinedObjectFields as omitFromCandidateExecution,
  parseExactCandidateProfile as parseFromCandidateExecution,
} from '../src/candidate-execution'
import {
  freezeGenericAgentCandidateProfile as fromRoot,
  omitUndefinedObjectFields as omitFromRoot,
  parseExactCandidateProfile as parseFromRoot,
} from '../src/index'

describe('candidate profile conversion public surface', () => {
  it('exports the canonical conversion and exact parser from both public barrels', () => {
    expect(fromRoot).toBe(fromCandidateExecution)
    expect(parseFromRoot).toBe(parseFromCandidateExecution)
    expect(omitFromRoot).toBe(omitFromCandidateExecution)

    const candidate = fromRoot({
      name: 'public-seed',
      prompt: { systemPrompt: 'Lead the pursuit.' },
    })
    expect(parseFromRoot(candidate)).toEqual(candidate)
    expect(omitFromRoot({ keep: 1, drop: undefined }, 'profile')).toEqual({ keep: 1 })
  })
})
