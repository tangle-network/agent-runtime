import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  type DriveTurnCapableBox,
  type DriveTurnTick,
  formatDetachedSessionRef,
  parseDetachedSessionRef,
  runDetachedTurn,
} from '../../src/mcp/detached-turn'
import { createSiblingSandboxExecutor } from '../../src/mcp/executor'
import { DelegationTaskQueue } from '../../src/mcp/task-queue'
import type { DelegateCodeArgs } from '../../src/mcp/types'
import type { LoopTraceEvent, SandboxClient } from '../../src/runtime'

const codeArgs: DelegateCodeArgs = { goal: 'fix bug', repoRoot: '/repo' }
const exactWorkerProfile = {
  name: 'coder-test',
  harness: 'claude-code' as const,
  model: { provider: 'anthropic', default: 'offline-test-model' },
}

/**
 * Submit a single-variant coder delegation to the queue exactly as the bin's `delegate` dispatch
 * does: a deterministic session-only detached ref (so a restart can resume), and a `run` closure
 * that hands the args + ctx to the coder delegate. `detachedDispatch:false` keeps the streaming path
 * (no ref recorded).
 */
function submitCoder(
  queue: DelegationTaskQueue,
  delegate: CoderDelegate,
  args: DelegateCodeArgs,
  opts: { detachedDispatch?: boolean } = {},
): { taskId: string } {
  const variants = Math.max(1, Math.trunc(args.variants ?? 1))
  const detached = opts.detachedDispatch && variants <= 1
  return queue.submit<DelegateCodeArgs>({
    profile: 'coder',
    args,
    ...(detached
      ? { detachedSessionRef: formatDetachedSessionRef({ sessionId: detachedCoderSessionId() }) }
      : {}),
    run: (ctx) => delegate(args, ctx),
  })
}

/** Deterministic single-variant detached session id, matching the `dlg-turn-coder-<8hex>` shape. */
function detachedCoderSessionId(): string {
  const hex = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0')
  return `dlg-turn-coder-${hex}`
}

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

interface FakeBoxOptions {
  ticks: DriveTurnTick[]
  id?: string
}

function fakeDriveTurnBox(options: FakeBoxOptions) {
  let call = 0
  const driveTurn = vi.fn(async (): Promise<DriveTurnTick> => {
    const tick = options.ticks[Math.min(call, options.ticks.length - 1)]
    call += 1
    if (!tick) throw new Error('fakeDriveTurnBox: no scripted tick')
    return tick
  })
  const sessionCancel = vi.fn(async () => {})
  const del = vi.fn(async () => {})
  return {
    box: {
      id: options.id ?? 'box-1',
      driveTurn,
      _sessionCancel: sessionCancel,
      delete: del,
    },
    driveTurn,
    sessionCancel,
    delete: del,
  }
}

function fakeClient(box: unknown): SandboxClient {
  return {
    async create() {
      return box as never
    },
  }
}

async function until(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('detached session ref codec', () => {
  it('round-trips a session-only ref', () => {
    const ref = formatDetachedSessionRef({ sessionId: 'dlg-turn-coder-abc' })
    expect(ref).toBe('session=dlg-turn-coder-abc')
    expect(parseDetachedSessionRef(ref)).toEqual({ sessionId: 'dlg-turn-coder-abc' })
  })

  it('round-trips a sandbox-bound ref', () => {
    const ref = formatDetachedSessionRef({ sandboxId: 'sandbox_42', sessionId: 's-1' })
    expect(ref).toBe('sandbox=sandbox_42;session=s-1')
    expect(parseDetachedSessionRef(ref)).toEqual({ sandboxId: 'sandbox_42', sessionId: 's-1' })
  })

  it('rejects malformed refs loudly', () => {
    expect(() => parseDetachedSessionRef('')).toThrow(ValidationError)
    expect(() => parseDetachedSessionRef('garbage')).toThrow(ValidationError)
    expect(() => parseDetachedSessionRef('sandbox=only')).toThrow(/no session id/)
    expect(() => parseDetachedSessionRef('session=a;session=b')).toThrow(ValidationError)
    expect(() => parseDetachedSessionRef('other=x;session=s')).toThrow(ValidationError)
  })

  it('rejects ids containing the delimiters', () => {
    expect(() => formatDetachedSessionRef({ sessionId: 'a;b' })).toThrow(ValidationError)
    expect(() => formatDetachedSessionRef({ sessionId: 'a', sandboxId: 'x=y' })).toThrow(
      ValidationError,
    )
    expect(() => formatDetachedSessionRef({ sessionId: '' })).toThrow(ValidationError)
  })
})

describe('runDetachedTurn', () => {
  const spec = {
    profile: exactWorkerProfile,
    taskToPrompt: () => 'do the thing',
  } as never

  it('drives running ticks to completion, binds the sandbox id, tears the box down', async () => {
    const fake = fakeDriveTurnBox({
      ticks: [
        { state: 'running', elapsedMs: 1200 },
        { state: 'completed', text: completedText, result: { ok: true } },
      ],
    })
    const bound: string[] = []
    const phases: string[] = []
    const turn = await runDetachedTurn({
      client: fakeClient(fake.box),
      spec,
      prompt: 'do the thing',
      sessionId: 'sess-1',
      bindSandbox: (id) => bound.push(id),
      signal: new AbortController().signal,
      report: (progress) => phases.push(progress.phase),
      tickIntervalMs: 1,
    })
    expect(turn.text).toBe(completedText)
    expect(bound).toEqual(['box-1'])
    expect(fake.driveTurn).toHaveBeenCalledTimes(2)
    expect(fake.driveTurn.mock.calls[0]?.[1]).toMatchObject({
      sessionId: 'sess-1',
      turnId: 'sess-1',
    })
    expect(phases).toContain('detached-running 1s')
    expect(fake.delete).toHaveBeenCalledTimes(1)
  })

  it('throws on a failed tick with the SDK reason', async () => {
    const fake = fakeDriveTurnBox({ ticks: [{ state: 'failed', error: 'wall cap exceeded' }] })
    await expect(
      runDetachedTurn({
        client: fakeClient(fake.box),
        spec,
        prompt: 'p',
        sessionId: 'sess-2',
        bindSandbox: () => {},
        signal: new AbortController().signal,
        report: () => {},
        tickIntervalMs: 1,
      }),
    ).rejects.toThrow(/sess-2 failed: wall cap exceeded/)
    expect(fake.delete).toHaveBeenCalledTimes(1)
  })

  it('cancels the remote session and aborts between ticks', async () => {
    const controller = new AbortController()
    const fake = fakeDriveTurnBox({ ticks: [{ state: 'running' }] })
    const pending = runDetachedTurn({
      client: fakeClient(fake.box),
      spec,
      prompt: 'p',
      sessionId: 'sess-3',
      bindSandbox: () => {},
      signal: controller.signal,
      report: () => {},
      tickIntervalMs: 5,
    })
    await until(() => fake.driveTurn.mock.calls.length >= 1)
    controller.abort()
    await expect(pending).rejects.toThrow(/abort/i)
    expect(fake.sessionCancel).toHaveBeenCalledWith('sess-3')
    expect(fake.delete).toHaveBeenCalledTimes(1)
  })

  it('fails loud when the box exposes no driveTurn (in-process style placement)', async () => {
    const box = { id: 'in-process-1', delete: vi.fn(async () => {}) }
    await expect(
      runDetachedTurn({
        client: fakeClient(box),
        spec,
        prompt: 'p',
        sessionId: 'sess-4',
        bindSandbox: () => {},
        signal: new AbortController().signal,
        report: () => {},
      }),
    ).rejects.toThrow(/no driveTurn/)
  })

  it('fails loud when the box carries no id (unresumable)', async () => {
    const fake = fakeDriveTurnBox({ ticks: [{ state: 'running' }] })
    const box = { ...fake.box, id: undefined }
    await expect(
      runDetachedTurn({
        client: fakeClient(box),
        spec,
        prompt: 'p',
        sessionId: 'sess-5',
        bindSandbox: () => {},
        signal: new AbortController().signal,
        report: () => {},
      }),
    ).rejects.toThrow(/no id/)
  })

  it('synthesizes a single-iteration loop event stream for the trace sinks', async () => {
    const fake = fakeDriveTurnBox({
      ticks: [
        { state: 'running', elapsedMs: 100 },
        { state: 'completed', text: completedText, result: {} },
      ],
      id: 'sandbox_t1',
    })
    const events: LoopTraceEvent[] = []
    await runDetachedTurn({
      client: fakeClient(fake.box),
      spec,
      prompt: 'p',
      sessionId: 'sess-trace-1',
      bindSandbox: () => {},
      signal: new AbortController().signal,
      report: () => {},
      tickIntervalMs: 1,
      traceEmitter: { emit: (e) => void events.push(e) },
    })
    expect(events.map((e) => e.kind)).toEqual([
      'loop.started',
      'loop.iteration.started',
      'loop.iteration.dispatch',
      'loop.iteration.ended',
      'loop.ended',
    ])
    // runId = the deterministic session id, so the stream is attributable
    expect(new Set(events.map((e) => e.runId))).toEqual(new Set(['sess-trace-1']))
    const started = events[0]!.payload as { driver: string; agentRunNames: string[] }
    expect(started.driver).toBe('detached-turn')
    expect(started.agentRunNames).toEqual(['coder-test'])
    const dispatch = events[2]!.payload as { placement: string; sandboxId: string }
    expect(dispatch).toMatchObject({ placement: 'sibling', sandboxId: 'sandbox_t1' })
    const iterationEnded = events[3]!.payload as {
      costUsd: number
      costUsdKnown?: false
      tokenUsage?: { input: number; output: number; tokensKnown?: false }
    }
    expect(iterationEnded).toMatchObject({
      costUsd: 0,
      costUsdKnown: false,
      tokenUsage: { input: 0, output: 0, tokensKnown: false },
    })
    const ended = events[4]!.payload as {
      winnerIterationIndex?: number
      iterations: number
      totalCostUsd: number
      costUsdKnown?: false
    }
    expect(ended.winnerIterationIndex).toBe(0)
    expect(ended.iterations).toBe(1)
    expect(ended.totalCostUsd).toBe(0)
    expect(ended.costUsdKnown).toBe(false)
  })

  it('records the error on the synthesized stream when the turn fails', async () => {
    const fake = fakeDriveTurnBox({ ticks: [{ state: 'failed', error: 'wall cap exceeded' }] })
    const events: LoopTraceEvent[] = []
    await expect(
      runDetachedTurn({
        client: fakeClient(fake.box),
        spec,
        prompt: 'p',
        sessionId: 'sess-trace-2',
        bindSandbox: () => {},
        signal: new AbortController().signal,
        report: () => {},
        tickIntervalMs: 1,
        traceEmitter: { emit: (e) => void events.push(e) },
      }),
    ).rejects.toThrow(/wall cap exceeded/)
    const iterationEnded = events.find((e) => e.kind === 'loop.iteration.ended')!
    expect((iterationEnded.payload as { error?: string }).error).toMatch(/wall cap exceeded/)
    expect(events[events.length - 1]!.kind).toBe('loop.ended')
    expect(
      (events[events.length - 1]!.payload as { winnerIterationIndex?: number })
        .winnerIterationIndex,
    ).toBeUndefined()
  })
})

describe('settleDetachedCoderTurn', () => {
  it('parses and validates a completed turn payload', async () => {
    const output = await settleDetachedCoderTurn(
      { text: completedText, result: {} },
      {
        task: coderTaskFromArgs(codeArgs),
        sessionId: 's',
        signal: new AbortController().signal,
      },
    )
    expect(output.branch).toBe('feat/detached')
    expect(output.patch).toBe(patchText)
  })

  it('rejects a turn whose payload fails the mechanical validator', async () => {
    const empty = JSON.stringify({
      branch: 'b',
      patch: '',
      testResult: { passed: true, output: '' },
      typecheckResult: { passed: true, output: '' },
      diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
    })
    await expect(
      settleDetachedCoderTurn(
        { text: `\`\`\`json\n${empty}\n\`\`\``, result: {} },
        {
          task: coderTaskFromArgs(codeArgs),
          sessionId: 's',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toThrow(/no candidate passed validation/)
  })

  it('applies the reviewer gate', async () => {
    await expect(
      settleDetachedCoderTurn(
        { text: completedText, result: {} },
        {
          task: coderTaskFromArgs(codeArgs),
          sessionId: 's',
          signal: new AbortController().signal,
          reviewer: () => ({ approved: false, readiness: 0 }),
        },
      ),
    ).rejects.toThrow(/validation \+ review/)
  })
})

describe('createDetachedTurnResumeDriver', () => {
  function makeRecord(ref: string) {
    return {
      record: {
        taskId: 'dlg-1',
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
        report: (p: { iteration: number; phase: string }) => progress.push(p.phase),
      },
    }
  }

  it('maps completed → settled output payload', async () => {
    const fake = fakeDriveTurnBox({
      ticks: [{ state: 'completed', text: completedText, result: { usage: 1 } }],
    })
    const settle = vi.fn(async () => ({ done: true }) as never)
    const driver = createDetachedTurnResumeDriver({
      resolveSandbox: async () => fake.box as DriveTurnCapableBox,
      buildMessage: () => 'rebuilt prompt',
      settleOutput: settle,
    })
    const { ctx } = makeCtx()
    const tick = await driver.tick(makeRecord('sandbox=box-1;session=sess-9'), ctx)
    expect(tick).toEqual({ state: 'completed', output: { done: true } })
    expect(settle).toHaveBeenCalledWith(
      { text: completedText, result: { usage: 1 } },
      expect.objectContaining({ taskId: 'dlg-1' }),
      expect.objectContaining({ signal: ctx.signal }),
    )
    expect(fake.driveTurn).toHaveBeenCalledWith('rebuilt prompt', {
      sessionId: 'sess-9',
      turnId: 'sess-9',
    })
  })

  it('maps running → running tick and reports elapsed progress', async () => {
    const fake = fakeDriveTurnBox({ ticks: [{ state: 'running', elapsedMs: 64_000 }] })
    const driver = createDetachedTurnResumeDriver({
      resolveSandbox: async () => fake.box as DriveTurnCapableBox,
      buildMessage: () => 'p',
      settleOutput: () => {
        throw new Error('not reached')
      },
    })
    const { ctx, progress } = makeCtx()
    const tick = await driver.tick(makeRecord('sandbox=box-1;session=s'), ctx)
    expect(tick).toEqual({ state: 'running' })
    expect(progress).toEqual(['detached-running 64s'])
  })

  it('maps failed → terminal failed tick', async () => {
    const fake = fakeDriveTurnBox({ ticks: [{ state: 'failed', error: 'session evaporated' }] })
    const driver = createDetachedTurnResumeDriver({
      resolveSandbox: async () => fake.box as DriveTurnCapableBox,
      buildMessage: () => 'p',
      settleOutput: () => {
        throw new Error('not reached')
      },
    })
    const { ctx } = makeCtx()
    const tick = await driver.tick(makeRecord('sandbox=box-1;session=s'), ctx)
    expect(tick).toMatchObject({
      state: 'failed',
      error: { kind: 'DetachedTurnFailedError', message: expect.stringContaining('evaporated') },
    })
  })

  it('fails an unbound ref without touching the sandbox', async () => {
    const resolve = vi.fn()
    const driver = createDetachedTurnResumeDriver({
      resolveSandbox: resolve as never,
      buildMessage: () => 'p',
      settleOutput: () => {
        throw new Error('not reached')
      },
    })
    const { ctx } = makeCtx()
    const tick = await driver.tick(makeRecord('session=never-bound'), ctx)
    expect(tick).toMatchObject({
      state: 'failed',
      error: { kind: 'DetachedSessionUnboundError' },
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('hooks remote cancellation onto the abort signal', async () => {
    const fake = fakeDriveTurnBox({ ticks: [{ state: 'running' }] })
    const driver = createDetachedTurnResumeDriver({
      resolveSandbox: async () => fake.box as DriveTurnCapableBox,
      buildMessage: () => 'p',
      settleOutput: () => {
        throw new Error('not reached')
      },
    })
    const { ctx, controller } = makeCtx()
    await driver.tick(makeRecord('sandbox=box-1;session=sess-c'), ctx)
    controller.abort()
    await until(() => fake.sessionCancel.mock.calls.length === 1)
    expect(fake.sessionCancel).toHaveBeenCalledWith('sess-c')
  })

  it('propagates a settle failure as a thrown tick (queue settles failed)', async () => {
    const fake = fakeDriveTurnBox({
      ticks: [{ state: 'completed', text: 'no fenced result here', result: {} }],
    })
    const driver = createDetachedTurnResumeDriver({
      resolveSandbox: async () => fake.box as DriveTurnCapableBox,
      buildMessage: () => 'p',
      settleOutput: () => {
        throw new Error('resumed output failed validation')
      },
    })
    const { ctx } = makeCtx()
    await expect(driver.tick(makeRecord('sandbox=box-1;session=s'), ctx)).rejects.toThrow(
      /failed validation/,
    )
  })
})

describe('detachedSessionRef population on submit', () => {
  it('records a deterministic session-only ref for single-variant detached submissions', async () => {
    const queue = new DelegationTaskQueue()
    const seenRefs: (string | undefined)[] = []
    const delegate: CoderDelegate = async (_args, ctx) => {
      seenRefs.push(ctx.detachedSessionRef)
      return {
        branch: 'b',
        patch: patchText,
        testResult: { passed: true, output: '' },
        typecheckResult: { passed: true, output: '' },
        diffStats: { filesChanged: 1, insertions: 1, deletions: 1 },
      }
    }
    const { taskId } = submitCoder(
      queue,
      delegate,
      { goal: 'fix', repoRoot: '/r' },
      {
        detachedDispatch: true,
      },
    )
    await until(() => queue.status(taskId)?.status === 'completed')
    expect(seenRefs).toHaveLength(1)
    const parsed = parseDetachedSessionRef(seenRefs[0] as string)
    expect(parsed.sessionId).toMatch(/^dlg-turn-coder-[0-9a-f]{8}$/)
    expect(parsed.sandboxId).toBeUndefined()
  })

  it('never records a ref for fanout submissions (variants > 1)', async () => {
    const queue = new DelegationTaskQueue()
    const seenRefs: (string | undefined)[] = []
    const delegate: CoderDelegate = async (_args, ctx) => {
      seenRefs.push(ctx.detachedSessionRef)
      return {
        branch: 'b',
        patch: patchText,
        testResult: { passed: true, output: '' },
        typecheckResult: { passed: true, output: '' },
        diffStats: { filesChanged: 1, insertions: 1, deletions: 1 },
      }
    }
    const { taskId } = submitCoder(
      queue,
      delegate,
      { goal: 'fix', repoRoot: '/r', variants: 2 },
      {
        detachedDispatch: true,
      },
    )
    await until(() => queue.status(taskId)?.status === 'completed')
    expect(seenRefs).toEqual([undefined])
  })

  it('records no ref when detachedDispatch is off (default)', async () => {
    const queue = new DelegationTaskQueue()
    const seenRefs: (string | undefined)[] = []
    const delegate: CoderDelegate = async (_args, ctx) => {
      seenRefs.push(ctx.detachedSessionRef)
      return {
        branch: 'b',
        patch: patchText,
        testResult: { passed: true, output: '' },
        typecheckResult: { passed: true, output: '' },
        diffStats: { filesChanged: 1, insertions: 1, deletions: 1 },
      }
    }
    const { taskId } = submitCoder(queue, delegate, { goal: 'fix', repoRoot: '/r' })
    await until(() => queue.status(taskId)?.status === 'completed')
    expect(seenRefs).toEqual([undefined])
  })
})

describe('detachedSessionDelegate detached path', () => {
  it('dispatches via driveTurn, rebinds the ref with the sandbox id, and settles the output', async () => {
    const fake = fakeDriveTurnBox({
      ticks: [{ state: 'running' }, { state: 'completed', text: completedText, result: {} }],
      id: 'sandbox_77',
    })
    const executor = createSiblingSandboxExecutor({ client: fakeClient(fake.box) })
    const delegate = detachedSessionDelegate({
      executor,
      workerProfile: exactWorkerProfile,
      detachedTickIntervalMs: 1,
    })
    const rebinds: string[] = []
    const sessionId = 'dlg-turn-coder-deadbeef'
    const output = await delegate(codeArgs, {
      signal: new AbortController().signal,
      report: () => {},
      detachedSessionRef: formatDetachedSessionRef({ sessionId }),
      updateDetachedSessionRef: (ref) => rebinds.push(ref),
    })
    expect(output.branch).toBe('feat/detached')
    expect(rebinds).toEqual([`sandbox=sandbox_77;session=${sessionId}`])
    expect(fake.driveTurn.mock.calls[0]?.[1]).toMatchObject({ sessionId })
    expect(fake.delete).toHaveBeenCalledTimes(1)
  })

  it('journals the detached turn onto the record when dispatched through the queue', async () => {
    const fake = fakeDriveTurnBox({
      ticks: [{ state: 'running' }, { state: 'completed', text: completedText, result: {} }],
      id: 'sandbox_88',
    })
    const executor = createSiblingSandboxExecutor({ client: fakeClient(fake.box) })
    const delegate = detachedSessionDelegate({
      executor,
      workerProfile: exactWorkerProfile,
      detachedTickIntervalMs: 1,
    })
    const queue = new DelegationTaskQueue()
    const { taskId } = submitCoder(
      queue,
      delegate,
      { goal: 'fix', repoRoot: '/r' },
      {
        detachedDispatch: true,
      },
    )
    await until(() => queue.status(taskId)?.status === 'completed')
    const status = queue.status(taskId, { includeTrace: true })!
    expect(status.trace?.map((s) => s.kind)).toEqual(['loop', 'branch'])
    const root = status.trace!.find((s) => s.kind === 'loop')!
    expect(root.meta?.['tangle.loop.driver']).toBe('detached-turn')
    const branch = status.trace!.find((s) => s.kind === 'branch')!
    expect(branch.parentSpanId).toBe(root.spanId)
    expect(branch.meta?.['tangle.sandbox.id']).toBe('sandbox_88')
    expect(queue.history().find((e) => e.taskId === taskId)?.hasTrace).toBe(true)
  })

  it('stays on the streaming runAgentRounds path when no ref is present', async () => {
    const fake = fakeDriveTurnBox({ ticks: [{ state: 'running' }] })
    const streamPrompt = vi.fn(async function* () {
      yield {
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
      }
      yield { type: 'done', data: { outcome: { type: 'completed' } } }
    })
    const box = { ...fake.box, streamPrompt }
    const executor = createSiblingSandboxExecutor({ client: fakeClient(box) })
    const delegate = detachedSessionDelegate({ executor, workerProfile: exactWorkerProfile })
    const output = await delegate(codeArgs, {
      signal: new AbortController().signal,
      report: () => {},
    })
    expect(output.branch).toBe('feat/stream')
    expect(streamPrompt).toHaveBeenCalledTimes(1)
    expect(fake.driveTurn).not.toHaveBeenCalled()
  })
})

describe('restored-record resume end-to-end', () => {
  let dir: string
  let filePath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dlg-detached-'))
    filePath = join(dir, 'delegations.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
  })

  it('resumes a bound in-flight record through driveTurn and settles a validated coder output', async () => {
    const first = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    const { taskId } = first.submit({
      profile: 'coder',
      args: codeArgs,
      detachedSessionRef: formatDetachedSessionRef({ sessionId: 'sess-e2e' }),
      run: async (ctx) => {
        // Mirror the detached delegate: bind the sandbox id, then "crash"
        // (never resolve) so the record persists as running.
        ctx.updateDetachedSessionRef(
          formatDetachedSessionRef({ sandboxId: 'sandbox_e2e', sessionId: 'sess-e2e' }),
        )
        return new Promise<never>(() => {})
      },
    })
    await until(() => first.status(taskId)?.status === 'running')
    await first.flush()

    const fake = fakeDriveTurnBox({
      ticks: [
        { state: 'running', elapsedMs: 500 },
        { state: 'completed', text: completedText, result: {} },
      ],
      id: 'sandbox_e2e',
    })
    const resolved: string[] = []
    const second = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
      resumeDelegate: createDetachedTurnResumeDriver({
        intervalMs: 1,
        resolveSandbox: async (sandboxId) => {
          resolved.push(sandboxId)
          return fake.box as DriveTurnCapableBox
        },
        buildMessage: (record) => `resume: ${(record.args as DelegateCodeArgs).goal}`,
        settleOutput: (turn, record, ctx) =>
          settleDetachedCoderTurn(turn, {
            task: coderTaskFromArgs(record.args as DelegateCodeArgs),
            sessionId: 'sess-e2e',
            signal: ctx.signal,
          }),
      }),
    })
    expect(['running', 'completed']).toContain(second.status(taskId)?.status)
    await until(() => second.status(taskId)?.status === 'completed')
    expect(resolved.every((id) => id === 'sandbox_e2e')).toBe(true)
    const status = second.status(taskId, { includeTrace: true })
    expect(status?.result?.profile).toBe('coder')
    const output = status?.result?.output
    if (output === undefined) throw new Error('expected completed detached turn output')
    expect((output as { branch: string }).branch).toBe('feat/detached')
    expect(fake.driveTurn).toHaveBeenCalledWith('resume: fix bug', {
      sessionId: 'sess-e2e',
      turnId: 'sess-e2e',
    })
    // the resumed segment is journaled even though the original process's
    // loop events died with it
    const resumeSpan = status?.trace?.find(
      (s) => s.meta?.['tangle.loop.driver'] === 'detached-resume',
    )
    expect(resumeSpan).toBeDefined()
    expect(resumeSpan?.meta?.['tangle.loop.detached_session_ref']).toBe(
      'sandbox=sandbox_e2e;session=sess-e2e',
    )
    await second.flush()
  })

  it('persists a mid-run ref rebind so a restart resumes against the bound sandbox', async () => {
    const store = new FileDelegationStore({ filePath })
    const queue = await DelegationTaskQueue.restore({ store })
    const { taskId } = queue.submit({
      profile: 'coder',
      args: codeArgs,
      detachedSessionRef: 'session=sess-bind',
      run: async (ctx) => {
        ctx.updateDetachedSessionRef('sandbox=box-9;session=sess-bind')
        return new Promise<never>(() => {})
      },
    })
    await until(() => queue.status(taskId)?.status === 'running')
    await queue.flush()
    const persisted = await new FileDelegationStore({ filePath }).loadAll()
    expect(persisted.find((r) => r.taskId === taskId)?.detachedSessionRef).toBe(
      'sandbox=box-9;session=sess-bind',
    )
  })
})
