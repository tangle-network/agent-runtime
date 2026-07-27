import {
  type AgentProfile,
  agentProfileSchema,
  applyAgentProfileDiff,
  defineInlineResource,
} from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  canonicalCandidateDigest,
  embeddedCandidateArtifact,
} from '../src/candidate-execution/digest'
import { agentCandidateProfileAsAgentProfile } from '../src/candidate-execution/profile'
import {
  AGENT_IMPROVEMENT_PROFILE_SURFACES,
  type AgentImprovementProfileSurface,
  agentImprovementProfileDiffs,
  agentImprovementProfileSurfaceDigest,
  agentImprovementProfileSurfaceInput,
  agentImprovementTargetInput,
  agentImprovementTargetProfileDiffs,
  isAgentImprovementProfileSurface,
  isAgentProfileMeasuredSurface,
  profileImprovementChangedSurfaces,
} from '../src/intelligence/improvement-surfaces'
import { candidateBundle, redigestCandidateBundle } from './helpers/candidate-execution-fixture'

describe('agent improvement profile delivery', () => {
  it('matches experiment inputs and digests for all six populated profile surfaces', () => {
    const base = candidateBundle()
    const skill = candidateInlineResource('measured.SKILL.md', 'Measured skill')
    const tool = candidateInlineResource('read.tool.md', 'Use Read')
    const agent = candidateInlineResource('reviewer.md', 'Review instructions')
    const bundle = redigestCandidateBundle(base, {
      profile: {
        ...base.profile,
        prompt: { systemPrompt: 'Measured prompt', instructions: ['Return citations'] },
        tools: { Read: true },
        mcp: {
          docs: {
            transport: 'stdio',
            command: 'node',
            args: [{ kind: 'public', value: 'docs-server.js' }],
          },
        },
        hooks: {
          Stop: [
            {
              executable: 'node',
              args: [{ kind: 'public', value: 'check.mjs' }],
              blocking: true,
            },
          ],
        },
        subagents: { reviewer: { prompt: 'Review the result' } },
        resources: {
          failOnError: true,
          skills: [skill],
          tools: [tool],
          agents: [agent],
        },
      },
    })
    const measured = agentCandidateProfileAsAgentProfile(bundle.profile)
    const profileWithUnrelatedFields: AgentProfile = {
      ...measured,
      name: 'different-product-name',
      description: 'Ignored by profile-deliverable target state.',
      metadata: { tenant: 'tenant-1' },
      resources: {
        ...measured.resources,
        files: [
          {
            path: 'context.txt',
            resource: defineInlineResource('context.txt', 'Unrelated file'),
          },
        ],
        commands: [defineInlineResource('command.md', 'Unrelated command')],
        instructions: 'Unrelated memory instructions',
      },
    }
    const expectedInputs = {
      prompt: { prompt: measured.prompt ?? null },
      skills: measured.resources?.skills ?? null,
      tools: {
        tools: measured.tools ?? null,
        resources: measured.resources?.tools ?? null,
      },
      mcp: measured.mcp ?? null,
      hooks: measured.hooks ?? null,
      subagents: {
        subagents: measured.subagents ?? null,
        resources: measured.resources?.agents ?? null,
      },
    } satisfies Record<AgentImprovementProfileSurface, unknown>

    for (const surface of AGENT_IMPROVEMENT_PROFILE_SURFACES) {
      const expected = agentImprovementTargetInput(bundle, surface)
      expect(expected).toEqual(expectedInputs[surface])
      expect(agentImprovementProfileSurfaceInput(profileWithUnrelatedFields, surface)).toEqual(
        expected,
      )
      expect(agentImprovementProfileSurfaceDigest(profileWithUnrelatedFields, surface)).toBe(
        canonicalCandidateDigest(expected),
      )
    }
  })

  it('matches all six null experiment inputs and produces removal-only diffs', () => {
    const base = candidateBundle()
    const { prompt: _prompt, ...profileWithoutMeasuredSurfaces } = base.profile
    const bundle = redigestCandidateBundle(base, { profile: profileWithoutMeasuredSurfaces })
    const measured: AgentProfile = {
      ...agentCandidateProfileAsAgentProfile(bundle.profile),
      description: 'Unrelated current profile state',
      metadata: { tenant: 'tenant-1' },
    }
    const expectedInputs = {
      prompt: { prompt: null },
      skills: null,
      tools: { tools: null, resources: null },
      mcp: null,
      hooks: null,
      subagents: { subagents: null, resources: null },
    } satisfies Record<AgentImprovementProfileSurface, unknown>

    for (const surface of AGENT_IMPROVEMENT_PROFILE_SURFACES) {
      const expected = agentImprovementTargetInput(bundle, surface)
      expect(expected).toEqual(expectedInputs[surface])
      const currentInput = agentImprovementProfileSurfaceInput(measured, surface)
      expect(currentInput).toEqual(expected)
      expect(agentImprovementProfileSurfaceDigest(measured, surface)).toBe(
        canonicalCandidateDigest(expected),
      )
      expect(
        agentImprovementTargetProfileDiffs(
          { surface, desiredInput: currentInput },
          { id: 'activation' },
        ),
      ).toHaveLength(1)
    }
  })

  it('returns a detached, deeply frozen surface value', () => {
    const profile: AgentProfile = {
      name: 'support-agent',
      prompt: {
        systemPrompt: 'Original prompt',
        instructions: ['Original instruction'],
      },
    }
    const input = agentImprovementProfileSurfaceInput(profile, 'prompt') as {
      prompt: { systemPrompt: string; instructions: string[] }
    }

    expect(Object.isFrozen(input)).toBe(true)
    expect(Object.isFrozen(input.prompt)).toBe(true)
    expect(Object.isFrozen(input.prompt.instructions)).toBe(true)
    expect(() => {
      input.prompt.instructions.push('Mutation')
    }).toThrow()
    expect(profile.prompt?.instructions).toEqual(['Original instruction'])
  })

  it('rejects malformed or non-canonical profiles before extraction or hashing', () => {
    const profile = {
      name: 'support-agent',
      prompt: { systemPrompt: 'Measured prompt' },
      unsupported: true,
    } as unknown as AgentProfile

    expect(() => agentImprovementProfileSurfaceInput(profile, 'prompt')).toThrow(
      /unsupported or non-canonical fields/,
    )
    expect(() => agentImprovementProfileSurfaceDigest(profile, 'prompt')).toThrow(
      /unsupported or non-canonical fields/,
    )
  })

  it('handles each independently absent tool and subagent slot', () => {
    const toolResource = defineInlineResource('read.tool.md', 'Use Read')
    const agentResource = defineInlineResource('reviewer.md', 'Review instructions')
    const cases: readonly {
      surface: AgentImprovementProfileSurface
      profile: AgentProfile
      expected: unknown
    }[] = [
      {
        surface: 'tools',
        profile: { name: 'tools-only', tools: { Read: true } },
        expected: { tools: { Read: true }, resources: null },
      },
      {
        surface: 'tools',
        profile: { name: 'tool-resources-only', resources: { tools: [toolResource] } },
        expected: { tools: null, resources: [toolResource] },
      },
      {
        surface: 'subagents',
        profile: { name: 'subagents-only', subagents: { reviewer: { prompt: 'Review' } } },
        expected: { subagents: { reviewer: { prompt: 'Review' } }, resources: null },
      },
      {
        surface: 'subagents',
        profile: { name: 'agent-resources-only', resources: { agents: [agentResource] } },
        expected: { subagents: null, resources: [agentResource] },
      },
    ]
    const active: AgentProfile = {
      name: 'active',
      tools: { Bash: true },
      subagents: { old: { prompt: 'Old prompt' } },
      resources: {
        tools: [defineInlineResource('old.tool.md', 'Old tool')],
        agents: [defineInlineResource('old-agent.md', 'Old agent')],
      },
    }

    for (const entry of cases) {
      const currentInput = agentImprovementProfileSurfaceInput(entry.profile, entry.surface)
      expect(currentInput).toEqual(entry.expected)
      expect(agentImprovementProfileSurfaceDigest(entry.profile, entry.surface)).toBe(
        canonicalCandidateDigest(entry.expected),
      )
      const applied = agentProfileSchema.parse(
        agentImprovementTargetProfileDiffs(
          { surface: entry.surface, desiredInput: currentInput },
          { id: 'activation' },
        ).reduce((profile, diff) => applyAgentProfileDiff(profile, diff), active),
      ) as AgentProfile
      expect(agentImprovementProfileSurfaceInput(applied, entry.surface)).toEqual(entry.expected)
    }
  })

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

  it('derives measured prompt and skill changes and rejects other profile changes', () => {
    const baseline: AgentProfile = {
      name: 'support-agent',
      prompt: { systemPrompt: 'Old prompt' },
      tools: { Bash: true },
      mcp: { old: { command: 'old-server' } },
      hooks: { Stop: [{ command: 'echo old' }] },
      subagents: { old: { prompt: 'Old subagent' } },
      resources: {
        skills: [defineInlineResource('old.SKILL.md', 'Old skill')],
        tools: [defineInlineResource('old.tool.md', 'Old tool')],
        agents: [defineInlineResource('old.md', 'Old subagent instructions')],
      },
    }
    const candidate: AgentProfile = {
      ...baseline,
      prompt: { systemPrompt: 'Measured prompt' },
      resources: {
        skills: [defineInlineResource('measured.SKILL.md', 'Use the evidence first')],
        tools: baseline.resources?.tools,
        agents: baseline.resources?.agents,
      },
    }
    const changes = agentImprovementProfileDiffs(baseline, candidate, { id: 'profile-change' })
    const applied = changes.reduce(
      (profile, change) => applyAgentProfileDiff(profile, change),
      baseline,
    )

    expect(agentProfileSchema.parse(applied)).toEqual(agentProfileSchema.parse(candidate))
    expect(profileImprovementChangedSurfaces(changes)).toEqual(['prompt', 'skills'])
    expect(() =>
      agentImprovementProfileDiffs(
        baseline,
        {
          ...candidate,
          tools: { Read: true },
          mcp: { docs: { command: 'node', args: ['docs-server.js'] } },
          hooks: { Stop: [{ command: 'node check.mjs' }] },
          subagents: { reviewer: { prompt: 'Review before answering' } },
        },
        {
          id: 'unsupported-profile-change',
        },
      ),
    ).toThrow(/measured profile contract cannot apply/)
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
    expect(isAgentProfileMeasuredSurface('prompt')).toBe(true)
    expect(isAgentProfileMeasuredSurface('skills')).toBe(true)
    expect(isAgentProfileMeasuredSurface('tools')).toBe(false)
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

function candidateInlineResource(name: string, content: string) {
  const artifact = embeddedCandidateArtifact(Buffer.from(content, 'utf8'))
  return {
    kind: 'inline' as const,
    name,
    content,
    sha256: artifact.sha256,
    byteLength: artifact.byteLength,
  }
}
