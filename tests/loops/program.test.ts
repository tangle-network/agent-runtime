import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  agentProgramPlanner,
  compileProgram,
  createDynamicDriver,
  flattenProgram,
  type OutputAdapter,
  type Program,
  runLoop,
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
