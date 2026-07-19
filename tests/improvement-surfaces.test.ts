import {
  type AgentProfile,
  applyAgentProfileDiff,
  defineInlineResource,
} from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'

import { agentCandidateProfileAsAgentProfile } from '../src/candidate-execution/profile'
import {
  AGENT_IMPROVEMENT_PROFILE_SURFACES,
  agentImprovementTargetInput,
  agentImprovementTargetProfileDiffs,
  isAgentImprovementProfileSurface,
} from '../src/intelligence/improvement-surfaces'
import { candidateBundle } from './helpers/candidate-execution-fixture'

describe('agent improvement profile delivery', () => {
  it('replaces prompt and skill arrays exactly while preserving unrelated fields', () => {
    const prompt = agentImprovementTargetProfileDiffs(
      {
        surface: 'prompt',
        desiredInput: {
          prompt: {
            systemPrompt: 'Measured prompt',
            instructions: ['Return citations'],
          },
        },
      },
      { id: 'activation' },
    )
    const skills = agentImprovementTargetProfileDiffs(
      {
        surface: 'skills',
        desiredInput: [defineInlineResource('measured.SKILL.md', 'Measured skill')],
      },
      { id: 'activation' },
    )
    const base: AgentProfile = {
      name: 'support-agent',
      prompt: { systemPrompt: 'Old prompt', instructions: ['Old instruction'] },
      tools: { Bash: true },
      resources: {
        skills: [defineInlineResource('old.SKILL.md', 'Old skill')],
        tools: [defineInlineResource('bash.tool.md', 'Use Bash')],
      },
    }
    const applied = [...prompt, ...skills].reduce(
      (profile, diff) => applyAgentProfileDiff(profile, diff),
      base,
    )

    expect(applied.prompt).toEqual({
      systemPrompt: 'Measured prompt',
      instructions: ['Return citations'],
    })
    expect(applied.resources?.skills).toEqual([
      defineInlineResource('measured.SKILL.md', 'Measured skill'),
    ])
    expect(applied.tools).toEqual({ Bash: true })
    expect(applied.resources?.tools).toEqual([defineInlineResource('bash.tool.md', 'Use Bash')])
  })

  it('replaces tool, MCP, hook, and subagent maps exactly', () => {
    const diffs = [
      {
        surface: 'tools',
        desiredInput: {
          tools: { Read: true },
          resources: [defineInlineResource('read.tool.md', 'Use Read')],
        },
      },
      {
        surface: 'mcp',
        desiredInput: { docs: { command: 'node', args: ['docs-server.js'] } },
      },
      {
        surface: 'hooks',
        desiredInput: { Stop: [{ command: 'echo done' }] },
      },
      {
        surface: 'subagents',
        desiredInput: {
          subagents: { reviewer: { prompt: 'Review the result' } },
          resources: [defineInlineResource('reviewer.md', 'Review instructions')],
        },
      },
    ] as const
    const base: AgentProfile = {
      name: 'support-agent',
      tools: { Bash: true },
      mcp: { old: { command: 'old-server' } },
      hooks: { Stop: [{ command: 'echo old' }] },
      subagents: { old: { prompt: 'Old prompt' } },
      resources: {
        skills: [defineInlineResource('preserved.SKILL.md', 'Preserved skill')],
        tools: [defineInlineResource('old.tool.md', 'Old tool')],
        agents: [defineInlineResource('old-agent.md', 'Old agent')],
      },
    }
    const applied = diffs
      .flatMap((target) => agentImprovementTargetProfileDiffs(target, { id: 'activation' }))
      .reduce((profile, diff) => applyAgentProfileDiff(profile, diff), base)

    expect(applied.tools).toEqual({ Read: true })
    expect(applied.mcp).toEqual({ docs: { command: 'node', args: ['docs-server.js'] } })
    expect(applied.hooks).toEqual({ Stop: [{ command: 'echo done' }] })
    expect(applied.subagents).toEqual({ reviewer: { prompt: 'Review the result' } })
    expect(applied.resources?.tools).toEqual([defineInlineResource('read.tool.md', 'Use Read')])
    expect(applied.resources?.agents).toEqual([
      defineInlineResource('reviewer.md', 'Review instructions'),
    ])
    expect(applied.resources?.skills).toEqual([
      defineInlineResource('preserved.SKILL.md', 'Preserved skill'),
    ])
  })

  it('accepts every profile surface shape produced by Runtime', () => {
    const bundle = candidateBundle()
    const measured = agentCandidateProfileAsAgentProfile(bundle.profile)
    const base: AgentProfile = {
      name: measured.name,
      prompt: { systemPrompt: 'Old prompt' },
      tools: { Bash: true },
      mcp: { old: { command: 'old-server' } },
      hooks: { Stop: [{ command: 'echo old' }] },
      subagents: { old: { prompt: 'Old prompt' } },
      resources: {
        failOnError: true,
        skills: [defineInlineResource('old.SKILL.md', 'Old skill')],
        tools: [defineInlineResource('old.tool.md', 'Old tool')],
        agents: [defineInlineResource('old-agent.md', 'Old agent')],
      },
    }
    const applied = AGENT_IMPROVEMENT_PROFILE_SURFACES.flatMap((surface) =>
      agentImprovementTargetProfileDiffs(
        { surface, desiredInput: agentImprovementTargetInput(bundle, surface) },
        { id: 'activation' },
      ),
    ).reduce((profile, diff) => applyAgentProfileDiff(profile, diff), base)

    expect(applied.prompt).toEqual(measured.prompt)
    expect(applied.tools).toEqual(measured.tools)
    expect(applied.mcp).toEqual(measured.mcp)
    expect(applied.hooks).toEqual(measured.hooks)
    expect(applied.subagents).toEqual(measured.subagents)
    expect(applied.resources?.skills).toEqual(measured.resources?.skills)
    expect(applied.resources?.tools).toEqual(measured.resources?.tools)
    expect(applied.resources?.agents).toEqual(measured.resources?.agents)
    expect(applied.resources?.failOnError).toBe(true)
  })

  it('binds stable identity and provenance to each ordered diff', () => {
    const source = {
      kind: 'optimizer' as const,
      artifacts: ['sha256:measured'],
    }
    const diffs = agentImprovementTargetProfileDiffs(
      { surface: 'prompt', desiredInput: { prompt: { systemPrompt: 'Measured prompt' } } },
      {
        id: 'activation',
        source,
        metadata: { tenant: 'tenant-1', surface: 'substituted' },
      },
    )

    expect(diffs).toMatchObject([
      {
        kind: 'agent-profile-diff',
        id: 'activation:prompt:reset',
        title: 'Replace active prompt',
        source,
        metadata: { tenant: 'tenant-1', surface: 'prompt' },
        remove: { prompt: true },
      },
      {
        kind: 'agent-profile-diff',
        id: 'activation:prompt:set',
        title: 'Activate measured prompt',
        source,
        metadata: { tenant: 'tenant-1', surface: 'prompt' },
        set: { prompt: { systemPrompt: 'Measured prompt' } },
      },
    ])
  })

  it('supports every profile-deliverable activation surface', () => {
    const inputs = [
      { surface: 'prompt', desiredInput: { prompt: null } },
      { surface: 'skills', desiredInput: null },
      { surface: 'tools', desiredInput: { tools: null, resources: null } },
      { surface: 'mcp', desiredInput: null },
      { surface: 'hooks', desiredInput: null },
      {
        surface: 'subagents',
        desiredInput: { subagents: null, resources: null },
      },
    ] as const

    for (const input of inputs) {
      expect(isAgentImprovementProfileSurface(input.surface)).toBe(true)
      expect(agentImprovementTargetProfileDiffs(input, { id: 'activation' })).toHaveLength(1)
    }
    expect(isAgentImprovementProfileSurface('agent-profile')).toBe(false)
    expect(isAgentImprovementProfileSurface('memory')).toBe(false)
    expect(isAgentImprovementProfileSurface('code')).toBe(false)
    expect(isAgentImprovementProfileSurface('knowledge')).toBe(false)
  })

  it('rejects input that does not match Runtime surface shape', () => {
    expect(() =>
      agentImprovementTargetProfileDiffs(
        {
          surface: 'prompt',
          desiredInput: { prompt: null, substituted: true },
        },
        { id: 'activation' },
      ),
    ).toThrow(/must contain exactly/)

    const undefinedInputs = [
      { surface: 'skills', desiredInput: undefined },
      { surface: 'tools', desiredInput: { tools: undefined, resources: null } },
      { surface: 'mcp', desiredInput: undefined },
      { surface: 'hooks', desiredInput: undefined },
      {
        surface: 'subagents',
        desiredInput: { subagents: null, resources: undefined },
      },
    ] as const
    for (const input of undefinedInputs) {
      expect(() => agentImprovementTargetProfileDiffs(input, { id: 'activation' })).toThrow(
        /must not be undefined/,
      )
    }
  })
})
