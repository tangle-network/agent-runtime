import { HARNESS_NATIVE_MODEL } from '@tangle-network/agent-eval'
import {
  type AgentProfile,
  AGENT_PROFILE_MATERIALIZATION_AXES as CANONICAL_AXES,
  changedAgentProfileAxes,
} from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  AGENT_PROFILE_MATERIALIZATION_AXES,
  assertProfileMaterialization,
  controlProfileMaterialization,
  defineProfileMaterializationContract,
  fullProfileMaterialization,
  profileMaterializationAxes,
  promptModelProfileMaterialization,
  promptOnlyProfileMaterialization,
  promptResourceProfileMaterialization,
  sandboxActProfileMaterialization,
  validateProfileMaterialization,
  worktreeCliProfileMaterialization,
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
  it('maps a complete profile to every exact nonempty canonical axis it requests', () => {
    const profile: AgentProfile = {
      name: 'researcher',
      description: 'Tests competing mechanisms',
      version: '1',
      tags: ['science'],
      prompt: { systemPrompt: 'Run discriminating experiments.' },
      model: { default: 'provider/model', reasoningEffort: 'high' },
      harness: 'codex',
      permissions: { shell: 'ask' },
      tools: { web: true },
      mcp: { papers: { transport: 'http', url: 'https://papers.example.test/mcp' } },
      connections: [{ connectionId: 'literature', capabilities: ['search'] }],
      subagents: { critic: { prompt: 'Find confounds.' } },
      resources: {
        skills: [{ kind: 'inline', name: 'hypothesis', content: 'Test mechanisms.' }],
      },
      hooks: { afterTool: [{ command: './capture-result' }] },
      modes: { adversarial: { prompt: 'Try to falsify the claim.' } },
      confidential: { sealed: true },
      metadata: { role: 'driver' },
      extensions: { codex: { sandbox: 'workspace-write' } },
    }

    expect(profileMaterializationAxes(profile)).toEqual([
      'name',
      'description',
      'version',
      'tags',
      'systemPrompt',
      'modelDefault',
      'modelReasoningEffort',
      'harness',
      'permissions',
      'tools',
      'mcp',
      'connections',
      'subagents',
      'skills',
      'hooks',
      'modes',
      'confidential',
      'metadata',
      'extensions',
    ])
  })

  it('treats cyclic opaque metadata as a nonempty request without recursing forever', () => {
    const metadata: Record<string, unknown> = {}
    metadata.self = metadata

    expect(profileMaterializationAxes({ metadata })).toEqual(['metadata'])
  })

  it('handles deeply nested empty opaque metadata without exhausting the call stack', () => {
    const metadata: Record<string, unknown> = {}
    let cursor = metadata
    for (let index = 0; index < 25_000; index += 1) {
      const next: Record<string, unknown> = {}
      cursor.next = next
      cursor = next
    }

    expect(profileMaterializationAxes({ metadata })).toEqual(['metadata'])
  })

  it('separates prompt-and-model execution from full-profile execution', () => {
    const requested = profileMaterializationAxes({
      name: 'router-worker',
      prompt: { systemPrompt: 'Solve it.' },
      model: { default: 'provider/model' },
      tools: { shell: true },
      harness: 'codex',
      metadata: { authorizationId: 'auth-1' },
    })

    expect(
      validateProfileMaterialization({
        contract: promptModelProfileMaterialization,
        changedAxes: requested,
      }).map((issue) => issue.axis),
    ).toEqual(['tools'])
    expect(
      validateProfileMaterialization({
        contract: fullProfileMaterialization,
        changedAxes: requested,
      }),
    ).toEqual([])
  })

  it('does not let a limited path claim model or prompt fields it cannot apply', () => {
    const requested = profileMaterializationAxes({
      name: 'pi-worker',
      prompt: { systemPrompt: 'Solve it.', instructions: ['Show evidence.'] },
      model: {
        default: 'provider/model',
        small: 'provider/small',
        reasoningEffort: 'high',
      },
      harness: 'pi',
      metadata: { run: 'one' },
    })

    expect(
      validateProfileMaterialization({
        contract: promptModelProfileMaterialization,
        changedAxes: requested,
      }).map((issue) => issue.axis),
    ).toEqual(['modelSmall'])
    expect(
      validateProfileMaterialization({
        contract: controlProfileMaterialization,
        changedAxes: requested,
      }).map((issue) => issue.axis),
    ).toEqual([
      'systemPrompt',
      'instructions',
      'modelDefault',
      'modelSmall',
      'modelReasoningEffort',
    ])
  })

  it('describes the local worktree CLI without claiming placement or ignored profile fields', () => {
    expect(
      validateProfileMaterialization({
        contract: worktreeCliProfileMaterialization,
        changedAxes: [
          'name',
          'systemPrompt',
          'modelDefault',
          'modelSmall',
          'tools',
          'permissions',
          'connections',
          'confidential',
          'extensions',
          'resourceFailOnError',
        ],
      }).map((issue) => issue.axis),
    ).toEqual(['modelSmall', 'connections', 'confidential', 'extensions'])
  })

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

  it('declares createSandboxAct as every canonical leaf', () => {
    // Asserted as the whole canonical set rather than a hand-listed subset, so dropping a leaf
    // from the contract fails here instead of passing an under-specified list.
    const expected = [...CANONICAL_AXES]
    expect([...sandboxActProfileMaterialization.axes].sort()).toEqual([...expected].sort())
    expect(
      validateProfileMaterialization({
        contract: sandboxActProfileMaterialization,
        changedAxes: expected,
      }),
    ).toEqual([])
  })

  it('claims harness, which the backend resolver now reads', () => {
    const issues = validateProfileMaterialization({
      contract: sandboxActProfileMaterialization,
      changedAxes: changedAgentProfileAxes({
        kind: 'agent-profile-diff',
        set: { harness: 'codex' },
      }),
    })

    expect(issues).toEqual([])
  })

  it('pins the resolver behavior the harness claim rests on', () => {
    // The contract claims `harness` only because buildBackendOptions resolves the runner from
    // it. A complete profile is mandatory, and its optional backendType selects a deliberate
    // execution implementation while model identity remains fixed by the profile.
    const executable = {
      name: 'a',
      harness: 'codex',
      model: { provider: 'tangle-router', default: 'deepseek-v4-flash' },
    } as const satisfies AgentProfile
    expect(buildBackendOptions(executable, undefined).backend?.type).toBe('codex')
    expect(
      buildBackendOptions({ ...executable, metadata: { backendType: 'amp' } }, undefined).backend
        ?.type,
    ).toBe('amp')
    expect(() => buildBackendOptions({ ...executable, harness: undefined }, undefined)).toThrow(
      /harness must be explicit/,
    )
  })

  it('refuses a runtime-selected model marker before sandbox execution', () => {
    const profile: AgentProfile = {
      name: 'runtime-selected',
      harness: 'codex',
      model: {
        default: HARNESS_NATIVE_MODEL,
        provider: 'tangle-router',
        reasoningEffort: 'high',
      },
    }

    expect(() => buildBackendOptions(profile, undefined)).toThrow(
      /model\.default is runtime-selected/,
    )
  })

  it('refuses a declared harness the sandbox cannot run', () => {
    // Falling through to opencode would run a gemini profile on a different harness and
    // report success, so the mismatch has to surface as a failure.
    expect(() =>
      buildBackendOptions(
        {
          name: 'a',
          harness: 'gemini',
          model: { provider: 'tangle-router', default: 'deepseek-v4-flash' },
        },
        undefined,
      ),
    ).toThrow(/no backend for/)
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
