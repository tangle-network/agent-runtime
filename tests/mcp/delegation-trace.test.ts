import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildDelegationTraceSpans,
  capDelegationTrace,
  composeLoopTraceEmitters,
  createDelegationTraceCollector,
  type DelegationTraceSpan,
} from '../../src/mcp/delegation-trace'
import { FileDelegationStore } from '../../src/mcp/delegation-store'
import { DelegationTaskQueue } from '../../src/mcp/task-queue'
import type { DelegateCodeArgs } from '../../src/mcp/types'
import { buildLoopOtelSpans } from '../../src/otel-export'
import type { LoopTraceEvent } from '../../src/runtime/types'

const codeArgs: DelegateCodeArgs = { goal: 'fix bug', repoRoot: '/repo' }

function coderOutput() {
  return {
    branch: 'b',
    patch: 'diff',
    testResult: { passed: true, output: '' },
    typecheckResult: { passed: true, output: '' },
    diffStats: { filesChanged: 1, insertions: 1, deletions: 0 },
  }
}

function loopEvents(runId = 'run-1'): LoopTraceEvent[] {
  return [
    {
      kind: 'loop.started',
      runId,
      timestamp: 1000,
      payload: { driver: 'single-shot', agentRunNames: ['coder'], maxIterations: 1, maxConcurrency: 1 },
    },
    {
      kind: 'loop.plan',
      runId,
      timestamp: 1001,
      payload: { roundIndex: 0, plannedCount: 1, moveKind: 'refine', childIndices: [0] },
    },
    {
      kind: 'loop.iteration.started',
      runId,
      timestamp: 1002,
      payload: { iterationIndex: 0, agentRunName: 'coder', taskHash: 'h' },
    },
    {
      kind: 'loop.iteration.dispatch',
      runId,
      timestamp: 1003,
      payload: { iterationIndex: 0, agentRunName: 'coder', placement: 'sibling', sandboxId: 'sbx-1' },
    },
    {
      kind: 'loop.iteration.ended',
      runId,
      timestamp: 2000,
      payload: { iterationIndex: 0, agentRunName: 'coder', costUsd: 0.5, durationMs: 998 },
    },
    {
      kind: 'loop.decision',
      runId,
      timestamp: 2001,
      payload: { decision: 'pick-winner', historyLength: 1 },
    },
    {
      kind: 'loop.ended',
      runId,
      timestamp: 2002,
      payload: { winnerIterationIndex: 0, totalCostUsd: 0.5, durationMs: 1002, iterations: 1 },
    },
  ]
}

function span(i: number, padBytes = 0): DelegationTraceSpan {
  return {
    spanId: `span-${i}`,
    name: 'loop.iteration',
    kind: 'branch',
    startMs: i,
    endMs: i + 1,
    ...(padBytes > 0 ? { meta: { pad: 'x'.repeat(padBytes) } } : {}),
  }
}

describe('buildDelegationTraceSpans', () => {
  it('reconstructs the loop → round → branch tree with parent linkage', () => {
    const spans = buildDelegationTraceSpans(loopEvents())
    expect(spans.map((s) => s.kind).sort()).toEqual(['branch', 'loop', 'round'])

    const root = spans.find((s) => s.kind === 'loop')!
    const round = spans.find((s) => s.kind === 'round')!
    const branch = spans.find((s) => s.kind === 'branch')!
    expect(root.parentSpanId).toBeUndefined()
    expect(round.parentSpanId).toBe(root.spanId)
    expect(branch.parentSpanId).toBe(round.spanId)

    expect(root.startMs).toBe(1000)
    expect(root.endMs).toBe(2002)
    expect(branch.startMs).toBe(1002)
    expect(branch.endMs).toBe(2000)

    expect(root.meta?.['tangle.cost.usd']).toBe(0.5)
    expect(branch.meta?.['tangle.sandbox.id']).toBe('sbx-1')
    expect(round.meta?.['tangle.loop.move.kind']).toBe('refine')
  })

  it('tolerates a partial stream that never reached loop.ended', () => {
    const partial = loopEvents().slice(0, 5)
    const spans = buildDelegationTraceSpans(partial)
    const root = spans.find((s) => s.kind === 'loop')!
    // root closes at the last observed event timestamp
    expect(root.endMs).toBe(2000)
    expect(spans.find((s) => s.kind === 'branch')).toBeDefined()
  })

  it('is JSON-safe (scalars only)', () => {
    const spans = buildDelegationTraceSpans(loopEvents())
    expect(JSON.parse(JSON.stringify(spans))).toEqual(spans)
  })

  it('mirrors the OTEL span tree topology (shared builder)', () => {
    const otel = buildLoopOtelSpans(loopEvents(), 'a'.repeat(32), 'b'.repeat(16))
    const compact = buildDelegationTraceSpans(loopEvents())
    expect(otel.map((s) => s.name)).toEqual(compact.map((s) => s.name))
    // OTEL root parents under the inherited span; compact root stays unparented
    expect(otel.find((s) => s.name === 'loop')!.parentSpanId).toBe('b'.repeat(16))
  })
})

describe('capDelegationTrace', () => {
  it('keeps everything under the caps and reports truncated: false', () => {
    const spans = Array.from({ length: 10 }, (_, i) => span(i))
    const { trace, truncated } = capDelegationTrace(spans)
    expect(trace).toHaveLength(10)
    expect(truncated).toBe(false)
  })

  it('drops oldest-first past the span cap and marks truncated', () => {
    const spans = Array.from({ length: 600 }, (_, i) => span(i))
    const { trace, truncated } = capDelegationTrace(spans)
    expect(trace).toHaveLength(512)
    expect(truncated).toBe(true)
    expect(trace[0]!.spanId).toBe('span-88')
    expect(trace[trace.length - 1]!.spanId).toBe('span-599')
  })

  it('drops oldest-first past the byte cap', () => {
    const spans = Array.from({ length: 8 }, (_, i) => span(i, 1024))
    const { trace, truncated } = capDelegationTrace(spans, { maxBytes: 3 * 1024 })
    expect(truncated).toBe(true)
    expect(trace.length).toBeLessThan(8)
    expect(trace[trace.length - 1]!.spanId).toBe('span-7')
  })

  it('never caps a non-empty input to empty', () => {
    const spans = [span(0, 64 * 1024)]
    const { trace } = capDelegationTrace(spans, { maxBytes: 16 })
    expect(trace).toHaveLength(1)
  })
})

describe('createDelegationTraceCollector', () => {
  it('flushes the span tree on loop.ended', () => {
    const batches: DelegationTraceSpan[][] = []
    const collector = createDelegationTraceCollector((spans) => batches.push(spans))
    for (const event of loopEvents()) collector.emitter.emit(event)
    expect(batches).toHaveLength(1)
    expect(batches[0]!.map((s) => s.kind).sort()).toEqual(['branch', 'loop', 'round'])
  })

  it('settle drains partial runs that never ended', () => {
    const batches: DelegationTraceSpan[][] = []
    const collector = createDelegationTraceCollector((spans) => batches.push(spans))
    for (const event of loopEvents().slice(0, 5)) collector.emitter.emit(event)
    expect(batches).toHaveLength(0)
    collector.settle()
    expect(batches).toHaveLength(1)
    collector.settle()
    expect(batches).toHaveLength(1)
  })
})

describe('composeLoopTraceEmitters', () => {
  it('returns undefined when no emitter survives', () => {
    expect(composeLoopTraceEmitters(undefined, undefined)).toBeUndefined()
  })

  it('returns the single emitter unwrapped', () => {
    const emitter = { emit() {} }
    expect(composeLoopTraceEmitters(undefined, emitter)).toBe(emitter)
  })

  it('fans events into every emitter', () => {
    const a: LoopTraceEvent[] = []
    const b: LoopTraceEvent[] = []
    const fan = composeLoopTraceEmitters({ emit: (e) => void a.push(e) }, undefined, {
      emit: (e) => void b.push(e),
    })!
    const [event] = loopEvents()
    fan.emit(event!)
    expect(a).toEqual([event])
    expect(b).toEqual([event])
  })
})

describe('DelegationTaskQueue trace tee', () => {
  let dir: string | undefined

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('journals the compact span tree onto the record at loop.ended', async () => {
    const store = new (await import('../../src/mcp/delegation-store')).InMemoryDelegationStore()
    const queue = await DelegationTaskQueue.restore({ store })
    const { taskId } = queue.submit<DelegateCodeArgs>({
      profile: 'coder',
      args: codeArgs,
      run: async (ctx) => {
        for (const event of loopEvents()) await ctx.traceEmitter?.emit(event)
        return coderOutput()
      },
    })
    await new Promise((r) => setImmediate(r))
    await queue.flush()
    expect(queue.status(taskId)?.status).toBe('completed')
    const persisted = (await store.loadAll()).find((r) => r.taskId === taskId)!
    expect(persisted.trace?.map((s) => s.kind).sort()).toEqual(['branch', 'loop', 'round'])
    expect(persisted.traceTruncated).toBeUndefined()
  })

  it('settles partial buffers at the terminal transition (failed run keeps its trace)', async () => {
    const queue = new DelegationTaskQueue()
    const { taskId } = queue.submit<DelegateCodeArgs>({
      profile: 'coder',
      args: codeArgs,
      run: async (ctx) => {
        for (const event of loopEvents().slice(0, 5)) await ctx.traceEmitter?.emit(event)
        throw new Error('boom')
      },
    })
    await new Promise((r) => setImmediate(r))
    await queue.flush()
    const status = queue.status(taskId, { includeTrace: true })!
    expect(status.status).toBe('failed')
    expect(status.trace?.length).toBeGreaterThan(0)
  })

  it('round-trips the trace through FileDelegationStore JSON persistence', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dlg-trace-'))
    const filePath = join(dir, 'state.json')
    const first = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    const { taskId } = first.submit<DelegateCodeArgs>({
      profile: 'coder',
      args: codeArgs,
      run: async (ctx) => {
        for (const event of loopEvents()) await ctx.traceEmitter?.emit(event)
        return coderOutput()
      },
    })
    await new Promise((r) => setImmediate(r))
    await first.flush()

    const second = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    const status = second.status(taskId, { includeTrace: true })!
    expect(status.status).toBe('completed')
    expect(status.trace?.map((s) => s.kind).sort()).toEqual(['branch', 'loop', 'round'])
    const branch = status.trace!.find((s) => s.kind === 'branch')!
    expect(branch.meta?.['tangle.sandbox.id']).toBe('sbx-1')
  })

  it('status omits the trace unless includeTrace is passed; history reports hasTrace only', async () => {
    const queue = new DelegationTaskQueue()
    const { taskId: traced } = queue.submit<DelegateCodeArgs>({
      profile: 'coder',
      args: codeArgs,
      run: async (ctx) => {
        for (const event of loopEvents()) await ctx.traceEmitter?.emit(event)
        return coderOutput()
      },
    })
    const { taskId: untraced } = queue.submit<DelegateCodeArgs>({
      profile: 'coder',
      args: { ...codeArgs, goal: 'other goal' },
      run: async () => coderOutput(),
    })
    await new Promise((r) => setImmediate(r))
    await queue.flush()

    expect(queue.status(traced)!.trace).toBeUndefined()
    expect(queue.status(traced, { includeTrace: false })!.trace).toBeUndefined()
    expect(queue.status(traced, { includeTrace: true })!.trace?.length).toBe(3)
    expect(queue.status(untraced, { includeTrace: true })!.trace).toBeUndefined()

    const entries = queue.history()
    const tracedEntry = entries.find((e) => e.taskId === traced)!
    const untracedEntry = entries.find((e) => e.taskId === untraced)!
    expect(tracedEntry.hasTrace).toBe(true)
    expect(untracedEntry.hasTrace).toBe(false)
    expect('trace' in tracedEntry).toBe(false)
  })
})
