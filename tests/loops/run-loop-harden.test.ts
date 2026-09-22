import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { runAgentRounds } from '../../src/runtime/run-loop'
import type {
  AgentRunSpec,
  LoopTraceEmitter,
  LoopTraceEvent,
  OutputAdapter,
} from '../../src/runtime/types'
import { type ScriptedMove, type ScriptedPlanner, scriptedDriver } from './refine-driver'

interface Task {
  goal: string
}

interface Out {
  ok: boolean
}

const output: OutputAdapter<Out> = {
  parse(events) {
    const last = events.at(-1)
    return { ok: Boolean((last?.data as { ok?: boolean } | undefined)?.ok) }
  },
}

function spec(
  name: string,
  taskToPrompt = (task: Task) => JSON.stringify(task),
): AgentRunSpec<Task> {
  return { profile: { name }, name, taskToPrompt }
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

function successfulEnvironment(id: string): AgentEnvironment {
  return {
    id,
    provider: 'test-provider',
    async status() {
      return 'running'
    },
    async *stream() {
      yield { type: 'result', data: { ok: true } } satisfies AgentEnvironmentEvent
    },
    async destroy() {},
  }
}

describe('runAgentRounds cancellation before a fresh batch', () => {
  it('prevents worker dispatch when plan cancels the run', async () => {
    const controller = new AbortController()
    let created = 0
    const environmentProvider = testProvider('test-provider', async () => {
      created += 1
      return successfulEnvironment(`environment-${created}`)
    })
    const planner: ScriptedPlanner<Task, Out> = async () => {
      controller.abort()
      return { kind: 'refine', task: { goal: 'x' } }
    }

    await expect(
      runAgentRounds({
        driver: scriptedDriver<Task, Out>({ planner }),
        agentRun: spec('worker'),
        output,
        task: { goal: 'x' },
        ctx: { environmentProvider, signal: controller.signal },
      }),
    ).rejects.toThrow(/aborted/)
    expect(created).toBe(0)
  })
})

function abortingEnvironment(controller: AbortController): AgentEnvironment {
  return {
    id: 'aborting-environment',
    provider: 'test-provider',
    async status() {
      return 'running'
    },
    async *stream() {
      controller.abort()
      const error = new Error('aborted')
      error.name = 'AbortError'
      yield await Promise.reject(error)
    },
    async destroy() {},
  }
}

describe('runAgentRounds cancellation during an iteration', () => {
  it('rejects instead of recording an empty iteration', async () => {
    const controller = new AbortController()
    const environmentProvider = testProvider('test-provider', async () =>
      abortingEnvironment(controller),
    )
    const planner: ScriptedPlanner<Task, Out> = () => ({
      kind: 'refine',
      task: { goal: 'x' },
    })

    await expect(
      runAgentRounds({
        driver: scriptedDriver<Task, Out>({ planner }),
        agentRun: spec('worker'),
        output,
        task: { goal: 'x' },
        ctx: { environmentProvider, signal: controller.signal },
      }),
    ).rejects.toThrow(/aborted/)
  })

  it('emits the iteration result before cancellation propagates', async () => {
    const controller = new AbortController()
    const environmentProvider = testProvider('test-provider', async () =>
      abortingEnvironment(controller),
    )
    const events: LoopTraceEvent[] = []
    const traceEmitter: LoopTraceEmitter = {
      emit: (event) => void events.push(event),
    }
    const planner: ScriptedPlanner<Task, Out> = () => ({
      kind: 'refine',
      task: { goal: 'x' },
    })

    await expect(
      runAgentRounds({
        driver: scriptedDriver<Task, Out>({ planner }),
        agentRun: spec('worker'),
        output,
        task: { goal: 'x' },
        ctx: { environmentProvider, traceEmitter, signal: controller.signal },
      }),
    ).rejects.toThrow(/aborted/)

    const ended = events.find((event) => event.kind === 'loop.iteration.ended')
    expect(ended?.kind).toBe('loop.iteration.ended')
    if (ended?.kind === 'loop.iteration.ended') {
      expect(ended.payload.error).toMatch(/aborted/)
    }
  })
})

describe('runAgentRounds environment cleanup', () => {
  it('reports a retained environment that fails to destroy', async () => {
    const moves: ScriptedMove<Task>[] = [{ kind: 'refine', task: { goal: 'g' } }, { kind: 'stop' }]
    let round = 0
    const planner: ScriptedPlanner<Task, Out> = () => moves[round++]!
    const environmentProvider = testProvider('test-provider', async () => ({
      ...successfulEnvironment('environment-1'),
      async destroy() {
        throw new Error('auth expired')
      },
    }))
    const events: LoopTraceEvent[] = []
    const traceEmitter: LoopTraceEmitter = {
      emit: (event) => void events.push(event),
    }

    await runAgentRounds({
      driver: scriptedDriver<Task, Out>({ planner }),
      agentRun: spec('worker'),
      output,
      task: { goal: 'g' },
      ctx: { environmentProvider, traceEmitter },
      onWorkerEnvironment: () => {},
    })

    const failed = events.filter((event) => event.kind === 'loop.teardown.failed')
    expect(failed).toHaveLength(1)
    if (failed[0]?.kind === 'loop.teardown.failed') {
      expect(failed[0].payload.environmentId).toBe('environment-1')
      expect(failed[0].payload.reason).toBe('destroy failed')
    }
  })

  it('destroys every retained environment when one destroy call fails', async () => {
    const destroyed: string[] = []
    let sequence = 0
    const moves: ScriptedMove<Task>[] = [
      {
        kind: 'fanout',
        tasks: [{ goal: 'a' }, { goal: 'b' }, { goal: 'c' }],
      },
      { kind: 'stop' },
    ]
    let round = 0
    const planner: ScriptedPlanner<Task, Out> = () => moves[round++]!
    const environmentProvider = testProvider('test-provider', async () => {
      const id = `environment-${sequence++}`
      return {
        ...successfulEnvironment(id),
        async destroy() {
          if (id === 'environment-1') throw new Error('flaky destroy')
          destroyed.push(id)
        },
      }
    })

    await runAgentRounds({
      driver: scriptedDriver<Task, Out>({ planner, maxFanout: 3 }),
      agentRuns: [spec('a'), spec('b'), spec('c')],
      output,
      task: { goal: 'a' },
      ctx: { environmentProvider },
      onWorkerEnvironment: () => {},
    })

    expect(destroyed.sort()).toEqual(['environment-0', 'environment-2'])
  })
})
