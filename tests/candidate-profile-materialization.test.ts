import type { ProxySecretBinding } from '@tangle-network/agent-interface'
import type { AgentCandidateWorkspacePlan } from '@tangle-network/agent-profile-materialize'
import { describe, expect, it } from 'vitest'
import {
  agentCandidateProfileAsAgentProfile,
  assertCandidateProfileExecutionSupport,
  candidateMaterializerHarness,
  freezeGenericAgentCandidateProfile,
  materializeAgentCandidateProfilePlan,
} from '../src/candidate-execution/profile'
import { projectCandidatePromptIntents } from '../src/candidate-execution/system-prompt'

describe('candidate profile materialization', () => {
  it('accepts only harnesses supported by the profile materializer', () => {
    expect(candidateMaterializerHarness('claude-code')).toBe('claude-code')
    expect(() => candidateMaterializerHarness('amp')).toThrow(/unsupported for harness amp/)
  })
})

const reference = { kind: 'secret-ref', key: 'service-reference' } as const
const binding: ProxySecretBinding = {
  envName: 'SERVICE_TOKEN',
  secretRef: reference,
  hosts: ['api.example.test'],
  presentation: { type: 'bearer' },
  methods: ['GET'],
  paths: ['/result'],
  ttlSeconds: 60,
}

it('preserves tagged references and proxy scope through candidate profile conversion', () => {
  const profile = { name: 'scoped', proxySecrets: [binding] }
  const candidate = freezeGenericAgentCandidateProfile(profile)
  expect(candidate.proxySecrets).toEqual(profile.proxySecrets)
  expect(agentCandidateProfileAsAgentProfile(candidate).proxySecrets).toEqual(profile.proxySecrets)
  const portable = agentCandidateProfileAsAgentProfile({
    name: 'tagged-mcp',
    mcp: {
      service: {
        command: 'node',
        args: [reference],
        env: { SERVICE_TOKEN: reference },
      },
    },
  })
  expect(portable.mcp?.service?.args).toEqual([reference])
  expect(portable.mcp?.service?.env?.SERVICE_TOKEN).toEqual(reference)
  expect(() => assertCandidateProfileExecutionSupport(candidate)).toThrow(
    'candidate local execution cannot materialize proxy-held secret declarations',
  )
  expect(() =>
    materializeAgentCandidateProfilePlan({
      profile: candidate,
      harness: 'codex',
      workspace: 'task',
      launch: { kind: 'container-command', executable: 'codex' },
      workspaces: { taskRoot: '/workspace/task' },
    }),
  ).toThrow('candidate local execution cannot materialize proxy-held secret declarations')
})

it('refuses to turn a hook argument reference into readable shell text', () => {
  expect(() =>
    agentCandidateProfileAsAgentProfile({
      name: 'hook',
      hooks: { Stop: [{ executable: 'node', args: [reference] }] },
    }),
  ).toThrow('candidate hook command arguments cannot contain secret references')
})

it.each(['systemPrompt', 'appendSystemPrompt'] as const)(
  'refuses a reference in the %s text projection',
  (intent) => {
    const plan: AgentCandidateWorkspacePlan = {
      harness: 'claude-code',
      sourceProfileDigest: `sha256:${'a'.repeat(64)}`,
      files: [],
      flags: [],
      env: {},
      unsupported: [],
      [intent]: reference,
    }
    expect(() =>
      projectCandidatePromptIntents(
        plan,
        { kind: 'container-command', executable: 'claude' },
        '/workspace/prompt.md',
      ),
    ).toThrow('candidate prompt and launch controls cannot resolve secret references')
  },
)
