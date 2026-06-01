import type {
  AgentProfile,
  CreateSandboxOptions,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  createDynamicDriver,
  createSandboxPlanner,
  createSteeringPlanner,
  defaultAnalyze,
  type Iteration,
  type OutputAdapter,
  runLoop,
  type Validator,
} from '../../src/loops'

// ── Worker model ────────────────────────────────────────────────────────────
// Score is a pure function of the strategy the driver steers the worker toward.
// A `parallel-*` strategy clears the bar; `naive` does not. So a loop only wins
// if the driver STEERS off `naive` — which it can only do if it SEES that the
// `naive` attempt failed. That visibility is the whole point of the gen.
interface Task {
  goal: string
  strategy: string
}
interface Out {
  strategy: string
  score: number
}
const VALID_THRESHOLD = 0.7
const GOAL = 'produce the correct return'
const FIX_STRATEGY = 'parallel-tools'

function scoreFor(strategy: string): number {
  if (strategy.startsWith('parallel')) return 0.9
  if (strategy === 'careful') return 0.6
  return 0.3 // naive / bare
}

const output: OutputAdapter<Out> = {
  parse(events) {
    const data = events.at(-1)?.data as Partial<Out> | undefined
    return { strategy: data?.strategy ?? '', score: typeof data?.score === 'number' ? data.score : 0 }
  },
}
const validator: Validator<Out> = {
  async validate(out) {
    return { valid: out.score >= VALID_THRESHOLD, score: out.score }
  },
}
function workerSpecs(names: string[]): AgentRunSpec<Task>[] {
  return names.map((name) => ({
    profile: { name } as AgentProfile,
    name,
    taskToPrompt: (t) => JSON.stringify(t),
  }))
}
function workerClient() {
  const dispatched: string[] = []
  return {
    dispatched,
    client: {
      async create(): Promise<SandboxInstance> {
        return {
          async *streamPrompt(message: string) {
            const task = JSON.parse(message) as Task
            dispatched.push(task.strategy)
            yield {
              type: 'result',
              data: { strategy: task.strategy, score: scoreFor(task.strategy) },
            } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    },
  }
}

// ── Driver model ──────────────────────────────────────────────────────────
// One competent-driver policy, fed to BOTH planners. It steers to the fix
// strategy *iff its prompt surfaces a failure signal*, stops once a valid
// attempt appears, else replays. The steering planner's prompt carries the
// analyst signal ("invalid-attempt"); the blind planner's does not. Same brain,
// different eyes — so the win/plateau split isolates the architectural change.
function driverClient() {
  const prompts: string[] = []
  return {
    prompts,
    client: {
      async create(_opts?: CreateSandboxOptions): Promise<SandboxInstance> {
        return {
          async *streamPrompt(message: string) {
            prompts.push(message)
            const sawValid = /"valid":\s*true/.test(message)
            const sawFailureSignal = /invalid-attempt|no-improvement|errored-attempt/.test(message)
            const move = sawValid
              ? { kind: 'stop', rationale: 'a valid attempt exists' }
              : sawFailureSignal
                ? {
                    kind: 'refine',
                    tasks: [{ goal: GOAL, strategy: FIX_STRATEGY }],
                    rationale: 'signal says the attempt failed — steer to the tool strategy',
                  }
                : { kind: 'refine', tasks: [{ goal: GOAL, strategy: 'naive' }], rationale: 'replay' }
            yield { type: 'result', data: { result: move } } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    },
  }
}

const decodeTask = (raw: unknown): Task => raw as Task

describe('createSteeringPlanner — driver-with-eyes vs blind planner', () => {
  it('breaks a degenerate plateau the blind planner cannot: steering wins, blind stalls', async () => {
    // STEERING: the driver sees the analyst signal → steers off naive → 0.9.
    const worker = workerClient()
    const driver = driverClient()
    const steering = await runLoop({
      driver: createDynamicDriver<Task, Out>({
        planner: createSteeringPlanner<Task, Out>({
          client: driver.client,
          profile: { name: 'driver' } as AgentProfile,
          decodeTask,
        }),
        maxIterations: 6,
      }),
      agentRuns: workerSpecs(['worker']),
      output,
      validator,
      task: { goal: GOAL, strategy: 'naive' },
      ctx: { sandboxClient: worker.client },
      maxIterations: 6,
    })

    expect(steering.decision).toBe('done')
    expect(steering.winner?.verdict?.valid).toBe(true)
    expect(steering.winner?.verdict?.score).toBeCloseTo(0.9, 6)
    // Shot 2 DIFFERS from shot 1 in the steered direction — not a degenerate replay.
    expect(worker.dispatched).toEqual(['naive', FIX_STRATEGY])
    // The steering prompt (round 2, after the naive attempt) carried the analyst
    // signal + the full worker output + the score trajectory — the "eyes". (Round
    // 1 plans with empty history, so the signal first appears once an attempt exists.)
    const steerPrompt = driver.prompts.find((p) => /invalid-attempt/.test(p)) ?? ''
    expect(steerPrompt).toMatch(/invalid-attempt/)
    expect(steerPrompt).toMatch(/Score trajectory/)
    expect(steerPrompt).toMatch(/Latest worker output/)

    // BLIND: same driver brain, but createSandboxPlanner shows only the
    // truncated summary — no "invalid-attempt" signal — so it replays naive
    // forever and never clears the bar. This is the matrix_multishot=0.316 plateau.
    const blindWorker = workerClient()
    const blindDriver = driverClient()
    const blind = await runLoop({
      driver: createDynamicDriver<Task, Out>({
        planner: createSandboxPlanner<Task, Out>({
          client: blindDriver.client,
          profile: { name: 'driver' } as AgentProfile,
          decodeTask,
        }),
        maxIterations: 6,
      }),
      agentRuns: workerSpecs(['worker']),
      output,
      validator,
      task: { goal: GOAL, strategy: 'naive' },
      ctx: { sandboxClient: blindWorker.client },
      maxIterations: 6,
    })

    expect(blind.winner?.verdict?.valid).not.toBe(true)
    expect(new Set(blindWorker.dispatched)).toEqual(new Set(['naive'])) // degenerate
    expect(blindDriver.prompts[0] ?? '').not.toMatch(/invalid-attempt/)
  })
})

describe('defaultAnalyze — zero-model signal derivation', () => {
  const iter = (over: Partial<Iteration<Task, Out>>): Iteration<Task, Out> =>
    ({
      index: 0,
      task: { goal: GOAL, strategy: 'naive' },
      agentRunName: 'worker',
      events: [],
      startedAt: 0,
      endedAt: 1,
      costUsd: 0,
      tokenUsage: { input: 0, output: 0 },
      ...over,
    }) as Iteration<Task, Out>

  it('flags an invalid attempt', () => {
    const signals = defaultAnalyze(iter({ verdict: { valid: false, score: 0.316 } }), [])
    expect(signals.map((s) => s.label)).toContain('invalid-attempt')
    expect(signals[0]?.detail).toMatch(/0.316/)
  })

  it('flags a non-improving refinement', () => {
    const prev = iter({ index: 0, verdict: { valid: false, score: 0.5 } })
    const curr = iter({ index: 1, verdict: { valid: false, score: 0.4 } })
    const signals = defaultAnalyze(curr, [prev, curr])
    expect(signals.map((s) => s.label)).toContain('no-improvement')
  })

  it('flags an errored attempt as critical', () => {
    const signals = defaultAnalyze(iter({ error: new Error('boom') }), [])
    expect(signals.find((s) => s.label === 'errored-attempt')?.severity).toBe('critical')
  })

  it('stays quiet on a valid attempt', () => {
    expect(defaultAnalyze(iter({ verdict: { valid: true, score: 0.9 } }), [])).toEqual([])
  })
})
