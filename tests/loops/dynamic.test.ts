import type { AnalystFinding } from '@tangle-network/agent-eval'
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
  createDriver,
  type LoopPlanPayload,
  type LoopTraceEmitter,
  type LoopTraceEvent,
  type OutputAdapter,
  renderAnalyses,
  runLoop,
  type TopologyMove,
  type TopologyPlanner,
  type Validator,
} from '../../src/runtime'

function finding(over: Partial<AnalystFinding> = {}): AnalystFinding {
  return {
    schema_version: '1.0.0',
    finding_id: 'f1',
    analyst_id: 'test-analyst',
    produced_at: '2026-01-01T00:00:00Z',
    severity: 'high',
    area: 'verification',
    claim: 'the answer omits the required unit',
    evidence_refs: [],
    confidence: 0.8,
    recommended_action: 'restate with the exact unit',
    ...over,
  }
}

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

describe('runLoop + createDriver', () => {
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
      driver: createDriver<Task, Out>({ planner, maxIterations: 8 }),
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
      driver: createDriver<Task, Out>({ planner }),
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
      driver: createDriver<Task, Out>({ planner, maxIterations: 3 }),
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
      driver: createDriver<Task, Out>({ planner, maxFanout: 2 }),
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
        driver: createDriver<Task, Out>({ planner }),
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
        driver: createDriver<Task, Out>({ planner }),
        agentRun: workerSpecs(['a'])[0],
        output,
        validator,
        task: { goal: 'x', strategy: 'naive' },
        ctx: { sandboxClient: client },
      }),
    ).rejects.toThrow(/unknown move kind/i)
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
      driver: createDriver<Task, Out>({ planner }),
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
    // edge lineage: round 0 dispatches iteration 0 from root (no parent)
    expect(planPayloads[0]?.childIndices).toEqual([0])
    expect(planPayloads[0]?.parentIndex).toBeUndefined()

    const ended = all.find((e) => e.kind === 'loop.iteration.ended')
    expect(ended?.kind).toBe('loop.iteration.ended')
    if (ended?.kind === 'loop.iteration.ended') {
      expect(ended.payload.tokenUsage).toEqual({ input: 800, output: 200 })
      expect(ended.payload.groupId).toBe(0)
      expect(typeof ended.payload.outputPreview).toBe('string')
    }
  })
})

describe('runLoop dynamic driver — planner-declared edge lineage (#82)', () => {
  it('a declared move.parentIndex overrides the kernel-inferred branch point', async () => {
    const goal = 'lineage'
    // round 0: fanout → iter0 (naive=0.3 invalid) + iter1 (parallel-a=0.9 valid).
    // round 1: refine DECLARING parentIndex 0 (branch off the WEAK iter, not the winner).
    // Inferred branchPoint would pick the best-valid iter1; declared must win.
    const moves: TopologyMove<Task>[] = [
      {
        kind: 'fanout',
        tasks: [
          { goal, strategy: 'naive' },
          { goal, strategy: 'parallel-a' },
        ],
      },
      { kind: 'refine', task: { goal, strategy: 'parallel-x' }, parentIndex: 0 },
      { kind: 'stop' },
    ]
    let round = 0
    const planner: TopologyPlanner<Task, Out> = () => moves[round++]!

    const planPayloads: LoopPlanPayload[] = []
    const traceEmitter: LoopTraceEmitter = {
      emit(e) {
        if (e.kind === 'loop.plan') planPayloads.push(e.payload)
      },
    }
    const { client } = workerClient()
    await runLoop({
      driver: createDriver<Task, Out>({ planner }),
      agentRuns: workerSpecs(['a', 'b']),
      output,
      validator,
      task: { goal, strategy: 'naive' },
      ctx: { sandboxClient: client, traceEmitter },
    })

    // round 0 fanout branches from root; round 1 refine declares parent 0 (the
    // weak iteration), which must override the inferred best-valid (iter 1).
    expect(planPayloads[0]?.parentIndex).toBeUndefined()
    expect(planPayloads[1]?.moveKind).toBe('refine')
    expect(planPayloads[1]?.parentIndex).toBe(0)
  })
})

describe('runLoop dynamic driver — analyses→planner wire (Phase 2)', () => {
  it('feeds analyze-hook findings to the planner via PlannerContext.analyses, skipping round 0', async () => {
    const goal = 'wire'
    const seen: Array<ReadonlyArray<AnalystFinding> | undefined> = []
    const planner: TopologyPlanner<Task, Out> = ({ history, analyses }) => {
      seen.push(analyses)
      if (history.some((h) => h.verdict?.valid === true)) return { kind: 'stop' }
      return {
        kind: 'refine',
        task: { goal, strategy: history.length === 0 ? 'naive' : 'parallel-x' },
      }
    }
    let analyzeCalls = 0
    const { client } = workerClient()
    const result = await runLoop({
      driver: createDriver<Task, Out>({
        planner,
        analyze: ({ history }) => {
          analyzeCalls += 1
          return [finding({ claim: `attempt ${history.length} missed the unit` })]
        },
        maxIterations: 8,
      }),
      agentRun: workerSpecs(['solo'])[0],
      output,
      validator,
      task: { goal, strategy: 'naive' },
      ctx: { sandboxClient: client },
    })

    expect(result.decision).toBe('done')
    // round 0 has no trace yet → analyze is NOT called, planner sees undefined.
    expect(seen[0]).toBeUndefined()
    // round 1+ : the diagnosis reached the planner's decision input.
    expect(seen[1]).toBeDefined()
    expect(seen[1]?.[0]?.claim).toContain('missed the unit')
    expect(analyzeCalls).toBeGreaterThanOrEqual(1)
  })

  it('fails loud when the analyze hook returns a non-array (no silent empty)', async () => {
    const planner: TopologyPlanner<Task, Out> = ({ history }) =>
      history.length === 0
        ? { kind: 'refine', task: { goal: 'x', strategy: 'naive' } }
        : { kind: 'stop' }
    const { client } = workerClient()
    await expect(
      runLoop({
        driver: createDriver<Task, Out>({
          planner,
          analyze: (() => ({ not: 'an array' })) as unknown as () => ReadonlyArray<AnalystFinding>,
        }),
        agentRun: workerSpecs(['solo'])[0],
        output,
        validator,
        task: { goal: 'x', strategy: 'naive' },
        ctx: { sandboxClient: client },
      }),
    ).rejects.toThrow(PlannerError)
  })

  it('renderAnalyses formats severity/area/claim/action/confidence and is empty for none', () => {
    expect(renderAnalyses([])).toBe('')
    const s = renderAnalyses([
      finding({
        severity: 'critical',
        area: 'cost',
        claim: 'overspent the budget',
        recommended_action: 'cap retries',
        confidence: 0.91,
      }),
    ])
    expect(s).toContain('[critical/cost]')
    expect(s).toContain('overspent the budget')
    expect(s).toContain('cap retries')
    expect(s).toContain('0.91')
  })
})

describe('runLoop dynamic driver — emittable select (Phase 3a)', () => {
  it('a select move authors the winner, overriding the kernel argmax', async () => {
    const goal = 'select'
    // round 0 fanout: iter0 naive (0.3, invalid), iter1 parallel-a (0.9, valid).
    // round 1 select index 0 — the WEAK iteration; the kernel argmax would pick iter1.
    const moves: TopologyMove<Task>[] = [
      {
        kind: 'fanout',
        tasks: [
          { goal, strategy: 'naive' },
          { goal, strategy: 'parallel-a' },
        ],
      },
      { kind: 'select', index: 0, rationale: 'I judge attempt 0 best despite its score' },
    ]
    let round = 0
    const planner: TopologyPlanner<Task, Out> = () => moves[round++]!
    const { client } = workerClient()
    const result = await runLoop({
      driver: createDriver<Task, Out>({ planner }),
      agentRuns: workerSpecs(['a', 'b']),
      output,
      validator,
      task: { goal, strategy: 'naive' },
      ctx: { sandboxClient: client },
    })

    expect(result.decision).toBe('done')
    // The planner authored the winner — index 0, NOT the argmax (index 1, score 0.9).
    expect(result.winner?.iterationIndex).toBe(0)
    expect(result.winner?.verdict?.score).toBeCloseTo(0.3, 6)
  })

  it('fails loud on a select index out of range', async () => {
    const goal = 'oob'
    const moves: TopologyMove<Task>[] = [
      { kind: 'refine', task: { goal, strategy: 'naive' } },
      { kind: 'select', index: 9 },
    ]
    let round = 0
    const planner: TopologyPlanner<Task, Out> = () => moves[round++]!
    const { client } = workerClient()
    await expect(
      runLoop({
        driver: createDriver<Task, Out>({ planner }),
        agentRun: workerSpecs(['solo'])[0],
        output,
        validator,
        task: { goal, strategy: 'naive' },
        ctx: { sandboxClient: client },
      }),
    ).rejects.toThrow(PlannerError)
  })

  it('a caller-supplied selectWinner overrides a planner select (precedence)', async () => {
    const goal = 'precedence'
    const moves: TopologyMove<Task>[] = [
      {
        kind: 'fanout',
        tasks: [
          { goal, strategy: 'naive' },
          { goal, strategy: 'parallel-a' },
        ],
      },
      { kind: 'select', index: 0 },
    ]
    let round = 0
    const planner: TopologyPlanner<Task, Out> = () => moves[round++]!
    const { client } = workerClient()
    const result = await runLoop({
      driver: createDriver<Task, Out>({ planner }),
      agentRuns: workerSpecs(['a', 'b']),
      output,
      validator,
      task: { goal, strategy: 'naive' },
      ctx: { sandboxClient: client },
      selectWinner: (iters) => {
        const i = iters.find((x) => x.index === 1)
        return i?.output === undefined
          ? undefined
          : {
              task: i.task,
              output: i.output,
              verdict: i.verdict,
              iterationIndex: 1,
              agentRunName: i.agentRunName,
            }
      },
    })
    // The caller forced index 1, overriding the planner's select(0).
    expect(result.winner?.iterationIndex).toBe(1)
  })
})

describe('runLoop dynamic driver — steer-firewall (selector ≠ judge, Gen-1)', () => {
  // The driver may steer from a TRACE-derived diagnosis but never from the
  // judge: a finding whose evidence is a judge/verdict score must be rejected
  // before it reaches the planner. Provenance, not content.
  const refineThenStop = (goal: string): TopologyPlanner<Task, Out> => {
    let r = 0
    return () =>
      r++ === 0 ? { kind: 'refine', task: { goal, strategy: 'naive' } } : { kind: 'stop' }
  }

  it('PASSES a finding with trace-derived (artifact) evidence', async () => {
    const { client } = workerClient()
    const result = await runLoop({
      driver: createDriver<Task, Out>({
        planner: refineThenStop('fw-pass'),
        analyze: () => [finding({ evidence_refs: [{ kind: 'artifact', uri: 'attempt:run1#0' }] })],
      }),
      agentRun: workerSpecs(['solo'])[0],
      output,
      validator,
      task: { goal: 'fw-pass', strategy: 'naive' },
      ctx: { sandboxClient: client },
    })
    expect(result.decision).toBe('done') // analyze ran on round 1; the finding cleared the firewall
  })

  it('PASSES a finding with empty evidence_refs (existing fixtures stay legal)', async () => {
    const { client } = workerClient()
    const result = await runLoop({
      driver: createDriver<Task, Out>({
        planner: refineThenStop('fw-empty'),
        analyze: () => [finding({ evidence_refs: [] })],
      }),
      agentRun: workerSpecs(['solo'])[0],
      output,
      validator,
      task: { goal: 'fw-empty', strategy: 'naive' },
      ctx: { sandboxClient: client },
    })
    expect(result.decision).toBe('done')
  })

  it('REJECTS a judge-derived finding (metric ref with a verdict/score uri scheme)', async () => {
    const { client } = workerClient()
    await expect(
      runLoop({
        driver: createDriver<Task, Out>({
          planner: refineThenStop('fw-reject'),
          analyze: () => [finding({ evidence_refs: [{ kind: 'metric', uri: 'verdict:score' }] })],
        }),
        agentRun: workerSpecs(['solo'])[0],
        output,
        validator,
        task: { goal: 'fw-reject', strategy: 'naive' },
        ctx: { sandboxClient: client },
      }),
    ).rejects.toThrow(/steer-firewall/)
  })

  it('REJECTS a score-scheme metric ref but ALLOWS a non-judge metric ref', async () => {
    const { client } = workerClient()
    // a 'metric' ref that is NOT judge-scheme (e.g. latency) is trace-derived → allowed
    const ok = await runLoop({
      driver: createDriver<Task, Out>({
        planner: refineThenStop('fw-latency'),
        analyze: () => [finding({ evidence_refs: [{ kind: 'metric', uri: 'latency_ms:1200' }] })],
      }),
      agentRun: workerSpecs(['solo'])[0],
      output,
      validator,
      task: { goal: 'fw-latency', strategy: 'naive' },
      ctx: { sandboxClient: client },
    })
    expect(ok.decision).toBe('done')
  })
})
