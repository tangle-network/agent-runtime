import type { AgentProfile } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import type { ExecutorConfig } from '../../src/runtime/supervise/runtime'
import { supervise, workerFromBackend } from '../../src/runtime/supervise/supervise'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { scriptedBrain } from './scripted-brain'

const budget: Budget = { maxIterations: 100, maxTokens: 100_000 }

function deliveringLeaf(name: string, out: unknown): Agent<unknown, unknown> {
  const ex: Executor<unknown> = {
    runtime: 'router',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `w:${name}`,
      out,
      verdict: { valid: true, score: 1 },
      spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor: ex }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

describe('supervise — the one-call convenience (defaults blobs/perWorker/journal/executors)', () => {
  it('runs a supervisor to delivery from just profile + task + worker seam + brain + budget', async () => {
    const brain = scriptedBrain([
      {
        toolCalls: [
          { name: 'spawn_worker', arguments: { profile: { kind: 'worker' }, task: 'go' } },
        ],
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ])
    const result = await supervise(
      { name: 'root', harness: null, systemPrompt: 'drive the worker' },
      'solve it',
      { budget, makeWorkerAgent: () => deliveringLeaf('w', { answer: 42 }), brain },
    )
    expect(result.kind).toBe('winner')
  })

  it('workerFromBackend builds a spawnable worker leaf with an executor (no network)', () => {
    const make = workerFromBackend({
      backend: 'router-tools',
      routerBaseUrl: 'http://localhost',
      routerKey: 'k',
      model: 'm',
    } as ExecutorConfig)
    const w = make({ name: 'w' }) as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    expect(w.name).toBe('w')
    expect(w.executorSpec.executor).toBeDefined()
  })

  it('fails loud with neither backend nor makeWorkerAgent', () => {
    expect(() => supervise({ name: 'r', harness: null }, 't', { budget })).toThrow(
      /backend|makeWorkerAgent/,
    )
  })
})
