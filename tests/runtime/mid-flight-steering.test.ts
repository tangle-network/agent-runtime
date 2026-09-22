/**
 * THE STEERING PROOF.
 *
 * The measured defect this file exists to close: 0 steer messages across 897+ supervisor journal
 * events. Two mechanical causes, both proved here:
 *   1. the default provider worker implemented no `Executor.deliver`, so `Scope.send` returned
 *      `false` and every `steer_agent` reported `delivered:false`;
 *   2. `observe_agent` returned nothing about a RUNNING worker, so a driver had no evidence a
 *      steer was warranted even if one could land.
 *
 * The test drives the REAL path — `supervise()` → coordination MCP verbs → `Scope` → the
 * steerable provider executor against a scripted environment. It asserts on worker actions,
 * split at the moment the steer was delivered:
 *
 *   before the steer: the worker only ever touched `legacy/wrong.ts`
 *   after  the steer: the worker touched `core/right.ts` and never `legacy/wrong.ts` again
 *
 * and it falsifies itself: the same script, same provider, same brain, with delivery disabled must
 * fail. The steer is not delivered and the worker's
 * post-steer actions never change.
 */

import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentSession,
  AgentTurnResult,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { inProcessEnvironmentProvider } from '../../src/runtime/in-process-environment-provider'
import type { EnvironmentWorkerOptions } from '../../src/runtime/supervise/runtime'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { Budget } from '../../src/runtime/supervise/types'
import type { ToolLoopChat } from '../../src/runtime/tool-loop'

const WRONG = 'legacy/wrong.ts'
const RIGHT = 'core/right.ts'
const STEER = `stop editing ${WRONG} — the change belongs in ${RIGHT}`

const budget: Budget = { maxIterations: 200, maxTokens: 400_000 }

/** A promise a test resolves by hand — how the fake harness is held mid-turn until the driver
 *  has actually observed it and sent its steer, so the assertion is about the worker's behavior
 *  and never about a race. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** One tool call the fake harness performed, in the order it performed it. */
interface WorkerAction {
  readonly turn: number
  readonly file: string
}

interface FakeHarness {
  readonly provider: AgentEnvironmentProvider
  /** Every file the worker touched, in order — the ground truth the proof asserts on. */
  readonly actions: WorkerAction[]
  /** Resolved once the worker has done enough work to be worth observing. */
  readonly workingOnWrongFile: Promise<void>
  /** The test resolves this to let the worker's first turn finish. */
  readonly releaseFirstTurn: () => void
  readonly prompts: string[]
}

/**
 * A fake coding environment is a two-state machine:
 *   - given a prompt that does NOT name a target file, it edits {@link WRONG} three times;
 *   - given a prompt that names `core/right.ts`, it edits {@link RIGHT} twice.
 * That is the whole behavioral difference a steer is supposed to cause, made observable.
 *
 * Turn 0 blocks before finishing, so the worker is provably still LIVE while the supervisor
 * observes it and steers — the mid-flight condition, not a between-workers handoff.
 */
function createFakeHarness(): FakeHarness {
  const actions: WorkerAction[] = []
  const prompts: string[] = []
  const observed = deferred()
  const release = deferred()
  let turn = 0

  const toolEvent = (file: string, seq: number): AgentEnvironmentEvent =>
    ({
      type: 'message.part.updated',
      data: {
        part: {
          type: 'tool',
          tool: 'edit',
          callID: `call-${turn}-${seq}`,
          state: { status: 'completed', input: { filePath: file } },
        },
      },
    }) as AgentEnvironmentEvent

  const resultEvent = (text: string): AgentEnvironmentEvent =>
    ({
      type: 'result',
      data: { finalText: text, usage: { inputTokens: 120, outputTokens: 40 } },
    }) as AgentEnvironmentEvent

  const knownSessions = new Set<string>()
  const baseProvider = inProcessEnvironmentProvider({
    name: 'steering-test',
    id: 'steering-environment',
    async *onTurn(message, ctx): AsyncIterable<AgentEnvironmentEvent> {
      const myTurn = turn
      turn += 1
      prompts.push(message)
      if (ctx.input.sessionId) knownSessions.add(ctx.input.sessionId)
      const target = message.includes(RIGHT) ? RIGHT : WRONG
      const edits = target === RIGHT ? 2 : 3
      for (let i = 0; i < edits; i += 1) {
        actions.push({ turn: myTurn, file: target })
        yield toolEvent(target, i)
      }
      if (myTurn === 0) {
        // Hold the turn open: the worker is now demonstrably LIVE and has visible activity, which
        // is exactly the window a supervisor must be able to observe and correct.
        observed.resolve()
        await release.promise
      }
      yield resultEvent(`edited ${target}`)
    },
  })

  const provider: AgentEnvironmentProvider = {
    ...baseProvider,
    async capabilities() {
      const capabilities = await baseProvider.capabilities()
      return {
        ...capabilities,
        sessions: { ...capabilities.sessions, continue: true },
      }
    },
    async create(input) {
      const environment = await baseProvider.create(input)
      return {
        ...environment,
        session: (id: string) => fakeSession(id, knownSessions),
      } satisfies AgentEnvironment
    },
  }

  return {
    provider,
    actions,
    prompts,
    workingOnWrongFile: observed.promise,
    releaseFirstTurn: () => release.resolve(),
  }
}

function fakeSession(id: string, knownSessions: Set<string>): AgentSession {
  const result: AgentTurnResult = { text: '', success: true, sessionId: id }
  return {
    id,
    async status() {
      return knownSessions.has(id) ? 'running' : null
    },
    async *events() {
      yield { type: 'session.ready', data: { sessionId: id } }
    },
    async result() {
      return result
    },
    async prompt() {
      return result
    },
    async cancel() {},
  }
}

/** What the supervisor's brain saw and did, captured for assertions. */
interface BrainRecord {
  observedProgress?: Record<string, unknown>
  steerResult?: Record<string, unknown>
}

/**
 * A REACTIVE brain (not a fixed script): it spawns, waits until the worker is genuinely mid-flight,
 * observes it through `observe_agent`, steers on what it saw, releases the worker, and drains.
 * Reactive because a fixed script cannot prove "observed a running worker" — it could just as
 * easily have run before the worker started or after it settled.
 */
function steeringBrain(harness: FakeHarness, record: BrainRecord): ToolLoopChat {
  let turn = 0
  let workerId = 'w'
  return async (messages) => {
    const lastTool = [...messages]
      .reverse()
      .find((m) => (m as { role?: string }).role === 'tool') as { content?: string } | undefined
    const parsed = lastTool?.content ? safeJson(lastTool.content) : undefined
    turn += 1

    if (turn === 1) {
      return call('spawn_agent', { profile: { name: 'coder' }, task: 'make the change' })
    }
    if (turn === 2) {
      workerId = String(parsed?.workerId ?? 'w')
      // Do not observe until the worker has really started working — otherwise "observed live
      // progress" would be a claim about timing luck, not about the feed.
      await harness.workingOnWrongFile
      return call('observe_agent', { workerId })
    }
    if (turn === 3) {
      record.observedProgress = parsed as Record<string, unknown>
      return call('steer_agent', { workerId, instruction: STEER })
    }
    if (turn === 4) {
      record.steerResult = parsed as Record<string, unknown>
      // The steer is queued in the worker's inbox; let its held turn finish so it can fold it.
      harness.releaseFirstTurn()
      return call('await_event', {})
    }
    return { toolCalls: [], content: 'done' }
  }
}

function call(name: string, args: Record<string, unknown>) {
  return {
    toolCalls: [{ id: `${name}-1`, name, arguments: JSON.stringify(args) }],
    usage: { input: 10, output: 5 },
  }
}

function safeJson(text: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(text) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function worker(harness: FakeHarness, steerable: boolean): EnvironmentWorkerOptions {
  return {
    provider: harness.provider,
    environment: { backend: 'opencode' },
    ...(steerable ? { steering: { maxTurns: 6 } } : {}),
  }
}

async function runSupervisedSteer(steerable: boolean) {
  const harness = createFakeHarness()
  const record: BrainRecord = {}
  const result = await supervise(
    { name: 'root', harness: null, systemPrompt: 'drive one coder and correct it' },
    'change the right module',
    {
      budget,
      worker: worker(harness, steerable),
      brain: steeringBrain(harness, record),
      maxTurns: 8,
    },
  )
  return { harness, record, result }
}

describe('mid-flight steering changes a live provider worker', () => {
  it('delivers a steer to a running worker and changes its later actions', {
    timeout: 30_000,
  }, async () => {
    const { harness, record } = await runSupervisedSteer(true)

    const progress = record.observedProgress?.progress as Record<string, unknown> | undefined
    expect(progress, 'observe_agent returned no progress for a running worker').toBeDefined()
    expect(progress?.live).toBe(true)
    expect(progress?.steerable, 'a steerable worker must advertise that a steer can land').toBe(
      true,
    )
    const activity = progress?.recentActivity as Array<{ label: string; detail?: string }>
    expect(activity.length, 'no live tool activity was visible mid-flight').toBeGreaterThan(0)
    expect(activity.map((a) => a.detail)).toContain(WRONG)
    expect(typeof progress?.idleMs).toBe('number')
    expect(progress?.stalled).toBe(false)

    expect(record.steerResult?.delivered, 'steer_agent did not deliver to a live worker').toBe(true)

    const steeredTurns = new Set(
      harness.prompts.map((p, i) => (p.includes(STEER) ? i : -1)).filter((i) => i >= 0),
    )
    expect(steeredTurns.size, 'the steer never reached the worker as a prompt').toBeGreaterThan(0)
    const firstSteeredTurn = Math.min(...steeredTurns)

    const before = harness.actions.filter((a) => a.turn < firstSteeredTurn)
    const after = harness.actions.filter((a) => a.turn >= firstSteeredTurn)

    expect(before.length, 'the worker did nothing before the steer').toBeGreaterThan(0)
    expect(new Set(before.map((a) => a.file))).toEqual(new Set([WRONG]))

    expect(after.length, 'the worker did nothing after the steer').toBeGreaterThan(0)
    expect(new Set(after.map((a) => a.file))).toEqual(new Set([RIGHT]))
    expect(after.some((a) => a.file === WRONG)).toBe(false)
  })

  it('with delivery disabled the same run cannot steer and the worker never changes', {
    timeout: 30_000,
  }, async () => {
    const { harness, record } = await runSupervisedSteer(false)

    expect(record.steerResult?.delivered).toBe(false)
    expect(record.steerResult?.reason).toBe('runtime-has-no-inbox')

    expect(harness.prompts.some((p) => p.includes(STEER))).toBe(false)
    expect(harness.actions.length).toBeGreaterThan(0)
    expect(new Set(harness.actions.map((a) => a.file))).toEqual(new Set([WRONG]))
    expect(harness.actions.some((a) => a.file === RIGHT)).toBe(false)
  })
})
