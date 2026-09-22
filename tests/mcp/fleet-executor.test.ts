import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
  PlacementInfo,
} from '@tangle-network/agent-interface/environment-provider'
import type { SandboxInstanceLike } from '@tangle-network/agent-provider-tangle'
import { describe, expect, it } from 'vitest'
import {
  createDelegationExecutor,
  createFleetWorkspaceExecutor,
  type FleetHandle,
} from '../../src/mcp/executor'
import { inProcessEnvironmentProvider } from '../../src/runtime/in-process-environment-provider'
import { runAgentRounds } from '../../src/runtime/run-loop'
import type { AgentRunSpec, LoopTraceEvent, OutputAdapter } from '../../src/runtime/types'

const profile: AgentProfile = { name: 'stub' }

interface SimpleTask {
  goal: string
}

interface SimpleOutput {
  prompt: string
  machineId?: string
}

function adapter(): OutputAdapter<SimpleOutput> {
  return {
    parse(events) {
      const last = events.at(-1)
      const data = (last?.data ?? {}) as { prompt?: string; machineId?: string }
      return { prompt: data.prompt ?? '', machineId: data.machineId }
    },
  }
}

function spec(name = 'agent'): AgentRunSpec<SimpleTask> {
  return {
    profile,
    name,
    taskToPrompt: (task) => task.goal,
  }
}

interface StubFleet extends FleetHandle {
  prompts: Array<{ machineId: string; message: string }>
  selections: string[]
}

function testProvider(options: {
  id: string
  placement?: () => Promise<PlacementInfo>
}): AgentEnvironmentProvider {
  const base = inProcessEnvironmentProvider({
    name: 'test-provider',
    id: options.id,
    onTurn: (prompt) => [{ type: 'message.completed', data: { prompt } }],
  })
  return {
    ...base,
    async create(input): Promise<AgentEnvironment> {
      const { placement: basePlacement, ...environment } = await base.create(input)
      void basePlacement
      return options.placement ? { ...environment, placement: options.placement } : environment
    },
  }
}

function stubFleet(machineIds: string[], opts?: { failOnSandbox?: boolean }): StubFleet {
  const prompts: Array<{ machineId: string; message: string }> = []
  const selections: string[] = []
  const ids: ReadonlyArray<string> = [...machineIds]
  const handle: StubFleet = {
    fleetId: 'fl_test',
    ids,
    prompts,
    selections,
    async sandbox(machineId: string): Promise<SandboxInstanceLike> {
      if (opts?.failOnSandbox) throw new Error('sandbox-resolution-failed')
      selections.push(machineId)
      const environmentId = `box_${machineId}`
      const environment: SandboxInstanceLike = {
        id: environmentId,
        async *streamPrompt(message) {
          const prompt = typeof message === 'string' ? message : (JSON.stringify(message) ?? '')
          prompts.push({ machineId, message: prompt })
          yield {
            type: 'message.completed',
            data: { prompt, machineId, environmentId },
          }
        },
      }
      return environment
    },
  }
  return handle
}

describe('createDelegationExecutor', () => {
  it('preserves provider placement and environment identity', async () => {
    const events: LoopTraceEvent[] = []
    const provider = testProvider({
      id: 'environment-1',
      placement: async () => ({ kind: 'sandbox', sandboxId: 'environment-1' }),
    })
    const executor = createDelegationExecutor(provider)

    await runAgentRounds<SimpleTask, SimpleOutput, 'pick-winner' | 'fail'>({
      driver: {
        name: 'one-shot',
        async plan(t, history) {
          return history.length === 0 ? [t] : []
        },
        decide(h) {
          return h.length > 0 ? 'pick-winner' : 'fail'
        },
      },
      agentRun: spec(),
      output: adapter(),
      task: { goal: 'hi' },
      maxIterations: 1,
      ctx: {
        environmentProvider: executor.provider,
        traceEmitter: {
          emit(e) {
            events.push(e)
          },
        },
      },
    })

    const dispatch = events.find((e) => e.kind === 'loop.iteration.dispatch')
    expect(dispatch).toBeDefined()
    expect(dispatch?.payload).toMatchObject({
      placement: 'sandbox',
      environmentId: 'environment-1',
      provider: 'test-provider',
    })
    expect((dispatch!.payload as { fleetId?: string }).fleetId).toBeUndefined()
  })

  it('describe() returns a stable human-readable tag', () => {
    const executor = createDelegationExecutor(testProvider({ id: 'environment-1' }))
    expect(executor.describe()).toBe('provider (test-provider)')
  })
})

describe('createFleetWorkspaceExecutor', () => {
  it('round-robins machine selection across iterations', async () => {
    const fleet = stubFleet(['coordinator', 'worker-1', 'worker-2'])
    const executor = createFleetWorkspaceExecutor({
      fleet,
      excludeMachineIds: ['coordinator'],
    })
    const events: LoopTraceEvent[] = []

    await runAgentRounds<SimpleTask, SimpleOutput, 'pick-winner' | 'fail'>({
      driver: {
        name: 'fanout-3',
        async plan(t, history) {
          return history.length === 0 ? [t, t, t] : []
        },
        decide(h) {
          return h.length > 0 ? 'pick-winner' : 'fail'
        },
      },
      agentRun: spec(),
      output: adapter(),
      task: { goal: 'land a diff' },
      maxIterations: 3,
      maxConcurrency: 1, // serial so round-robin order is deterministic
      ctx: {
        environmentProvider: executor.provider,
        traceEmitter: {
          emit(e) {
            events.push(e)
          },
        },
      },
    })

    expect(fleet.selections).toEqual(['worker-1', 'worker-2', 'worker-1'])
    expect(fleet.prompts).toHaveLength(3)
    expect(fleet.prompts[0]?.machineId).toBe('worker-1')

    const dispatches = events.filter((e) => e.kind === 'loop.iteration.dispatch')
    expect(dispatches).toHaveLength(3)
    for (const d of dispatches) {
      expect(d.payload).toMatchObject({ placement: 'fleet', fleetId: 'fl_test' })
    }
    const machineSeq = dispatches.map((d) => (d.payload as { machineId?: string }).machineId)
    expect(machineSeq).toEqual(['worker-1', 'worker-2', 'worker-1'])
  })

  it('fails loud when every machine is excluded', async () => {
    const fleet = stubFleet(['coordinator'])
    const executor = createFleetWorkspaceExecutor({
      fleet,
      excludeMachineIds: ['coordinator'],
    })

    await expect(executor.provider.create({ profile })).rejects.toThrow(/no eligible machines/)
  })

  it('honours a custom selectMachine policy', async () => {
    const fleet = stubFleet(['worker-1', 'worker-2'])
    const executor = createFleetWorkspaceExecutor({
      fleet,
      selectMachine: ({ callIndex, ids }) =>
        ids[ids.length - 1 - (callIndex % ids.length)] ?? ids[0]!,
    })

    await executor.provider.create({ profile })
    await executor.provider.create({ profile })
    expect(fleet.selections).toEqual(['worker-2', 'worker-1'])
  })

  it('propagates sandbox-resolution errors', async () => {
    const fleet = stubFleet(['worker-1'], { failOnSandbox: true })
    const executor = createFleetWorkspaceExecutor({ fleet })
    await expect(executor.provider.create({ profile })).rejects.toThrow(/sandbox-resolution-failed/)
  })

  it('describe() reports fleetId, machines, and exclusions', () => {
    const fleet = stubFleet(['coordinator', 'worker-1'])
    const executor = createFleetWorkspaceExecutor({
      fleet,
      excludeMachineIds: ['coordinator'],
    })
    const tag = executor.describe()
    expect(tag).toMatch(/fleet \(id=fl_test/)
    expect(tag).toMatch(/coordinator,worker-1/)
    expect(tag).toMatch(/excluded=\[coordinator\]/)
  })
})

describe('AgentEnvironmentProvider placement default', () => {
  it('falls back to provider when the environment has no placement method', async () => {
    const events: LoopTraceEvent[] = []
    const provider = testProvider({ id: 'environment-without-placement' })

    await runAgentRounds<SimpleTask, SimpleOutput, 'pick-winner' | 'fail'>({
      driver: {
        name: 'one-shot',
        async plan(t, history) {
          return history.length === 0 ? [t] : []
        },
        decide(h) {
          return h.length > 0 ? 'pick-winner' : 'fail'
        },
      },
      agentRun: spec(),
      output: adapter(),
      task: { goal: 'hi' },
      maxIterations: 1,
      ctx: {
        environmentProvider: provider,
        traceEmitter: {
          emit(e) {
            events.push(e)
          },
        },
      },
    })

    const dispatch = events.find((e) => e.kind === 'loop.iteration.dispatch')
    expect(dispatch?.payload).toMatchObject({
      placement: 'provider',
      environmentId: 'environment-without-placement',
      provider: 'test-provider',
    })
  })

  it('ignores a placement method that throws and falls back to provider', async () => {
    const events: LoopTraceEvent[] = []
    const provider = testProvider({
      id: 'environment-with-broken-placement',
      placement: async () => {
        throw new Error('adapter bug')
      },
    })

    await runAgentRounds<SimpleTask, SimpleOutput, 'pick-winner' | 'fail'>({
      driver: {
        name: 'one-shot',
        async plan(t, history) {
          return history.length === 0 ? [t] : []
        },
        decide(h) {
          return h.length > 0 ? 'pick-winner' : 'fail'
        },
      },
      agentRun: spec(),
      output: adapter(),
      task: { goal: 'hi' },
      maxIterations: 1,
      ctx: {
        environmentProvider: provider,
        traceEmitter: {
          emit(e) {
            events.push(e)
          },
        },
      },
    })

    const dispatch = events.find((e) => e.kind === 'loop.iteration.dispatch')
    expect(dispatch?.payload).toMatchObject({
      placement: 'provider',
      environmentId: 'environment-with-broken-placement',
      provider: 'test-provider',
    })
  })
})
