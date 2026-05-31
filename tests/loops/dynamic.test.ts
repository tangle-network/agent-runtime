import type {
  AgentProfile,
  CreateSandboxOptions,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { PlannerError } from '../../src/errors'
import {
  type AgentRunSpec,
  createDynamicDriver,
  createSandboxPlanner,
  type LoopPlanPayload,
  type LoopTraceEmitter,
  type LoopTraceEvent,
  type OutputAdapter,
  runLoop,
  type TopologyMove,
  type TopologyPlanner,
  type Validator,
} from '../../src/loops'

interface Task {
  goal: string
  strategy: string
}

interface Out {
  strategy: string
  harness: string
  score: number
}

const VALID_THRESHOLD = 0.7

// Score is a pure function of the strategy the planner chose — so a stronger
// strategy (parallel-*) clears the bar while naive/careful do not. This lets a
// planner adapt: refine the strategy, then fan out when refinement stalls.
function scoreFor(strategy: string): number {
  if (strategy.startsWith('parallel')) return 0.9
  if (strategy === 'careful') return 0.6
  return 0.3
}

const output: OutputAdapter<Out> = {
  parse(events) {
    const last = events.at(-1)
    const data = last?.data as Partial<Out> | undefined
    return {
      strategy: data?.strategy ?? '',
      harness: data?.harness ?? '',
      score: typeof data?.score === 'number' ? data.score : 0,
    }
  },
}

const validator: Validator<Out> = {
  async validate(out) {
    return { valid: out.score >= VALID_THRESHOLD, score: out.score }
  },
}

function profile(name: string): AgentProfile {
  return { name }
}

function workerSpecs(names: string[]): AgentRunSpec<Task>[] {
  return names.map((name) => ({
    profile: profile(name),
    name,
    taskToPrompt: (t) => JSON.stringify(t),
  }))
}

// Worker client: each iteration's score derives from the task strategy carried
// in the prompt; the harness is read from the profile the kernel round-robined
// to. Records dispatch order so tests can assert topology + harness rotation.
function workerClient() {
  const dispatched: Array<{ harness: string; strategy: string }> = []
  return {
    dispatched,
    client: {
      async create(opts?: CreateSandboxOptions): Promise<SandboxInstance> {
        const harness =
          (opts?.backend?.profile && typeof opts.backend.profile === 'object'
            ? opts.backend.profile.name
            : undefined) ?? 'unknown'
        return {
          async *streamPrompt(message: string) {
            const task = JSON.parse(message) as Task
            dispatched.push({ harness, strategy: task.strategy })
            yield {
              type: 'result',
              data: { strategy: task.strategy, harness, score: scoreFor(task.strategy) },
            } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    },
  }
}

describe('runLoop + createDynamicDriver', () => {
  it('lets an adaptive planner choose refine→refine→fanout→stop from history', async () => {
    const goal = 'ship the feature'
    // The planner reads history and adapts: try cheap strategies first, escalate
    // to a heterogeneous fanout when refinement stalls, stop once a branch wins.
    const planner: TopologyPlanner<Task, Out> = ({ history }) => {
      if (history.some((h) => h.verdict?.valid === true)) return { kind: 'stop' }
      if (history.length === 0) return { kind: 'refine', task: { goal, strategy: 'naive' } }
      if (history.length === 1) return { kind: 'refine', task: { goal, strategy: 'careful' } }
      return {
        kind: 'fanout',
        tasks: [
          { goal, strategy: 'parallel-a' },
          { goal, strategy: 'parallel-b' },
        ],
      }
    }

    const { client, dispatched } = workerClient()
    const result = await runLoop({
      driver: createDynamicDriver<Task, Out>({ planner, maxIterations: 8 }),
      agentRuns: workerSpecs(['worker-a', 'worker-b']),
      output,
      validator,
      task: { goal, strategy: 'naive' },
      ctx: { sandboxClient: client },
      maxIterations: 10,
    })

    expect(result.decision).toBe('done')
    expect(result.iterations).toHaveLength(4)
    expect(dispatched.map((d) => d.strategy)).toEqual([
      'naive',
      'careful',
      'parallel-a',
      'parallel-b',
    ])
    // The fanout round dispatched its two branches across two distinct harnesses.
    expect(result.iterations[2]?.agentRunName).toBe('worker-a')
    expect(result.iterations[3]?.agentRunName).toBe('worker-b')
    // Winner is the highest-valid-score attempt (0.9), earliest index breaks the tie.
    expect(result.winner?.verdict?.valid).toBe(true)
    expect(result.winner?.verdict?.score).toBeCloseTo(0.9, 6)
    expect(result.winner?.iterationIndex).toBe(2)
  })

  it('runs an explicit refine→fanout→stop script across two harnesses', async () => {
    const goal = 'explicit'
    const moves: TopologyMove<Task>[] = [
      { kind: 'refine', task: { goal, strategy: 'careful' } },
      {
        kind: 'fanout',
        tasks: [
          { goal, strategy: 'parallel-a' },
          { goal, strategy: 'parallel-b' },
        ],
      },
      { kind: 'stop' },
    ]
    let round = 0
    const planner: TopologyPlanner<Task, Out> = () => moves[round++]!

    const { client } = workerClient()
    const result = await runLoop({
      driver: createDynamicDriver<Task, Out>({ planner }),
      agentRuns: workerSpecs(['claude-code', 'codex']),
      output,
      validator,
      task: { goal, strategy: 'careful' },
      ctx: { sandboxClient: client },
    })

    expect(result.decision).toBe('done')
    expect(round).toBe(3)
    // Assert the ordered iteration record (deterministic) rather than dispatch
    // order, which races across the concurrent fanout branches. The kernel maps
    // iteration index N to agentRuns[N % len], so the fanout spans both harnesses.
    expect(result.iterations.map((i) => [i.agentRunName, i.task.strategy])).toEqual([
      ['claude-code', 'careful'],
      ['codex', 'parallel-a'],
      ['claude-code', 'parallel-b'],
    ])
    expect(result.winner?.verdict?.score).toBeCloseTo(0.9, 6)
  })

  it('terminates on the maxIterations cap even when the planner never stops', async () => {
    const planner: TopologyPlanner<Task, Out> = () => ({
      kind: 'refine',
      task: { goal: 'forever', strategy: 'naive' },
    })
    const { client } = workerClient()
    const result = await runLoop({
      driver: createDynamicDriver<Task, Out>({ planner, maxIterations: 3 }),
      agentRun: workerSpecs(['solo'])[0],
      output,
      validator,
      task: { goal: 'forever', strategy: 'naive' },
      ctx: { sandboxClient: client },
      maxIterations: 10,
    })

    expect(result.iterations).toHaveLength(3)
    expect(result.decision).toBe('done')
  })

  it('clamps a fanout move to maxFanout branches', async () => {
    const moves: TopologyMove<Task>[] = [
      {
        kind: 'fanout',
        tasks: Array.from({ length: 5 }, (_, i) => ({ goal: 'wide', strategy: `parallel-${i}` })),
      },
      { kind: 'stop' },
    ]
    let round = 0
    const planner: TopologyPlanner<Task, Out> = () => moves[round++]!

    const { client, dispatched } = workerClient()
    const result = await runLoop({
      driver: createDynamicDriver<Task, Out>({ planner, maxFanout: 2 }),
      agentRuns: workerSpecs(['a', 'b']),
      output,
      validator,
      task: { goal: 'wide', strategy: 'parallel-0' },
      ctx: { sandboxClient: client },
    })

    expect(result.iterations).toHaveLength(2)
    expect(dispatched.map((d) => d.strategy)).toEqual(['parallel-0', 'parallel-1'])
  })

  it('fails loud on a fanout move with no tasks', async () => {
    const planner: TopologyPlanner<Task, Out> = () => ({ kind: 'fanout', tasks: [] })
    const { client } = workerClient()
    await expect(
      runLoop({
        driver: createDynamicDriver<Task, Out>({ planner }),
        agentRun: workerSpecs(['a'])[0],
        output,
        validator,
        task: { goal: 'x', strategy: 'naive' },
        ctx: { sandboxClient: client },
      }),
    ).rejects.toThrow(PlannerError)
  })

  it('fails loud on an unknown move kind', async () => {
    const planner = (() => ({ kind: 'teleport' })) as unknown as TopologyPlanner<Task, Out>
    const { client } = workerClient()
    await expect(
      runLoop({
        driver: createDynamicDriver<Task, Out>({ planner }),
        agentRun: workerSpecs(['a'])[0],
        output,
        validator,
        task: { goal: 'x', strategy: 'naive' },
        ctx: { sandboxClient: client },
      }),
    ).rejects.toThrow(/unknown move kind/i)
  })
})

// A single client serving BOTH the planner agent and the workers, routed by
// profile name. The planner sandbox reads "Iterations spent: N" out of the
// prompt the driver built and emits a structured topology-move envelope —
// exercising the real createSandboxPlanner → kernel → worker path.
function plannerAndWorkerClient(plannerMove: (spent: number) => unknown) {
  const dispatched: Array<{ harness: string; strategy: string }> = []
  const plannerPrompts: string[] = []
  return {
    dispatched,
    plannerPrompts,
    client: {
      async create(opts?: CreateSandboxOptions): Promise<SandboxInstance> {
        const name =
          (opts?.backend?.profile && typeof opts.backend.profile === 'object'
            ? opts.backend.profile.name
            : undefined) ?? 'unknown'
        if (name === 'planner') {
          return {
            async *streamPrompt(message: string) {
              plannerPrompts.push(message)
              const spent = Number(message.match(/Iterations spent: (\d+)/)?.[1] ?? '0')
              yield {
                type: 'result',
                data: { result: plannerMove(spent) },
              } satisfies SandboxEvent
            },
          } as unknown as SandboxInstance
        }
        return {
          async *streamPrompt(message: string) {
            const task = JSON.parse(message) as Task
            dispatched.push({ harness: name, strategy: task.strategy })
            yield {
              type: 'result',
              data: { strategy: task.strategy, harness: name, score: scoreFor(task.strategy) },
            } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    },
  }
}

describe('createSandboxPlanner', () => {
  it('drives the loop end-to-end: planner agent authors refine→fanout→stop', async () => {
    const goal = 'sandbox-planner'
    const { client, plannerPrompts } = plannerAndWorkerClient((spent) => {
      if (spent === 0) return { kind: 'refine', tasks: [{ goal, strategy: 'careful' }] }
      if (spent === 1)
        return {
          kind: 'fanout',
          tasks: [
            { goal, strategy: 'parallel-a' },
            { goal, strategy: 'parallel-b' },
          ],
        }
      return { kind: 'stop' }
    })

    const planner = createSandboxPlanner<Task, Out>({
      client,
      profile: profile('planner'),
      decodeTask: (raw) => raw as Task,
    })

    const result = await runLoop({
      driver: createDynamicDriver<Task, Out>({ planner }),
      agentRuns: workerSpecs(['worker-a', 'worker-b']),
      output,
      validator,
      task: { goal, strategy: 'naive' },
      ctx: { sandboxClient: client },
    })

    expect(result.decision).toBe('done')
    expect(result.iterations.map((i) => [i.agentRunName, i.task.strategy])).toEqual([
      ['worker-a', 'careful'],
      ['worker-b', 'parallel-a'],
      ['worker-a', 'parallel-b'],
    ])
    expect(result.winner?.verdict?.score).toBeCloseTo(0.9, 6)
    // The planner saw a growing history each round (its prompt carried the count).
    expect(plannerPrompts).toHaveLength(3)
    expect(plannerPrompts[0]).toMatch(/Iterations spent: 0/)
    expect(plannerPrompts[2]).toMatch(/Iterations spent: 3/)
  })

  it('expands the n shorthand into N copies of the root task', async () => {
    const { client, dispatched } = plannerAndWorkerClient((spent) =>
      spent === 0 ? { kind: 'fanout', n: 3 } : { kind: 'stop' },
    )
    const planner = createSandboxPlanner<Task, Out>({
      client,
      profile: profile('planner'),
      decodeTask: (raw) => raw as Task,
    })
    const result = await runLoop({
      driver: createDynamicDriver<Task, Out>({ planner, maxFanout: 4 }),
      agentRuns: workerSpecs(['a', 'b']),
      output,
      validator,
      task: { goal: 'n-shorthand', strategy: 'parallel-root' },
      ctx: { sandboxClient: client },
    })
    expect(dispatched).toHaveLength(3)
    expect(dispatched.every((d) => d.strategy === 'parallel-root')).toBe(true)
    expect(result.decision).toBe('done')
  })

  it('fails loud when the planner emits no parseable envelope', async () => {
    const client = {
      async create(): Promise<SandboxInstance> {
        return {
          async *streamPrompt() {
            yield { type: 'message', data: { text: 'I think we should keep going!' } }
          },
        } as unknown as SandboxInstance
      },
    }
    const planner = createSandboxPlanner<Task, Out>({
      client,
      profile: profile('planner'),
      decodeTask: (raw) => raw as Task,
    })
    await expect(
      runLoop({
        driver: createDynamicDriver<Task, Out>({ planner }),
        agentRun: workerSpecs(['a'])[0],
        output,
        validator,
        task: { goal: 'x', strategy: 'naive' },
        ctx: { sandboxClient: client },
      }),
    ).rejects.toThrow(/no parseable topology-move envelope/i)
  })

  it('parses a fenced JSON envelope from a text delta', async () => {
    let plannerRound = 0
    const client = {
      async create(opts?: CreateSandboxOptions): Promise<SandboxInstance> {
        const name =
          (opts?.backend?.profile && typeof opts.backend.profile === 'object'
            ? opts.backend.profile.name
            : undefined) ?? 'unknown'
        if (name === 'planner') {
          const fenced =
            plannerRound++ === 0
              ? '```json\n{"kind":"refine","tasks":[{"goal":"g","strategy":"parallel-x"}]}\n```'
              : '```json\n{"kind":"stop"}\n```'
          return {
            async *streamPrompt() {
              yield { type: 'message.delta', data: { text: `here is my plan:\n${fenced}` } }
            },
          } as unknown as SandboxInstance
        }
        return {
          async *streamPrompt(message: string) {
            const task = JSON.parse(message) as Task
            yield {
              type: 'result',
              data: { strategy: task.strategy, harness: name, score: scoreFor(task.strategy) },
            } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    }
    const planner = createSandboxPlanner<Task, Out>({
      client,
      profile: profile('planner'),
      decodeTask: (raw) => raw as Task,
    })
    const result = await runLoop({
      driver: createDynamicDriver<Task, Out>({ planner }),
      agentRun: workerSpecs(['a'])[0],
      output,
      validator,
      task: { goal: 'g', strategy: 'naive' },
      ctx: { sandboxClient: client },
    })
    expect(result.decision).toBe('done')
    expect(result.winner?.verdict?.score).toBeCloseTo(0.9, 6)
  })

  it('surfaces a decodeTask rejection as a PlannerError', async () => {
    const client = {
      async create(): Promise<SandboxInstance> {
        return {
          async *streamPrompt() {
            yield { type: 'result', data: { result: { kind: 'refine', tasks: [{ bad: true }] } } }
          },
        } as unknown as SandboxInstance
      },
    }
    const planner = createSandboxPlanner<Task, Out>({
      client,
      profile: profile('planner'),
      decodeTask: (raw) => {
        const t = raw as Partial<Task>
        if (typeof t.strategy !== 'string') throw new Error('missing strategy')
        return t as Task
      },
    })
    await expect(
      runLoop({
        driver: createDynamicDriver<Task, Out>({ planner }),
        agentRun: workerSpecs(['a'])[0],
        output,
        validator,
        task: { goal: 'x', strategy: 'naive' },
        ctx: { sandboxClient: client },
      }),
    ).rejects.toThrow(PlannerError)
  })
})

describe('runLoop dynamic driver — trace emission for topology viewers', () => {
  it('emits loop.plan with move kind + rationale, and iteration tokenUsage', async () => {
    const goal = 'trace'
    const moves: TopologyMove<Task>[] = [
      { kind: 'refine', task: { goal, strategy: 'parallel-x' }, rationale: 'first pass, refine' },
      { kind: 'stop', rationale: 'valid result exists' },
    ]
    let round = 0
    const planner: TopologyPlanner<Task, Out> = () => moves[round++]!

    const client = {
      async create(opts?: CreateSandboxOptions): Promise<SandboxInstance> {
        const name =
          (opts?.backend?.profile && typeof opts.backend.profile === 'object'
            ? opts.backend.profile.name
            : undefined) ?? 'w'
        return {
          async *streamPrompt(message: string) {
            const task = JSON.parse(message) as Task
            // result event carries usage → kernel sums it into iteration tokenUsage
            yield {
              type: 'result',
              data: {
                strategy: task.strategy,
                harness: name,
                score: scoreFor(task.strategy),
                usage: { inputTokens: 800, outputTokens: 200 },
              },
            } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    }

    const all: LoopTraceEvent[] = []
    const planPayloads: LoopPlanPayload[] = []
    const traceEmitter: LoopTraceEmitter = {
      emit(e) {
        all.push(e)
        if (e.kind === 'loop.plan') planPayloads.push(e.payload)
      },
    }

    const result = await runLoop({
      driver: createDynamicDriver<Task, Out>({ planner }),
      agentRun: workerSpecs(['w'])[0],
      output,
      validator,
      task: { goal, strategy: 'naive' },
      ctx: { sandboxClient: client, traceEmitter },
    })

    expect(result.decision).toBe('done')
    expect(planPayloads.map((p) => p.moveKind)).toEqual(['refine', 'stop'])
    expect(planPayloads[0]?.rationale).toBe('first pass, refine')
    expect(planPayloads[1]?.rationale).toBe('valid result exists')

    const ended = all.find((e) => e.kind === 'loop.iteration.ended')
    expect(ended?.kind).toBe('loop.iteration.ended')
    if (ended?.kind === 'loop.iteration.ended') {
      expect(ended.payload.tokenUsage).toEqual({ input: 800, output: 200 })
    }
  })
})
