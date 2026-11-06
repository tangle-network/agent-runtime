import { expect, it } from 'vitest'
import { supervise } from '../../src/runtime/supervise/supervise'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

// A root that declares coordination tools its run does not serve is refused before its harness
// runs a turn (the backend create), with every unserved name in one error (#1219). The resolver
// serves `served_tool`; the profile also declares two names nothing serves.
it('refuses a root declaring unserved coordination tools before its first drive, naming each', async () => {
  let drives = 0
  const res = await supervise(
    testAgentProfile('root', {
      tools: runtimeToolDeclarations('spawn_worker', 'served_tool', 'missing_a', 'missing_b'),
    }),
    'task',
    {
      budget: { maxIterations: 10, maxTokens: 10_000 },
      inheritSpawnRights: false,
      driverRetry: { enabled: false },
      makeLeafAgent: () => {
        throw new Error('no children in this fixture')
      },
      resolveSupervisorTools: () => [
        {
          name: 'served_tool',
          description: 'A product tool the resolver serves.',
          inputSchema: { type: 'object' },
          handler: async () => 'ok',
        },
      ],
      driveHarness: async () => {
        drives += 1
      },
    },
  )
  expect(res.kind).toBe('no-winner')
  expect(JSON.stringify(res)).toContain(
    'requested tools \\"missing_a\\", \\"missing_b\\" are unavailable',
  )
  expect(drives).toBe(0)
})
