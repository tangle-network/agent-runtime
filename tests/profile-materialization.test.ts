import { describe, expect, it } from 'vitest'
import {
  assertProfileMaterialization,
  defineProfileMaterializationContract,
  promptOnlyProfileMaterialization,
  promptResourceProfileMaterialization,
  sandboxActProfileMaterialization,
  validateProfileMaterialization,
} from '../src/agent'

describe('profile materialization contracts', () => {
  it('lets a broad prompt contract carry prompt sub-axes', () => {
    expect(
      validateProfileMaterialization({
        contract: promptOnlyProfileMaterialization,
        changedAxes: ['systemPrompt', 'instructions'],
      }),
    ).toEqual([])
  })

  it('lets a broad resources contract carry resource sub-axes', () => {
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
      changedAxes: ['prompt', 'tools', 'permissions', 'mcp'],
    })

    expect(issues.map((issue) => issue.axis)).toEqual(['tools', 'permissions', 'mcp'])
    expect(issues[0]?.supportedAxes).toEqual(['prompt', 'resources'])
  })

  it('throws before a limited path can silently drop tool or permission changes', () => {
    expect(() =>
      assertProfileMaterialization({
        contract: promptResourceProfileMaterialization,
        changedAxes: ['tools', 'permissions'],
        context: 'candidate:r348-tools',
      }),
    ).toThrow(
      [
        'candidate:r348-tools: profile materialization would drop axis changes on "prompt-resource-attachment": tools, permissions.',
        'Supported axes: prompt, resources.',
        'Use a run path that carries those AgentProfile axes, or remove them from the candidate.',
      ].join('\n'),
    )
  })

  it('declares createSandboxAct as the full profile path', () => {
    expect(
      validateProfileMaterialization({
        contract: sandboxActProfileMaterialization,
        changedAxes: [
          'name',
          'model',
          'systemPrompt',
          'files',
          'skills',
          'tools',
          'permissions',
          'mcpConnections',
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

  it('deduplicates axes while preserving first-seen order', () => {
    const contract = defineProfileMaterializationContract({
      name: 'custom-path',
      axes: ['prompt', 'prompt', 'tools'],
    })

    expect(contract.axes).toEqual(['prompt', 'tools'])
  })

  it('rejects misspelled axes instead of treating them as carried', () => {
    expect(() =>
      defineProfileMaterializationContract({
        name: 'bad-path',
        axes: ['toolz' as never],
      }),
    ).toThrow('unknown profile axis "toolz"')
  })
})
