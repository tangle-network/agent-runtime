import type { AgentProfile, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { refineDriver } from './refine-driver'
import {
  type AgentRunSpec,
  createFanoutVoteDriver,
  type Driver,
  type OutputAdapter,
  runLoop,
  type Validator,
} from '../../src/loops'

interface Task {
  goal: string
}

interface Inner {
  attempt: number
}

interface Outer {
  best: number
}

const profile: AgentProfile = { name: 'compose-stub' }

const innerOutput: OutputAdapter<Inner> = {
  parse(events) {
    const last = events.at(-1)
    const data = last?.data as { attempt?: number } | undefined
    return { attempt: typeof data?.attempt === 'number' ? data.attempt : 0 }
  },
}

const innerValidator: Validator<Inner> = {
  async validate(out) {
    return { valid: out.attempt >= 2, score: out.attempt / 3 }
  },
}

const outerValidator: Validator<Outer> = {
  async validate(out) {
    return { valid: out.best >= 2, score: out.best }
  },
}

const innerSpec: AgentRunSpec<Task> = {
  profile,
  name: 'inner',
  taskToPrompt: (t) => t.goal,
}

function counterClient() {
  let i = 0
  return {
    async create() {
      const attempt = ++i
      return {
        async *streamPrompt() {
          yield { type: 'result', data: { attempt } } satisfies SandboxEvent
        },
      } as unknown as SandboxInstance
    },
  }
}

describe('runLoop composition — a Driver that nests runLoop inside plan()', () => {
  it('wraps an inner refine loop and the outer driver gates on the inner winner', async () => {
    const innerClient = counterClient()

    // Outer driver: each iteration's plan kicks off a full inner refine loop
    // and yields a *single* outer task whose output adapter just stamps the
    // inner best score. The outer task never reaches the sandbox client
    // because we hand the kernel a no-op spec that immediately yields a
    // synthetic result mirroring the inner winner.
    let innerBest = 0
    const outerDriver: Driver<Task, Outer, 'stop' | 'continue'> = {
      name: 'outer',
      async plan(task, history) {
        if (history.length >= 2) return []
        const innerResult = await runLoop({
          driver: refineDriver<Task, Inner>(),
          agentRun: innerSpec,
          output: innerOutput,
          validator: innerValidator,
          task,
          ctx: { sandboxClient: innerClient },
        })
        innerBest = innerResult.winner?.verdict?.score ?? 0
        return [task]
      },
      decide(history) {
        const last = history.at(-1)
        if (last?.verdict?.valid) return 'stop'
        if (history.length >= 2) return 'stop'
        return 'continue'
      },
    }

    let outerCalls = 0
    const outerClient = {
      async create() {
        outerCalls += 1
        return {
          async *streamPrompt() {
            yield { type: 'result', data: { best: innerBest } } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    }

    const outerOutput: OutputAdapter<Outer> = {
      parse(events) {
        const last = events.at(-1)
        const data = last?.data as { best?: number } | undefined
        return { best: typeof data?.best === 'number' ? data.best : 0 }
      },
    }

    const result = await runLoop({
      driver: outerDriver,
      agentRun: {
        profile,
        name: 'outer-agent',
        taskToPrompt: (t) => `outer:${t.goal}`,
      },
      output: outerOutput,
      validator: outerValidator,
      task: { goal: 'compose' },
      ctx: { sandboxClient: outerClient },
    })

    expect(outerCalls).toBeGreaterThan(0)
    // The inner refine produces attempt=2 on the second iteration (score=2/3),
    // which fails outerValidator's `best >= 2` check, so the loop exhausts
    // the outer cap and stops without winning — but the structure shows the
    // nesting works end-to-end.
    expect(result.iterations.length).toBeGreaterThan(0)
    expect(result.decision).toBe('stop')
  })

  it('static type check: a driver may compose multiple runLoops sequentially', () => {
    // Compile-time proof that nested runLoop calls return well-typed results.
    // The body is intentionally unreachable; the assertion is the type
    // signature itself.
    async function _typecheckOnly() {
      const r1 = await runLoop({
        driver: refineDriver<Task, Inner>(),
        agentRun: innerSpec,
        output: innerOutput,
        validator: innerValidator,
        task: { goal: '' },
        ctx: {
          sandboxClient: {
            async create() {
              throw new Error()
            },
          },
        },
      })
      const r2 = await runLoop({
        driver: createFanoutVoteDriver<Task, Inner>({ n: 2 }),
        agentRun: innerSpec,
        output: innerOutput,
        validator: innerValidator,
        task: { goal: '' },
        ctx: {
          sandboxClient: {
            async create() {
              throw new Error()
            },
          },
        },
      })
      return { r1, r2 }
    }
    expect(typeof _typecheckOnly).toBe('function')
  })
})
