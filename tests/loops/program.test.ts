import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  agentProgramPlanner,
  compileProgram,
  createDynamicDriver,
  deterministicCompletion,
  flattenProgram,
  isStraightLine,
  type OutputAdapter,
  type Program,
  type RunProgramOptions,
  runAgent,
  runLoop,
  runProgram,
  type Validator,
} from '../../src/loops'

// Minimal string→string harness: the worker echoes the task as its answer; an
// answer of 'good' is valid. So a Program's op→move mapping is observable in the
// kernel's iteration record + winner.
const output: OutputAdapter<string> = {
  parse(events) {
    let a = ''
    for (const ev of events) {
      const d = ev?.data as { answer?: unknown } | undefined
      if (typeof d?.answer === 'string') a = d.answer
    }
    return a
  },
}
const validator: Validator<string> = {
  async validate(answer) {
    return { valid: answer.trim() === 'good', score: answer.trim() === 'good' ? 1 : 0 }
  },
}
const agentRuns: AgentRunSpec<string>[] = ['a', 'b'].map((name) => ({
  profile: { name },
  name,
  taskToPrompt: (t) => t,
}))
function echoClient() {
  return {
    async create(_opts?: CreateSandboxOptions): Promise<SandboxInstance> {
      return {
        async *streamPrompt(message: string) {
          yield { type: 'result', data: { answer: message } } satisfies SandboxEvent
        },
      } as unknown as SandboxInstance
    },
  }
}
const run = (program: Program<string>) =>
  runLoop<string, string, 'continue' | 'done'>({
    driver: createDynamicDriver<string, string>({
      planner: compileProgram(program),
      maxIterations: 8,
    }),
    agentRuns,
    output,
    validator,
    task: 'root',
    ctx: { sandboxClient: echoClient() },
    maxIterations: 8,
  })

describe('Program op-set — flattenProgram', () => {
  it('maps each op to the per-round TopologyMove (and seq concatenates)', () => {
    expect(flattenProgram<string>({ op: 'sample', task: 't', n: 3 })).toEqual([
      { kind: 'fanout', tasks: ['t', 't', 't'], rationale: undefined },
    ])
    expect(flattenProgram<string>({ op: 'sample', task: 't' })[0]?.kind).toBe('refine') // n=1
    expect(flattenProgram<string>({ op: 'steer', task: 't' })[0]?.kind).toBe('refine')
    expect(flattenProgram<string>({ op: 'fork', branches: ['a', 'b'] })).toEqual([
      { kind: 'fanout', tasks: ['a', 'b'], rationale: undefined },
    ])
    expect(flattenProgram<string>({ op: 'select', index: 1 })).toEqual([
      { kind: 'select', index: 1, rationale: undefined },
    ])
    expect(
      flattenProgram<string>({
        op: 'seq',
        steps: [{ op: 'steer', task: 'x' }, { op: 'stop' }],
      }).map((m) => m.kind),
    ).toEqual(['refine', 'stop'])
  })

  it('fails loud on an empty fork or empty seq', () => {
    expect(() => flattenProgram<string>({ op: 'fork', branches: [] })).toThrow(/non-empty branches/)
    expect(() => flattenProgram<string>({ op: 'seq', steps: [] })).toThrow(/non-empty steps/)
    expect(() => flattenProgram<string>({ op: 'sample', task: 't', n: 0 })).toThrow(
      /positive integer/,
    )
  })
})

describe('Program op-set — executed through the real runLoop kernel', () => {
  it('seq([sample×3, stop]) runs a 3-wide fanout then stops', async () => {
    const r = await run({ op: 'seq', steps: [{ op: 'sample', task: 'bad', n: 3 }, { op: 'stop' }] })
    expect(r.decision).toBe('done')
    expect(r.iterations).toHaveLength(3)
    expect(r.iterations.every((i) => i.task === 'bad')).toBe(true)
  })

  it('seq([steer, steer, stop]) refines in order and short-circuits on the valid attempt', async () => {
    const r = await run({
      op: 'seq',
      steps: [{ op: 'steer', task: 'bad' }, { op: 'steer', task: 'good' }, { op: 'stop' }],
    })
    expect(r.decision).toBe('done')
    expect(r.iterations.map((i) => i.task)).toEqual(['bad', 'good'])
    expect(r.winner?.output).toBe('good')
  })

  it('seq([fork, select]) fans out then the program declares the winner index', async () => {
    const r = await run({
      op: 'seq',
      steps: [
        { op: 'fork', branches: ['a', 'b'] },
        { op: 'select', index: 1 },
      ],
    })
    expect(r.decision).toBe('done')
    expect(r.iterations).toHaveLength(2) // the fanout; select is terminal, dispatches nothing
    expect(r.winner?.iterationIndex).toBe(1)
    expect(r.winner?.output).toBe('b')
  })

  it('agentProgramPlanner drives the agent-emitted program', async () => {
    const planner = agentProgramPlanner<string, string>({
      act: () => ({ op: 'seq', steps: [{ op: 'sample', task: 'good', n: 2 }, { op: 'stop' }] }),
    })
    const r = await runLoop<string, string, 'continue' | 'done'>({
      driver: createDynamicDriver<string, string>({ planner, maxIterations: 8 }),
      agentRuns,
      output,
      validator,
      task: 'root',
      ctx: { sandboxClient: echoClient() },
      maxIterations: 8,
    })
    expect(r.decision).toBe('done')
    expect(r.winner?.output).toBe('good')
  })
})

// A client that records peak in-flight `streamPrompt` calls, so a test can PROVE
// concurrent execution (not just assert the merged result). Each call holds `active`
// across a real tick before yielding, giving siblings the chance to overlap.
function trackingClient() {
  const state = { active: 0, maxActive: 0, total: 0 }
  const client = {
    async create(_opts?: CreateSandboxOptions): Promise<SandboxInstance> {
      return {
        async *streamPrompt(message: string) {
          state.active += 1
          state.total += 1
          state.maxActive = Math.max(state.maxActive, state.active)
          try {
            await new Promise((r) => setTimeout(r, 5))
            yield { type: 'result', data: { answer: message } } satisfies SandboxEvent
          } finally {
            state.active -= 1
          }
        },
      } as unknown as SandboxInstance
    },
  }
  return { state, client }
}

const baseOpts = (
  sandboxClient: ReturnType<typeof echoClient>,
): RunProgramOptions<string, string> => ({
  agentRuns,
  output,
  validator,
  ctx: { sandboxClient },
  maxIterations: 8,
})

describe('Program op-set — isStraightLine + flatten(parallel)', () => {
  it('classifies parallel (and any tree containing it) as NOT straight-line', () => {
    expect(isStraightLine<string>({ op: 'sample', task: 't', n: 3 })).toBe(true)
    expect(
      isStraightLine<string>({
        op: 'seq',
        steps: [
          { op: 'steer', task: 'a' },
          { op: 'fork', branches: ['b', 'c'] },
        ],
      }),
    ).toBe(true)
    expect(
      isStraightLine<string>({ op: 'parallel', branches: [{ op: 'sample', task: 'a' }] }),
    ).toBe(false)
    expect(
      isStraightLine<string>({
        op: 'seq',
        steps: [
          { op: 'steer', task: 'a' },
          { op: 'parallel', branches: [{ op: 'sample', task: 'b' }] },
        ],
      }),
    ).toBe(false)
  })

  it('flattenProgram fails loud on parallel (it needs the runProgram executor)', () => {
    expect(() =>
      flattenProgram<string>({ op: 'parallel', branches: [{ op: 'sample', task: 'a' }] }),
    ).toThrow(/runProgram/)
  })
})

describe('runProgram — the tree executor (loop-layer parallelism)', () => {
  it('straight-line program is parity with compileProgram (one loop, threaded seq)', async () => {
    const r = await runProgram<string, string>(
      {
        op: 'seq',
        steps: [{ op: 'steer', task: 'bad' }, { op: 'steer', task: 'good' }, { op: 'stop' }],
      },
      baseOpts(echoClient()),
    )
    expect(r.iterations.map((i) => i.task)).toEqual(['bad', 'good']) // short-circuits on the valid attempt
    expect(r.winner?.output).toBe('good')
  })

  it('parallel runs its branches CONCURRENTLY and merges to the valid winner', async () => {
    const { state, client } = trackingClient()
    const r = await runProgram<string, string>(
      {
        op: 'parallel',
        branches: [
          { op: 'sample', task: 'bad' },
          { op: 'sample', task: 'good' },
        ],
      },
      baseOpts(client),
    )
    expect(state.maxActive).toBe(2) // both sub-loops in flight at once — loop-layer parallelism
    expect(r.iterations).toHaveLength(2)
    expect(r.iterations.map((i) => i.index)).toEqual([0, 1]) // merged + re-indexed contiguously
    expect(r.winner?.output).toBe('good')
  })

  it('maxParallel bounds the number of concurrent branches', async () => {
    const { state, client } = trackingClient()
    await runProgram<string, string>(
      {
        op: 'parallel',
        branches: [
          { op: 'sample', task: 'a' },
          { op: 'sample', task: 'b' },
          { op: 'sample', task: 'c' },
          { op: 'sample', task: 'd' },
        ],
      },
      { ...baseOpts(client), maxParallel: 2 },
    )
    expect(state.total).toBe(4) // every branch ran
    expect(state.maxActive).toBeLessThanOrEqual(2) // never more than maxParallel at once
  })

  it('a workflow — seq of a fanout then a parallel of sub-loops — accumulates and picks the global winner', async () => {
    const r = await runProgram<string, string>(
      {
        op: 'seq',
        steps: [
          { op: 'sample', task: 'bad', n: 2 },
          {
            op: 'parallel',
            branches: [
              { op: 'steer', task: 'bad' },
              { op: 'steer', task: 'good' },
            ],
          },
        ],
      },
      baseOpts(echoClient()),
    )
    expect(r.iterations).toHaveLength(4) // 2 (fanout) + 2 (parallel branches)
    expect(r.iterations.map((i) => i.index)).toEqual([0, 1, 2, 3])
    expect(r.winner?.output).toBe('good')
    expect(r.winner?.iterationIndex).toBe(3)
  })

  it('fails loud on a select placed after a parallel boundary', async () => {
    await expect(
      runProgram<string, string>(
        {
          op: 'seq',
          steps: [
            { op: 'parallel', branches: [{ op: 'sample', task: 'a' }] },
            { op: 'select', index: 0 },
          ],
        },
        baseOpts(echoClient()),
      ),
    ).rejects.toThrow(/select after a parallel boundary/)
  })

  it('runAgent drives an agent that forks concurrent sub-loops', async () => {
    const { state, client } = trackingClient()
    const r = await runAgent<string, string>(
      {
        act: () => ({
          op: 'parallel',
          branches: [
            { op: 'sample', task: 'bad' },
            { op: 'sample', task: 'good' },
          ],
        }),
      },
      'root',
      baseOpts(client),
    )
    expect(state.maxActive).toBe(2)
    expect(r.winner?.output).toBe('good')
  })

  it('fails loud past maxDepth — the ~k^depth recursion guard (deep trees must be earned)', async () => {
    // top-level parallel runs its branch at depth 1; maxDepth 0 forbids descending.
    await expect(
      runProgram<string, string>(
        { op: 'parallel', branches: [{ op: 'sample', task: 'a' }] },
        { ...baseOpts(echoClient()), maxDepth: 0 },
      ),
    ).rejects.toThrow(/maxDepth/)
  })

  it('a completion analyst stops a runProgram sub-loop before the program is exhausted', async () => {
    // always-invalid so the ORACLE never short-circuits — the stop is the completion analyst's.
    const alwaysInvalid: Validator<string> = {
      async validate() {
        return { valid: false, score: 0 }
      },
    }
    const complete = deterministicCompletion<string, string>((out) => ({ passed: out === 'good' }))
    const r = await runProgram<string, string>(
      {
        op: 'seq',
        steps: [
          { op: 'steer', task: 'good' },
          { op: 'steer', task: 'x' },
          { op: 'steer', task: 'x' },
          { op: 'steer', task: 'x' },
        ],
      },
      { ...baseOpts(echoClient()), validator: alwaysInvalid, complete },
    )
    expect(r.iterations).toHaveLength(1) // round 0 produced 'good'; round 1 stops on completion, not steer #2-4
    expect(r.winner?.output).toBe('good')
  })
})
