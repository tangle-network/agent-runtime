import type {
  AgentProfile,
  CreateSandboxOptions,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  attributionToPlaybookEntry,
  createDynamicDriver,
  createSteeringMemory,
  createSteeringPlanner,
  type OutputAdapter,
  runLoop,
  type SteerAttribution,
  type Validator,
} from '../../src/loops'

interface Task {
  goal: string
  strategy: string
}
interface Out {
  strategy: string
  score: number
}
const GOAL = 'produce the correct return'
const FIX = 'parallel-tools'

function driverAttr(over: Partial<SteerAttribution<Task>> = {}): SteerAttribution<Task> {
  return {
    actualScore: 0.3,
    best: { steer: { goal: GOAL, strategy: FIX }, score: 0.9 },
    results: [],
    byMutation: [],
    driverShare: 0.6,
    workerShare: 0.1,
    verdict: 'driver-attributable',
    ...over,
  }
}

describe('attributionToPlaybookEntry', () => {
  it('maps a driver-attributable attribution to an entry naming the winning steer', () => {
    const entry = attributionToPlaybookEntry(driverAttr(), {
      situation: 'weak-strategy',
      sourceRunId: 'run-1',
    })
    expect(entry).not.toBeNull()
    expect(entry?.instruction).toContain('weak-strategy')
    expect(entry?.instruction).toContain(FIX) // the suggested steer is in the instruction
    expect(entry?.weight).toBeCloseTo(0.6, 6) // weight = driverShare
    expect(entry?.category).toBe('weak-strategy')
    expect(entry?.sourceRunId).toBe('run-1')
  })

  it('records nothing for non-driver-attributable verdicts (only proven wins)', () => {
    for (const verdict of ['worker-attributable', 'mixed', 'inconclusive'] as const) {
      expect(attributionToPlaybookEntry(driverAttr({ verdict }), { situation: 's' })).toBeNull()
    }
  })
})

describe('createSteeringMemory', () => {
  it('records only driver-attributable attributions; render reflects them', () => {
    const mem = createSteeringMemory<Task>()
    expect(mem.render()).toBe('') // empty memory injects nothing
    expect(
      mem.record(driverAttr({ verdict: 'worker-attributable' }), { situation: 's' }),
    ).toBeNull()
    expect(mem.size).toBe(0)
    const entry = mem.record(driverAttr(), { situation: 'weak-strategy' })
    expect(entry).not.toBeNull()
    expect(mem.size).toBe(1)
    expect(mem.render()).toContain(FIX)
  })

  it('caps stored entries by weight (drops the weakest on overflow)', () => {
    const mem = createSteeringMemory<Task>({ maxEntries: 2 })
    mem.add({ instruction: 'lo', rationale: 'r', weight: 0.3 })
    mem.add({ instruction: 'mid', rationale: 'r', weight: 0.6 })
    mem.add({ instruction: 'hi', rationale: 'r', weight: 0.9 })
    expect(mem.size).toBe(2)
    const kept = mem.entries().map((e) => e.instruction)
    expect(kept).toContain('hi')
    expect(kept).toContain('mid')
    expect(kept).not.toContain('lo') // weakest dropped
  })
})

// ── Full-loop proof: memory makes the driver converge in FEWER shots ──────────
const scoreFor = (s: string) => (s.startsWith('parallel') ? 0.9 : 0.3)
const output: OutputAdapter<Out> = {
  parse(events) {
    const d = events.at(-1)?.data as Partial<Out> | undefined
    return { strategy: d?.strategy ?? '', score: typeof d?.score === 'number' ? d.score : 0 }
  },
}
const validator: Validator<Out> = {
  async validate(o) {
    return { valid: o.score >= 0.7, score: o.score }
  },
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
// Driver steers to FIX once it has ANY reason to move off naive — either a
// failure signal (defaultAnalyze) OR prior memory naming the fix. Memory
// supplies that reason a round earlier.
function driverClient() {
  return {
    client: {
      async create(_o?: CreateSandboxOptions): Promise<SandboxInstance> {
        return {
          async *streamPrompt(message: string) {
            const move = /"valid":\s*true/.test(message)
              ? { kind: 'stop', rationale: 'valid' }
              : /invalid-attempt/.test(message) || message.includes(FIX)
                ? {
                    kind: 'refine',
                    tasks: [{ goal: GOAL, strategy: FIX }],
                    rationale: 'steer to the known fix',
                  }
                : {
                    kind: 'refine',
                    tasks: [{ goal: GOAL, strategy: 'naive' }],
                    rationale: 'replay',
                  }
            yield { type: 'result', data: { result: move } } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    },
  }
}

const runArgs = (
  planner: ReturnType<typeof createSteeringPlanner<Task, Out>>,
  worker: ReturnType<typeof workerClient>,
) => ({
  driver: createDynamicDriver<Task, Out>({ planner, maxIterations: 6 }),
  agentRuns: [
    {
      profile: { name: 'worker' } as AgentProfile,
      name: 'worker',
      taskToPrompt: (t: Task) => JSON.stringify(t),
    },
  ] satisfies AgentRunSpec<Task>[],
  output,
  validator,
  task: { goal: GOAL, strategy: 'naive' },
  ctx: { sandboxClient: worker.client },
  maxIterations: 6,
})

describe('createSteeringMemory — fewer shots to valid with memory', () => {
  it('memory-seeded driver wins on shot 1; memoryless takes an extra shot to discover the steer', async () => {
    // MEMORYLESS: round 1 has no signal/memory → replays naive (fail) → round 2
    // sees the invalid-attempt signal → steers to FIX → wins. Two shots.
    const w1 = workerClient()
    const memoryless = await runLoop<Task, Out>(
      runArgs(
        createSteeringPlanner<Task, Out>({
          client: driverClient().client,
          profile: { name: 'driver' } as AgentProfile,
          decodeTask: (raw) => raw as Task,
        }),
        w1,
      ),
    )
    expect(memoryless.winner?.verdict?.valid).toBe(true)
    expect(w1.dispatched).toEqual(['naive', FIX])

    // MEMORY: pre-seeded with the proven steer for this situation. Round 1's
    // prompt carries the playbook → driver adopts FIX immediately → wins shot 1.
    const mem = createSteeringMemory<Task>()
    mem.record(driverAttr(), { situation: 'weak-strategy' })
    const w2 = workerClient()
    const withMemory = await runLoop<Task, Out>(
      runArgs(
        createSteeringPlanner<Task, Out>({
          client: driverClient().client,
          profile: { name: 'driver' } as AgentProfile,
          decodeTask: (raw) => raw as Task,
          priorContext: () => mem.render(),
        }),
        w2,
      ),
    )
    expect(withMemory.winner?.verdict?.valid).toBe(true)
    expect(w2.dispatched).toEqual([FIX]) // adopted the remembered steer on shot 1
    expect(w2.dispatched.length).toBeLessThan(w1.dispatched.length) // memory compounds
  })
})
