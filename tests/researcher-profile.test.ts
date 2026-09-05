import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { multiHarnessResearcherFanout, researcherProfile } from '../src/profiles/researcher'

const executionProfile: AgentProfile = {
  name: 'researcher-exact',
  harness: 'opencode',
  model: { provider: 'zai', default: 'glm-5.1' },
  tools: { shell: false },
}

describe('researcher profile execution authority', () => {
  it('adds researcher content while preserving the caller-owned execution identity', () => {
    const { profile, agentRunSpec } = researcherProfile({ profile: executionProfile })

    expect(profile).toMatchObject({
      name: 'researcher-exact',
      harness: 'opencode',
      model: { provider: 'zai', default: 'glm-5.1' },
      metadata: { specialty: 'researcher' },
      tools: { web_search: true, fs: true, shell: false },
    })
    expect(profile.prompt?.systemPrompt).toContain('source-grounded knowledge items')
    expect(agentRunSpec.profile).toBe(profile)
  })

  it('refuses an incomplete execution profile before returning a run spec', () => {
    expect(() => researcherProfile({ profile: { name: 'incomplete' } })).toThrow(
      /harness must be explicit/,
    )
  })

  it('requires exact profiles for every fanout arm', () => {
    expect(() => multiHarnessResearcherFanout({ profiles: [] })).toThrow(
      /at least one exact profile/,
    )

    const second: AgentProfile = {
      name: 'researcher-second',
      harness: 'codex',
      model: { provider: 'openai', default: 'gpt-5.2-codex' },
    }
    const fanout = multiHarnessResearcherFanout({ profiles: [executionProfile, second] })
    expect(fanout.agentRuns.map((run) => run.profile.harness)).toEqual(['opencode', 'codex'])
    expect(fanout.agentRuns.map((run) => run.profile.model?.default)).toEqual([
      'glm-5.1',
      'gpt-5.2-codex',
    ])
  })
})
