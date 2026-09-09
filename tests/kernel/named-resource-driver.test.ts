import { expect, it } from 'vitest'
import { InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { Agent, Spend } from '../../src/runtime/supervise/types'
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

it.each(['reported', 'missing', 'malformed'])(
  'meters explicit root resource receipts before tool calls: receipt=%s',
  async (mode) => {
    const reported = mode === 'reported'
    const resources = {
      compute: { unit: 'millisecond', limit: 100 },
      transfer: { unit: 'byte', limit: 100 },
    }
    const receipt: Spend['resources'] = {
      compute: { unit: 'millisecond', amount: 2, known: true },
      transfer: { unit: 'byte', amount: 0, known: true },
    }
    const journal = new InMemorySpawnJournal()
    let entered = 0
    let calls = 0
    const brain: ToolLoopChat = async () => ({
      toolCalls:
        calls++ === 0
          ? [
              {
                id: 'spawn',
                name: 'spawn_worker',
                arguments: JSON.stringify({ profile: testAgentProfile('leaf'), task: 'work' }),
              },
              { id: 'await', name: 'await_event', arguments: '{}' },
            ]
          : [],
      usage: { input: 1, output: 1 },
      ...(reported ? { resources: receipt } : {}),
    })
    const leaf: Agent<unknown, unknown> = {
      name: 'leaf',
      act: async () => 'unused',
      executorSpec: {
        profile: testAgentProfile('leaf'),
        harness: null,
        executor: {
          runtime: 'resource-receipt',
          execute: async () => {
            entered++
            return {
              outRef: 'leaf',
              out: 'done',
              spent: {
                iterations: 1,
                tokens: { input: 1, output: 1 },
                usd: 0,
                ms: 0,
                resources: receipt,
              },
            }
          },
          teardown: async () => ({ destroyed: true }),
        },
      },
    }
    const result = await supervise(
      testAgentProfile('root', {
        harness: 'cli-base',
        tools: runtimeToolDeclarations('spawn_worker', 'await_event'),
      }),
      'work',
      {
        router: {
          routerBaseUrl: 'http://unused.invalid/v1',
          routerKey: 'offline',
          complete: async (body) => {
            expect(body.model).toBe('offline-test-model')
            const result = await brain([], [])
            return {
              model: body.model,
              choices: [
                {
                  message: {
                    content: result.content,
                    tool_calls: result.toolCalls.map((call) => ({
                      id: call.id,
                      type: 'function',
                      function: { name: call.name, arguments: call.arguments },
                    })),
                  },
                },
              ],
              usage: {
                prompt_tokens: result.usage?.input,
                completion_tokens: result.usage?.output,
                ...(mode === 'malformed'
                  ? { resources: { compute: { unit: 'millisecond', amount: -1, known: true } } }
                  : result.resources
                    ? { resources: result.resources }
                    : {}),
              },
            }
          },
        },
        journal,
        budget: { maxTokens: 100, maxIterations: 10, resources },
        perWorker: {
          maxTokens: 10,
          maxIterations: 1,
          resources: {
            compute: { unit: 'millisecond', limit: 10 },
            transfer: { unit: 'byte', limit: 10 },
          },
        },
        makeWorkerAgent: () => leaf,
      },
    )
    expect(entered).toBe(reported ? 1 : 0)
    expect(result.spentTotal.resources?.compute.known).toBe(reported)
    expect(result.spentTotal.resources?.transfer).toEqual({
      unit: 'byte',
      amount: 0,
      known: reported,
    })
    const events = await journal.loadTree('supervise')
    const metered = events?.filter((event) => event.kind === 'metered') ?? []
    expect(metered.length).toBeGreaterThan(0)
    for (const event of metered) {
      if (event.kind !== 'metered') continue
      expect(event.spend.resources?.compute).toEqual({
        unit: 'millisecond',
        amount: reported ? 2 : 0,
        known: reported,
      })
    }
  },
)
