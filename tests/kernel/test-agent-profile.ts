import type { AgentProfile } from '@tangle-network/agent-interface'
import type { coordinationVerbNames } from '../../src/mcp/tools/coordination'

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

type CoordinationVerbName = (typeof coordinationVerbNames)[number]

/** Declare the exact Runtime coordination tools an offline test profile may invoke. */
export function withRuntimeTools(
  profile: AgentProfile,
  ...names: ReadonlyArray<CoordinationVerbName>
): AgentProfile {
  const tools = { ...profile.tools }
  for (const name of names) tools[`agent_runtime_coordination_${name}`] = true
  return { ...profile, tools }
}
