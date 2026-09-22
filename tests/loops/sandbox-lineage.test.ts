import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentSession,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { runAgentRounds } from '../../src/runtime/run-loop'
import type {
  AgentRunSpec,
  Driver,
  Iteration,
  LoopPlanDescription,
  OutputAdapter,
} from '../../src/runtime/types'

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

type ScriptedMove<T> =
  | { kind: 'refine'; task: T; parentIndex?: number }
  | { kind: 'fanout'; tasks: T[]; parentIndex?: number }
  | { kind: 'stop' }

type ScriptedPlanner<T, O> = (context: {
  task: T
  history: ReadonlyArray<Iteration<T, O>>
}) => ScriptedMove<T> | Promise<ScriptedMove<T>>

function scriptedDriver<T, O>(options: {
  planner: ScriptedPlanner<T, O>
  maxFanout?: number
}): Driver<T, O, 'continue' | 'done'> {
  let pending: ScriptedMove<T> | undefined
  return {
    name: 'scripted',
    async plan(task, history) {
      pending = await options.planner({ task, history })
      if (pending.kind === 'refine') return [pending.task]
      if (pending.kind === 'fanout') {
        return pending.tasks.slice(0, options.maxFanout ?? 4)
      }
      return []
    },
    decide() {
      return pending?.kind === 'stop' ? 'done' : 'continue'
    },
    describePlan() {
      if (!pending) return undefined
      const description: LoopPlanDescription = { kind: pending.kind }
      if (
        (pending.kind === 'refine' || pending.kind === 'fanout') &&
        pending.parentIndex !== undefined
      ) {
        description.parentIndex = pending.parentIndex
      }
      return description
    },
  }
}

/** One `stream` call's recorded arguments: the environment id it ran on, the
 *  session id it carried, and how many environments had already been destroyed
 *  when it began, so a test can prove an environment was pruned mid-loop. */
interface StreamCall {
  environmentId: string
  sessionId?: string
  destroyedAtStart: number
}

interface FakeProviderOptions {
  canFork: boolean
  /** `'dead'` makes the provider report the continued session as unknown. */
  sessionState?: 'live' | 'dead'
  /** Invoked at the start of every stream, using a one-based call count. */
  onStream?: (callIndex: number) => void
}

function fakeCapabilities(canFork: boolean): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: true,
      systemPrompt: true,
      instructions: true,
      tools: true,
      permissions: true,
      mcp: true,
      subagents: true,
      resources: {
        files: true,
        instructions: true,
        tools: true,
        skills: true,
        agents: true,
        commands: true,
      },
      hooks: true,
      modes: true,
      runtimeUpdate: true,
      validation: true,
    },
    streaming: { live: true, replay: true, detach: true, turnIdempotency: true },
    sessions: { continue: true, list: true, messages: true },
    workspace: { read: true, write: true, exec: true, git: true, upload: true, download: true },
    branching: { checkpoint: canFork, fork: canFork },
    placement: true,
    usage: true,
    confidential: true,
  }
}

/**
 * A fake provider whose environments record every stream, support continuation
 * and branching, and track peak concurrent forks.
 */
function createFakeProvider(opts: FakeProviderOptions) {
  const streamCalls: StreamCall[] = []
  const created: string[] = []
  const forked: string[] = []
  const destroyed: string[] = []
  const peakFork = { value: 0 }
  let forkInFlight = 0
  let environmentSeq = 0
  let forkSeq = 0
  let checkpointSeq = 0

  function makeSession(id: string): AgentSession {
    return {
      id,
      async status() {
        return opts.sessionState === 'dead' ? null : 'completed'
      },
      async *events(): AsyncIterable<AgentEnvironmentEvent> {},
      async result() {
        return { text: 'ok', success: true, sessionId: id }
      },
      async prompt() {
        return { text: 'ok', success: true, sessionId: id }
      },
      async cancel() {},
    }
  }

  function makeEnvironment(id: string): AgentEnvironment {
    return {
      id,
      provider: 'fake-provider',
      async status() {
        return 'running'
      },
      async *stream(input): AsyncIterable<AgentEnvironmentEvent> {
        streamCalls.push({
          environmentId: id,
          sessionId: input.sessionId,
          destroyedAtStart: destroyed.length,
        })
        opts.onStream?.(streamCalls.length)
        yield { type: 'result', data: { ok: true } }
      },
      session: makeSession,
      async checkpoint() {
        return { id: `cp-${checkpointSeq++}`, provider: 'fake-provider' }
      },
      async fork(): Promise<AgentEnvironment> {
        forkInFlight += 1
        peakFork.value = Math.max(peakFork.value, forkInFlight)
        await Promise.resolve()
        const child = makeEnvironment(`fork-${forkSeq++}`)
        forked.push(child.id)
        forkInFlight -= 1
        return child
      },
      async destroy() {
        destroyed.push(id)
      },
    }
  }

  const provider: AgentEnvironmentProvider = {
    name: 'fake-provider',
    capabilities: () => fakeCapabilities(opts.canFork),
    async create(): Promise<AgentEnvironment> {
      const id = `environment-${environmentSeq++}`
      created.push(id)
      return makeEnvironment(id)
    },
  }
  return { provider, streamCalls, created, forked, destroyed, peakFork }
}

/** A planner that replays a fixed sequence of topology moves. */
function scriptedPlanner(moves: ScriptedMove<Task>[]): ScriptedPlanner<Task, Out> {
  let i = 0
  return () => moves[i++]!
}

describe('runAgentRounds lineage — sessionContinuity OFF (the independence invariant)', () => {
  it('uses a fresh environment and session id for every iteration', async () => {
    const { provider, streamCalls, created } = createFakeProvider({ canFork: true })
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
      ctx: { environmentProvider: provider },
      // lineage unset ⇒ default behavior
    })
    expect(streamCalls).toHaveLength(2)
    expect(new Set(streamCalls.map((c) => c.environmentId)).size).toBe(2)
    expect(streamCalls.every((c) => c.sessionId !== undefined)).toBe(true)
    expect(new Set(streamCalls.map((c) => c.sessionId)).size).toBe(2)
    expect(created).toHaveLength(2)
  })
})

describe('runAgentRounds — streaming: poll (drop-resilient batch path)', () => {
  it('dispatches the turn and drains the terminal result without a live stream', async () => {
    const calls = { stream: 0, dispatch: 0, result: 0 }
    const provider: AgentEnvironmentProvider = {
      name: 'poll-provider',
      capabilities: () => fakeCapabilities(false),
      async create(): Promise<AgentEnvironment> {
        const environment: AgentEnvironment = {
          id: 'poll-environment',
          provider: 'poll-provider',
          async status() {
            return 'running'
          },
          async *stream(): AsyncIterable<AgentEnvironmentEvent> {
            calls.stream += 1
            yield { type: 'result', data: { finalText: 'SSE' } }
          },
          async dispatch(input) {
            calls.dispatch += 1
            return { id: input.sessionId ?? 'minted', provider: 'poll-provider' }
          },
          session(id: string) {
            return {
              id,
              async status() {
                return 'completed' as const
              },
              async *events(): AsyncIterable<AgentEnvironmentEvent> {},
              async prompt() {
                return { text: 'POLLED', success: true, sessionId: id }
              },
              async result() {
                calls.result += 1
                return { text: 'POLLED', success: true, sessionId: id }
              },
              async cancel() {},
            }
          },
          async destroy() {},
        }
        return environment
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
      ctx: { environmentProvider: provider },
      lineage: { streaming: 'poll' },
    })

    expect(calls.dispatch).toBe(1) // fire-and-detach used
    expect(calls.result).toBe(1) // terminal result drained by status-poll
    expect(calls.stream).toBe(0) // a live SSE was NEVER held — the drop is impossible
  })
})

describe('runAgentRounds lineage — sessionContinuity ON', () => {
  it('a refine continues the parent on the SAME environment with the SAME session id', async () => {
    const { provider, streamCalls, created } = createFakeProvider({ canFork: false })
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
      ctx: { environmentProvider: provider },
      lineage: { sessionContinuity: true },
    })
    expect(streamCalls).toHaveLength(2)
    // Round 0 starts fresh; round 1 continues on the same environment + session id.
    expect(streamCalls[0]!.environmentId).toBe(streamCalls[1]!.environmentId)
    expect(streamCalls[0]!.sessionId).toBeDefined()
    expect(streamCalls[1]!.sessionId).toBe(streamCalls[0]!.sessionId)
    // Only ONE environment was created — the second round reused it, not a fresh acquire.
    expect(created).toHaveLength(1)
  })
})

describe('runAgentRounds lineage — forkFanout', () => {
  it('forks the parent checkpoint when the provider advertises branching', async () => {
    const { provider, streamCalls, created, forked } = createFakeProvider({ canFork: true })
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
      ctx: { environmentProvider: provider },
      lineage: { forkFanout: true },
    })
    // 1 seed stream + 3 branch streams.
    expect(streamCalls).toHaveLength(4)
    // The 3 fanout branches ran on forked environments, NOT fresh creates: one fresh
    // environment for the seed, three forks for the branches.
    expect(created).toHaveLength(1)
    expect(forked).toHaveLength(3)
    const branchBoxes = streamCalls.slice(1).map((c) => c.environmentId)
    expect(branchBoxes.every((id) => id.startsWith('fork-'))).toBe(true)
    expect(new Set(branchBoxes).size).toBe(3)
  })

  it('uses fresh environments when the provider does not advertise branching', async () => {
    const { provider, streamCalls, created, forked } = createFakeProvider({ canFork: false })
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
      ctx: { environmentProvider: provider },
      lineage: { forkFanout: true },
    })
    expect(streamCalls).toHaveLength(4)
    expect(forked).toHaveLength(0)
    // seed (1) + three independent fresh branches (3) = 4 creates, no forks.
    expect(created).toHaveLength(4)
    expect(streamCalls.slice(1).every((c) => c.environmentId.startsWith('environment-'))).toBe(true)
  })
})

describe('runAgentRounds lineage — guardrails', () => {
  it('rejects lineage + onWorkerEnvironment (both own worker environments)', async () => {
    const { provider } = createFakeProvider({ canFork: true })
    const planner = scriptedPlanner([{ kind: 'stop' }])
    await expect(
      runAgentRounds({
        driver: scriptedDriver<Task, Out>({ planner }),
        agentRun: spec('w'),
        output,
        task: { goal: 'a' },
        ctx: { environmentProvider: provider },
        lineage: { sessionContinuity: true },
        onWorkerEnvironment: () => {},
      }),
    ).rejects.toThrow(/own worker environments/)
  })

  it('tears down every lineage-owned environment at loop end', async () => {
    const { provider, destroyed } = createFakeProvider({ canFork: true })
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
      ctx: { environmentProvider: provider },
      lineage: { forkFanout: true },
    })
    // 1 seed environment + 2 forked branch environments all reaped by lineage.teardown().
    expect(destroyed.sort()).toEqual(['environment-0', 'fork-0', 'fork-1'])
  })
})

describe('runAgentRounds lineage — continue asserts session liveness (fail-loud)', () => {
  it('throws when the platform reports the continued session is unknown', async () => {
    const { provider } = createFakeProvider({ canFork: false, sessionState: 'dead' })
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
        ctx: { environmentProvider: provider },
        lineage: { sessionContinuity: true },
      }),
    ).rejects.toThrow(/no longer recognizes session/)
  })

  it('proceeds when the platform reports the session is live', async () => {
    const { provider, streamCalls } = createFakeProvider({ canFork: false, sessionState: 'live' })
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
      ctx: { environmentProvider: provider },
      lineage: { sessionContinuity: true },
    })
    // Continuation ran: same environment, same session id, second turn not blocked.
    expect(streamCalls).toHaveLength(2)
    expect(streamCalls[1]!.environmentId).toBe(streamCalls[0]!.environmentId)
    expect(streamCalls[1]!.sessionId).toBe(streamCalls[0]!.sessionId)
  })
})

describe('runAgentRounds lineage — fork creation respects the concurrency bound', () => {
  it('never has more than maxConcurrency forks in flight at once', async () => {
    const { provider, peakFork, forked } = createFakeProvider({ canFork: true })
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
      ctx: { environmentProvider: provider },
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

describe('runAgentRounds lineage — prune frees non-frontier environments mid-loop', () => {
  it('reaps environments no future round can descend from before loop end', async () => {
    const { provider, streamCalls, destroyed } = createFakeProvider({ canFork: true })
    // round 0: refine seed (environment-0); round 1: fork 3 from seed (fork-0/1/2);
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
      ctx: { environmentProvider: provider },
      lineage: { sessionContinuity: true, forkFanout: true },
    })
    // No verdicts ⇒ branchPoint is the latest iteration. After the round-1 fork
    // (iterations 1,2,3) the branch point is index 3 (fork-2), so the seed environment
    // and the two non-selected forks are unreachable and pruned. The round-2
    // continue stream therefore starts after 3 destroys have happened, proving
    // they were freed mid-loop, not at teardown.
    const round2Stream = streamCalls.at(-1)!
    expect(round2Stream.destroyedAtStart).toBe(3)
    expect(destroyed).toContain('environment-0')
    expect(destroyed).toContain('fork-0')
    expect(destroyed).toContain('fork-1')
  })

  it('does NOT prune when the driver authors its own branch point', async () => {
    const { provider, streamCalls } = createFakeProvider({ canFork: true })
    // scriptedDriver defines describePlan ⇒ canPrune false ⇒ every environment is
    // held until teardown, so no stream ever starts after a prior destroy.
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
      ctx: { environmentProvider: provider },
      lineage: { sessionContinuity: true, forkFanout: true },
    })
    expect(streamCalls.every((c) => c.destroyedAtStart === 0)).toBe(true)
  })
})

describe('runAgentRounds lineage — abort during a lineage run', () => {
  it('rejects and tears down every owned environment (no leak)', async () => {
    const controller = new AbortController()
    const { provider, destroyed } = createFakeProvider({
      canFork: false,
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
        ctx: { environmentProvider: provider, signal: controller.signal },
        lineage: { sessionContinuity: true },
      }),
    ).rejects.toThrow(/abort/i)
    // The one environment the lineage started before the abort is still reaped.
    expect(destroyed).toEqual(['environment-0'])
  })
})
