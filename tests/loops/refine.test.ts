import type {
  AgentProfile,
  CreateSandboxOptions,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  createRefineDriver,
  type LoopTraceEvent,
  type OutputAdapter,
  refineWinnerIndex,
  reportLoopUsage,
  runLoop,
  type Validator,
} from '../../src/loops'
import type { RuntimeHookEvent } from '../../src/runtime-hooks'

interface RefineTask {
  goal: string
}

interface RefineOutput {
  attempt: number
}

const profile: AgentProfile = { name: 'stub' }

function spec(): AgentRunSpec<RefineTask> {
  return {
    profile,
    name: 'refiner',
    taskToPrompt: (task) => task.goal,
  }
}

function stubClient(eventsPerCall: SandboxEvent[][]): {
  client: { create(opts?: CreateSandboxOptions): Promise<SandboxInstance> }
  creates: number
  prompts: string[]
} {
  const state = { creates: 0, prompts: [] as string[] }
  let callIndex = 0
  return {
    creates: state.creates,
    prompts: state.prompts,
    client: {
      async create() {
        state.creates += 1
        const events = eventsPerCall[callIndex] ?? []
        callIndex += 1
        const box = {
          async *streamPrompt(message: string) {
            state.prompts.push(message)
            for (const e of events) yield e
          },
        } as unknown as SandboxInstance
        return box
      },
    },
  }
}

const output: OutputAdapter<RefineOutput> = {
  parse: (events) => {
    const last = events.at(-1)
    const data = last?.data as { attempt?: number } | undefined
    return { attempt: typeof data?.attempt === 'number' ? data.attempt : -1 }
  },
}

const passOnSecond: Validator<RefineOutput> = {
  async validate(out) {
    if (out.attempt >= 2) return { valid: true, score: 1, scores: { attempt: 1 } }
    return { valid: false, score: 0, scores: { attempt: 0 }, notes: 'try again' }
  },
}

describe('runLoop + createRefineDriver', () => {
  it('iterates until the validator returns valid=true', async () => {
    const stub = stubClient([
      [{ type: 'result', data: { attempt: 1 } }],
      [{ type: 'result', data: { attempt: 2 } }],
    ])
    const result = await runLoop({
      driver: createRefineDriver<RefineTask, RefineOutput>(),
      agentRun: spec(),
      output,
      validator: passOnSecond,
      task: { goal: 'fix it' },
      ctx: { sandboxClient: stub.client },
    })

    expect(result.decision).toBe('stop')
    expect(result.iterations).toHaveLength(2)
    expect(result.iterations[0]?.verdict?.valid).toBe(false)
    expect(result.iterations[1]?.verdict?.valid).toBe(true)
    expect(result.winner?.iterationIndex).toBe(1)
    expect(result.winner?.output).toEqual({ attempt: 2 })
    expect(stub.client).toBeDefined()
  })

  it('respects the driver-local maxIterations cap and reports stop', async () => {
    const events: SandboxEvent[][] = Array.from({ length: 6 }, (_, i) => [
      { type: 'result', data: { attempt: i } },
    ])
    const failing: Validator<RefineOutput> = {
      async validate() {
        return { valid: false, score: 0, scores: { attempt: 0 } }
      },
    }
    const stub = stubClient(events)
    const result = await runLoop({
      driver: createRefineDriver<RefineTask, RefineOutput>({ maxIterations: 3 }),
      agentRun: spec(),
      output,
      validator: failing,
      task: { goal: 'never passes' },
      ctx: { sandboxClient: stub.client },
    })

    expect(result.iterations).toHaveLength(3)
    expect(result.decision).toBe('stop')
    expect(result.winner?.iterationIndex).toBeDefined()
  })

  it('respects the kernel maxIterations cap and re-asks the driver for a final decision', async () => {
    const events: SandboxEvent[][] = Array.from({ length: 4 }, () => [
      { type: 'result', data: { attempt: 0 } },
    ])
    const failing: Validator<RefineOutput> = {
      async validate() {
        return { valid: false, score: 0, scores: { attempt: 0 } }
      },
    }
    const stub = stubClient(events)
    const result = await runLoop({
      driver: createRefineDriver<RefineTask, RefineOutput>({ maxIterations: 10 }),
      agentRun: spec(),
      output,
      validator: failing,
      task: { goal: 'never passes' },
      ctx: { sandboxClient: stub.client },
      maxIterations: 2,
    })
    expect(result.iterations).toHaveLength(2)
  })

  it('emits trace events in canonical order', async () => {
    const events: LoopTraceEvent[] = []
    const stub = stubClient([
      [{ type: 'result', data: { attempt: 1 } }],
      [{ type: 'result', data: { attempt: 2 } }],
    ])
    await runLoop({
      driver: createRefineDriver<RefineTask, RefineOutput>(),
      agentRun: spec(),
      output,
      validator: passOnSecond,
      task: { goal: 'trace order' },
      ctx: {
        sandboxClient: stub.client,
        traceEmitter: { emit: (e) => void events.push(e) },
      },
      runId: 'fixed-run-id',
    })

    const kinds = events.map((e) => e.kind)
    expect(kinds[0]).toBe('loop.started')
    expect(kinds[kinds.length - 1]).toBe('loop.ended')
    // Each iteration emits a started + ended; two iterations = two pairs.
    const startedCount = kinds.filter((k) => k === 'loop.iteration.started').length
    const endedCount = kinds.filter((k) => k === 'loop.iteration.ended').length
    expect(startedCount).toBe(2)
    expect(endedCount).toBe(2)
    // Every event references the same runId.
    expect(events.every((e) => e.runId === 'fixed-run-id')).toBe(true)
    // Decision event follows each iteration.
    const decisionCount = kinds.filter((k) => k === 'loop.decision').length
    expect(decisionCount).toBeGreaterThanOrEqual(2)
  })

  it('emits runtime hooks around agent.run plan and decision lifecycle', async () => {
    const events: RuntimeHookEvent[] = []
    const stub = stubClient([[{ type: 'result', data: { attempt: 1 } }]])
    const passFirst: Validator<RefineOutput> = {
      async validate() {
        return { valid: true, score: 1, scores: { attempt: 1 } }
      },
    }

    await runLoop({
      driver: createRefineDriver<RefineTask, RefineOutput>(),
      agentRun: spec(),
      output,
      validator: passFirst,
      task: { goal: 'hook order' },
      ctx: {
        sandboxClient: stub.client,
        hooks: {
          onEvent: (event) => {
            events.push(event)
          },
        },
      },
      runId: 'hook-run-id',
    })

    expect(events.map((event) => `${event.target}:${event.phase}`)).toEqual([
      'agent.run:before',
      'agent.plan:before',
      'agent.plan:after',
      'agent.decision:before',
      'agent.decision:after',
      'agent.run:after',
    ])
    expect(
      events.find((event) => event.target === 'agent.plan' && event.phase === 'after'),
    ).toMatchObject({
      runId: 'hook-run-id',
      payload: { plannedCount: 1, moveKind: 'refine' },
    })
  })

  it('captures per-iteration errors without aborting the whole loop', async () => {
    const stub = {
      creates: 0,
      client: {
        async create() {
          stub.creates += 1
          if (stub.creates === 1) {
            return {
              streamPrompt(): AsyncIterable<SandboxEvent> {
                return {
                  [Symbol.asyncIterator]: () => ({
                    next: () => Promise.reject(new Error('sandbox blew up')),
                  }),
                }
              },
            } as unknown as SandboxInstance
          }
          return {
            async *streamPrompt() {
              yield { type: 'result', data: { attempt: 2 } } satisfies SandboxEvent
            },
          } as unknown as SandboxInstance
        },
      },
    }

    const result = await runLoop({
      driver: createRefineDriver<RefineTask, RefineOutput>(),
      agentRun: spec(),
      output,
      validator: passOnSecond,
      task: { goal: 'survive errors' },
      ctx: { sandboxClient: stub.client },
    })

    expect(result.iterations[0]?.error?.message).toContain('sandbox blew up')
    expect(result.iterations[0]?.output).toBeUndefined()
    expect(result.iterations[1]?.verdict?.valid).toBe(true)
    expect(result.decision).toBe('stop')
  })

  it('aggregates costUsd from llm_call events across iterations', async () => {
    const stub = stubClient([
      [
        { type: 'llm_call', data: { tokensIn: 100, tokensOut: 50, costUsd: 0.01, model: 'm' } },
        { type: 'result', data: { attempt: 1 } },
      ],
      [
        { type: 'llm_call', data: { tokensIn: 80, tokensOut: 30, costUsd: 0.02, model: 'm' } },
        { type: 'result', data: { attempt: 2 } },
      ],
    ])
    const result = await runLoop({
      driver: createRefineDriver<RefineTask, RefineOutput>(),
      agentRun: spec(),
      output,
      validator: passOnSecond,
      task: { goal: 'cost' },
      ctx: { sandboxClient: stub.client },
    })
    expect(result.iterations[0]?.costUsd).toBeCloseTo(0.01, 9)
    expect(result.iterations[1]?.costUsd).toBeCloseTo(0.02, 9)
    expect(result.costUsd).toBeCloseTo(0.03, 9)
    // Token usage must aggregate too — a runProfileMatrix dispatch forwards
    // this to the backend-integrity guard; if it stayed 0/0 a real run would
    // be misread as a stub.
    expect(result.iterations[0]?.tokenUsage).toEqual({ input: 100, output: 50 })
    expect(result.iterations[1]?.tokenUsage).toEqual({ input: 80, output: 30 })
    expect(result.tokenUsage).toEqual({ input: 180, output: 80 })

    // reportLoopUsage forwards both cost AND tokens into a campaign cost meter.
    const observed: Array<{ usd: number; src: string }> = []
    let tokens = { input: 0, output: 0 }
    reportLoopUsage(
      {
        observe: (usd, src) => observed.push({ usd, src }),
        observeTokens: (u) => {
          tokens = u
        },
      },
      result,
    )
    expect(observed).toEqual([{ usd: 0.03, src: 'loop' }])
    expect(tokens).toEqual({ input: 180, output: 80 })
  })

  it('refineWinnerIndex returns the last valid iteration', () => {
    expect(
      refineWinnerIndex([
        {
          index: 0,
          task: {} as RefineTask,
          agentRunName: 'refiner',
          events: [],
          startedAt: 0,
          endedAt: 0,
          costUsd: 0,
          verdict: { valid: false, score: 0 },
        },
        {
          index: 1,
          task: {} as RefineTask,
          agentRunName: 'refiner',
          events: [],
          startedAt: 0,
          endedAt: 0,
          costUsd: 0,
          verdict: { valid: true, score: 1 },
        },
        {
          index: 2,
          task: {} as RefineTask,
          agentRunName: 'refiner',
          events: [],
          startedAt: 0,
          endedAt: 0,
          costUsd: 0,
          verdict: { valid: false, score: 0 },
        },
      ]),
    ).toBe(1)
  })
})
