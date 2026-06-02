import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  blind,
  createDynamicDriver,
  drew,
  type OutputAdapter,
  PROMPT_PLANNERS,
  refineOnFail,
  resolvePlanner,
  runLoop,
  type Validator,
} from '../../src/loops'

// Task is a prompt string (the benchmark shape). The worker's score is a pure
// function of which skill directive the planner prepended — so we can script
// exactly which moves clear the bar and assert the planner's escalation.
const VALID = 0.7

interface Out {
  directive: string
  score: number
}

function directiveOf(task: string): string {
  return task.match(/^\[skill:([a-z-]+)\]/)?.[1] ?? 'none'
}

// pursue/evolve fail (0.3); critical-audit + verify clear the bar (0.9). A bare
// task (blind) also fails. This forces drew to escalate pursue→evolve→audit.
function scoreForTask(task: string): number {
  const d = directiveOf(task)
  return d === 'critical-audit' || d === 'verify' ? 0.9 : 0.3
}

const output: OutputAdapter<Out> = {
  parse(events) {
    const d = events.at(-1)?.data as Partial<Out> | undefined
    return { directive: d?.directive ?? 'none', score: typeof d?.score === 'number' ? d.score : 0 }
  },
}

const validator: Validator<Out> = {
  async validate(out) {
    return { valid: out.score >= VALID, score: out.score }
  },
}

function stringWorker() {
  const tasks: string[] = []
  const client = {
    async create(_opts?: CreateSandboxOptions): Promise<SandboxInstance> {
      return {
        async *streamPrompt(message: string) {
          tasks.push(message)
          yield {
            type: 'result',
            data: { directive: directiveOf(message), score: scoreForTask(message) },
          } satisfies SandboxEvent
        },
      } as unknown as SandboxInstance
    },
  }
  return { tasks, client }
}

const worker: AgentRunSpec<string> = {
  profile: { name: 'worker' },
  name: 'worker',
  taskToPrompt: (t) => t,
}

describe('PROMPT_PLANNERS — driver variants through the real kernel', () => {
  it('blind runs exactly one attempt then stops', async () => {
    const { client, tasks } = stringWorker()
    const result = await runLoop({
      driver: createDynamicDriver<string, Out>({ planner: blind }),
      agentRun: worker,
      output,
      validator,
      task: 'solve the task',
      ctx: { sandboxClient: client },
      maxIterations: 8,
    })
    expect(result.decision).toBe('done')
    expect(result.iterations).toHaveLength(1)
    expect(tasks).toEqual(['solve the task']) // no steering directive injected
  })

  it('drew escalates pursue → evolve → critical-audit, then verifies the win', async () => {
    const { client } = stringWorker()
    const result = await runLoop({
      driver: createDynamicDriver<string, Out>({ planner: drew, maxIterations: 8 }),
      agentRun: worker,
      output,
      validator,
      task: 'ship the feature',
      ctx: { sandboxClient: client },
      maxIterations: 12,
    })
    expect(result.decision).toBe('done')
    // pursue(0.3) → evolve(0.3, plateau) → critical-audit(0.9 valid) → verify(0.9) → stop
    expect(result.iterations.map((i) => directiveOf(i.task))).toEqual([
      'pursue',
      'evolve',
      'critical-audit',
      'verify',
    ])
    expect(result.winner?.verdict?.valid).toBe(true)
    expect(result.winner?.verdict?.score).toBeCloseTo(0.9, 6)
  })

  it('refineOnFail stops as soon as an attempt is valid', async () => {
    // A worker whose 2nd attempt clears the bar regardless of directive.
    let n = 0
    const client = {
      async create(): Promise<SandboxInstance> {
        return {
          async *streamPrompt(message: string) {
            const score = n++ === 0 ? 0.3 : 0.9
            yield {
              type: 'result',
              data: { directive: directiveOf(message), score },
            } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    }
    const result = await runLoop({
      driver: createDynamicDriver<string, Out>({ planner: refineOnFail, maxIterations: 8 }),
      agentRun: worker,
      output,
      validator,
      task: 'fix the bug',
      ctx: { sandboxClient: client },
      maxIterations: 12,
    })
    expect(result.decision).toBe('done')
    expect(result.iterations).toHaveLength(2) // fail, then a valid refine
    expect(result.winner?.verdict?.valid).toBe(true)
  })

  it('resolvePlanner returns registered planners and fails loud on unknown', () => {
    expect(resolvePlanner('drew')).toBe(drew)
    expect(resolvePlanner('blind')).toBe(blind)
    expect(Object.keys(PROMPT_PLANNERS).sort()).toEqual(['blind', 'drew', 'refine-on-fail'])
    expect(() => resolvePlanner('teleport')).toThrow(/unknown driver 'teleport'/)
  })
})
