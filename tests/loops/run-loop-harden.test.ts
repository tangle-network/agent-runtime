import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  createDriver,
  type LoopTraceEmitter,
  type LoopTraceEvent,
  type OutputAdapter,
  runLoop,
  type TopologyMove,
  type TopologyPlanner,
} from '../../src/runtime'

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

function spec(name: string, taskToPrompt = (t: Task) => JSON.stringify(t)): AgentRunSpec<Task> {
  return { profile: { name }, name, taskToPrompt }
}

describe('runLoop — abort short-circuits before launching a fresh batch', () => {
  it('an abort during plan() prevents the next round of workers from dispatching', async () => {
    const ctrl = new AbortController()
    let created = 0
    const client = {
      async create(): Promise<SandboxInstance> {
        created += 1
        return {
          async *streamPrompt() {
            yield { type: 'result', data: { ok: true } } satisfies SandboxEvent
          },
          async delete() {},
        } as unknown as SandboxInstance
      },
    }
    // The planner aborts the loop during its own (async) plan() call. The kernel
    // must observe the abort right after plan() returns and NOT reserve+dispatch.
    const planner: TopologyPlanner<Task, Out> = async () => {
      ctrl.abort()
      return { kind: 'refine', task: { goal: 'x' } }
    }
    await expect(
      runLoop({
        driver: createDriver<Task, Out>({ planner }),
        agentRun: spec('w'),
        output,
        task: { goal: 'x' },
        ctx: { sandboxClient: client, signal: ctrl.signal },
      }),
    ).rejects.toThrow(/aborted/)
    expect(created).toBe(0)
  })
})

// A box whose stream aborts the loop and then throws an AbortError on its first
// pull — exercises the kernel's catch -> rethrow-on-abort fail-loud path.
function abortingBox(ctrl: AbortController): SandboxInstance {
  return {
    async *streamPrompt() {
      ctrl.abort()
      const err = new Error('aborted')
      err.name = 'AbortError'
      yield await Promise.reject(err)
    },
    async delete() {},
  } as unknown as SandboxInstance
}

describe('runLoop — fail-loud on abort mid-iteration (no soft-failure masking)', () => {
  it('an AbortError thrown during streamPrompt rejects the loop, not a recorded empty iteration', async () => {
    const ctrl = new AbortController()
    const client = { create: async () => abortingBox(ctrl) }
    const planner: TopologyPlanner<Task, Out> = () => ({ kind: 'refine', task: { goal: 'x' } })
    await expect(
      runLoop({
        driver: createDriver<Task, Out>({ planner }),
        agentRun: spec('w'),
        output,
        task: { goal: 'x' },
        ctx: { sandboxClient: client, signal: ctrl.signal },
      }),
    ).rejects.toThrow(/aborted/)
  })

  it('the iteration.ended trace is still emitted before the abort propagates', async () => {
    const ctrl = new AbortController()
    const client = { create: async () => abortingBox(ctrl) }
    const events: LoopTraceEvent[] = []
    const traceEmitter: LoopTraceEmitter = { emit: (e) => void events.push(e) }
    const planner: TopologyPlanner<Task, Out> = () => ({ kind: 'refine', task: { goal: 'x' } })
    await expect(
      runLoop({
        driver: createDriver<Task, Out>({ planner }),
        agentRun: spec('w'),
        output,
        task: { goal: 'x' },
        ctx: { sandboxClient: client, traceEmitter, signal: ctrl.signal },
      }),
    ).rejects.toThrow(/aborted/)
    const ended = events.find((e) => e.kind === 'loop.iteration.ended')
    expect(ended?.kind).toBe('loop.iteration.ended')
    if (ended?.kind === 'loop.iteration.ended') {
      expect(ended.payload.error).toMatch(/aborted/)
    }
  })
})

describe('runLoop — teardown observability + parallelism', () => {
  it('emits loop.teardown.failed when a kept-alive worker box delete throws', async () => {
    const moves: TopologyMove<Task>[] = [{ kind: 'refine', task: { goal: 'g' } }, { kind: 'stop' }]
    let round = 0
    const planner: TopologyPlanner<Task, Out> = () => moves[round++]!
    const client = {
      async create(): Promise<SandboxInstance> {
        return {
          id: 'box-1',
          async *streamPrompt() {
            yield { type: 'result', data: { ok: true } } satisfies SandboxEvent
          },
          async delete() {
            throw new Error('auth expired')
          },
        } as unknown as SandboxInstance
      },
    }
    const events: LoopTraceEvent[] = []
    const traceEmitter: LoopTraceEmitter = { emit: (e) => void events.push(e) }
    // onWorkerBox keeps the box alive across plan(); teardown runs at loop end,
    // and the throwing delete must surface as a loop.teardown.failed span.
    await runLoop({
      driver: createDriver<Task, Out>({ planner }),
      agentRun: spec('w'),
      output,
      task: { goal: 'g' },
      ctx: { sandboxClient: client, traceEmitter },
      onWorkerBox: () => {},
    })
    const failed = events.filter((e) => e.kind === 'loop.teardown.failed')
    expect(failed).toHaveLength(1)
    if (failed[0]?.kind === 'loop.teardown.failed') {
      expect(failed[0].payload.sandboxId).toBe('box-1')
      expect(failed[0].payload.reason).toBe('delete threw')
    }
  })

  it('tears down all kept-alive boxes even when one delete throws', async () => {
    const deleted: string[] = []
    let n = 0
    const moves: TopologyMove<Task>[] = [
      {
        kind: 'fanout',
        tasks: [{ goal: 'a' }, { goal: 'b' }, { goal: 'c' }],
      },
      { kind: 'stop' },
    ]
    let round = 0
    const planner: TopologyPlanner<Task, Out> = () => moves[round++]!
    const client = {
      async create(): Promise<SandboxInstance> {
        const id = `box-${n++}`
        return {
          id,
          async *streamPrompt() {
            yield { type: 'result', data: { ok: true } } satisfies SandboxEvent
          },
          async delete() {
            if (id === 'box-1') throw new Error('flaky delete')
            deleted.push(id)
          },
        } as unknown as SandboxInstance
      },
    }
    await runLoop({
      driver: createDriver<Task, Out>({ planner, maxFanout: 3 }),
      agentRuns: [spec('a'), spec('b'), spec('c')],
      output,
      task: { goal: 'a' },
      ctx: { sandboxClient: client },
      onWorkerBox: () => {},
    })
    // box-1's delete threw but the other two were still deleted (parallel, allSettled).
    expect(deleted.sort()).toEqual(['box-0', 'box-2'])
  })
})
