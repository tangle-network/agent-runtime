import type { AgentProfile, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  attributeSteer,
  createAttributionAnalyze,
  type Iteration,
  type OutputAdapter,
  steerAttributionSignal,
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
const spec: AgentRunSpec<Task> = {
  profile: { name: 'worker' } as AgentProfile,
  name: 'worker',
  taskToPrompt: (t) => JSON.stringify(t),
}

// Worker whose score is a pure function of strategy; optionally explodes on one.
function worker(scoreFor: (s: string) => number, throwOn?: string) {
  const dispatched: string[] = []
  return {
    dispatched,
    client: {
      async create(): Promise<SandboxInstance> {
        return {
          async *streamPrompt(message: string) {
            const t = JSON.parse(message) as Task
            if (throwOn !== undefined && t.strategy === throwOn) {
              throw new Error(`worker exploded on ${t.strategy}`)
            }
            dispatched.push(t.strategy)
            yield {
              type: 'result',
              data: { strategy: t.strategy, score: scoreFor(t.strategy) },
            } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    },
  }
}

function failedShot(strategy = 'naive', score = 0.3): Iteration<Task, Out> {
  return {
    index: 1,
    task: { goal: GOAL, strategy },
    agentRunName: 'worker',
    events: [],
    startedAt: 0,
    endedAt: 1,
    costUsd: 0,
    tokenUsage: { input: 0, output: 0 },
    verdict: { valid: false, score },
  } as Iteration<Task, Out>
}

const t = (strategy: string): Task => ({ goal: GOAL, strategy })

describe('attributeSteer — causal driver/worker credit assignment', () => {
  it('blames the DRIVER when a counterfactual steer would have won', async () => {
    // A strong strategy exists (parallel-tools → 0.9); the driver just didn't pick it.
    const w = worker((s) => (s.startsWith('parallel') ? 0.9 : 0.3))
    const attr = await attributeSteer<Task, Out>({
      client: w.client,
      spec,
      output,
      validator,
      iteration: failedShot('naive', 0.3),
      counterfactualSteers: [t('naive'), t('parallel-tools')],
    })
    expect(attr.best?.score).toBeCloseTo(0.9, 6)
    expect(attr.driverShare).toBeCloseTo(0.6, 6) // 0.9 − 0.3 recoverable by a better steer
    expect(attr.workerShare).toBeCloseTo(0.1, 6) // 1 − 0.9 irreducible
    expect(attr.verdict).toBe('driver-attributable')
    expect(steerAttributionSignal(attr).label).toBe('driver-attributable')
    expect(w.dispatched).toEqual(['naive', 'parallel-tools']) // re-dispatched both, same spec
  })

  it('blames the WORKER when even the best counterfactual steer stays low', async () => {
    // No strategy clears the bar — the worker is the ceiling, not the steer.
    const w = worker((s) => (s === 'careful' ? 0.4 : 0.3))
    const attr = await attributeSteer<Task, Out>({
      client: w.client,
      spec,
      output,
      validator,
      iteration: failedShot('naive', 0.3),
      counterfactualSteers: [t('careful'), t('parallel-tools')],
    })
    expect(attr.best?.score).toBeCloseTo(0.4, 6)
    expect(attr.driverShare).toBeCloseTo(0.1, 6) // 0.4 − 0.3 — a better steer barely helps
    expect(attr.workerShare).toBeCloseTo(0.6, 6) // 1 − 0.4 — worker can't execute
    expect(attr.verdict).toBe('worker-attributable')
    expect(steerAttributionSignal(attr).detail).toMatch(/stop re-steering/)
  })

  it('emits substrate CounterfactualResult shape + reuses attributeCounterfactuals', async () => {
    const w = worker((s) => (s.startsWith('parallel') ? 0.9 : 0.3))
    const attr = await attributeSteer<Task, Out>({
      client: w.client,
      spec,
      output,
      validator,
      iteration: failedShot('naive', 0.3),
      counterfactualSteers: [t('parallel-tools')],
    })
    expect(attr.results).toHaveLength(1)
    expect(attr.results[0]?.delta).toEqual({
      originalOutcomeScore: 0.3,
      counterfactualOutcomeScore: 0.9,
      deltaScore: expect.closeTo(0.6, 6),
    })
    expect(attr.results[0]?.mutation.kind).toBe('custom')
    expect(attr.byMutation[0]?.mutationKind).toBe('custom') // aggregator consumed
  })

  it('isolates a counterfactual that errors — attribution still computes', async () => {
    // The 'parallel-tools' re-dispatch throws; 'careful' (0.4) still scores.
    const w = worker((s) => (s === 'careful' ? 0.4 : 0.3), 'parallel-tools')
    const attr = await attributeSteer<Task, Out>({
      client: w.client,
      spec,
      output,
      validator,
      iteration: failedShot('naive', 0.3),
      counterfactualSteers: [t('careful'), t('parallel-tools')],
    })
    expect(attr.results[1]?.delta.counterfactualOutcomeScore).toBeNull() // errored CF
    expect(attr.best?.score).toBeCloseTo(0.4, 6) // best of the survivors
    expect(attr.verdict).toBe('worker-attributable')
  })

  it('returns inconclusive when no counterfactual produces a score', async () => {
    const w = worker(() => 0.3, 'only') // every dispatch of "only" throws
    const attr = await attributeSteer<Task, Out>({
      client: w.client,
      spec,
      output,
      validator,
      iteration: failedShot('naive', 0.3),
      counterfactualSteers: [t('only')],
    })
    expect(attr.best).toBeNull()
    expect(attr.verdict).toBe('inconclusive')
    expect(steerAttributionSignal(attr).label).toBe('attribution-inconclusive')
  })
})

describe('createAttributionAnalyze — gated, opt-in integration', () => {
  it('does NOT re-dispatch when the gate is closed (cost guard)', async () => {
    const w = worker((s) => (s.startsWith('parallel') ? 0.9 : 0.3))
    const analyze = createAttributionAnalyze<Task, Out>({
      client: w.client,
      spec,
      output,
      validator,
      counterfactualSteers: () => [t('parallel-tools')],
    })
    // Latest attempt is VALID → default gate is closed → no attribution.
    const signals = await analyze(
      { ...failedShot('naive', 0.9), verdict: { valid: true, score: 0.9 } } as Iteration<Task, Out>,
      [],
    )
    expect(signals).toEqual([])
    expect(w.dispatched).toEqual([]) // crucially: no expensive re-dispatch
  })

  it('runs attribution + emits the verdict signal when the gate fires', async () => {
    const w = worker((s) => (s.startsWith('parallel') ? 0.9 : 0.3))
    const analyze = createAttributionAnalyze<Task, Out>({
      client: w.client,
      spec,
      output,
      validator,
      counterfactualSteers: () => [t('parallel-tools')],
    })
    // A failed, non-improving attempt → default gate fires.
    const latest = failedShot('naive', 0.3)
    const prev = { ...failedShot('naive', 0.3), index: 0 } as Iteration<Task, Out>
    const signals = await analyze(latest, [prev, latest])
    expect(signals).toHaveLength(1)
    expect(signals[0]?.label).toBe('driver-attributable')
    // The production wrapper defaults to reps=3 (noise-robust verdict), so the
    // steer is re-dispatched 3× and averaged.
    expect(w.dispatched).toEqual(['parallel-tools', 'parallel-tools', 'parallel-tools'])
  })
})

describe('attributeSteer — reps averaging (noise robustness lever)', () => {
  it('averages reps re-dispatches per counterfactual', async () => {
    // Worker returns a different score on each successive call for the steer;
    // reps=2 must average them (0.4, 0.8 → 0.6), not take one sample.
    const queue = [0.4, 0.8]
    const client = {
      async create(): Promise<SandboxInstance> {
        return {
          async *streamPrompt() {
            const score = queue.shift() ?? 0
            yield { type: 'result', data: { strategy: 'x', score } } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    }
    const attr = await attributeSteer<Task, Out>({
      client,
      spec,
      output,
      validator,
      iteration: failedShot('naive', 0.3),
      counterfactualSteers: [t('x')],
      reps: 2,
    })
    expect(attr.best?.score).toBeCloseTo(0.6, 6) // (0.4 + 0.8) / 2
    expect(queue).toHaveLength(0) // both reps consumed
  })
})
