import { type AgentProfile, defineInlineResource } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'

import {
  agentImprovementProfileSurfaceDigest,
  prepareAgentImprovementProfileActivation,
} from '../src/intelligence'

const base: AgentProfile = {
  name: 'support',
  prompt: { systemPrompt: 'Old prompt' },
  tools: { Bash: true },
  resources: {
    skills: [defineInlineResource('old.SKILL.md', 'Old skill')],
  },
}

function target(surface: 'prompt' | 'skills', desiredInput: unknown, desiredProfile: AgentProfile) {
  return {
    surface,
    identity: 'profile-1',
    expectedBaseDigest: agentImprovementProfileSurfaceDigest(base, surface),
    desiredDigest: agentImprovementProfileSurfaceDigest(desiredProfile, surface),
    desiredInput,
  }
}

describe('prepareAgentImprovementProfileActivation', () => {
  it('prepares exact multi-surface replacements while preserving unrelated fields', () => {
    const desired: AgentProfile = {
      ...base,
      prompt: { systemPrompt: 'Measured prompt' },
      resources: {
        ...base.resources,
        skills: [defineInlineResource('measured.SKILL.md', 'Measured skill')],
      },
    }
    const prepared = prepareAgentImprovementProfileActivation({
      currentByIdentity: new Map([['profile-1', base]]),
      targets: [
        target('prompt', { prompt: desired.prompt }, desired),
        target('skills', desired.resources?.skills, desired),
      ],
    })

    expect(prepared.status).toBe('apply')
    if (prepared.status !== 'apply') throw new Error('expected apply')
    expect(prepared.replacements).toEqual([{ identity: 'profile-1', profile: desired }])
    expect(prepared.targets).toHaveLength(2)
    expect(Object.isFrozen(prepared)).toBe(true)
    expect(Object.isFrozen(prepared.replacements)).toBe(true)
    expect(Object.isFrozen(prepared.replacements[0]?.profile)).toBe(true)
    expect(JSON.parse(JSON.stringify(prepared))).toEqual(prepared)
  })

  it('distinguishes missing, already applied, and conflicting profiles', () => {
    const desired: AgentProfile = { ...base, prompt: { systemPrompt: 'Measured prompt' } }
    const activationTarget = target('prompt', { prompt: desired.prompt }, desired)
    const missing = prepareAgentImprovementProfileActivation({
      currentByIdentity: new Map(),
      targets: [activationTarget],
    })
    expect(missing).toEqual({ status: 'missing', identities: ['profile-1'] })

    const applied = prepareAgentImprovementProfileActivation({
      currentByIdentity: new Map([['profile-1', desired]]),
      targets: [activationTarget],
    })
    expect(applied.status).toBe('already-applied')

    const conflict = prepareAgentImprovementProfileActivation({
      currentByIdentity: new Map([
        ['profile-1', { ...base, prompt: { systemPrompt: 'Changed elsewhere' } }],
      ]),
      targets: [activationTarget],
    })
    expect(conflict.status).toBe('conflict')
  })

  it('rejects duplicate identity and surface pairs', () => {
    const desired: AgentProfile = { ...base, prompt: { systemPrompt: 'Measured prompt' } }
    const activationTarget = target('prompt', { prompt: desired.prompt }, desired)
    expect(() =>
      prepareAgentImprovementProfileActivation({
        currentByIdentity: new Map([['profile-1', base]]),
        targets: [activationTarget, activationTarget],
      }),
    ).toThrow('agent profile activation repeats a target')
  })

  it('represents removal as an absent canonical field', () => {
    const desired: AgentProfile = { name: base.name, tools: base.tools, resources: base.resources }
    const prepared = prepareAgentImprovementProfileActivation({
      currentByIdentity: new Map([['profile-1', base]]),
      targets: [target('prompt', { prompt: null }, desired)],
    })

    expect(prepared.status).toBe('apply')
    if (prepared.status !== 'apply') throw new Error('expected apply')
    const profile = prepared.replacements[0].profile
    expect(Object.hasOwn(profile, 'prompt')).toBe(false)
    expect(Object.isFrozen(profile)).toBe(true)
    expect(JSON.parse(JSON.stringify(profile))).toEqual(profile)
  })
})
