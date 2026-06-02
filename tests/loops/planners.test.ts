import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  blind,
  createDynamicDriver,
  type OutputAdapter,
  PROMPT_PLANNERS,
  resolvePlanner,
  runLoop,
  type Validator,
} from '../../src/loops'

const VALID = 0.7

interface Out {
  score: number
}

const output: OutputAdapter<Out> = {
  parse(events) {
    const d = events.at(-1)?.data as Partial<Out> | undefined
    return { score: typeof d?.score === 'number' ? d.score : 0 }
  },
}

const validator: Validator<Out> = {
  async validate(out) {
    return { valid: out.score >= VALID, score: out.score }
  },
}

function stringWorker(score: number) {
  const tasks: string[] = []
  const client = {
    async create(_opts?: CreateSandboxOptions): Promise<SandboxInstance> {
      return {
        async *streamPrompt(message: string) {
          tasks.push(message)
          yield { type: 'result', data: { score } } satisfies SandboxEvent
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

describe('PROMPT_PLANNERS — deterministic driver controls', () => {
  it('blind runs exactly one attempt then stops, with no steering injected', async () => {
    const { client, tasks } = stringWorker(0.3)
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
    expect(tasks).toEqual(['solve the task']) // exact root task, no directive prepended
  })

  it('resolvePlanner returns registered planners and fails loud on unknown', () => {
    expect(resolvePlanner('blind')).toBe(blind)
    expect(Object.keys(PROMPT_PLANNERS)).toEqual(['blind'])
    expect(() => resolvePlanner('teleport')).toThrow(/unknown driver 'teleport'/)
  })
})
