import type {
  AgentProfile,
  CreateSandboxOptions,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  createFanoutVoteDriver,
  type OutputAdapter,
  runLoop,
  scoreFanoutVoteIterations,
  type Validator,
} from '../../src/loops'

interface FanTask {
  goal: string
}

interface FanOutput {
  variantId: string
  score: number
}

const output: OutputAdapter<FanOutput> = {
  parse(events) {
    const last = events.at(-1)
    const data = last?.data as { variantId?: string; score?: number } | undefined
    return {
      variantId: data?.variantId ?? '',
      score: typeof data?.score === 'number' ? data.score : 0,
    }
  },
}

const validator: Validator<FanOutput> = {
  async validate(out) {
    return { valid: out.score > 0.5, score: out.score }
  },
}

function profile(name: string): AgentProfile {
  return { name }
}

function specs(names: string[]): AgentRunSpec<FanTask>[] {
  return names.map((name) => ({
    profile: profile(name),
    name,
    taskToPrompt: (t) => t.goal,
  }))
}

function deterministicClient(outputs: Array<{ variantId: string; score: number }>): {
  client: { create(opts?: CreateSandboxOptions): Promise<SandboxInstance> }
  observed: { creates: number; concurrentMax: number }
} {
  const state = { creates: 0, concurrentMax: 0, inflight: 0 }
  const pending: Array<() => void> = []
  return {
    observed: state as { creates: number; concurrentMax: number },
    client: {
      async create() {
        const i = state.creates
        state.creates += 1
        const variant = outputs[i] ?? { variantId: `unknown-${i}`, score: 0 }
        const release = new Promise<void>((resolve) => pending.push(resolve))
        const box = {
          async *streamPrompt() {
            state.inflight += 1
            state.concurrentMax = Math.max(state.concurrentMax, state.inflight)
            // Yield to the scheduler so all sandboxes start in parallel.
            await new Promise((r) => setTimeout(r, 0))
            // Release the next pending sandbox so concurrency can climb.
            const next = pending.shift()
            if (next) next()
            await release
            state.inflight -= 1
            yield {
              type: 'result',
              data: { variantId: variant.variantId, score: variant.score },
            } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
        // First sandbox releases the pump.
        if (i === 0) {
          setTimeout(() => {
            const next = pending.shift()
            if (next) next()
          }, 0)
        }
        return box
      },
    },
  }
}

describe('runLoop + createFanoutVoteDriver', () => {
  it('spawns N parallel attempts and selects the highest-scoring valid winner', async () => {
    const outputs = [
      { variantId: 'a', score: 0.3 },
      { variantId: 'b', score: 0.9 },
      { variantId: 'c', score: 0.7 },
    ]
    let createdCount = 0
    const client = {
      async create() {
        const i = createdCount
        createdCount += 1
        const variant = outputs[i]!
        return {
          async *streamPrompt() {
            yield {
              type: 'result',
              data: { variantId: variant.variantId, score: variant.score },
            } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    }

    const result = await runLoop({
      driver: createFanoutVoteDriver<FanTask, FanOutput>({ n: 3 }),
      agentRun: {
        profile: profile('uniform'),
        name: 'uniform',
        taskToPrompt: (t) => t.goal,
      },
      output,
      validator,
      task: { goal: 'fanout' },
      ctx: { sandboxClient: client },
    })

    expect(result.iterations).toHaveLength(3)
    expect(result.decision).toBe('pick-winner')
    expect(result.winner?.output.variantId).toBe('b')
    expect(result.winner?.verdict?.score).toBeCloseTo(0.9, 6)
  })

  it('resolves to fail when no iteration produces a valid output', async () => {
    let createdCount = 0
    const client = {
      async create() {
        const i = createdCount
        createdCount += 1
        return {
          async *streamPrompt() {
            yield {
              type: 'result',
              data: { variantId: `v${i}`, score: 0.1 },
            } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    }

    const result = await runLoop({
      driver: createFanoutVoteDriver<FanTask, FanOutput>({ n: 2 }),
      agentRun: {
        profile: profile('weak'),
        name: 'weak',
        taskToPrompt: (t) => t.goal,
      },
      output,
      validator,
      task: { goal: 'fail-fanout' },
      ctx: { sandboxClient: client },
    })

    expect(result.decision).toBe('fail')
    expect(result.iterations).toHaveLength(2)
  })

  it('respects maxConcurrency cap on parallel fanout', async () => {
    const { client, observed } = deterministicClient(
      Array.from({ length: 4 }, (_, i) => ({ variantId: `v${i}`, score: 0.6 })),
    )
    await runLoop({
      driver: createFanoutVoteDriver<FanTask, FanOutput>({ n: 4 }),
      agentRun: {
        profile: profile('uniform'),
        name: 'uniform',
        taskToPrompt: (t) => t.goal,
      },
      output,
      validator,
      task: { goal: 'cap' },
      ctx: { sandboxClient: client },
      maxConcurrency: 2,
    })

    expect(observed.creates).toBe(4)
    expect(observed.concurrentMax).toBeLessThanOrEqual(2)
  })

  it('rotates through heterogeneous agentRuns for diversity', async () => {
    const used: string[] = []
    let createdCount = 0
    const client = {
      async create(opts?: CreateSandboxOptions) {
        const name =
          (opts?.backend?.profile && typeof opts.backend.profile === 'object'
            ? opts.backend.profile.name
            : undefined) ?? 'unknown'
        used.push(name)
        const i = createdCount
        createdCount += 1
        return {
          async *streamPrompt() {
            yield {
              type: 'result',
              data: { variantId: `${name}-${i}`, score: 0.9 },
            } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    }

    const result = await runLoop({
      driver: createFanoutVoteDriver<FanTask, FanOutput>({ n: 3 }),
      agentRuns: specs(['alpha', 'beta', 'gamma']),
      output,
      validator,
      task: { goal: 'diversity' },
      ctx: { sandboxClient: client },
    })

    expect(used).toEqual(['alpha', 'beta', 'gamma'])
    expect(result.iterations.map((i) => i.agentRunName)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('scoreFanoutVoteIterations surfaces the per-iteration view', () => {
    const scored = scoreFanoutVoteIterations<FanTask, FanOutput>([
      {
        index: 0,
        task: { goal: '' },
        agentRunName: 'a',
        events: [],
        startedAt: 0,
        endedAt: 0,
        costUsd: 0,
        output: { variantId: 'x', score: 0.5 },
        verdict: { valid: true, score: 0.5 },
      },
      {
        index: 1,
        task: { goal: '' },
        agentRunName: 'b',
        events: [],
        startedAt: 0,
        endedAt: 0,
        costUsd: 0,
        error: new Error('boom'),
      },
    ])
    expect(scored).toHaveLength(1)
    expect(scored[0]?.iterationIndex).toBe(0)
  })

  it('rejects mismatched options (agentRun + agentRuns)', async () => {
    await expect(
      runLoop({
        driver: createFanoutVoteDriver<FanTask, FanOutput>({ n: 1 }),
        agentRun: specs(['a'])[0],
        agentRuns: specs(['a', 'b']),
        output,
        validator,
        task: { goal: 'bad' },
        ctx: {
          sandboxClient: {
            async create() {
              throw new Error('unreachable')
            },
          },
        },
      }),
    ).rejects.toThrow(/exactly one of/i)
  })
})
