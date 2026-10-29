import type { AgentCandidateProfile, AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  agentCandidateProfileAsAgentProfile,
  assertCandidateProfileBinding,
  assertCandidateProfileExecutionSupport,
  freezeGenericAgentCandidateProfile,
} from '../src/candidate-execution/profile'
import { ValidationError } from '../src/errors'

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

describe('candidate profile fields Sandbox cannot carry', () => {
  // Interface 5.3 admits these; the pinned development types do not expose them yet.
  // The packed consumer repeats this under the Interface the registry serves.
  const secretRef = { kind: 'secret-ref', key: 'example' }
  const cases = [
    {
      field: 'mcp.search.env.SEARCH_REGION (secret-ref)',
      profile: { mcp: { search: { command: 'search-mcp', env: { SEARCH_REGION: secretRef } } } },
    },
    {
      field: 'mcp.search.args[1] (secret-ref)',
      profile: {
        mcp: {
          search: {
            command: 'search-mcp',
            args: [{ kind: 'public', value: '--region' }, secretRef],
          },
        },
      },
    },
    {
      field: 'hooks.PreToolUse[0].args[0] (secret-ref)',
      profile: { hooks: { PreToolUse: [{ executable: 'audit', args: [secretRef] }] } },
    },
  ]
  for (const { field, profile } of cases) {
    it(`refuses ${field} by name instead of dropping it`, () => {
      const refusal = (convert: () => unknown) => {
        let thrown: unknown
        try {
          convert()
        } catch (error) {
          thrown = error
        }
        expect(thrown).toBeInstanceOf(ValidationError)
        expect((thrown as Error).message).toBe(
          `candidate profile field ${field} is refused: Sandbox's Interface 4.0.0 cannot carry it yet, and Runtime does not drop it`,
        )
      }
      const candidate = profile as unknown as AgentCandidateProfile
      // Generic hooks are commands, not executable/args, so only candidate profiles carry hook args.
      if (!field.startsWith('hooks.')) {
        const generic = profile as unknown as AgentProfile
        refusal(() => freezeGenericAgentCandidateProfile(generic))
        refusal(() => assertCandidateProfileBinding(generic, {} as AgentCandidateProfile))
      }
      refusal(() => agentCandidateProfileAsAgentProfile(candidate))
      refusal(() => assertCandidateProfileExecutionSupport(candidate))
    })
  }
})
