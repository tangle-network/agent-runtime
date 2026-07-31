import {
  AGENT_PROFILE_MATERIALIZATION_AXES as CANONICAL_AXES,
  changedAgentProfileAxes,
  profileMaterializationAxes,
} from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  AGENT_PROFILE_MATERIALIZATION_AXES,
  assertProfileMaterialization,
  defineProfileMaterializationContract,
  promptOnlyProfileMaterialization,
  promptResourceProfileMaterialization,
  sandboxActProfileMaterialization,
  validateProfileMaterialization,
} from '../src/agent'

describe('canonical axis set', () => {
  it('is the exact set agent-interface publishes', () => {
    expect([...AGENT_PROFILE_MATERIALIZATION_AXES].sort()).toEqual([...CANONICAL_AXES].sort())
  })

  it('accepts every axis agent-interface can produce from a diff or a profile', () => {
    // Both producers are agent-interface public exports and this validator is an agent-runtime
    // public export, so every axis either can emit must be a legal input here.
    const fromDiff = changedAgentProfileAxes({
      kind: 'agent-profile-diff',
      set: { harness: 'codex' },
    })
    expect(fromDiff).toEqual(['harness'])

    const fromProfile = profileMaterializationAxes({
      name: 'x',
      model: { reasoningEffort: 'high' },
      harness: 'codex',
      mcp: {},
    })
    expect(fromProfile).toContain('modelReasoningEffort')
    expect(fromProfile).toContain('harness')

    const contract = defineProfileMaterializationContract({
      name: 'everything',
      axes: CANONICAL_AXES,
    })
    for (const axes of [fromProfile, CANONICAL_AXES]) {
      expect(validateProfileMaterialization({ contract, changedAxes: axes })).toEqual([])
    }
  })
})

describe('profile materialization contracts', () => {
  it('lets a prompt-only contract carry both prompt leaves', () => {
    expect(
      validateProfileMaterialization({
        contract: promptOnlyProfileMaterialization,
        changedAxes: ['systemPrompt', 'instructions'],
      }),
    ).toEqual([])
  })

  it('lets a resource-attaching contract carry the resource leaves it declares', () => {
    expect(
      validateProfileMaterialization({
        contract: promptResourceProfileMaterialization,
        changedAxes: ['files', 'skills', 'resourceTools', 'commands'],
      }),
    ).toEqual([])
  })

  it('reports profile axes a limited path would drop', () => {
    const issues = validateProfileMaterialization({
      contract: promptResourceProfileMaterialization,
      changedAxes: ['systemPrompt', 'tools', 'permissions', 'mcp'],
    })

    expect(issues.map((issue) => issue.axis)).toEqual(['tools', 'permissions', 'mcp'])
  })

  it('does not let an inlining path claim the resource failure policy', () => {
    expect(
      validateProfileMaterialization({
        contract: promptResourceProfileMaterialization,
        changedAxes: ['resourceFailOnError'],
      }).map((issue) => issue.axis),
    ).toEqual(['resourceFailOnError'])
  })

  it('throws before a limited path can silently drop tool or permission changes', () => {
    expect(() =>
      assertProfileMaterialization({
        contract: promptResourceProfileMaterialization,
        changedAxes: ['tools', 'permissions'],
        context: 'candidate:r348-tools',
      }),
    ).toThrow(
      'candidate:r348-tools: profile materialization would drop axis changes on "prompt-resource-attachment": tools, permissions.',
    )
  })

  it('declares createSandboxAct as every profile leaf it forwards', () => {
    expect(
      validateProfileMaterialization({
        contract: sandboxActProfileMaterialization,
        changedAxes: [
          'name',
          'description',
          'version',
          'tags',
          'modelDefault',
          'modelReasoningEffort',
          'modelMetadata',
          'systemPrompt',
          'instructions',
          'files',
          'skills',
          'resourceFailOnError',
          'tools',
          'permissions',
          'mcp',
          'connections',
          'subagents',
          'hooks',
          'modes',
          'confidential',
          'metadata',
          'extensions',
        ],
      }),
    ).toEqual([])
  })

  it('refuses to claim harness, which the backend resolver never reads', () => {
    // buildBackendOptions resolves the runner from sandboxOverrides then
    // profile.metadata.backendType — a harness-only change would run unchanged.
    const issues = validateProfileMaterialization({
      contract: sandboxActProfileMaterialization,
      changedAxes: changedAgentProfileAxes({
        kind: 'agent-profile-diff',
        set: { harness: 'codex' },
      }),
    })

    expect(issues.map((issue) => issue.axis)).toEqual(['harness'])
  })

  it('deduplicates axes while preserving first-seen order', () => {
    const contract = defineProfileMaterializationContract({
      name: 'custom-path',
      axes: ['systemPrompt', 'systemPrompt', 'tools'],
    })

    expect(contract.axes).toEqual(['systemPrompt', 'tools'])
  })

  it('rejects misspelled axes instead of treating them as carried', () => {
    expect(() =>
      defineProfileMaterializationContract({
        name: 'bad-path',
        axes: ['toolz' as never],
      }),
    ).toThrow('unknown profile axis "toolz"')
  })

  it('rejects a compound property and names the leaves to use instead', () => {
    expect(() =>
      defineProfileMaterializationContract({
        name: 'compound-path',
        axes: ['resources' as never],
      }),
    ).toThrow(
      'compound-path.axes: "resources" is a compound AgentProfile property, not a materialization axis. Name the exact leaves this path carries: files, resourceTools, skills, resourceAgents, commands, resourceInstructions, resourceFailOnError.',
    )
  })
})
