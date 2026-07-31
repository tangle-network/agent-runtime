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
import { buildBackendOptions } from '../src/runtime/sandbox-backend'

/** Pinned explicitly: comparing the re-export to itself could never fail. */
const EXPECTED_CANONICAL_AXES = [
  'name',
  'description',
  'version',
  'tags',
  'systemPrompt',
  'instructions',
  'modelDefault',
  'modelSmall',
  'modelProvider',
  'modelReasoningEffort',
  'modelMetadata',
  'harness',
  'permissions',
  'tools',
  'mcp',
  'connections',
  'subagents',
  'files',
  'resourceTools',
  'skills',
  'resourceAgents',
  'commands',
  'resourceInstructions',
  'resourceFailOnError',
  'hooks',
  'modes',
  'confidential',
  'metadata',
  'extensions',
] as const

describe('canonical axis set', () => {
  it('is the exact 29-leaf set agent-interface publishes', () => {
    expect([...AGENT_PROFILE_MATERIALIZATION_AXES].sort()).toEqual(
      [...EXPECTED_CANONICAL_AXES].sort(),
    )
    expect([...CANONICAL_AXES].sort()).toEqual([...EXPECTED_CANONICAL_AXES].sort())
  })

  it('accepts every axis agent-interface can produce from a diff or a profile', () => {
    // agent-interface publishes TWO axis vocabularies and both are public producers:
    // profileMaterializationAxes emits canonical leaves, changedAgentProfileAxes emits diff
    // axes, which are COMPOUND property names for everything but the scalar properties.
    // This validator is a public agent-runtime export, so both must be legal inputs.
    const contract = defineProfileMaterializationContract({
      name: 'everything',
      axes: CANONICAL_AXES,
    })

    const diffs = [
      { set: { harness: 'codex' } },
      { set: { name: 'x' } },
      { set: { model: { reasoningEffort: 'high' } } },
      { set: { prompt: { systemPrompt: 'x' } } },
      { set: { resources: { files: [] } } },
      { set: { tools: {} } },
    ] as const

    for (const diff of diffs) {
      const changed = changedAgentProfileAxes({ kind: 'agent-profile-diff', ...diff })
      expect(
        validateProfileMaterialization({ contract, changedAxes: changed }),
        `changedAgentProfileAxes -> ${JSON.stringify(changed)} must be a legal input`,
      ).toEqual([])
    }

    const fromProfile = profileMaterializationAxes({
      name: 'x',
      model: { reasoningEffort: 'high' },
      harness: 'codex',
      mcp: {},
    })
    expect(fromProfile).toContain('modelReasoningEffort')
    expect(fromProfile).toContain('harness')
    expect(validateProfileMaterialization({ contract, changedAxes: fromProfile })).toEqual([])
    expect(validateProfileMaterialization({ contract, changedAxes: CANONICAL_AXES })).toEqual([])
  })

  it('expands a compound diff axis into leaves rather than rejecting it', () => {
    const contract = defineProfileMaterializationContract({
      name: 'model-only',
      axes: ['modelDefault', 'modelSmall', 'modelProvider', 'modelReasoningEffort'],
    })

    // `model` covers five leaves; the contract declares four, so the fifth is reported by NAME.
    expect(
      validateProfileMaterialization({ contract, changedAxes: ['model'] }).map((i) => i.axis),
    ).toEqual(['modelMetadata'])
  })

  it('keeps every compound expansion inside the canonical leaf set', () => {
    // Guards the expansion map against an upstream leaf rename making it silently stale: a
    // stale leaf is not in the all-leaves contract, so it would surface as an issue here.
    const everything = defineProfileMaterializationContract({
      name: 'everything',
      axes: CANONICAL_AXES,
    })

    for (const compound of ['identity', 'prompt', 'model', 'resources', 'mcpConnections']) {
      expect(
        validateProfileMaterialization({
          contract: everything,
          changedAxes: [compound as never],
        }),
        `${compound} must expand to canonical leaves only`,
      ).toEqual([])
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

  it('declares createSandboxAct as every canonical leaf except harness', () => {
    // Asserted as "the whole canonical set minus harness" rather than a hand-listed subset, so
    // dropping a leaf from the contract fails here instead of passing an under-specified list.
    const expected = CANONICAL_AXES.filter((axis) => axis !== 'harness')
    expect(sandboxActProfileMaterialization.axes).toEqual(expected)
    expect(
      validateProfileMaterialization({
        contract: sandboxActProfileMaterialization,
        changedAxes: expected,
      }),
    ).toEqual([])
  })

  it('refuses to claim harness, which the backend resolver never reads', () => {
    const issues = validateProfileMaterialization({
      contract: sandboxActProfileMaterialization,
      changedAxes: changedAgentProfileAxes({
        kind: 'agent-profile-diff',
        set: { harness: 'codex' },
      }),
    })

    expect(issues.map((issue) => issue.axis)).toEqual(['harness'])
  })

  it('pins the resolver behavior that omission rests on', () => {
    // The contract omits `harness` because buildBackendOptions resolves the runner from
    // sandboxOverrides, then profile.metadata.backendType, and never profile.harness. If that
    // ever grows a profile.harness fallback, the omission becomes wrong — catch it here.
    expect(buildBackendOptions({ name: 'a', harness: 'codex' }, undefined).backend?.type).toBe(
      'opencode',
    )
    expect(
      buildBackendOptions(
        { name: 'a', harness: 'codex', metadata: { backendType: 'amp' } },
        undefined,
      ).backend?.type,
    ).toBe('amp')
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
