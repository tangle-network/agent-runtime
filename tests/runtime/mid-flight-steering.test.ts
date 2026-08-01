/**
 * THE STEERING PROOF.
 *
 * The measured defect this file exists to close: 0 steer messages across 897+ supervisor journal
 * events. Two mechanical causes, both proved here:
 *   1. the default sandbox worker implemented no `Executor.deliver`, so `Scope.send` returned
 *      `false` and every `steer_agent` reported `delivered:false`;
 *   2. `observe_agent` returned nothing about a RUNNING worker, so a driver had no evidence a
 *      steer was warranted even if one could land.
 *
 * The test drives the REAL path — `supervise()` → coordination MCP verbs → `Scope` → the
 * steerable sandbox executor → `SandboxLineage` — against a fake box whose harness is scripted to
 * behave differently depending on what it is told. It asserts on the WORKER'S OBSERVED ACTIONS,
 * split at the moment the steer was delivered:
 *
 *   before the steer: the worker only ever touched `legacy/wrong.ts`
 *   after  the steer: the worker touched `core/right.ts` and never `legacy/wrong.ts` again
 *
 * and it FALSIFIES itself: the same script, same box, same brain, with delivery disabled (the
 * historical single-shot sandbox worker) must fail — the steer is not delivered and the worker's
 * post-steer actions never change.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import type { ExecutorConfig } from '../../src/runtime/supervise/runtime'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { Budget } from '../../src/runtime/supervise/types'
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import type { SandboxClient } from '../../src/runtime/types'

const WRONG = 'legacy/wrong.ts'
const RIGHT = 'core/right.ts'
const STEER = `stop editing ${WRONG} — the change belongs in ${RIGHT}`
const ANSWER = `continue in ${RIGHT}`

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
  readonly client: SandboxClient
  /** Every file the worker touched, in order — the ground truth the proof asserts on. */
  readonly actions: WorkerAction[]
  /** Resolved once the worker has done enough work to be worth observing. */
  readonly workingOnWrongFile: Promise<void>
  /** The test resolves this to let the worker's first turn finish. */
  readonly releaseFirstTurn: () => void
  readonly prompts: string[]
}

/**
 * A fake sandbox whose "coding harness" is a two-state machine:
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

  const toolEvent = (file: string, seq: number): SandboxEvent =>
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
    }) as unknown as SandboxEvent

  const resultEvent = (text: string): SandboxEvent =>
    ({
      type: 'result',
      data: { finalText: text, usage: { inputTokens: 120, outputTokens: 40 } },
    }) as unknown as SandboxEvent

  const box: SandboxInstance = {
    id: 'fake-box',
    async *streamPrompt(message: string, _options?: unknown): AsyncGenerator<SandboxEvent> {
      const myTurn = turn
      turn += 1
      prompts.push(message)
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
    async delete() {},
  } as unknown as SandboxInstance

  const client: SandboxClient = {
    create: (_options?: CreateSandboxOptions) => Promise.resolve(box),
  }

  return {
    client,
    actions,
    prompts,
    workingOnWrongFile: observed.promise,
    releaseFirstTurn: () => release.resolve(),
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

function missingMessageAuthorityBrain(
  harness: FakeHarness,
  record: { steer?: Record<string, unknown>; answer?: Record<string, unknown> },
): ToolLoopChat {
  let turn = 0
  let workerId = 'w'
  let questionId = 'q'
  return async (messages) => {
    const lastTool = [...messages]
      .reverse()
      .find((message) => (message as { role?: string }).role === 'tool') as
      | { content?: string }
      | undefined
    const parsed = lastTool?.content ? safeJson(lastTool.content) : undefined
    turn += 1

    if (turn === 1) {
      return call('spawn_agent', { profile: { name: 'coder' }, task: 'make the change' })
    }
    if (turn === 2) {
      workerId = String(parsed?.workerId ?? workerId)
      await harness.workingOnWrongFile
      return call('steer_agent', { workerId, instruction: STEER })
    }
    if (turn === 3) {
      record.steer = parsed
      return call('ask_parent', {
        from: workerId,
        level: 'worker',
        question: 'Which file should I edit?',
        reason: 'Two plausible targets',
        urgency: 'blocks-step',
      })
    }
    if (turn === 4) {
      const question = parsed?.question as Record<string, unknown> | undefined
      questionId = String(question?.id ?? questionId)
      return call('answer_question', { questionId, answer: ANSWER })
    }
    if (turn === 5) {
      record.answer = parsed
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

function backend(harness: FakeHarness, steerable: boolean): ExecutorConfig {
  return {
    backend: 'sandbox',
    harness: 'opencode',
    sandboxClient: harness.client,
    // The ONLY difference between the proof and its falsification.
    ...(steerable ? { steering: { maxTurns: 6 } } : {}),
  } as ExecutorConfig
}

interface AuthorityRecord {
  spawnCalls: number
  messages: Array<{ instruction: string; frozen: boolean; hasIdentity: boolean }>
}

async function runSupervisedSteer(steerable: boolean, authority?: AuthorityRecord) {
  const harness = createFakeHarness()
  const record: BrainRecord = {}
  const result = await supervise(
    {
      name: 'root',
      harness: 'cli-base',
      prompt: { systemPrompt: 'drive one coder and correct it' },
    },
    'change the right module',
    {
      budget,
      backend: backend(harness, steerable),
      brain: steeringBrain(harness, record),
      maxTurns: 8,
      ...(authority
        ? {
            authorizeSpawn(input) {
              authority.spawnCalls += 1
              return { profile: input.profile }
            },
            authorizeMessage(input) {
              authority.messages.push({
                instruction: input.instruction,
                frozen: Object.isFrozen(input) && Object.isFrozen(input.workerIdentity),
                hasIdentity:
                  input.workerIdentity.profileDigest !== undefined &&
                  input.workerIdentity.taskDigest !== undefined,
              })
              return { instruction: input.instruction }
            },
          }
        : {}),
    },
  )
  return { harness, record, result }
}

describe('mid-flight steering — a supervisor observes a live worker and changes what it does', () => {
  it('refuses steer and answer when spawn authority has no message authority', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'supervise-message-authority-'))
    const harness = createFakeHarness()
    const record: { steer?: Record<string, unknown>; answer?: Record<string, unknown> } = {}
    try {
      await supervise({ name: 'root', harness: 'cli-base' }, 'change the right module', {
        budget,
        backend: backend(harness, true),
        brain: missingMessageAuthorityBrain(harness, record),
        runDir,
        runId: 'message-authority-refusal',
        authorizeSpawn: (input) => ({ profile: input.profile }),
      })

      expect(JSON.stringify(record.steer)).toContain('authorizeMessage is required')
      expect(JSON.stringify(record.answer)).toContain('authorizeMessage is required')
      expect(
        harness.prompts.some((prompt) => prompt.includes(STEER) || prompt.includes(ANSWER)),
      ).toBe(false)
      const coordinationLog = await readFile(join(runDir, 'coordination-log.jsonl'), 'utf8')
      const eventTypes = coordinationLog
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { event: { type: string } }).event.type)
      expect(eventTypes).not.toContain('instruction')
    } finally {
      harness.releaseFirstTurn()
      await rm(runDir, { recursive: true, force: true })
    }
  })

  it('authorizes the continuation against the exact live worker identity', {
    timeout: 30_000,
  }, async () => {
    const authority: AuthorityRecord = { spawnCalls: 0, messages: [] }
    const { record } = await runSupervisedSteer(true, authority)
    expect(record.steerResult?.delivered).toBe(true)
    expect(authority).toEqual({
      spawnCalls: 1,
      messages: [{ instruction: STEER, frozen: true, hasIdentity: true }],
    })
  })

  it('delivers a steer to a RUNNING sandbox worker and the worker acts differently afterwards', {
    timeout: 30_000,
  }, async () => {
    const { harness, record } = await runSupervisedSteer(true)

    // ── B-1: the driver could SEE the running worker ───────────────────────────────
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

    // ── B-2: the steer actually landed ────────────────────────────────────────────
    expect(record.steerResult?.delivered, 'steer_agent did not deliver to a live worker').toBe(true)

    // ── THE PROOF: the worker's behavior CHANGED, before vs after the message ──────
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

  it('FALSIFICATION: with delivery disabled the same run cannot steer and the worker never changes', {
    timeout: 30_000,
  }, async () => {
    const { harness, record } = await runSupervisedSteer(false)

    // The single-shot sandbox worker has no inbox — this is the historical behavior, stated.
    expect(record.steerResult?.delivered).toBe(false)
    expect(record.steerResult?.reason).toBe('runtime-has-no-inbox')

    // And so the proof's assertion is unreachable: nothing the worker did ever changed.
    expect(harness.prompts.some((p) => p.includes(STEER))).toBe(false)
    expect(harness.actions.length).toBeGreaterThan(0)
    expect(new Set(harness.actions.map((a) => a.file))).toEqual(new Set([WRONG]))
    expect(harness.actions.some((a) => a.file === RIGHT)).toBe(false)
  })
})
