import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { runAgentRounds } from '../../src/runtime/run-loop'
import type { AgentRunSpec, Driver, OutputAdapter, Validator } from '../../src/runtime/types'
import { fanoutDriver, refineDriver } from './refine-driver'

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
  taskToPrompt: (task) => task.goal,
}

function testProvider(
  name: string,
  create: AgentEnvironmentProvider['create'],
): AgentEnvironmentProvider {
  return {
    name,
    capabilities() {
      throw new Error('capabilities are not used without lineage')
    },
    create,
  }
}

function counterProvider(): AgentEnvironmentProvider {
  let attempt = 0
  return testProvider('counter', async () => {
    attempt += 1
    const currentAttempt = attempt
    return {
      id: `counter-${currentAttempt}`,
      provider: 'counter',
      async status() {
        return 'running'
      },
      async *stream() {
        yield {
          type: 'result',
          data: { attempt: currentAttempt },
        } satisfies AgentEnvironmentEvent
      },
    }
  })
}

function unavailableProvider(name: string): AgentEnvironmentProvider {
  return testProvider(name, async () => {
    throw new Error('provider must not run in this type-only branch')
  })
}

describe('runAgentRounds composition with a nested run inside plan()', () => {
  it('wraps an inner refine loop and the outer driver uses its winner', async () => {
    const innerProvider = counterProvider()

    let innerBest = 0
    const outerDriver: Driver<Task, Outer, 'stop' | 'continue'> = {
      name: 'outer',
      async plan(task, history) {
        if (history.length >= 2) return []
        const innerResult = await runAgentRounds({
          driver: refineDriver<Task, Inner>(),
          agentRun: innerSpec,
          output: innerOutput,
          validator: innerValidator,
          task,
          ctx: { environmentProvider: innerProvider },
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
    const outerProvider = testProvider('outer', async () => {
      const id = `outer-${outerCalls}`
      outerCalls += 1
      return {
        id,
        provider: 'outer',
        async status() {
          return 'running'
        },
        async *stream() {
          yield {
            type: 'result',
            data: { best: innerBest },
          } satisfies AgentEnvironmentEvent
        },
      }
    })

    const outerOutput: OutputAdapter<Outer> = {
      parse(events) {
        const last = events.at(-1)
        const data = last?.data as { best?: number } | undefined
        return { best: typeof data?.best === 'number' ? data.best : 0 }
      },
    }

    const result = await runAgentRounds({
      driver: outerDriver,
      agentRun: {
        profile,
        name: 'outer-agent',
        taskToPrompt: (task) => `outer:${task.goal}`,
      },
      output: outerOutput,
      validator: outerValidator,
      task: { goal: 'compose' },
      ctx: { environmentProvider: outerProvider },
    })

    expect(outerCalls).toBeGreaterThan(0)
    expect(result.iterations.length).toBeGreaterThan(0)
    expect(result.decision).toBe('stop')
  })

  it('allows a driver to compose multiple runAgentRounds calls sequentially', () => {
    async function typecheckOnly() {
      const first = await runAgentRounds({
        driver: refineDriver<Task, Inner>(),
        agentRun: innerSpec,
        output: innerOutput,
        validator: innerValidator,
        task: { goal: '' },
        ctx: { environmentProvider: unavailableProvider('first') },
      })
      const second = await runAgentRounds({
        driver: fanoutDriver<Task, Inner>(2),
        agentRun: innerSpec,
        output: innerOutput,
        validator: innerValidator,
        task: { goal: '' },
        ctx: { environmentProvider: unavailableProvider('second') },
      })
      return { first, second }
    }

    expect(typeof typecheckOnly).toBe('function')
  })
})
