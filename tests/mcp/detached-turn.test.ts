import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentSessionStatus,
  AgentTurnInput,
  AgentTurnResult,
  PlacementInfo,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../../src/errors'
import {
  type CoderDelegate,
  coderTaskFromArgs,
  detachedSessionDelegate,
  settleDetachedCoderTurn,
} from '../../src/mcp/delegates'
import { FileDelegationStore } from '../../src/mcp/delegation-store'
import {
  createDetachedTurnResumeDriver,
  formatDetachedSessionRef,
  parseDetachedSessionRef,
  runDetachedTurn,
} from '../../src/mcp/detached-turn'
import type { DelegationExecutor } from '../../src/mcp/executor'
import { DelegationTaskQueue } from '../../src/mcp/task-queue'
import type { DelegateCodeArgs } from '../../src/mcp/types'
import type { LoopTraceEvent } from '../../src/runtime/types'

const codeArgs: DelegateCodeArgs = { goal: 'fix bug', repoRoot: '/repo' }

const patchText = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n')

const coderResultJson = JSON.stringify({
  branch: 'feat/detached',
  patch: patchText,
  testResult: { passed: true, output: 'ok' },
  typecheckResult: { passed: true, output: 'ok' },
  diffStats: { filesChanged: 1, insertions: 1, deletions: 1 },
})

const completedText = ['All done.', '```json', coderResultJson, '```'].join('\n')

function completedResult(overrides: Partial<AgentTurnResult> = {}): AgentTurnResult {
  return {
    text: completedText,
    success: true,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface FakeProviderOptions {
  id?: string
  sessionId?: string
  events?: AgentEnvironmentEvent[]
  result?: AgentTurnResult
  resultPromise?: Promise<AgentTurnResult>
  statuses?: AgentSessionStatus[]
  placement?: PlacementInfo
  detach?: boolean
  getMissing?: boolean
  omitSession?: boolean
  omitDispatch?: boolean
}

function fakeProvider(options: FakeProviderOptions = {}) {
  const environmentId = options.id ?? 'environment-1'
  const statuses = options.statuses ?? ['completed']
  let statusIndex = 0
  const captured: { create?: unknown; turn?: AgentTurnInput; requestedId?: string } = {}
  const cancel = vi.fn(async () => {})
  const destroy = vi.fn(async () => {})
  const status = vi.fn(async () => {
    const value = statuses[Math.min(statusIndex, statuses.length - 1)] ?? 'unknown'
    statusIndex += 1
    return value
  })
  const result = vi.fn(
    async () => options.resultPromise ?? Promise.resolve(options.result ?? completedResult()),
  )
  const dispatch = vi.fn(async (input: AgentTurnInput) => {
    captured.turn = input
    return { id: options.sessionId ?? input.sessionId ?? 'session-1', provider: 'test-provider' }
  })
  const session = {
    id: options.sessionId ?? 'session-1',
    status,
    async *events() {
      for (const event of options.events ?? []) yield event
    },
    result,
    prompt: async () => options.result ?? completedResult(),
    cancel,
  }
  const environment: AgentEnvironment = {
    id: environmentId,
    provider: 'test-provider',
    status: async () => 'running',
    async *stream(input) {
      captured.turn = input
      for (const event of options.events ?? []) yield event
    },
    ...(options.omitDispatch ? {} : { dispatch }),
    ...(options.omitSession
      ? {}
      : {
          session(id: string) {
            captured.requestedId = id
            return { ...session, id }
          },
        }),
    placement: async () => options.placement ?? { kind: 'provider' },
    destroy,
  }
  const provider: AgentEnvironmentProvider = {
    name: 'test-provider',
    capabilities: () => ({
      profile: {},
      streaming: {
        live: true,
        replay: true,
        detach: options.detach ?? true,
        turnIdempotency: true,
      },
      sessions: { continue: true, list: true, messages: true },
      workspace: {
        read: true,
        write: true,
        exec: true,
        git: true,
        upload: true,
        download: true,
      },
      branching: { checkpoint: false, fork: false },
      placement: true,
      usage: true,
      confidential: false,
    }),
    create: vi.fn(async (input) => {
      captured.create = input
      return environment
    }),
    get: vi.fn(async (id) => {
      captured.requestedId = id
      return options.getMissing ? null : environment
    }),
  }
  return {
    provider,
    environment,
    captured,
    cancel,
    destroy,
    dispatch,
    result,
    status,
  }
}

function delegationExecutor(provider: AgentEnvironmentProvider): DelegationExecutor {
  return {
    provider,
    placement: 'provider',
    describe: () => provider.name,
  }
}

async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function submitCoder(
  queue: DelegationTaskQueue,
  delegate: CoderDelegate,
  args: DelegateCodeArgs,
  options: { detachedDispatch?: boolean } = {},
): { taskId: string } {
  const variants = Math.max(1, Math.trunc(args.variants ?? 1))
  const detached = options.detachedDispatch && variants <= 1
  return queue.submit<DelegateCodeArgs>({
    profile: 'coder',
    args,
    ...(detached
      ? { detachedSessionRef: formatDetachedSessionRef({ sessionId: detachedCoderSessionId() }) }
      : {}),
    run: (ctx) => delegate(args, ctx),
  })
}

function detachedCoderSessionId(): string {
  const hex = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0')
  return `dlg-turn-coder-${hex}`
}

describe('detached session ref codec', () => {
  it('round-trips unbound and environment-bound refs', () => {
    const unbound = formatDetachedSessionRef({ sessionId: 'session-1' })
    expect(unbound).toBe('session=session-1')
    expect(parseDetachedSessionRef(unbound)).toEqual({ sessionId: 'session-1' })

    const bound = formatDetachedSessionRef({
      environmentId: 'environment-42',
      sessionId: 'session-1',
    })
    expect(bound).toBe('environment=environment-42;session=session-1')
    expect(parseDetachedSessionRef(bound)).toEqual({
      environmentId: 'environment-42',
      sessionId: 'session-1',
    })
  })

  it('rejects malformed, duplicate, retired, and delimiter-bearing fields', () => {
    expect(() => parseDetachedSessionRef('')).toThrow(ValidationError)
    expect(() => parseDetachedSessionRef('sandbox=old;session=s')).toThrow(ValidationError)
    expect(() => parseDetachedSessionRef('environment=only')).toThrow(/no session id/)
    expect(() => parseDetachedSessionRef('session=a;session=b')).toThrow(ValidationError)
    expect(() => formatDetachedSessionRef({ sessionId: 'a;b' })).toThrow(ValidationError)
    expect(() => formatDetachedSessionRef({ sessionId: 'a', environmentId: 'x=y' })).toThrow(
      ValidationError,
    )
  })
})

describe('runDetachedTurn', () => {
  const spec = {
    profile: { name: 'coder-test' },
    taskToPrompt: () => 'do the thing',
    environment: { backend: 'codex' },
  }

  it('dispatches once, reports while waiting, binds both ids, and destroys the environment', async () => {
    const terminal = deferred<AgentTurnResult>()
    const fake = fakeProvider({
      id: 'environment-7',
      sessionId: 'session-resolved',
      resultPromise: terminal.promise,
    })
    const bindings: string[] = []
    const phases: string[] = []
    const pending = runDetachedTurn({
      provider: fake.provider,
      spec,
      prompt: 'do the thing',
      sessionId: 'session-requested',
      bindEnvironment: (environmentId, sessionId) => bindings.push(`${environmentId}:${sessionId}`),
      signal: new AbortController().signal,
      report: (progress) => phases.push(progress.phase),
      tickIntervalMs: 1,
    })
    await until(() => phases.length > 0)
    terminal.resolve(completedResult())

    const turn = await pending
    expect(turn.text).toBe(completedText)
    expect(bindings).toEqual(['environment-7:session-resolved'])
    expect(fake.dispatch).toHaveBeenCalledTimes(1)
    expect(fake.captured.turn).toMatchObject({
      prompt: 'do the thing',
      sessionId: 'session-requested',
      turnId: 'session-requested',
      executionId: 'session-requested',
      detach: true,
    })
    expect(phases[0]).toMatch(/^detached-running /)
    expect(fake.destroy).toHaveBeenCalledTimes(1)
  })

  it('fails on an unsuccessful provider result and still destroys the environment', async () => {
    const fake = fakeProvider({
      result: completedResult({ success: false, error: 'wall cap exceeded' }),
    })
    await expect(
      runDetachedTurn({
        provider: fake.provider,
        spec,
        prompt: 'p',
        sessionId: 'session-2',
        bindEnvironment: () => {},
        signal: new AbortController().signal,
        report: () => {},
        tickIntervalMs: 1,
      }),
    ).rejects.toThrow(/wall cap exceeded/)
    expect(fake.destroy).toHaveBeenCalledTimes(1)
  })

  it('cancels the provider session and destroys the environment on abort', async () => {
    const terminal = deferred<AgentTurnResult>()
    const controller = new AbortController()
    const fake = fakeProvider({ resultPromise: terminal.promise })
    const pending = runDetachedTurn({
      provider: fake.provider,
      spec,
      prompt: 'p',
      sessionId: 'session-3',
      bindEnvironment: () => {},
      signal: controller.signal,
      report: () => {},
      tickIntervalMs: 1,
    })
    await until(() => fake.dispatch.mock.calls.length === 1)
    controller.abort()
    await expect(pending).rejects.toThrow(/abort/i)
    expect(fake.cancel).toHaveBeenCalledTimes(1)
    expect(fake.destroy).toHaveBeenCalledTimes(1)
  })

  it('fails before creation when the provider cannot detach', async () => {
    const fake = fakeProvider({ detach: false })
    await expect(
      runDetachedTurn({
        provider: fake.provider,
        spec,
        prompt: 'p',
        sessionId: 'session-4',
        bindEnvironment: () => {},
        signal: new AbortController().signal,
        report: () => {},
      }),
    ).rejects.toThrow(/does not support detached turns/)
    expect(fake.provider.create).not.toHaveBeenCalled()
  })

  it('fails when the created environment lacks dispatch or session lookup', async () => {
    const noDispatch = fakeProvider({ omitDispatch: true })
    await expect(
      runDetachedTurn({
        provider: noDispatch.provider,
        spec,
        prompt: 'p',
        sessionId: 'session-5',
        bindEnvironment: () => {},
        signal: new AbortController().signal,
        report: () => {},
      }),
    ).rejects.toThrow(/without dispatch\/session support/)

    const noSession = fakeProvider({ omitSession: true })
    await expect(
      runDetachedTurn({
        provider: noSession.provider,
        spec,
        prompt: 'p',
        sessionId: 'session-6',
        bindEnvironment: () => {},
        signal: new AbortController().signal,
        report: () => {},
      }),
    ).rejects.toThrow(/without dispatch\/session support/)
  })

  it('emits official provider placement fields in the loop trace', async () => {
    const fake = fakeProvider({
      id: 'environment-trace',
      result: completedResult({
        usage: { inputTokens: 9, outputTokens: 4, cost: 0.02 },
      }),
      placement: {
        kind: 'fleet',
        fleetId: 'fleet-1',
        machineId: 'machine-2',
        region: 'us-west',
      },
    })
    const events: LoopTraceEvent[] = []
    await runDetachedTurn({
      provider: fake.provider,
      spec,
      prompt: 'p',
      sessionId: 'session-trace',
      bindEnvironment: () => {},
      signal: new AbortController().signal,
      report: () => {},
      traceEmitter: { emit: (event) => void events.push(event) },
    })

    expect(events.map((event) => event.kind)).toEqual([
      'loop.started',
      'loop.iteration.started',
      'loop.iteration.dispatch',
      'loop.iteration.ended',
      'loop.ended',
    ])
    const dispatch = events[2]?.payload
    expect(dispatch).toMatchObject({
      placement: 'fleet',
      environmentId: 'environment-trace',
      provider: 'test-provider',
      fleetId: 'fleet-1',
      machineId: 'machine-2',
      region: 'us-west',
    })
    expect(events[3]?.payload).toMatchObject({
      costUsd: 0.02,
      tokenUsage: { input: 9, output: 4 },
    })
    expect(events[4]?.payload).toMatchObject({ totalCostUsd: 0.02 })
  })

  it('emits the official sandbox placement id', async () => {
    const fake = fakeProvider({
      placement: {
        kind: 'sandbox',
        sandboxId: 'sandbox-1',
      },
    })
    const events: LoopTraceEvent[] = []

    await runDetachedTurn({
      provider: fake.provider,
      spec,
      prompt: 'p',
      sessionId: 'session-sandbox-placement',
      bindEnvironment: () => {},
      signal: new AbortController().signal,
      report: () => {},
      traceEmitter: { emit: (event) => void events.push(event) },
    })

    expect(events[2]?.payload).toMatchObject({
      placement: 'sandbox',
      sandboxId: 'sandbox-1',
    })
  })
})

describe('settleDetachedCoderTurn', () => {
  it('parses and validates a completed provider result', async () => {
    const output = await settleDetachedCoderTurn(
      { text: completedText, result: completedResult() },
      {
        task: coderTaskFromArgs(codeArgs),
        sessionId: 'session-1',
        signal: new AbortController().signal,
      },
    )
    expect(output.branch).toBe('feat/detached')
    expect(output.patch).toBe(patchText)
  })

  it('rejects invalid output and reviewer rejection', async () => {
    const empty = JSON.stringify({
      branch: 'b',
      patch: '',
      testResult: { passed: true, output: '' },
      typecheckResult: { passed: true, output: '' },
      diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
    })
    await expect(
      settleDetachedCoderTurn(
        {
          text: `\`\`\`json\n${empty}\n\`\`\``,
          result: completedResult({ text: `\`\`\`json\n${empty}\n\`\`\`` }),
        },
        {
          task: coderTaskFromArgs(codeArgs),
          sessionId: 'session-1',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toThrow(/no candidate passed validation/)

    await expect(
      settleDetachedCoderTurn(
        { text: completedText, result: completedResult() },
        {
          task: coderTaskFromArgs(codeArgs),
          sessionId: 'session-1',
          signal: new AbortController().signal,
          reviewer: () => ({ approved: false, recommendation: 'reject', readiness: 0 }),
        },
      ),
    ).rejects.toThrow(/validation \+ review/)
  })
})

describe('createDetachedTurnResumeDriver', () => {
  function makeRecord(ref: string) {
    return {
      record: {
        taskId: 'delegation-1',
        profile: 'coder' as const,
        args: codeArgs,
        status: 'running' as const,
        startedAt: new Date().toISOString(),
        feedback: [],
        detachedSessionRef: ref,
      },
      detachedSessionRef: ref,
    }
  }

  function makeCtx() {
    const controller = new AbortController()
    const progress: string[] = []
    return {
      controller,
      progress,
      ctx: {
        signal: controller.signal,
        report: (value: { iteration: number; phase: string }) => progress.push(value.phase),
      },
    }
  }

  it('resolves a completed session and settles its provider result', async () => {
    const fake = fakeProvider({ statuses: ['completed'] })
    const settleOutput = vi.fn(async () => ({ done: true }) as never)
    const driver = createDetachedTurnResumeDriver({
      provider: fake.provider,
      settleOutput,
    })
    const { ctx } = makeCtx()
    const tick = await driver.tick(makeRecord('environment=environment-1;session=session-9'), ctx)
    expect(tick).toEqual({ state: 'completed', output: { done: true } })
    expect(fake.provider.get).toHaveBeenCalledWith('environment-1')
    expect(fake.captured.requestedId).toBe('session-9')
    expect(settleOutput).toHaveBeenCalledWith(
      { text: completedText, result: completedResult() },
      expect.objectContaining({ taskId: 'delegation-1' }),
      expect.objectContaining({ signal: ctx.signal }),
    )
    expect(fake.destroy).toHaveBeenCalledTimes(1)
  })

  it('reports a running session without redispatching it', async () => {
    const fake = fakeProvider({ statuses: ['running'] })
    const driver = createDetachedTurnResumeDriver({
      provider: fake.provider,
      settleOutput: () => {
        throw new Error('not reached')
      },
    })
    const { ctx, progress } = makeCtx()
    const tick = await driver.tick(makeRecord('environment=environment-1;session=session-1'), ctx)
    expect(tick).toEqual({ state: 'running' })
    expect(progress).toEqual(['detached-running'])
    expect(fake.dispatch).not.toHaveBeenCalled()
    expect(fake.destroy).not.toHaveBeenCalled()
  })

  it('maps provider failures and missing bindings to explicit failed ticks', async () => {
    const failed = fakeProvider({ statuses: ['failed'] })
    const failedDriver = createDetachedTurnResumeDriver({
      provider: failed.provider,
      settleOutput: () => {
        throw new Error('not reached')
      },
    })
    const { ctx } = makeCtx()
    await expect(
      failedDriver.tick(makeRecord('environment=environment-1;session=session-1'), ctx),
    ).resolves.toMatchObject({
      state: 'failed',
      error: { kind: 'DetachedTurnFailedError' },
    })
    expect(failed.destroy).toHaveBeenCalledTimes(1)

    await expect(failedDriver.tick(makeRecord('session=never-bound'), ctx)).resolves.toMatchObject({
      state: 'failed',
      error: { kind: 'DetachedSessionUnboundError' },
    })

    const unknown = fakeProvider({ statuses: ['unknown'] })
    const unknownDriver = createDetachedTurnResumeDriver({
      provider: unknown.provider,
      settleOutput: () => {
        throw new Error('not reached')
      },
    })
    await expect(
      unknownDriver.tick(makeRecord('environment=environment-1;session=session-unknown'), ctx),
    ).resolves.toMatchObject({
      state: 'failed',
      error: { kind: 'DetachedSessionStatusUnknownError' },
    })
    expect(unknown.destroy).toHaveBeenCalledTimes(1)
  })

  it('cancels the resumed provider session when the queue aborts', async () => {
    const fake = fakeProvider({ statuses: ['running'] })
    const driver = createDetachedTurnResumeDriver({
      provider: fake.provider,
      settleOutput: () => {
        throw new Error('not reached')
      },
    })
    const { ctx, controller } = makeCtx()
    await driver.tick(makeRecord('environment=environment-1;session=session-cancel'), ctx)
    controller.abort()
    await until(() => fake.cancel.mock.calls.length === 1)
    await until(() => fake.destroy.mock.calls.length === 1)
  })
})

describe('detached session queue integration', () => {
  it('records a session-only ref only for single-variant detached submissions', async () => {
    const queue = new DelegationTaskQueue()
    const seen: Array<string | undefined> = []
    const delegate: CoderDelegate = async (_args, ctx) => {
      seen.push(ctx.detachedSessionRef)
      return {
        branch: 'b',
        patch: patchText,
        testResult: { passed: true, output: '' },
        typecheckResult: { passed: true, output: '' },
        diffStats: { filesChanged: 1, insertions: 1, deletions: 1 },
      }
    }

    const detached = submitCoder(queue, delegate, codeArgs, { detachedDispatch: true })
    await until(() => queue.status(detached.taskId)?.status === 'completed')
    expect(parseDetachedSessionRef(seen[0] as string).environmentId).toBeUndefined()

    const fanout = submitCoder(
      queue,
      delegate,
      { ...codeArgs, variants: 2 },
      { detachedDispatch: true },
    )
    await until(() => queue.status(fanout.taskId)?.status === 'completed')
    expect(seen[1]).toBeUndefined()
  })

  it('runs detached and streamed coder work through executor.provider', async () => {
    const detached = fakeProvider({ id: 'environment-77', sessionId: 'session-77' })
    const detachedDelegate = detachedSessionDelegate({
      executor: delegationExecutor(detached.provider),
      detachedTickIntervalMs: 1,
    })
    const rebinds: string[] = []
    const detachedOutput = await detachedDelegate(codeArgs, {
      signal: new AbortController().signal,
      report: () => {},
      detachedSessionRef: 'session=session-requested',
      updateDetachedSessionRef: (ref) => rebinds.push(ref),
    })
    expect(detachedOutput.branch).toBe('feat/detached')
    expect(rebinds).toEqual(['environment=environment-77;session=session-77'])

    const streamed = fakeProvider({
      events: [
        {
          type: 'result',
          data: {
            result: {
              branch: 'feat/stream',
              patch: patchText,
              testResult: { passed: true, output: '' },
              typecheckResult: { passed: true, output: '' },
              diffStats: { filesChanged: 1, insertions: 1, deletions: 1 },
            },
          },
        },
      ],
    })
    const streamedOutput = await detachedSessionDelegate({
      executor: delegationExecutor(streamed.provider),
    })(codeArgs, {
      signal: new AbortController().signal,
      report: () => {},
    })
    expect(streamedOutput.branch).toBe('feat/stream')
    expect(streamed.dispatch).not.toHaveBeenCalled()
  })
})

describe('restored detached record', () => {
  let directory: string
  let filePath: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'delegation-detached-'))
    filePath = join(directory, 'delegations.json')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
  })

  it('resumes a bound provider session and persists current ref fields', async () => {
    const first = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    const { taskId } = first.submit({
      profile: 'coder',
      args: codeArgs,
      detachedSessionRef: formatDetachedSessionRef({ sessionId: 'session-e2e' }),
      run: async (ctx) => {
        ctx.updateDetachedSessionRef(
          formatDetachedSessionRef({
            environmentId: 'environment-e2e',
            sessionId: 'session-e2e',
          }),
        )
        return new Promise<never>(() => {})
      },
    })
    await until(() => first.status(taskId)?.status === 'running')
    await first.flush()

    const fake = fakeProvider({
      id: 'environment-e2e',
      statuses: ['running', 'completed'],
    })
    const second = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
      resumeDelegate: createDetachedTurnResumeDriver({
        provider: fake.provider,
        intervalMs: 1,
        settleOutput: (turn, record, ctx) =>
          settleDetachedCoderTurn(turn, {
            task: coderTaskFromArgs(record.args as DelegateCodeArgs),
            sessionId: 'session-e2e',
            signal: ctx.signal,
          }),
      }),
    })
    await until(() => second.status(taskId)?.status === 'completed')
    const status = second.status(taskId, { includeTrace: true })
    expect(status?.result?.profile).toBe('coder')
    expect((status!.result!.output as { branch: string }).branch).toBe('feat/detached')
    expect(fake.provider.get).toHaveBeenCalledWith('environment-e2e')
    expect(fake.destroy).toHaveBeenCalledTimes(1)
    expect(
      status?.trace?.some((span) => span.meta?.['tangle.loop.driver'] === 'detached-resume'),
    ).toBe(true)
    expect(
      status?.trace?.find((span) => span.meta?.['tangle.loop.driver'] === 'detached-resume')
        ?.meta?.['tangle.loop.detached_session_ref'],
    ).toBe('environment=environment-e2e;session=session-e2e')
    await second.flush()
  })
})
