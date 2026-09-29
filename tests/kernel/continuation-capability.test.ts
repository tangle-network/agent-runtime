import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import { supervisorAgent } from '../../src/runtime/supervise/supervisor-agent'
import type { Agent } from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

async function rpc(url: string, method: string, params: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  expect(response.ok).toBe(true)
  return response.json()
}

function listedToolNames(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null || !('result' in payload)) {
    throw new Error('tools/list did not return a JSON-RPC result')
  }
  const result = payload.result
  if (typeof result !== 'object' || result === null || !('tools' in result)) {
    throw new Error('tools/list result has no tools')
  }
  if (!Array.isArray(result.tools)) throw new Error('tools/list tools is not an array')
  return result.tools
    .map((tool: unknown) => {
      if (
        typeof tool !== 'object' ||
        tool === null ||
        !('name' in tool) ||
        typeof tool.name !== 'string'
      ) {
        throw new Error('tools/list returned an invalid tool name')
      }
      return tool.name
    })
    .sort()
}

function run(
  root: Agent<unknown, unknown>,
  blobs: InMemoryResultBlobStore,
  journal: InMemorySpawnJournal,
) {
  return createSupervisor<unknown, unknown>().run(
    root,
    'Preserve useful partial work for outside assessment.',
    {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'continuation-capability-consumer',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 1,
      now: () => 0,
    },
  )
}

describe('continuation instructions agree with the served coordination capabilities', () => {
  it('preserves an unassessed profile on reentry without demanding an ungranted submission tool', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const tasks: string[] = []
    const inventories: string[][] = []
    const root = supervisorAgent(
      testAgentProfile('outside-assessed-root', {
        harness: 'pi',
        tools: runtimeToolDeclarations('read_continuation', 'report_blocked'),
      }),
      {
        blobs,
        makeWorkerAgent: () => {
          throw new Error('this profile does not grant spawning')
        },
        perWorker: { maxIterations: 4, maxTokens: 1000 },
        driveHarness: async ({ coordinationMcpUrl, task }) => {
          tasks.push(String(task))
          inventories.push(listedToolNames(await rpc(coordinationMcpUrl, 'tools/list', {})))
        },
        deliverable: {
          describe: 'Outside assessment remains pending; preserve the output packet.',
          check: () => false,
        },
        continuation: testContinuation({
          maxBarren: 2,
          profile: {
            id: 'outside-assessment-capability-control',
            opening: 'Outside assessment remains pending. The retained contract is {owed}',
            plan: 'Continue useful implementation and retain replayable evidence.',
            rules: 'This run cannot certify product success.',
            headings: {
              failures: '',
              protected: '',
              changed: '',
              findings: '',
              bar: '',
              plan: '',
              rules: '',
            },
          },
        }),
      },
    )
    const result = await run(root, blobs, journal)
    expect(result.kind).toBe('no-winner')
    expect(tasks.length).toBeGreaterThan(1)
    expect(inventories).toHaveLength(tasks.length)
    for (const names of inventories) {
      expect(names).toEqual(['read_continuation', 'report_blocked'])
    }
    for (const note of tasks.slice(1)) {
      expect(note).not.toContain('submit_result')
      expect(note).not.toContain('read_journal')
      expect(note).not.toContain('await_event')
      expect(note).not.toContain('observe_agent')
      expect(note).toContain('This run cannot certify product success.')
    }
  })

  it('still serves an authored submission tool and accepts a checked result once', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const tasks: string[] = []
    let drives = 0
    let checks = 0
    const root = supervisorAgent(
      testAgentProfile('checked-root', {
        harness: 'pi',
        tools: runtimeToolDeclarations('submit_result', 'read_journal', 'await_event'),
      }),
      {
        blobs,
        makeWorkerAgent: () => {
          throw new Error('this profile does not grant spawning')
        },
        perWorker: { maxIterations: 4, maxTokens: 1000 },
        driveHarness: async ({ coordinationMcpUrl, task }) => {
          drives += 1
          tasks.push(String(task))
          expect(listedToolNames(await rpc(coordinationMcpUrl, 'tools/list', {}))).toEqual([
            'await_event',
            'read_journal',
            'submit_result',
          ])
          for (const name of ['read_journal', 'await_event']) {
            const reply = await rpc(coordinationMcpUrl, 'tools/call', { name, arguments: {} })
            expect(reply).toHaveProperty('result')
            expect(reply).not.toHaveProperty('error')
            expect(reply).not.toMatchObject({ result: { isError: true } })
          }
          if (drives === 2) {
            await rpc(coordinationMcpUrl, 'tools/call', {
              name: 'submit_result',
              arguments: { result: 'checked-output' },
            })
          }
        },
        deliverable: {
          check: (result) => {
            checks += 1
            return result === 'checked-output'
          },
        },
        continuation: testContinuation(),
      },
    )
    const result = await run(root, blobs, journal)
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toBe('checked-output')
    expect(drives).toBe(2)
    expect(tasks[1]).toContain('submit_result')
    expect(tasks[1]).toContain('read_journal')
    expect(tasks[1]).toContain('await_event')
    expect(checks).toBe(1)
  })
})
