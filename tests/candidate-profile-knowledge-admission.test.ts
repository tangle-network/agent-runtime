import type { AgentCandidateProfile, AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  agentCandidateProfileAsAgentProfile,
  assertCandidateProfileBinding,
  assertCandidateProfileExecutionSupport,
  freezeGenericAgentCandidateProfile,
} from '../src/candidate-execution/profile'

describe('candidate profile knowledge admission', () => {
  for (const knowledge of [[], [{ sourceId: 'source', generation: `kg_${'a'.repeat(64)}` }]]) {
    for (const failOnError of [true, false]) {
      it(`refuses ${knowledge.length} knowledge pins with failOnError=${failOnError}`, () => {
        // Simulate a valid newer-peer field that the pinned development types do not yet expose.
        const profile = { resources: { knowledge, failOnError } }
        const generic = profile as unknown as AgentProfile
        const candidate = profile as unknown as AgentCandidateProfile
        const stripped = { resources: { failOnError: true } } as AgentCandidateProfile
        // Older peers reject at parsing; newer peers must reject at conversion, never drop pins.
        expect(() => freezeGenericAgentCandidateProfile(generic)).toThrow()
        expect(() => assertCandidateProfileBinding(generic, stripped)).toThrow()
        expect(() => agentCandidateProfileAsAgentProfile(candidate)).toThrow(/owner-authorized/)
        expect(() => assertCandidateProfileExecutionSupport(candidate)).toThrow(/owner-authorized/)
      })
    }
  }

  it('preserves supported resource conversion and binding', () => {
    const profile: AgentProfile = {
      resources: { failOnError: true, instructions: 'Synthetic supported instructions' },
    }
    const candidate = freezeGenericAgentCandidateProfile(profile)
    expect(agentCandidateProfileAsAgentProfile(candidate)).toEqual(profile)
    expect(() => assertCandidateProfileBinding(profile, candidate)).not.toThrow()
    expect(() => assertCandidateProfileExecutionSupport(candidate)).not.toThrow()
  })
})
