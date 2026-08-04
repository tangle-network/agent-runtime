import type { AgentProfile } from '@tangle-network/agent-interface'

type TestProfileOverrides = Omit<Partial<AgentProfile>, 'name' | 'model'> & {
  model?: AgentProfile['model']
}

/** Complete offline identity for tests that exercise execution rather than profile validation. */
export function testAgentProfile(name: string, overrides: TestProfileOverrides = {}): AgentProfile {
  return {
    name,
    harness: 'opencode',
    ...overrides,
    model: {
      provider: 'offline',
      default: 'offline-test-model',
      ...overrides.model,
    },
  }
}
