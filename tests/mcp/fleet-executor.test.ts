import type {
  AgentProfile,
  CreateSandboxOptions,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { detachedSessionDelegate } from '../../src/mcp/delegates'
import {
  createFleetWorkspaceExecutor,
  createSiblingSandboxExecutor,
  type FleetHandle,
} from '../../src/mcp/executor'
import {
  type AgentRunSpec,
  type LoopTraceEvent,
  type OutputAdapter,
  runLoop,
} from '../../src/runtime'

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

function stubFleet(machineIds: string[], opts?: { failOnSandbox?: boolean }): StubFleet {
  const prompts: Array<{ machineId: string; message: string }> = []
  const selections: string[] = []
  const ids: ReadonlyArray<string> = [...machineIds]
  const handle: StubFleet = {
    fleetId: 'fl_test',
    ids,
    prompts,
    selections,
    async sandbox(machineId: string): Promise<SandboxInstance> {
      if (opts?.failOnSandbox) throw new Error('sandbox-resolution-failed')
      selections.push(machineId)
      const sandboxId = `box_${machineId}`
      const events: SandboxEvent[] = [
        { type: 'message.completed', data: { prompt: '', machineId, sandboxId } },
      ]
      return {
        id: sandboxId,
        async *streamPrompt(message: string) {
          prompts.push({ machineId, message })
          for (const e of events) {
            yield {
              ...e,
              data: { ...(e.data as Record<string, unknown>), prompt: message },
            }
          }
        },
      } as unknown as SandboxInstance
    },
  }
  return handle
}

describe('createSiblingSandboxExecutor', () => {
  it('produces a placement of kind=sibling carrying the sandbox id', async () => {
    const events: LoopTraceEvent[] = []
    const fakeBox = {
      id: 'box_sibling_1',
      async *streamPrompt() {
        yield { type: 'message.completed', data: {} } satisfies SandboxEvent
      },
    } as unknown as SandboxInstance
    const executor = createSiblingSandboxExecutor({
      client: {
        async create(): Promise<SandboxInstance> {
          return fakeBox
        },
      },
    })

    await runLoop<SimpleTask, SimpleOutput, 'pick-winner' | 'fail'>({
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
        sandboxClient: executor.client,
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
      placement: 'sibling',
      sandboxId: 'box_sibling_1',
    })
    expect((dispatch?.payload as { fleetId?: string }).fleetId).toBeUndefined()
  })

  it('describe() returns a stable human-readable tag', () => {
    const executor = createSiblingSandboxExecutor({
      client: {
        async create(): Promise<SandboxInstance> {
          return null as unknown as SandboxInstance
        },
      },
    })
    expect(executor.describe()).toMatch(/sibling-sandbox/)
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

    await runLoop<SimpleTask, SimpleOutput, 'pick-winner' | 'fail'>({
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
        sandboxClient: executor.client,
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

    await expect(executor.client.create({} as CreateSandboxOptions)).rejects.toThrow(
      /no eligible worker machines/,
    )
  })

  it('honours a custom selectMachine policy', async () => {
    const fleet = stubFleet(['worker-1', 'worker-2'])
    const executor = createFleetWorkspaceExecutor({
      fleet,
      selectMachine: ({ callIndex, ids }) =>
        ids[ids.length - 1 - (callIndex % ids.length)] ?? ids[0]!,
    })

    await executor.client.create()
    await executor.client.create()
    expect(fleet.selections).toEqual(['worker-2', 'worker-1'])
  })

  it('propagates sandbox-resolution errors', async () => {
    const fleet = stubFleet(['worker-1'], { failOnSandbox: true })
    const executor = createFleetWorkspaceExecutor({ fleet })
    await expect(executor.client.create()).rejects.toThrow(/sandbox-resolution-failed/)
  })

  it('describe() reports fleetId, machines, and exclusions', () => {
    const fleet = stubFleet(['coordinator', 'worker-1'])
    const executor = createFleetWorkspaceExecutor({
      fleet,
      excludeMachineIds: ['coordinator'],
    })
    const tag = executor.describe()
    expect(tag).toMatch(/fleetId=fl_test/)
    expect(tag).toMatch(/coordinator,worker-1/)
    expect(tag).toMatch(/excluded=\[coordinator\]/)
  })
})

describe('detachedSessionDelegate with executor', () => {
  it('rejects when both executor and sandboxClient are passed', () => {
    const fakeClient = {
      async create(): Promise<SandboxInstance> {
        return null as unknown as SandboxInstance
      },
    }
    const executor = createSiblingSandboxExecutor({ client: fakeClient })
    expect(() => detachedSessionDelegate({ executor, sandboxClient: fakeClient })).toThrow(
      /exactly one/,
    )
  })

  it('rejects when neither is passed', () => {
    expect(() => detachedSessionDelegate({})).toThrow(/required/)
  })

  it('accepts the legacy sandboxClient shorthand (defaults to sibling)', () => {
    const fakeClient = {
      async create(): Promise<SandboxInstance> {
        return null as unknown as SandboxInstance
      },
    }
    const delegate = detachedSessionDelegate({ sandboxClient: fakeClient })
    expect(typeof delegate).toBe('function')
  })
})

describe('SandboxClient placement default', () => {
  it('falls back to sibling when the client has no describePlacement', async () => {
    const events: LoopTraceEvent[] = []
    const fakeBox = {
      id: 'box_anon',
      async *streamPrompt() {
        yield { type: 'message.completed', data: {} } satisfies SandboxEvent
      },
    } as unknown as SandboxInstance

    await runLoop<SimpleTask, SimpleOutput, 'pick-winner' | 'fail'>({
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
        sandboxClient: {
          async create(): Promise<SandboxInstance> {
            return fakeBox
          },
        },
        traceEmitter: {
          emit(e) {
            events.push(e)
          },
        },
      },
    })

    const dispatch = events.find((e) => e.kind === 'loop.iteration.dispatch')
    expect(dispatch?.payload).toMatchObject({ placement: 'sibling', sandboxId: 'box_anon' })
  })

  it('ignores a describePlacement that throws and falls back to sibling', async () => {
    const events: LoopTraceEvent[] = []
    const fakeBox = {
      id: 'box_throw',
      async *streamPrompt() {
        yield { type: 'message.completed', data: {} } satisfies SandboxEvent
      },
    } as unknown as SandboxInstance

    await runLoop<SimpleTask, SimpleOutput, 'pick-winner' | 'fail'>({
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
        sandboxClient: {
          async create(): Promise<SandboxInstance> {
            return fakeBox
          },
          describePlacement() {
            throw new Error('adapter bug')
          },
        },
        traceEmitter: {
          emit(e) {
            events.push(e)
          },
        },
      },
    })

    const dispatch = events.find((e) => e.kind === 'loop.iteration.dispatch')
    expect(dispatch?.payload).toMatchObject({ placement: 'sibling', sandboxId: 'box_throw' })
  })
})
