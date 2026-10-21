/**
 * A durable supervised run records no instruction when message authority is absent.
 * The Sandbox client and model turns are local fixtures; the journal filesystem is real.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import type { ExecutorConfig } from '../../src/runtime/supervise/runtime'
import type { Budget } from '../../src/runtime/supervise/types'
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import type { SandboxClient } from '../../src/runtime/types'
import { supervise } from '../helpers/runtime-with-test-brain'
import { runtimeToolDeclarations } from '../kernel/test-agent-profile'

const WRONG = 'legacy/wrong.ts'
const RIGHT = 'core/right.ts'
const STEER = `stop editing ${WRONG} — the change belongs in ${RIGHT}`
const ANSWER = `continue in ${RIGHT}`

const budget: Budget = { maxIterations: 200, maxTokens: 400_000 }
const rootProfile = {
  name: 'root',
  harness: 'cli-base' as const,
  model: { provider: 'offline', default: 'offline/supervisor' },
  prompt: { systemPrompt: 'drive one coder and correct it' },
  tools: runtimeToolDeclarations('spawn_worker', 'observe_agent', 'steer_agent'),
}
const messageAuthorityRootProfile = {
  ...rootProfile,
  tools: runtimeToolDeclarations('spawn_worker', 'steer_agent', 'ask_parent', 'answer_question'),
}
const coderProfile = {
  name: 'coder',
  harness: 'opencode' as const,
  model: { provider: 'offline', default: 'offline/coder' },
}

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
      return call('spawn_worker', { profile: coderProfile, task: 'make the change' })
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
      return { toolCalls: [], content: 'waiting for the worker' }
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
    sandboxClient: harness.client,
    // The ONLY difference between the proof and its falsification.
    ...(steerable ? { steering: { maxTurns: 6 } } : {}),
  }
}

describe('mid-flight steering — a supervisor observes a live worker and changes what it does', () => {
  it('refuses steer and answer when spawn authority has no message authority', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'supervise-message-authority-'))
    const harness = createFakeHarness()
    const record: { steer?: Record<string, unknown>; answer?: Record<string, unknown> } = {}
    try {
      await supervise(messageAuthorityRootProfile, 'change the right module', {
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
})
