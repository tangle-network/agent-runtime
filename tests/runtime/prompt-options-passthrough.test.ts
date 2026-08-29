/**
 * Per-prompt SDK options reach the wire on both sandbox kernels.
 *
 * A host binds a session-scoped credential by passing `ExecCtx.promptOptions`
 * (`backend.model.authMode` + `authFiles`). The option is only worth anything if it rides EVERY
 * `streamPrompt` the run makes, so these tests assert on the options object the box actually
 * received — the first turn and the continuation of a steerable session, and every iteration of
 * the leaf kernel — and that the kernel's own `sessionId` / `signal` are still present.
 *
 * A malformed value must fail loud instead of silently dropping the credential, which would
 * surface much later as an auth failure inside the box.
 */

import { CostLedger } from '@tangle-network/agent-eval'
import type { DispatchContext } from '@tangle-network/agent-eval/campaign'
import type {
  CreateSandboxOptions,
  PromptOptions,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../src/errors'
import {
  type AgentRunSpec,
  loopDispatch,
  type OutputAdapter,
  runAgentRounds,
} from '../../src/runtime'
import { createInbox, type Inbox } from '../../src/runtime/supervise/inbox'
import { createSteerableSandboxSession } from '../../src/runtime/supervise/sandbox-session'
import type { ExecCtx, SandboxClient } from '../../src/runtime/types'
import { scriptedDriver } from '../kernel/refine-driver'
import { testAgentProfile } from '../kernel/test-agent-profile'

/** The session credential shape a host binds per prompt: an OAuth subscription written into the
 *  box before the CLI starts. */
const backend: NonNullable<PromptOptions['backend']> = {
  type: 'codex',
  model: {
    model: 'gpt-5.6-sol',
    authMode: 'oauth',
    authFiles: [{ path: '.codex/auth.json', content: 'X', mode: 0o600 }],
  },
}

/** One `streamPrompt` call as the box saw it. */
interface CapturedPrompt {
  readonly message: string
  readonly options: Record<string, unknown> | undefined
}

const turnEvent = (text: string): SandboxEvent =>
  ({
    type: 'result',
    data: { finalText: text, usage: { inputTokens: 12, outputTokens: 4 } },
  }) as unknown as SandboxEvent

/** A box that records every prompt it is given. `onTurn` runs after the turn's events, which is
 *  how a steer is queued while the worker is still live. */
function capturingClient(
  calls: CapturedPrompt[],
  onTurn?: (turn: number) => void,
): { client: SandboxClient; created: () => number } {
  let created = 0
  let turn = 0
  const client: SandboxClient = {
    async create(_options?: CreateSandboxOptions): Promise<SandboxInstance> {
      created += 1
      return {
        id: `box-${created}`,
        async *streamPrompt(
          message: string,
          options?: Record<string, unknown>,
        ): AsyncGenerator<SandboxEvent> {
          const myTurn = turn
          turn += 1
          calls.push({ message, options })
          yield turnEvent(`turn ${myTurn}`)
          onTurn?.(myTurn)
        },
        async delete() {},
      } as unknown as SandboxInstance
    },
  }
  return { client, created: () => created }
}

function steerableSession(args: {
  client: SandboxClient
  inbox: Inbox
  loopCtx?: Partial<Omit<ExecCtx, 'sandboxClient' | 'signal'>>
}) {
  return createSteerableSandboxSession({
    controller: new AbortController(),
    profile: testAgentProfile('worker'),
    harness: 'opencode',
    sandboxClient: args.client,
    inbox: args.inbox,
    taskToPrompt: (task) => String(task),
    contentRef: (prefix) => `${prefix}:ref`,
    ...(args.loopCtx === undefined ? {} : { loopCtx: args.loopCtx }),
  })
}

async function drain(session: {
  stream(task: unknown, signal: AbortSignal): AsyncIterable<unknown>
}) {
  for await (const _event of session.stream('do the work', new AbortController().signal)) {
    // The usage stream is irrelevant here; the assertions read the box's captured prompts.
  }
}

describe('the steerable sandbox worker — promptOptions ride every turn', () => {
  it('forwards the caller options on the first turn and on the continuation of the same session', async () => {
    const calls: CapturedPrompt[] = []
    const inbox = createInbox()
    // Queue a steer while turn 0 is still running, so the worker takes a SECOND turn through
    // `SandboxLineage.continue` — the path a continuation credential has to survive.
    const { client } = capturingClient(calls, (turn) => {
      if (turn === 0) inbox.deliver({ steer: 'switch to the other file' })
    })

    await drain(
      steerableSession({
        client,
        inbox,
        loopCtx: { promptOptions: { backend, timeoutMs: 1234 } },
      }),
    )

    expect(calls).toHaveLength(2)
    const first = calls[0]?.options
    expect(first?.backend).toEqual(backend)
    expect(first?.timeoutMs).toBe(1234)
    expect(typeof first?.sessionId).toBe('string')
    expect(first?.signal).toBeInstanceOf(AbortSignal)

    const second = calls[1]?.options
    expect(second?.backend).toEqual(backend)
    expect(second?.timeoutMs).toBe(1234)
    expect(second?.sessionId).toBe(first?.sessionId)
  })

  it('carries only the kernel-owned keys when the caller supplied no options', async () => {
    const calls: CapturedPrompt[] = []
    const inbox = createInbox()
    const { client } = capturingClient(calls)

    await drain(steerableSession({ client, inbox }))

    expect(calls).toHaveLength(1)
    const options = calls[0]?.options ?? {}
    expect(Object.keys(options).sort()).toEqual(['sessionId', 'signal'])
    expect('backend' in options).toBe(false)
  })

  it('rejects a non-object promptOptions before any box is created', async () => {
    for (const value of ['oops', null, 42, [backend]]) {
      const calls: CapturedPrompt[] = []
      const inbox = createInbox()
      const { client, created } = capturingClient(calls)
      const session = steerableSession({
        client,
        inbox,
        loopCtx: { promptOptions: value } as unknown as Partial<
          Omit<ExecCtx, 'sandboxClient' | 'signal'>
        >,
      })

      await expect(drain(session)).rejects.toBeInstanceOf(ValidationError)
      expect(created()).toBe(0)
      expect(calls).toEqual([])
    }
  })

  it('runs on the kernel-minted session, never a session id the caller supplied', async () => {
    const calls: CapturedPrompt[] = []
    const inbox = createInbox()
    const { client } = capturingClient(calls)

    await drain(
      steerableSession({
        client,
        inbox,
        loopCtx: {
          promptOptions: { backend, sessionId: 'caller-owned' },
        } as unknown as Partial<Omit<ExecCtx, 'sandboxClient' | 'signal'>>,
      }),
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]?.options?.backend).toEqual(backend)
    expect(typeof calls[0]?.options?.sessionId).toBe('string')
    expect(calls[0]?.options?.sessionId).not.toBe('caller-owned')
  })
})

describe('runAgentRounds — promptOptions ride every iteration', () => {
  it('forwards the caller options into each iteration of the leaf kernel', async () => {
    const calls: CapturedPrompt[] = []
    const { client } = capturingClient(calls)
    const output: OutputAdapter<string> = { parse: () => 'done' }
    const agentRun: AgentRunSpec<string> = {
      profile: testAgentProfile('leaf'),
      name: 'leaf',
      taskToPrompt: (task) => task,
    }

    await runAgentRounds<string, string, 'continue' | 'done'>({
      driver: scriptedDriver<string, string>({
        planner: () => ({ kind: 'refine', task: 'again' }),
        maxIterations: 2,
      }),
      agentRun,
      output,
      task: 'start',
      maxIterations: 2,
      ctx: {
        sandboxClient: client,
        promptOptions: { backend, context: { runId: 'r1' } },
      },
    })

    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.options?.backend).toEqual(backend)
      expect(call.options?.context).toEqual({ runId: 'r1' })
      expect(call.options?.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('carries only the kernel-owned signal when the caller supplied no options', async () => {
    const calls: CapturedPrompt[] = []
    const { client } = capturingClient(calls)

    await runAgentRounds<string, string, 'continue' | 'done'>({
      driver: scriptedDriver<string, string>({
        planner: () => ({ kind: 'refine', task: 'again' }),
        maxIterations: 1,
      }),
      agentRun: {
        profile: testAgentProfile('leaf'),
        name: 'leaf',
        taskToPrompt: (task) => task,
      },
      output: { parse: () => 'done' },
      task: 'start',
      maxIterations: 1,
      ctx: { sandboxClient: client },
    })

    expect(calls).toHaveLength(1)
    expect(Object.keys(calls[0]?.options ?? {})).toEqual(['signal'])
  })

  it('rejects a non-object promptOptions before any box is created', async () => {
    for (const value of ['oops', null, 42, [backend]]) {
      const calls: CapturedPrompt[] = []
      const { client, created } = capturingClient(calls)

      await expect(
        runAgentRounds<string, string, 'continue' | 'done'>({
          driver: scriptedDriver<string, string>({
            planner: () => ({ kind: 'refine', task: 'again' }),
            maxIterations: 1,
          }),
          agentRun: {
            profile: testAgentProfile('leaf'),
            name: 'leaf',
            taskToPrompt: (task) => task,
          },
          output: { parse: () => 'done' },
          task: 'start',
          maxIterations: 1,
          ctx: { sandboxClient: client, promptOptions: value } as unknown as ExecCtx,
        }),
      ).rejects.toBeInstanceOf(ValidationError)
      expect(created()).toBe(0)
      expect(calls).toEqual([])
    }
  })

  it('strips a caller-supplied sessionId and signal from the fresh-box prompt', async () => {
    const calls: CapturedPrompt[] = []
    const { client } = capturingClient(calls)
    const callerSignal = new AbortController().signal

    await runAgentRounds<string, string, 'continue' | 'done'>({
      driver: scriptedDriver<string, string>({
        planner: () => ({ kind: 'refine', task: 'again' }),
        maxIterations: 2,
      }),
      agentRun: {
        profile: testAgentProfile('leaf'),
        name: 'leaf',
        taskToPrompt: (task) => task,
      },
      output: { parse: () => 'done' },
      task: 'start',
      maxIterations: 2,
      ctx: {
        sandboxClient: client,
        // An untyped host (JSON on a wire) can carry the kernel-owned keys; the type does not
        // reject them, because a full PromptOptions is assignable to the Omit.
        promptOptions: {
          backend,
          sessionId: 'caller-owned',
          signal: callerSignal,
        },
      } as unknown as ExecCtx,
    })

    expect(calls).toHaveLength(2)
    for (const call of calls) {
      const options = call.options ?? {}
      // A fresh box per iteration owns no session, so the kernel supplies none — and the
      // caller's would have made every iteration share ONE server-side session.
      expect('sessionId' in options).toBe(false)
      expect(options.backend).toEqual(backend)
      expect(options.signal).toBeInstanceOf(AbortSignal)
      expect(options.signal).not.toBe(callerSignal)
    }
  })
})

/** One `dispatchPrompt` call as the box saw it — the poll path's fire-and-detach. */
interface CapturedDispatch {
  readonly boxId: string
  readonly options: Record<string, unknown> | undefined
}

/**
 * A poll-mode client: `dispatchPrompt` + a session whose `result()` answers, and (optionally) the
 * live `branch(count)` API a fork fanout uses. A live SSE is a failure here — poll mode must never
 * hold one.
 */
function pollCapturingClient(
  calls: CapturedDispatch[],
  opts: { branch?: boolean } = {},
): SandboxClient {
  let boxSeq = 0
  let branchSeq = 0

  function makeBox(id: string): SandboxInstance {
    return {
      id,
      streamPrompt(): AsyncGenerator<SandboxEvent> {
        throw new Error('poll mode must not open a live stream')
      },
      async dispatchPrompt(_message: string, options?: Record<string, unknown>) {
        calls.push({ boxId: id, options })
        return {
          sessionId: String(options?.sessionId ?? 'minted'),
          status: 'running' as const,
          alreadyExisted: false,
        }
      },
      session(sessionId: string) {
        return {
          async status() {
            return { id: sessionId, status: 'completed' as const }
          },
          async result() {
            return { success: true, response: 'polled', durationMs: 1 }
          },
        }
      },
      ...(opts.branch
        ? {
            async branch(count: number): Promise<SandboxInstance[]> {
              return Array.from({ length: count }, () => makeBox(`branch-${branchSeq++}`))
            },
          }
        : {}),
      async delete() {},
    } as unknown as SandboxInstance
  }

  return {
    async create(_options?: CreateSandboxOptions): Promise<SandboxInstance> {
      return makeBox(`box-${boxSeq++}`)
    },
  }
}

const polledOutput: OutputAdapter<string> = {
  parse: (events) =>
    String(
      (
        [...events].reverse().find((event) => event.type === 'result')?.data as
          | { finalText?: string }
          | undefined
      )?.finalText ?? '',
    ),
}

describe('runAgentRounds — promptOptions on the poll and fork-fanout paths', () => {
  it('forwards them on the fire-and-detach dispatch of the leaf kernel', async () => {
    const calls: CapturedDispatch[] = []

    await runAgentRounds<string, string, 'continue' | 'done'>({
      driver: scriptedDriver<string, string>({
        planner: () => ({ kind: 'refine', task: 'again' }),
        maxIterations: 2,
      }),
      agentRun: {
        profile: testAgentProfile('leaf'),
        name: 'leaf',
        taskToPrompt: (task) => task,
      },
      output: polledOutput,
      task: 'start',
      maxIterations: 2,
      ctx: {
        sandboxClient: pollCapturingClient(calls),
        promptOptions: { backend, timeoutMs: 900 },
      },
      lineage: { streaming: 'poll' },
    })

    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.options?.backend).toEqual(backend)
      expect(call.options?.timeoutMs).toBe(900)
      // The poll path owns a per-iteration session id, applied after the caller's options.
      expect(typeof call.options?.sessionId).toBe('string')
      expect(call.options?.signal).toBeInstanceOf(AbortSignal)
    }
    expect(new Set(calls.map((call) => call.options?.sessionId)).size).toBe(2)
  })

  it('forwards them into every branch of a live fork fanout', async () => {
    const calls: CapturedDispatch[] = []

    await runAgentRounds<string, string, 'continue' | 'done'>({
      driver: scriptedDriver<string, string>({
        planner: ({ history }) =>
          history.length === 0
            ? { kind: 'refine', task: 'seed' }
            : { kind: 'fanout', tasks: ['a', 'b'] },
        maxIterations: 3,
        maxFanout: 2,
      }),
      agentRun: {
        profile: testAgentProfile('leaf'),
        name: 'leaf',
        taskToPrompt: (task) => task,
      },
      output: polledOutput,
      task: 'seed',
      maxIterations: 3,
      ctx: {
        sandboxClient: pollCapturingClient(calls, { branch: true }),
        promptOptions: { backend, sessionId: 'caller-owned' },
      } as unknown as ExecCtx,
      lineage: { forkFanout: true, streaming: 'poll' },
    })

    // The seed, then one dispatch per branched child box.
    expect(calls).toHaveLength(3)
    const branches = calls.filter((call) => call.boxId.startsWith('branch-'))
    expect(branches).toHaveLength(2)
    for (const call of calls) {
      expect(call.options?.backend).toEqual(backend)
      // Each branch opens its OWN lineage-minted session; the caller's id never reaches the SDK.
      expect(typeof call.options?.sessionId).toBe('string')
      expect(call.options?.sessionId).not.toBe('caller-owned')
    }
    expect(new Set(calls.map((call) => call.options?.sessionId)).size).toBe(3)
  })
})

/** The smallest campaign context a dispatch needs: a real ledger, a no-op trace and artifacts. */
function dispatchContext(): { ctx: DispatchContext; ledger: CostLedger } {
  const ledger = new CostLedger({})
  const ctx: DispatchContext = {
    cellId: 'cell-0',
    rep: 0,
    seed: 1,
    signal: new AbortController().signal,
    trace: {
      span() {
        return { end() {}, setAttribute() {} }
      },
      async flush() {},
    },
    artifacts: {
      async write() {
        return 'p'
      },
      async writeJson() {
        return 'p'
      },
    },
    cost: {
      runPaidCall(input) {
        return ledger.runPaidCall({ ...input, channel: input.channel ?? 'agent', phase: 'cell' })
      },
    },
  }
  return { ctx, ledger }
}

describe('loopDispatch — promptOptions reach every cell the campaign runs', () => {
  const dispatchWith = (client: SandboxClient, promptOptions: unknown) =>
    loopDispatch<string, string, 'continue' | 'done', { id: string; kind: string }, string>({
      sandboxClient: client,
      ...(promptOptions === undefined ? {} : { promptOptions }),
      toLoopOptions: (scenario) => ({
        driver: scriptedDriver<string, string>({
          planner: () => ({ kind: 'refine', task: 'again' }),
          maxIterations: 2,
        }),
        agentRun: {
          profile: testAgentProfile('leaf'),
          name: 'leaf',
          taskToPrompt: (task) => task,
        },
        output: { parse: () => 'done' } as OutputAdapter<string>,
        task: scenario.id,
        maxIterations: 2,
      }),
    } as Parameters<
      typeof loopDispatch<string, string, 'continue' | 'done', { id: string; kind: string }, string>
    >[0])

  it('forwards them into every iteration of every cell', async () => {
    const calls: CapturedPrompt[] = []
    const { client } = capturingClient(calls)
    const dispatch = dispatchWith(client, { backend, context: { runId: 'r1' } })

    await dispatch(
      { name: 'baseline', model: { default: 'offline-test-model' } },
      { id: 's1', kind: 'task' },
      dispatchContext().ctx,
    )

    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.options?.backend).toEqual(backend)
      expect(call.options?.context).toEqual({ runId: 'r1' })
      expect('sessionId' in (call.options ?? {})).toBe(false)
    }
  })

  it('strips a caller-supplied sessionId, so cells never share one server session', async () => {
    const calls: CapturedPrompt[] = []
    const { client } = capturingClient(calls)
    const dispatch = dispatchWith(client, { backend, sessionId: 'caller-owned' })

    await dispatch(
      { name: 'baseline', model: { default: 'offline-test-model' } },
      { id: 's1', kind: 'task' },
      dispatchContext().ctx,
    )

    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.options?.backend).toEqual(backend)
      expect('sessionId' in (call.options ?? {})).toBe(false)
    }
  })

  it('rejects a non-object value on the same reader, before any box is created', async () => {
    for (const value of ['oops', null, 42, [backend]]) {
      const calls: CapturedPrompt[] = []
      const { client, created } = capturingClient(calls)
      const dispatch = dispatchWith(client, value)

      await expect(
        dispatch(
          { name: 'baseline', model: { default: 'offline-test-model' } },
          { id: 's1', kind: 'task' },
          dispatchContext().ctx,
        ),
      ).rejects.toBeInstanceOf(ValidationError)
      expect(created()).toBe(0)
      expect(calls).toEqual([])
    }
  })
})
