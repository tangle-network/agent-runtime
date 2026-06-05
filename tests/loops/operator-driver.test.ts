import { describe, expect, it } from 'vitest'
import {
  type Agent,
  type AgentSpec,
  createSupervisor,
  type ExecutorContext,
  type ExecutorRegistry,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  type LeafResult,
  type Runtime,
} from '../../src/loops'
import { createOperatorDriverAgent, type ToolChat } from '../../src/mcp/tools/operator-driver'

// A stub worker registry: each leaf "solves" to a verdict whose score rides in its spawn task.
// No router, no LLM — the leaf IS the worker, so the test exercises the DRIVER (spawn/await/select)
// through the real Supervisor + conserved budget pool, not a model. outRef is content-stable.
function stubWorkerRegistry(): ExecutorRegistry {
  let n = 0
  return {
    register() {
      throw new Error('stub: register unsupported')
    },
    resolve(_spec: AgentSpec) {
      const factory = (_s: AgentSpec, _ctx: ExecutorContext) => {
        let artifact: LeafResult<unknown> | undefined
        return {
          runtime: 'stub-worker' as Runtime,
          async execute(task: unknown): Promise<LeafResult<unknown>> {
            const score =
              typeof task === 'object' &&
              task &&
              typeof (task as { score?: unknown }).score === 'number'
                ? (task as { score: number }).score
                : 0
            const out = {
              answer: `worker@${score}`,
              messages: [{ role: 'assistant', content: `solved at ${score}` }],
            }
            n += 1
            artifact = {
              outRef: `blob:${n}:${score}`,
              out,
              verdict: { valid: score >= 1, score },
              spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
            }
            return artifact
          },
          teardown: () => Promise.resolve({ destroyed: true }),
          resultArtifact() {
            if (!artifact) throw new Error('stub: resultArtifact before execute')
            return artifact
          },
        }
      }
      return { succeeded: true as const, value: factory }
    },
  }
}

// A scripted operator — a turn-indexed sequence of tool calls standing in for the LLM.
function scriptedChat(script: Array<Array<{ name: string; args: unknown }>>): ToolChat {
  let turn = 0
  return () => {
    const calls = script[turn] ?? []
    turn += 1
    return Promise.resolve({
      content: null,
      toolCalls: calls.map((c, i) => ({
        id: `t${turn}_${i}`,
        name: c.name,
        arguments: JSON.stringify(c.args),
      })),
    })
  }
}

const workerAgent = (): Agent<unknown, unknown> =>
  ({
    name: 'w',
    executorSpec: { profile: {}, harness: null },
    act: () => Promise.reject(new Error('leaf runs via executor')),
  }) as unknown as Agent<unknown, unknown>

describe('operator driver (live, through the real Supervisor)', () => {
  it('drives spawn → await_next → stop and selects the best deployable verdict', async () => {
    const blobs = new InMemoryResultBlobStore()
    const driver = createOperatorDriverAgent({
      systemPrompt: 'You lead workers.',
      describeTask: () => 'solve it',
      chat: scriptedChat([
        [
          { name: 'spawn_worker', args: { profile: {}, task: { score: 0.4 } } },
          { name: 'spawn_worker', args: { profile: {}, task: { score: 0.9 } } },
        ],
        [{ name: 'await_next', args: {} }],
        [{ name: 'await_next', args: {} }],
        [{ name: 'stop', args: { reason: 'best collected' } }],
      ]),
      blobs,
      makeWorkerAgent: () => workerAgent(),
      perWorker: { maxIterations: 1, maxTokens: 1000 },
      maxTurns: 10,
    })
    const result = await createSupervisor<unknown, unknown>().run(
      driver,
      {},
      {
        budget: { maxIterations: 10, maxTokens: 10_000 },
        runId: 'op-test',
        journal: new InMemorySpawnJournal(),
        blobs,
        executors: stubWorkerRegistry(),
      },
    )
    expect(result.kind).toBe('winner')
    if (result.kind !== 'winner') throw new Error('expected a winner')
    const out = result.out as {
      mode: string
      resolved: boolean
      score: number
      selected: { answer: string }
      workers: unknown[]
      stopReason: string
    }
    expect(out.mode).toBe('operator-driver')
    expect(out.score).toBe(0.9) // best of {0.4, 0.9}
    expect(out.resolved).toBe(false) // 0.9 < 1 ⇒ deployable verdict did not pass
    expect(out.selected.answer).toBe('worker@0.9')
    expect(out.workers).toHaveLength(2)
    expect(out.stopReason).toBe('best collected')
  })

  it('fails closed: a spawn past the conserved pool returns budget-exhausted (equal-k holds for an LLM driver)', async () => {
    const blobs = new InMemoryResultBlobStore()
    const spawnResults: Array<Record<string, unknown>> = []
    const driver = createOperatorDriverAgent({
      systemPrompt: 'You lead workers.',
      describeTask: () => 'go',
      chat: scriptedChat([
        [
          { name: 'spawn_worker', args: { profile: {}, task: { score: 0.5 } } },
          { name: 'spawn_worker', args: { profile: {}, task: { score: 0.6 } } },
          { name: 'spawn_worker', args: { profile: {}, task: { score: 0.7 } } },
        ],
        [{ name: 'stop', args: { reason: 'done' } }],
      ]),
      blobs,
      makeWorkerAgent: () => workerAgent(),
      perWorker: { maxIterations: 1, maxTokens: 1000 },
      maxTurns: 5,
      onStep: (s) => {
        for (const c of s.calls)
          if (c.name === 'spawn_worker') spawnResults.push(c.result as Record<string, unknown>)
      },
    })
    const result = await createSupervisor<unknown, unknown>().run(
      driver,
      {},
      {
        // The pool admits exactly two workers (each reserves maxIterations:1). A worker spending its
        // full reservation refunds nothing, so the iterations cap is timing-independent: the 3rd spawn
        // fails closed regardless of when earlier workers settle. This IS equal-k for an LLM driver.
        budget: { maxIterations: 2, maxTokens: 1_000_000 },
        runId: 'op-cap',
        journal: new InMemorySpawnJournal(),
        blobs,
        executors: stubWorkerRegistry(),
      },
    )
    expect(result.kind).toBe('winner')
    const ok = spawnResults.filter((r) => 'workerId' in r)
    const failed = spawnResults.filter((r) => 'error' in r)
    expect(ok).toHaveLength(2)
    expect(failed).toHaveLength(1)
    expect(failed[0]?.error).toBe('budget-exhausted')
  })
})
