import { agentCandidateProfileSchema, type ProxySecretBinding } from '@tangle-network/agent-interface'
import type { AgentCandidateWorkspacePlan } from '@tangle-network/agent-profile-materialize'
import { describe, expect, it } from 'vitest'
import {
  candidateMaterializerHarness,
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

it('refuses proxy-held declarations before local candidate profile materialization', () => {
  const candidate = agentCandidateProfileSchema.parse({ name: 'scoped', proxySecrets: [binding] })
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
