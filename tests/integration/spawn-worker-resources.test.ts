import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { expect, it } from 'vitest'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { DriveHarness } from '../../src/runtime/supervise/types'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

async function callTool(url: string, name: string, args: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const body = (await response.json()) as { result?: { content?: Array<{ text?: string }> } }
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>
}

// A manager sizes each worker's machine through spawn_worker `resources` (#1277): two children get
// their requested sizes in the provider create, and a third above the run's ceiling is refused
// naming it, before any create.
it('sizes each spawned worker within maxWorkerResources and refuses one above it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spawn-resources-'))
  const created: unknown[] = []
  const base = durableRetainedProvider(join(dir, 'provider.json'))
  const provider: AgentEnvironmentProvider = {
    ...base,
    create: async (input) => {
      created.push(input.resources)
      return base.create(input)
    },
  }
  const replies: Record<string, Record<string, unknown>> = {}
  const worker = (name: string) => testAgentProfile(name, { harness: 'codex' })
  try {
    await supervise(
      testAgentProfile('root', { tools: runtimeToolDeclarations('spawn_worker', 'stop') }),
      'size',
      {
        budget: { maxIterations: 20, maxTokens: 100_000 },
        perWorker: { maxIterations: 1, maxTokens: 1_000 },
        runDir: join(dir, 'run'),
        inheritSpawnRights: false,
        driverRetry: { enabled: false },
        backend: {
          backend: 'provider',
          provider,
          defaults: { resources: { memoryMb: 2048 } },
          maxWorkerResources: { cpu: 4, memoryMb: 16384 },
        },
        driveHarness: (async ({ coordinationMcpUrl: url }) => {
          if (replies.small !== undefined) return void (await callTool(url, 'stop', {}))
          replies.small = await callTool(url, 'spawn_worker', {
            profile: worker('small'),
            task: 'check',
            resources: { memoryMb: 4096 },
          })
          replies.large = await callTool(url, 'spawn_worker', {
            profile: worker('large'),
            task: 'sweep',
            resources: { memoryMb: 16384, cpu: 2 },
          })
          replies.over = await callTool(url, 'spawn_worker', {
            profile: worker('over'),
            task: 'too big',
            resources: { memoryMb: 32768 },
          })
        }) as DriveHarness,
      },
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  expect(replies.small).toHaveProperty('workerId')
  expect(replies.large).toHaveProperty('workerId')
  expect(replies.over).toMatchObject({ error: 'preflight-refused' })
  expect(String(replies.over?.reason)).toContain('memoryMb=32768 exceed')
  expect(String(replies.over?.reason)).toContain('"memoryMb":16384')
  expect(created).toEqual(expect.arrayContaining([{ memoryMb: 4096 }, { memoryMb: 16384, cpu: 2 }]))
  expect(created).toHaveLength(2)
})
