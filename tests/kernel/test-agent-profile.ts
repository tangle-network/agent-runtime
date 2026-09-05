import type { AgentProfile } from '@tangle-network/agent-interface'
import { coordinationProfileToolPrefix } from '../../src/runtime/supervise/supervisor-agent'

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

/** Explicit Runtime authority for a test profile. No test gets coordination tools by default. */
export function runtimeToolDeclarations(
  ...names: ReadonlyArray<string>
): NonNullable<AgentProfile['tools']> {
  return Object.fromEntries(names.map((name) => [`${coordinationProfileToolPrefix}${name}`, true]))
}
