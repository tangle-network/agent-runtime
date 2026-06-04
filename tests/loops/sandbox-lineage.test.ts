import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  createDynamicDriver,
  type OutputAdapter,
  runLoop,
  type TopologyMove,
  type TopologyPlanner,
} from '../../src/loops'

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

function spec(name: string): AgentRunSpec<Task> {
  return { profile: { name }, name, taskToPrompt: (t) => JSON.stringify(t) }
}

/** One `streamPrompt` call's recorded arguments — the box id it ran on and the
 *  session id it carried (undefined ⇒ no continuity). */
interface StreamCall {
  boxId: string
  sessionId?: string
}

/**
 * A fake sandbox client whose boxes record every `streamPrompt` call, support
 * checkpoint+fork, and report a configurable CRIU status. The recorder lets the
 * tests assert which box + session id each iteration ran on.
 */
function createFakeClient(opts: { criuAvailable: boolean }) {
  const streamCalls: StreamCall[] = []
  const created: string[] = []
  const forked: string[] = []
  const deleted: string[] = []
  let boxSeq = 0
  let forkSeq = 0
  let checkpointSeq = 0

  function makeBox(id: string): SandboxInstance {
    const box = {
      id,
      async *streamPrompt(
        _message: string,
        options?: { sessionId?: string },
      ): AsyncGenerator<SandboxEvent> {
        streamCalls.push({ boxId: id, sessionId: options?.sessionId })
        yield { type: 'result', data: { ok: true } } satisfies SandboxEvent
      },
      async checkpoint(_o?: { leaveRunning?: boolean }) {
        return { checkpointId: `cp-${checkpointSeq++}`, createdAt: new Date(), tags: [] }
      },
      async fork(_checkpointId: string): Promise<SandboxInstance> {
        const child = makeBox(`fork-${forkSeq++}`)
        forked.push(child.id as string)
        return child
      },
      async delete() {
        deleted.push(id)
      },
    }
    return box as unknown as SandboxInstance
  }

  const client = {
    async create(): Promise<SandboxInstance> {
      const id = `box-${boxSeq++}`
      created.push(id)
      return makeBox(id)
    },
    async criuStatus() {
      return { available: opts.criuAvailable }
    },
  }
  return { client, streamCalls, created, forked, deleted }
}

/** A driver that replays a fixed sequence of topology moves. */
function scriptedPlanner(moves: TopologyMove<Task>[]): TopologyPlanner<Task, Out> {
  let i = 0
  return () => moves[i++]!
}

describe('runLoop lineage — sessionContinuity OFF (the independence invariant)', () => {
  it('is fresh-box-per-iteration with no sessionId reuse when the flag is off', async () => {
    const { client, streamCalls, created } = createFakeClient({ criuAvailable: true })
    // refine, refine, stop — three single-task rounds.
    const planner = scriptedPlanner([
      { kind: 'refine', task: { goal: 'a' } },
      { kind: 'refine', task: { goal: 'b' } },
      { kind: 'stop' },
    ])
    await runLoop({
      driver: createDynamicDriver<Task, Out>({ planner }),
      agentRun: spec('w'),
      output,
      task: { goal: 'a' },
      ctx: { sandboxClient: client },
      // lineage unset ⇒ default behavior
    })
    // Two iterations, two distinct fresh boxes, NO sessionId on either stream.
    expect(streamCalls).toHaveLength(2)
    expect(new Set(streamCalls.map((c) => c.boxId)).size).toBe(2)
    expect(streamCalls.every((c) => c.sessionId === undefined)).toBe(true)
    expect(created).toHaveLength(2)
  })
})

describe('runLoop lineage — sessionContinuity ON', () => {
  it('a refine continues the parent on the SAME box with the SAME session id', async () => {
    const { client, streamCalls, created } = createFakeClient({ criuAvailable: false })
    const planner = scriptedPlanner([
      { kind: 'refine', task: { goal: 'a' } },
      { kind: 'refine', task: { goal: 'b' } },
      { kind: 'stop' },
    ])
    await runLoop({
      driver: createDynamicDriver<Task, Out>({ planner }),
      agentRun: spec('w'),
      output,
      task: { goal: 'a' },
      ctx: { sandboxClient: client },
      lineage: { sessionContinuity: true },
    })
    expect(streamCalls).toHaveLength(2)
    // Round 0 starts fresh; round 1 continues on the same box + session id.
    expect(streamCalls[0]!.boxId).toBe(streamCalls[1]!.boxId)
    expect(streamCalls[0]!.sessionId).toBeDefined()
    expect(streamCalls[1]!.sessionId).toBe(streamCalls[0]!.sessionId)
    // Only ONE box was created — the second round reused it, not a fresh acquire.
    expect(created).toHaveLength(1)
  })
})

describe('runLoop lineage — forkFanout', () => {
  it('forks the parent checkpoint when criuStatus.available', async () => {
    const { client, streamCalls, created, forked } = createFakeClient({ criuAvailable: true })
    // refine (seed a parent), then a 3-way fanout descending from it, then stop.
    const planner = scriptedPlanner([
      { kind: 'refine', task: { goal: 'seed' } },
      { kind: 'fanout', tasks: [{ goal: 'a' }, { goal: 'b' }, { goal: 'c' }] },
      { kind: 'stop' },
    ])
    await runLoop({
      driver: createDynamicDriver<Task, Out>({ planner, maxFanout: 3 }),
      agentRuns: [spec('a'), spec('b'), spec('c')],
      output,
      task: { goal: 'seed' },
      ctx: { sandboxClient: client },
      lineage: { forkFanout: true },
    })
    // 1 seed stream + 3 branch streams.
    expect(streamCalls).toHaveLength(4)
    // The 3 fanout branches ran on forked boxes, NOT fresh creates: one fresh
    // box for the seed, three forks for the branches.
    expect(created).toHaveLength(1)
    expect(forked).toHaveLength(3)
    const branchBoxes = streamCalls.slice(1).map((c) => c.boxId)
    expect(branchBoxes.every((id) => id.startsWith('fork-'))).toBe(true)
    expect(new Set(branchBoxes).size).toBe(3)
  })

  it('degrades to fresh boxes when criuStatus reports fork unavailable', async () => {
    const { client, streamCalls, created, forked } = createFakeClient({ criuAvailable: false })
    const planner = scriptedPlanner([
      { kind: 'refine', task: { goal: 'seed' } },
      { kind: 'fanout', tasks: [{ goal: 'a' }, { goal: 'b' }, { goal: 'c' }] },
      { kind: 'stop' },
    ])
    await runLoop({
      driver: createDynamicDriver<Task, Out>({ planner, maxFanout: 3 }),
      agentRuns: [spec('a'), spec('b'), spec('c')],
      output,
      task: { goal: 'seed' },
      ctx: { sandboxClient: client },
      lineage: { forkFanout: true },
    })
    expect(streamCalls).toHaveLength(4)
    expect(forked).toHaveLength(0)
    // seed (1) + three independent fresh branches (3) = 4 creates, no forks.
    expect(created).toHaveLength(4)
    expect(streamCalls.slice(1).every((c) => c.boxId.startsWith('box-'))).toBe(true)
  })

  it('falls back to fresh boxes when the client has no criuStatus probe', async () => {
    const base = createFakeClient({ criuAvailable: true })
    // Strip the probe: a client without criuStatus ⇒ canFork=false.
    const client = { create: base.client.create.bind(base.client) }
    const planner = scriptedPlanner([
      { kind: 'refine', task: { goal: 'seed' } },
      { kind: 'fanout', tasks: [{ goal: 'a' }, { goal: 'b' }] },
      { kind: 'stop' },
    ])
    await runLoop({
      driver: createDynamicDriver<Task, Out>({ planner, maxFanout: 2 }),
      agentRuns: [spec('a'), spec('b')],
      output,
      task: { goal: 'seed' },
      ctx: { sandboxClient: client },
      lineage: { forkFanout: true },
    })
    expect(base.forked).toHaveLength(0)
    // seed + 2 fresh branches = 3 creates.
    expect(base.created).toHaveLength(3)
  })
})

describe('runLoop lineage — guardrails', () => {
  it('rejects lineage + onWorkerBox (both own worker boxes)', async () => {
    const { client } = createFakeClient({ criuAvailable: true })
    const planner = scriptedPlanner([{ kind: 'stop' }])
    await expect(
      runLoop({
        driver: createDynamicDriver<Task, Out>({ planner }),
        agentRun: spec('w'),
        output,
        task: { goal: 'a' },
        ctx: { sandboxClient: client },
        lineage: { sessionContinuity: true },
        onWorkerBox: () => {},
      }),
    ).rejects.toThrow(/own worker boxes/)
  })

  it('tears down every lineage-owned box at loop end', async () => {
    const { client, deleted } = createFakeClient({ criuAvailable: true })
    const planner = scriptedPlanner([
      { kind: 'refine', task: { goal: 'seed' } },
      { kind: 'fanout', tasks: [{ goal: 'a' }, { goal: 'b' }] },
      { kind: 'stop' },
    ])
    await runLoop({
      driver: createDynamicDriver<Task, Out>({ planner, maxFanout: 2 }),
      agentRuns: [spec('a'), spec('b')],
      output,
      task: { goal: 'seed' },
      ctx: { sandboxClient: client },
      lineage: { forkFanout: true },
    })
    // 1 seed box + 2 forked branch boxes all reaped by lineage.teardown().
    expect(deleted.sort()).toEqual(['box-0', 'fork-0', 'fork-1'])
  })
})
