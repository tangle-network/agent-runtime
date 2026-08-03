import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  type Driver,
  type Iteration,
  type OutputAdapter,
  runAgentRounds,
} from '../../src/runtime'
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

function spec(name: string): AgentRunSpec<Task> {
  return { profile: { name }, name, taskToPrompt: (t) => JSON.stringify(t) }
}

/** One `streamPrompt` call's recorded arguments — the box id it ran on, the
 *  session id it carried (undefined ⇒ no continuity), and how many boxes had
 *  already been deleted when it began (so a test can prove a box was pruned
 *  mid-loop, not reaped at teardown). */
interface StreamCall {
  boxId: string
  sessionId?: string
  deletedAtStart: number
}

interface FakeClientOpts {
  criuAvailable: boolean
  /**
   * Whether boxes expose `session(id).status()`. `'live'` ⇒ status resolves a
   * SessionInfo (the platform honored the id); `'dead'` ⇒ status resolves null
   * (id unknown/reaped). Omitted ⇒ no `session` method (today's fakes).
   */
  sessionState?: 'live' | 'dead'
  /** Invoked at the start of every `streamPrompt`, 1-based call count. Lets a
   *  test abort mid-run. */
  onStream?: (callIndex: number) => void
}

/**
 * A fake sandbox client whose boxes record every `streamPrompt` call, support
 * checkpoint+fork, and report a configurable CRIU status. The recorder lets the
 * tests assert which box + session id each iteration ran on. `peakFork` tracks
 * the highest number of `fork` calls in flight at once — so a test can prove
 * fork creation respects the concurrency bound.
 */
function createFakeClient(opts: FakeClientOpts) {
  const streamCalls: StreamCall[] = []
  const created: string[] = []
  const forked: string[] = []
  const deleted: string[] = []
  const peakFork = { value: 0 }
  let forkInFlight = 0
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
        streamCalls.push({
          boxId: id,
          sessionId: options?.sessionId,
          deletedAtStart: deleted.length,
        })
        opts.onStream?.(streamCalls.length)
        yield { type: 'result', data: { ok: true } } satisfies SandboxEvent
      },
      async checkpoint(_o?: { leaveRunning?: boolean }) {
        return { checkpointId: `cp-${checkpointSeq++}`, createdAt: new Date(), tags: [] }
      },
      async fork(_checkpointId: string): Promise<SandboxInstance> {
        forkInFlight += 1
        peakFork.value = Math.max(peakFork.value, forkInFlight)
        // Yield so concurrently-started forks overlap — peakFork then reflects
        // the real in-flight ceiling, not a serialized 1.
        await Promise.resolve()
        const child = makeBox(`fork-${forkSeq++}`)
        forked.push(child.id as string)
        forkInFlight -= 1
        return child
      },
      async delete() {
        deleted.push(id)
      },
      ...(opts.sessionState
        ? {
            session(_id: string) {
              return {
                async status() {
                  return opts.sessionState === 'dead'
                    ? null
                    : { id: _id, status: 'completed' as const }
                },
              }
            },
          }
        : {}),
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
  return { client, streamCalls, created, forked, deleted, peakFork }
}

/** A planner that replays a fixed sequence of topology moves. */
function scriptedPlanner(moves: ScriptedMove<Task>[]): ScriptedPlanner<Task, Out> {
  let i = 0
  return () => moves[i++]!
}

describe('runAgentRounds lineage — sessionContinuity OFF (the independence invariant)', () => {
  it('is fresh-box-per-iteration with no sessionId reuse when the flag is off', async () => {
    const { client, streamCalls, created } = createFakeClient({ criuAvailable: true })
    // refine, refine, stop — three single-task rounds.
    const planner = scriptedPlanner([
      { kind: 'refine', task: { goal: 'a' } },
      { kind: 'refine', task: { goal: 'b' } },
      { kind: 'stop' },
    ])
    await runAgentRounds({
      driver: scriptedDriver<Task, Out>({ planner }),
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

describe('runAgentRounds — streaming: poll (drop-resilient batch path)', () => {
  it('fire-and-detaches via dispatchPrompt + drains the terminal result, never holding a live stream', async () => {
    const calls = { stream: 0, dispatch: 0, result: 0 }
    const client = {
      async create(): Promise<SandboxInstance> {
        return {
          id: 'poll-box',
          async *streamPrompt(): AsyncGenerator<SandboxEvent> {
            calls.stream += 1 // MUST NOT run in poll mode — that is the whole point
            yield { type: 'result', data: { finalText: 'SSE' } }
          },
          async dispatchPrompt(_m: string, o?: { sessionId?: string }) {
            calls.dispatch += 1
            return {
              sessionId: o?.sessionId ?? 'minted',
              status: 'running' as const,
              alreadyExisted: false,
            }
          },
          session(id: string) {
            return {
              async status() {
                return { id, status: 'completed' as const }
              },
              async result() {
                calls.result += 1
                return { success: true, response: 'POLLED', durationMs: 1 }
              },
            }
          },
          async delete() {},
        } as unknown as SandboxInstance
      },
    }
    const pollOutput: OutputAdapter<string> = {
      parse: (events) =>
        String((events.at(-1)?.data as { finalText?: string } | undefined)?.finalText ?? ''),
    }
    const moves: ScriptedMove<Task>[] = [{ kind: 'refine', task: { goal: 'g' } }, { kind: 'stop' }]
    let i = 0
    const planner: ScriptedPlanner<Task, string> = () => moves[i++]!

    await runAgentRounds<Task, string, 'continue' | 'done'>({
      driver: scriptedDriver<Task, string>({ planner }),
      agentRun: spec('w'),
      output: pollOutput,
      task: { goal: 'g' },
      ctx: { sandboxClient: client as never },
      lineage: { streaming: 'poll' },
    })

    expect(calls.dispatch).toBe(1) // fire-and-detach used
    expect(calls.result).toBe(1) // terminal result drained by status-poll
    expect(calls.stream).toBe(0) // a live SSE was NEVER held — the drop is impossible
  })
})

describe('runAgentRounds lineage — sessionContinuity ON', () => {
  it('a refine continues the parent on the SAME box with the SAME session id', async () => {
    const { client, streamCalls, created } = createFakeClient({ criuAvailable: false })
    const planner = scriptedPlanner([
      { kind: 'refine', task: { goal: 'a' } },
      { kind: 'refine', task: { goal: 'b' } },
      { kind: 'stop' },
    ])
    await runAgentRounds({
      driver: scriptedDriver<Task, Out>({ planner }),
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

describe('runAgentRounds lineage — forkFanout', () => {
  it('forks the parent checkpoint when criuStatus.available', async () => {
    const { client, streamCalls, created, forked } = createFakeClient({ criuAvailable: true })
    // refine (seed a parent), then a 3-way fanout descending from it, then stop.
    const planner = scriptedPlanner([
      { kind: 'refine', task: { goal: 'seed' } },
      { kind: 'fanout', tasks: [{ goal: 'a' }, { goal: 'b' }, { goal: 'c' }] },
      { kind: 'stop' },
    ])
    await runAgentRounds({
      driver: scriptedDriver<Task, Out>({ planner, maxFanout: 3 }),
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
    await runAgentRounds({
      driver: scriptedDriver<Task, Out>({ planner, maxFanout: 3 }),
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
    await runAgentRounds({
      driver: scriptedDriver<Task, Out>({ planner, maxFanout: 2 }),
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

describe('runAgentRounds lineage — guardrails', () => {
  it('rejects lineage + onWorkerBox (both own worker boxes)', async () => {
    const { client } = createFakeClient({ criuAvailable: true })
    const planner = scriptedPlanner([{ kind: 'stop' }])
    await expect(
      runAgentRounds({
        driver: scriptedDriver<Task, Out>({ planner }),
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
    await runAgentRounds({
      driver: scriptedDriver<Task, Out>({ planner, maxFanout: 2 }),
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

describe('runAgentRounds lineage — continue asserts session liveness (fail-loud)', () => {
  it('throws when the platform reports the continued session is unknown', async () => {
    const { client } = createFakeClient({ criuAvailable: false, sessionState: 'dead' })
    const planner = scriptedPlanner([
      { kind: 'refine', task: { goal: 'a' } },
      { kind: 'refine', task: { goal: 'b' } },
      { kind: 'stop' },
    ])
    await expect(
      runAgentRounds({
        driver: scriptedDriver<Task, Out>({ planner }),
        agentRun: spec('w'),
        output,
        task: { goal: 'a' },
        ctx: { sandboxClient: client },
        lineage: { sessionContinuity: true },
      }),
    ).rejects.toThrow(/not known to the sandbox/)
  })

  it('proceeds when the platform reports the session is live', async () => {
    const { client, streamCalls } = createFakeClient({ criuAvailable: false, sessionState: 'live' })
    const planner = scriptedPlanner([
      { kind: 'refine', task: { goal: 'a' } },
      { kind: 'refine', task: { goal: 'b' } },
      { kind: 'stop' },
    ])
    await runAgentRounds({
      driver: scriptedDriver<Task, Out>({ planner }),
      agentRun: spec('w'),
      output,
      task: { goal: 'a' },
      ctx: { sandboxClient: client },
      lineage: { sessionContinuity: true },
    })
    // Continuation ran: same box, same session id, second turn not blocked.
    expect(streamCalls).toHaveLength(2)
    expect(streamCalls[1]!.boxId).toBe(streamCalls[0]!.boxId)
    expect(streamCalls[1]!.sessionId).toBe(streamCalls[0]!.sessionId)
  })
})

describe('runAgentRounds lineage — fork creation respects the concurrency bound', () => {
  it('never has more than maxConcurrency forks in flight at once', async () => {
    const { client, peakFork, forked } = createFakeClient({ criuAvailable: true })
    // refine seed, then a 6-way fanout descending from it, under maxConcurrency 2.
    const planner = scriptedPlanner([
      { kind: 'refine', task: { goal: 'seed' } },
      {
        kind: 'fanout',
        tasks: [
          { goal: 'a' },
          { goal: 'b' },
          { goal: 'c' },
          { goal: 'd' },
          { goal: 'e' },
          { goal: 'f' },
        ],
      },
      { kind: 'stop' },
    ])
    await runAgentRounds({
      driver: scriptedDriver<Task, Out>({ planner, maxFanout: 6 }),
      agentRuns: [spec('w')],
      output,
      task: { goal: 'seed' },
      ctx: { sandboxClient: client },
      maxConcurrency: 2,
      lineage: { forkFanout: true },
    })
    expect(forked).toHaveLength(6)
    // Pre-fix this was 6 (all forks fired via Promise.all); bounded it is ≤ 2.
    expect(peakFork.value).toBeLessThanOrEqual(2)
    expect(peakFork.value).toBeGreaterThan(0)
  })
})

/**
 * A driver that does NOT author its own branch point (no `describePlan`), so the
 * kernel's monotonic `branchPoint` is the only descent source and the kernel may
 * prune. Plays a fixed plan: refine seed → fork 3 → refine → stop.
 */
function noDescribePlanDriver(plans: Task[][]): Driver<Task, Out, string> {
  let r = 0
  return {
    name: 'no-describe-plan',
    async plan(): Promise<Task[]> {
      return plans[r++] ?? []
    },
    decide(history: ReadonlyArray<Iteration<Task, Out>>): string {
      return history.length >= 5 ? 'stop' : 'continue'
    },
  }
}

describe('runAgentRounds lineage — prune frees non-frontier boxes mid-loop', () => {
  it('reaps boxes no future round can descend from before loop end', async () => {
    const { client, streamCalls, deleted } = createFakeClient({ criuAvailable: true })
    // round 0: refine seed (box-0); round 1: fork 3 from seed (fork-0/1/2);
    // round 2: refine continuing the branch point; then stop.
    await runAgentRounds({
      driver: noDescribePlanDriver([
        [{ goal: 'seed' }],
        [{ goal: 'a' }, { goal: 'b' }, { goal: 'c' }],
        [{ goal: 'final' }],
        [],
      ]),
      agentRuns: [spec('w')],
      output,
      task: { goal: 'seed' },
      ctx: { sandboxClient: client },
      lineage: { sessionContinuity: true, forkFanout: true },
    })
    // No verdicts ⇒ branchPoint is the latest iteration. After the round-1 fork
    // (iterations 1,2,3) the branch point is index 3 (fork-2), so the seed box
    // and the two non-selected forks are unreachable and pruned. The round-2
    // continue stream therefore starts AFTER 3 deletes have happened — proving
    // they were freed mid-loop, not at teardown.
    const round2Stream = streamCalls.at(-1)!
    expect(round2Stream.deletedAtStart).toBe(3)
    expect(deleted).toContain('box-0')
    expect(deleted).toContain('fork-0')
    expect(deleted).toContain('fork-1')
  })

  it('does NOT prune when the driver authors its own branch point', async () => {
    const { client, streamCalls } = createFakeClient({ criuAvailable: true })
    // scriptedDriver defines describePlan ⇒ canPrune false ⇒ every box is
    // held until teardown, so no stream ever starts with a prior delete.
    const planner = scriptedPlanner([
      { kind: 'refine', task: { goal: 'seed' } },
      { kind: 'fanout', tasks: [{ goal: 'a' }, { goal: 'b' }, { goal: 'c' }] },
      { kind: 'refine', task: { goal: 'final' } },
      { kind: 'stop' },
    ])
    await runAgentRounds({
      driver: scriptedDriver<Task, Out>({ planner, maxFanout: 3 }),
      agentRuns: [spec('w')],
      output,
      task: { goal: 'seed' },
      ctx: { sandboxClient: client },
      lineage: { sessionContinuity: true, forkFanout: true },
    })
    expect(streamCalls.every((c) => c.deletedAtStart === 0)).toBe(true)
  })
})

describe('runAgentRounds lineage — abort during a lineage run', () => {
  it('rejects and tears down every owned box (no leak)', async () => {
    const controller = new AbortController()
    const { client, deleted } = createFakeClient({
      criuAvailable: false,
      // Abort while the seed turn streams — the next round must not run.
      onStream: (n) => {
        if (n === 1) controller.abort()
      },
    })
    const planner = scriptedPlanner([
      { kind: 'refine', task: { goal: 'a' } },
      { kind: 'refine', task: { goal: 'b' } },
      { kind: 'stop' },
    ])
    await expect(
      runAgentRounds({
        driver: scriptedDriver<Task, Out>({ planner }),
        agentRun: spec('w'),
        output,
        task: { goal: 'a' },
        ctx: { sandboxClient: client, signal: controller.signal },
        lineage: { sessionContinuity: true },
      }),
    ).rejects.toThrow(/abort/i)
    // The one box the lineage started before the abort is still reaped.
    expect(deleted).toEqual(['box-0'])
  })
})
