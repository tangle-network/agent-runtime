import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
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

  it('omits empty structure while retaining explicit false and zero requests', () => {
    expect(
      profileMaterializationAxes({
        name: '   ',
        tags: [],
        prompt: { systemPrompt: '', instructions: [' '] },
        model: { metadata: {} },
        permissions: {},
        tools: { web: false },
        mcp: {},
        connections: [],
        subagents: {},
        resources: { files: [], failOnError: false },
        hooks: { afterTool: [] },
        modes: {},
        confidential: { sealed: false },
        metadata: { retries: 0 },
        extensions: { codex: undefined },
      }),
    ).toEqual(['tools', 'resourceFailOnError', 'confidential', 'metadata'])
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

    expect(profileMaterializationAxes({ metadata })).toEqual([])
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
    ).toEqual(['modelSmall', 'modelReasoningEffort'])
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
    ).toEqual(['modelSmall', 'connections', 'confidential', 'extensions', 'resourceFailOnError'])
  })

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
          'harness',
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
