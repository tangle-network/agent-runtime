/**
 * The LIVE progress feed (B-1), at the two layers it is built from.
 *
 * Layer 1 — the SCOPE, which needs no executor cooperation at all: tokens, turns, and the
 * last-activity stamp are derived from the metered usage stream, so EVERY runtime becomes
 * observable mid-flight. Before this, `live.spent` was assigned once after the stream drained,
 * so a running worker read `{tokens: 0, iterations: 0}` for its entire life.
 *
 * Layer 2 — the EXECUTOR's optional enrichment, and the online detector wire: `watchTrace` folded
 * over a worker's live tool spans, raising a `finding` on the coordination bus the moment it
 * loops. That wire's own docstring described it; nothing connected it until now.
 */

import type { AgentProfile } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { createCoordinationTools } from '../../src/mcp/tools/coordination'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import { gateOnDeliverable } from '../../src/runtime/supervise/completion-gate'
import {
  type ActivityLog,
  createActivityLog,
  type ExecutorProgress,
  readWorkerProgress,
} from '../../src/runtime/supervise/progress'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createScope } from '../../src/runtime/supervise/scope'
import { createPushTraceSource } from '../../src/runtime/supervise/trace-source'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'

const budget: Budget = { maxIterations: 50, maxTokens: 100_000 }

/** A gate the test opens by hand, so "mid-flight" is a fact, not a race. */
function gate() {
  let open!: () => void
  const opened = new Promise<void>((r) => {
    open = r
  })
  return { opened, open }
}

/** A streaming leaf that emits two usage events, pausing between them so the test can read the
 *  scope's live view at a known point. It implements NO progress/deliver — the point is that the
 *  scope layer alone makes it observable. */
function pausingLeaf(name: string, pause: Promise<void>): Agent<unknown, unknown> {
  const ex: Executor<unknown> = {
    runtime: 'router',
    execute() {
      return (async function* () {
        yield { kind: 'tokens', input: 100, output: 20 } as UsageEvent
        yield { kind: 'iteration' } as UsageEvent
        await pause
        yield { kind: 'tokens', input: 50, output: 10 } as UsageEvent
        yield { kind: 'iteration' } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `w:${name}`,
      out: { done: true },
      spent: { iterations: 2, tokens: { input: 150, output: 30 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor: ex }
  return { name, act: async () => 0, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

function scopeOf(now: () => number = Date.now) {
  const journal = new InMemorySpawnJournal()
  void journal.beginTree('root', new Date(now()).toISOString())
  return createScope<unknown>({
    parentId: 'root',
    root: 'root',
    depth: 0,
    pool: createBudgetPool(budget),
    journal,
    blobs: new InMemoryResultBlobStore(),
    executors: createExecutorRegistry(),
    signal: new AbortController().signal,
    seams: {},
    now,
  })
}

describe('scope.progress — a running worker is observable without any executor cooperation', () => {
  it('reports tokens and turns spent SO FAR, not zero until settle', async () => {
    const g = gate()
    const scope = scopeOf()
    const res = scope.spawn(pausingLeaf('w', g.opened), 'go', { budget })
    expect(res.ok).toBe(true)
    if (!res.ok) return

    // Let the first two usage events land.
    await new Promise((r) => setImmediate(r))

    const mid = scope.progress(res.handle.id)
    expect(mid, 'no progress for a live worker').toBeDefined()
    expect(mid?.live).toBe(true)
    expect(mid?.status).toBe('running')
    expect(mid?.tokens).toEqual({ input: 100, output: 20 })
    expect(mid?.turns).toBe(1)
    // No inbox on this leaf, so the driver is told plainly that a steer cannot land.
    expect(mid?.steerable).toBe(false)

    g.open()
    const settled = await scope.next()
    expect(settled?.kind).toBe('done')

    const after = scope.progress(res.handle.id)
    expect(after?.live).toBe(false)
    expect(after?.tokens).toEqual({ input: 150, output: 30 })
    expect(after?.turns).toBe(2)
    // A finished worker is finished, never "stalled".
    expect(after?.stalled).toBe(false)
  })

  it('derives stall from idle time at READ time — no watchdog, nothing killed', async () => {
    const g = gate()
    let clock = 1_000
    const scope = scopeOf(() => clock)
    const res = scope.spawn(pausingLeaf('w', g.opened), 'go', { budget })
    if (!res.ok) throw new Error('spawn failed')
    await new Promise((r) => setImmediate(r))

    expect(scope.progress(res.handle.id, { stallAfterMs: 5_000 })?.stalled).toBe(false)
    // Nothing runs in between; the SAME state read later is what turns stalled true.
    clock = 1_000 + 60_000
    const stalled = scope.progress(res.handle.id, { stallAfterMs: 5_000 })
    expect(stalled?.stalled).toBe(true)
    expect(stalled?.idleMs).toBe(60_000)
    // The same read with a longer tolerance is not stalled — it is a threshold, not a verdict.
    expect(scope.progress(res.handle.id, { stallAfterMs: 120_000 })?.stalled).toBe(false)

    g.open()
    await scope.next()
  })

  it('returns undefined for an unknown worker instead of throwing at the driver', () => {
    expect(scopeOf().progress('nope')).toBeUndefined()
  })
})

// Both halves of the blind-supervisor fix, end-to-end through the deliverable gate:
//   - scope layer (BUG 2, already landed via foldStream): tokens/turns advance BEFORE settle.
//   - executor layer (BUG 1, this fix): `gateOnDeliverable` forwards `progress()`, so recentActivity
//     is non-empty AND a live tool call keeps idleMs at 0 even when no usage event has fired for
//     minutes. This is the exact scenario that produced the false-stall steer.
describe('a GATED active worker stays fully observable mid-flight (BUG 1 + BUG 2 together)', () => {
  /** A streaming worker wrapped by `gateOnDeliverable`, whose `progress()` reports a live tool log
   *  the test drives by hand — modelling a harness minutes-deep inside one tool call. */
  function gatedActiveLeaf(
    name: string,
    log: ActivityLog,
    pause: Promise<void>,
  ): Agent<unknown, unknown> {
    const inner: Executor<unknown> = {
      runtime: 'router',
      execute() {
        return (async function* () {
          yield { kind: 'tokens', input: 100, output: 20 } as UsageEvent
          yield { kind: 'iteration' } as UsageEvent
          await pause
          yield { kind: 'tokens', input: 50, output: 10 } as UsageEvent
          yield { kind: 'iteration' } as UsageEvent
        })()
      },
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact: (): ExecutorResult<unknown> => ({
        outRef: `w:${name}`,
        out: { done: true },
        spent: { iterations: 2, tokens: { input: 150, output: 30 }, usd: 0, ms: 0 },
      }),
      // The executor-only enrichment the gate must forward — a bare scope read cannot know the
      // harness's tool activity.
      progress: (): ExecutorProgress => ({ recentActivity: log.read(), note: 'running tests' }),
    }
    const gated = gateOnDeliverable(inner, { check: () => true })
    const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor: gated }
    return { name, act: async () => 0, executorSpec: spec } as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
  }

  it('reports non-zero turns/tokens AND non-empty recentActivity, and idleMs stays 0 while active', async () => {
    const g = gate()
    let clock = 1_000
    const log = createActivityLog(12)
    log.push({ at: clock, kind: 'tool', label: 'edit', detail: 'src/x.ts' })
    const scope = scopeOf(() => clock)
    const res = scope.spawn(gatedActiveLeaf('w', log, g.opened), 'go', { budget })
    expect(res.ok).toBe(true)
    if (!res.ok) return

    // First usage batch lands; the worker then parks inside its (paused) tool call.
    await new Promise((r) => setImmediate(r))

    const mid = scope.progress(res.handle.id)
    expect(mid?.live).toBe(true)
    expect(mid?.status).toBe('running')
    // Scope layer — the foldStream fix: real spend before settle, not a zeroed row.
    expect(mid?.tokens).toEqual({ input: 100, output: 20 })
    expect(mid?.turns).toBe(1)
    // Executor layer — the gate-forward fix: the harness's own activity survived the wrapper.
    expect(mid?.recentActivity?.length ?? 0).toBeGreaterThan(0)
    expect(mid?.recentActivity?.some((a) => a.label === 'edit')).toBe(true)
    expect(mid?.idleMs).toBe(0)

    // Minutes pass with NO usage event — the worker is still inside one long tool call and says so
    // through progress(). The forwarded activity beats the stale usage stamp, so idle stays 0.
    clock = 1_000 + 120_000
    log.push({ at: clock, kind: 'tool', label: 'bash', detail: 'pnpm test' })
    const deep = scope.progress(res.handle.id, { stallAfterMs: 60_000 })
    expect(deep?.idleMs).toBe(0)
    expect(deep?.stalled).toBe(false)
    expect(deep?.recentActivity?.some((a) => a.label === 'bash')).toBe(true)

    // Falsification: with the pre-fix gate `progress()` was dropped, so this note never reached the
    // fold — the scope's last usage stamp (t=1_000) would read idleMs 120_000 and stalled:true, the
    // false stall that steered the live run. Prove that counterfactual directly.
    const blind = readWorkerProgress(
      {
        id: 'w',
        status: 'running',
        steerable: false,
        startedAt: 1_000,
        lastActivityAt: 1_000,
        turns: 1,
        tokens: { input: 100, output: 20 },
        usd: 0,
      },
      undefined,
      clock,
      60_000,
    )
    expect(blind.idleMs).toBe(120_000)
    expect(blind.stalled).toBe(true)

    g.open()
    const settled = await scope.next()
    expect(settled?.kind).toBe('done')
  })
})

describe('readWorkerProgress — the fold of scope facts and executor enrichment', () => {
  const base = {
    id: 'w0',
    status: 'running' as const,
    steerable: true,
    startedAt: 0,
    lastActivityAt: 100,
    turns: 1,
    tokens: { input: 10, output: 5 },
    usd: 0.01,
  }

  it('lets a later executor activity beat the last metered event as the liveness stamp', () => {
    // A harness can spend minutes inside one tool call without emitting a token; the tool event
    // is newer evidence of life than the last usage event, so it must win.
    const p = readWorkerProgress(
      base,
      { recentActivity: [{ at: 900, kind: 'tool', label: 'bash' }] },
      1_000,
      500,
    )
    expect(p.lastActivityAt).toBe(900)
    expect(p.idleMs).toBe(100)
    expect(p.stalled).toBe(false)
  })

  it('prefers the executor turn count and surfaces unread steers', () => {
    const p = readWorkerProgress(base, { turns: 7, pendingMessages: 2 }, 200, 500)
    expect(p.turns).toBe(7)
    expect(p.pendingMessages).toBe(2)
  })

  it('reports a settled worker as not live and never stalled', () => {
    const p = readWorkerProgress({ ...base, status: 'done' }, undefined, 10_000_000, 1)
    expect(p.live).toBe(false)
    expect(p.stalled).toBe(false)
  })
})

describe('createActivityLog — bounded newest-last window', () => {
  it('keeps only the newest `limit` notes', () => {
    const log = createActivityLog(3)
    for (let i = 0; i < 10; i += 1) log.push({ at: i, kind: 'tool', label: `t${i}` })
    expect(log.read().map((n) => n.label)).toEqual(['t7', 't8', 't9'])
    expect(log.last()?.label).toBe('t9')
  })
})

describe('watchWorkers — the online detector raises a finding MID-RUN, not at settle', () => {
  it('publishes a `finding` the moment a live worker repeats the same tool call', async () => {
    const pushed = createPushTraceSource({ runId: 'w0' })
    const nodes = [{ id: 'w0', status: 'running', spent: {} }]
    const scope = {
      spawn: () => ({
        ok: true as const,
        handle: { id: 'w0', label: 'w', status: 'running' as const, abort() {} },
      }),
      next: async () => null,
      nextResolved: async () => null,
      send: () => false,
      progress: () => undefined,
      traceSource: (id: string) => (id === 'w0' ? pushed.source : undefined),
      get view() {
        return { root: 'root', nodes, inFlight: 1 }
      },
      budget: { tokensLeft: 1e9, usdLeft: 0, deadlineMs: 0, reservedTokens: 0 },
      signal: new AbortController().signal,
    } as unknown as Parameters<typeof createCoordinationTools>[0]['scope']

    const findings: unknown[] = []
    const tools = createCoordinationTools({
      scope,
      blobs: new InMemoryResultBlobStore(),
      makeWorkerAgent: () => ({ name: 'w', act: async () => 0 }),
      perWorker: budget,
      watchWorkers: { maxFindingsPerWorker: 2 },
      onEvent: (e) => {
        if (e.type === 'finding') findings.push(e.finding)
      },
    })

    const spawnTool = tools.tools.find((t) => t.name === 'spawn_agent')
    await spawnTool?.handler({ profile: {}, task: 'go' })

    // The default panel trips on the 4th identical call (maxRepeated: 3).
    for (let i = 0; i < 6; i += 1) {
      pushed.record({ toolName: 'read', args: { path: 'same.ts' }, status: 'ok' })
    }
    await new Promise((r) => setImmediate(r))

    expect(findings.length, 'no online finding was raised for a looping worker').toBeGreaterThan(0)
    const first = findings[0] as { fromWorker: string; analyst: string }
    expect(first.fromWorker).toBe('w0')
    expect(first.analyst.startsWith('online:')).toBe(true)
    // The per-worker cap stops one pathological worker from flooding the driver's inbox.
    expect(findings.length).toBeLessThanOrEqual(2)
  })

  it('is OFF by default — no watchWorkers means no online findings', async () => {
    const pushed = createPushTraceSource({ runId: 'w0' })
    const scope = {
      spawn: () => ({
        ok: true as const,
        handle: { id: 'w0', label: 'w', status: 'running' as const, abort() {} },
      }),
      next: async () => null,
      nextResolved: async () => null,
      send: () => false,
      traceSource: () => pushed.source,
      get view() {
        return { root: 'root', nodes: [{ id: 'w0', status: 'running', spent: {} }], inFlight: 1 }
      },
      budget: { tokensLeft: 1e9, usdLeft: 0, deadlineMs: 0, reservedTokens: 0 },
      signal: new AbortController().signal,
    } as unknown as Parameters<typeof createCoordinationTools>[0]['scope']

    const findings: unknown[] = []
    const tools = createCoordinationTools({
      scope,
      blobs: new InMemoryResultBlobStore(),
      makeWorkerAgent: () => ({ name: 'w', act: async () => 0 }),
      perWorker: budget,
      onEvent: (e) => {
        if (e.type === 'finding') findings.push(e.finding)
      },
    })
    await tools.tools.find((t) => t.name === 'spawn_agent')?.handler({ profile: {}, task: 'go' })
    for (let i = 0; i < 8; i += 1) {
      pushed.record({ toolName: 'read', args: { path: 'same.ts' }, status: 'ok' })
    }
    await new Promise((r) => setImmediate(r))
    expect(findings).toEqual([])
  })
})
