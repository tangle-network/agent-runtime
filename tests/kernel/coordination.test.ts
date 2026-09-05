import type { ToolSpan, TraceAnalysisStore } from '@tangle-network/agent-eval'
import { agentProfileSchema } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { createMcpServer } from '../../src/mcp/server'
import {
  type CoordinationEvent,
  canonicalFindingEvent,
  createCoordinationTools,
  deriveSpawnProfileArg,
  spawnProfileFieldNames,
} from '../../src/mcp/tools/coordination'
import type { Agent, ResultBlobStore, Scope, Spend, WorkerTraceEvidence } from '../../src/runtime'
import {
  contentAddress,
  createPushTraceSource,
  WORKER_TOOL_TRACE_SCHEMA_VERSION,
  watchTrace,
} from '../../src/runtime'

const zeroSpend = (): Spend => ({ iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 })

const noTrace = {
  status: 'unavailable',
  reason: 'executor-did-not-expose-trace-source',
} as const satisfies WorkerTraceEvidence

const toolSpan = {
  spanId: 'worker-trace-t0',
  runId: 'worker-trace',
  kind: 'tool',
  name: 'read_file',
  toolName: 'read_file',
  args: { path: 'actual.ts' },
  result: { text: 'structured tool result' },
  status: 'ok',
  startedAt: 100,
  endedAt: 105,
} as const satisfies ToolSpan
const traceArtifact = {
  schemaVersion: WORKER_TOOL_TRACE_SCHEMA_VERSION,
  spans: [toolSpan],
}
const traceRef = contentAddress(traceArtifact)
const availableTrace = {
  status: 'available',
  traceRef,
  spanCount: 1,
} as const satisfies WorkerTraceEvidence

function traceBlobStore(outputRef: string, output: unknown): ResultBlobStore {
  return {
    get: async (ref) => {
      if (ref === traceRef) return traceArtifact
      if (ref === outputRef) return output
      return undefined
    },
    put: async () => {},
  }
}

async function traceSummary(trace: TraceAnalysisStore) {
  const overview = await trace.getOverview()
  return {
    traces: overview.total_traces,
    tools: overview.tool_names,
    traceIds: overview.sample_trace_ids,
  }
}

function mockScope() {
  const sent: Array<{ id: string; msg: unknown }> = []
  const spawns: Array<{ task: unknown; opts: { budget: unknown; label: string } }> = []
  const nodes = [
    {
      id: 'w0',
      label: 'worker',
      status: 'running' as const,
      runtime: 'router',
      budget: { maxIterations: 1, maxTokens: 10 },
      identity: {
        profileDigest: `sha256:${'a'.repeat(64)}`,
        taskDigest: `sha256:${'b'.repeat(64)}`,
      },
      spent: zeroSpend(),
    },
    {
      id: 'w1',
      label: 'settled',
      status: 'done' as const,
      runtime: 'router',
      budget: { maxIterations: 1, maxTokens: 10 },
      spent: zeroSpend(),
      outRef: 'blob:w1',
      trace: noTrace,
    },
  ]
  let admit = true
  let refusal: 'budget-exhausted' | 'usd-unbudgeted' = 'budget-exhausted'
  const scope = {
    spawn: (_agent: unknown, task: unknown, opts: { budget: unknown; label: string }) => {
      spawns.push({ task, opts })
      return admit
        ? {
            ok: true as const,
            handle: { id: 'w0', label: opts.label, status: 'running' as const, abort() {} },
          }
        : { ok: false as const, reason: refusal }
    },
    next: async () => null,
    send: (id: string, msg: unknown) => {
      if (id === 'w0') {
        sent.push({ id, msg })
        return true
      }
      return false
    },
    get view() {
      return { root: 'root', nodes, inFlight: 1 }
    },
    budget: { tokensLeft: 10, usdLeft: 0, deadlineMs: 0, reservedTokens: 0 },
    signal: new AbortController().signal,
  } as unknown as Scope<unknown>
  return {
    scope,
    sent,
    spawns,
    setAdmit: (v: boolean) => (admit = v),
    setRefusal: (r: typeof refusal) => (refusal = r),
  }
}

const blobs: ResultBlobStore = { get: async () => undefined, put: async () => {} }
const makeWorkerAgent = (): Agent<unknown, unknown> => ({ name: 'w', act: async () => 0 })
const tool = (tb: ReturnType<typeof createCoordinationTools>, name: string) => {
  const t = tb.tools.find((x) => x.name === name)
  if (!t) throw new Error(`no tool ${name}`)
  return t
}

describe('coordination tools', () => {
  it('a preflight refusal is a tool result that spawns nothing and is counted in stats', async () => {
    const { scope, spawns } = mockScope()
    const seen: Array<{ name: string | undefined; label: string }> = []
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      preflightSpawn: async (profile, context) => {
        seen.push({ name: profile.name, label: context.label })
        return profile.name === 'unrouted'
          ? { cause: 'model-route', detail: 'bridge routes no backend for "pi/x/y"' }
          : undefined
      },
    })
    // Every cause is published from the first read, so a gate that has refused nothing is
    // readable as a gate that has refused nothing.
    expect(tb.stats().preflight).toEqual({
      'model-route': 0,
      'bridge-full': 0,
      'unmountable-tool': 0,
    })

    const spawn = tool(tb, 'spawn_worker')
    expect(
      await spawn.handler({
        profile: { name: 'unrouted', harness: 'pi', model: { provider: 'x', default: 'y' } },
        task: 'go',
        label: 'refused',
      }),
    ).toMatchObject({
      error: 'preflight-refused',
      cause: 'model-route',
      detail: 'bridge routes no backend for "pi/x/y"',
    })
    // Nothing reserved: `Scope.spawn` is where the pool is charged, and it was never reached.
    expect(spawns).toEqual([])
    expect(tb.stats().preflight).toMatchObject({ 'model-route': 1 })

    expect(
      await spawn.handler({
        profile: { name: 'routed', harness: 'pi', model: { provider: 'x', default: 'y' } },
        task: 'go',
        label: 'admitted',
      }),
    ).toMatchObject({ workerId: 'w0' })
    expect(spawns).toHaveLength(1)
    expect(tb.stats().preflight).toMatchObject({ 'model-route': 1 })
    expect(seen).toEqual([
      { name: 'unrouted', label: 'refused' },
      { name: 'routed', label: 'admitted' },
    ])
  })

  it('publishes no preflight ledger when no gate is installed', () => {
    const { scope } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    expect(tb.stats().preflight).toBeUndefined()
  })

  it('exposes direct submission only with an injected check and retains the first passing result', async () => {
    const { scope } = mockScope()
    const withoutCheck = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    expect(withoutCheck.tools.map((t) => t.name)).not.toContain('submit_result')

    const checked: unknown[] = []
    const stopReasons: Array<string | undefined> = []
    const events: CoordinationEvent[] = []
    const withCheck = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      onStop: (reason) => stopReasons.push(reason),
      onEvent: (event) => events.push(event),
      deliverable: {
        describe: 'an object whose answer is 42',
        check(result) {
          checked.push(result)
          const answer = (result as { answer?: unknown }).answer
          if (answer === 'throw') throw new Error('check broke')
          return answer === 42
        },
      },
    })
    const submit = tool(withCheck, 'submit_result')

    // A failed check and a THROWN check are both refusals, and each names which one it was.
    expect(await submit.handler({ result: { answer: 0 } })).toEqual({
      accepted: false,
      stop: false,
      reason:
        'the independent check did not pass on this result. Expected: an object whose answer is 42',
    })
    expect(await submit.handler({ result: { answer: 'throw' } })).toMatchObject({
      accepted: false,
      stop: false,
      reason: expect.stringContaining('the independent check THREW'),
    })
    expect(withCheck.isStopped()).toBe(false)
    expect(withCheck.submittedResult()).toBeUndefined()

    const passing = { answer: 42 }
    expect(await submit.handler({ result: passing })).toEqual({
      accepted: true,
      retained: 'this-result',
      stop: true,
    })
    passing.answer = 0
    expect(withCheck.submittedResult()).toEqual({ result: { answer: 42 } })
    expect(withCheck.isStopped()).toBe(true)
    expect(withCheck.stopReason()).toBe('result-accepted')

    expect(await submit.handler({ result: { answer: 43 } })).toEqual({
      accepted: true,
      retained: 'earlier-passing-result',
      stop: true,
    })
    expect(await tool(withCheck, 'stop').handler({ reason: 'redundant-stop' })).toEqual({
      stopped: true,
    })
    expect(checked).toHaveLength(3)
    expect(stopReasons).toEqual(['result-accepted'])
    expect(withCheck.submittedResult()).toEqual({ result: { answer: 42 } })
    expect(events).toEqual([{ type: 'submission', result: { answer: 42 } }])
  })

  it('commits one passing submission when concurrent callers race the durable append', async () => {
    const { scope } = mockScope()
    const events: CoordinationEvent[] = []
    let appendStarted!: () => void
    const appending = new Promise<void>((resolve) => {
      appendStarted = resolve
    })
    let releaseAppend!: () => void
    const appendReleased = new Promise<void>((resolve) => {
      releaseAppend = resolve
    })
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      onEvent: async (event) => {
        events.push(event)
        appendStarted()
        await appendReleased
      },
      deliverable: { check: () => true },
    })
    const submit = tool(tb, 'submit_result')

    const first = submit.handler({ result: { winner: 'first' } })
    await appending
    const second = submit.handler({ result: { winner: 'second' } })
    releaseAppend()

    await expect(first).resolves.toEqual({ accepted: true, retained: 'this-result', stop: true })
    await expect(second).resolves.toEqual({
      accepted: true,
      retained: 'earlier-passing-result',
      stop: true,
    })
    expect(events).toEqual([{ type: 'submission', result: { winner: 'first' } }])
    expect(tb.submittedResult()).toEqual({ result: { winner: 'first' } })
  })

  it('spawn_worker returns workerId and fails closed when admission fails', async () => {
    const { scope, setAdmit } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    // No `maxLiveWorkers` cap ⇒ `freeSlots: null` (uncapped; the conserved pool is the fence).
    expect(await tool(tb, 'spawn_worker').handler({ profile: {}, task: 'go' })).toEqual({
      workerId: 'w0',
      assignmentId: 'ordinal:0',
      continuity: 'fresh',
      live: 1,
      freeSlots: null,
    })
    setAdmit(false)
    expect(await tool(tb, 'spawn_worker').handler({ profile: {}, task: 'go' })).toEqual({
      error: 'budget-exhausted',
      reason:
        'the conserved pool refused this spawn (budget-exhausted); the run has no allocation left to give this worker',
      live: 1,
      freeSlots: null,
    })
  })

  it('continues unkeyed assignment identity past the highest durable resume ordinal', async () => {
    const { scope } = mockScope()
    Object.defineProperty(scope, 'resume', {
      value: {
        settled: [],
        view: {
          root: 'root',
          nodes: [
            {
              id: 'prior-0',
              parent: 'root',
              label: 'prior 0',
              status: 'done',
              runtime: 'router',
              budget: { maxIterations: 1, maxTokens: 10 },
              assignmentId: 'ordinal:0',
              spent: zeroSpend(),
            },
            {
              id: 'prior-3',
              parent: 'root',
              label: 'prior 3',
              status: 'done',
              runtime: 'router',
              budget: { maxIterations: 1, maxTokens: 10 },
              assignmentId: 'ordinal:3',
              spent: zeroSpend(),
            },
            {
              id: 'prior-keyed',
              parent: 'root',
              label: 'prior keyed',
              status: 'done',
              runtime: 'router',
              budget: { maxIterations: 1, maxTokens: 10 },
              assignmentId: 'key:control',
              spent: zeroSpend(),
            },
          ],
          inFlight: 0,
          waiting: 0,
        },
        waits: [],
        keys: new Map(),
        priorSpend: { childWork: zeroSpend(), driverInference: zeroSpend() },
      },
    })
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })

    expect(await tool(tb, 'spawn_worker').handler({ profile: {}, task: 'new work' })).toMatchObject(
      {
        workerId: 'w0',
        assignmentId: 'ordinal:4',
      },
    )
  })

  it('spawn_worker fails closed at the maxLiveWorkers cap WITHOUT touching the pool', async () => {
    // A scope whose live (non-terminal) node set is driven by the spawns we make: each successful
    // spawn appends a `running` node; nothing settles. The conserved pool always admits, so the
    // ONLY thing that can stop a spawn here is the concurrency cap.
    const live: Array<{ status: string }> = []
    const spawns: unknown[] = []
    const cappedScope = {
      spawn: (_a: unknown, _t: unknown, opts: { label: string }) => {
        spawns.push(opts)
        live.push({ status: 'running' })
        return {
          ok: true as const,
          handle: {
            id: `w${live.length - 1}`,
            label: opts.label,
            status: 'running' as const,
            abort() {},
          },
        }
      },
      next: async () => null,
      send: () => false,
      get view() {
        return { root: 'root', nodes: live, inFlight: live.length }
      },
      budget: { tokensLeft: 1e9, usdLeft: 0, deadlineMs: 0, reservedTokens: 0 },
      signal: new AbortController().signal,
    } as unknown as Scope<unknown>

    const tb = createCoordinationTools({
      scope: cappedScope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      maxLiveWorkers: 2,
    })
    const spawn = () => tool(tb, 'spawn_worker').handler({ profile: {}, task: 'go' })
    // `freeSlots` counts down as the cap fills — the reading that tells the driver capacity is
    // still idle, so it can fill slots instead of opening one worker per turn.
    expect(await spawn()).toEqual({
      workerId: 'w0',
      assignmentId: 'ordinal:0',
      continuity: 'fresh',
      live: 1,
      freeSlots: 1,
    })
    expect(await spawn()).toEqual({
      workerId: 'w1',
      assignmentId: 'ordinal:1',
      continuity: 'fresh',
      live: 2,
      freeSlots: 0,
    })
    // The 2 live workers fill the cap → the 3rd fails closed BEFORE scope.spawn is called.
    expect(await spawn()).toEqual({
      error: 'max-live-workers',
      reason:
        "2 workers are already live, which is this manager's ceiling — await_event until one settles, then spawn",
      live: 2,
      freeSlots: 0,
    })
    expect(spawns).toHaveLength(2)
    // A settled worker frees a slot — mark one terminal and the next spawn admits again.
    live[0]!.status = 'done'
    expect(await spawn()).toEqual({
      workerId: 'w2',
      assignmentId: 'ordinal:2',
      continuity: 'fresh',
      live: 2,
      freeSlots: 0,
    })

    // No cap (omitted) → the pool stays the only fence; the same scope admits past the prior cap.
    const uncapped = createCoordinationTools({
      scope: cappedScope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    expect(await tool(uncapped, 'spawn_worker').handler({ profile: {}, task: 'go' })).toEqual({
      workerId: 'w3',
      assignmentId: 'ordinal:0',
      continuity: 'fresh',
      live: 3,
      freeSlots: null,
    })
  })

  it('a key already delivered in THIS run resolves at the cap — it starts no worker', async () => {
    // The fence bounds SIMULTANEOUS work. A keyed spawn whose key already delivered starts nothing
    // and occupies no slot, so holding it behind the cap would contradict the verb's own contract
    // ("a key that already completed returns the finished result — nothing is spent").
    const live: Array<{ id: string; status: string }> = []
    const settled = {
      kind: 'done' as const,
      handle: { id: 'w0', label: 'a', status: 'done' as const, abort() {} },
      out: 'A',
      outRef: 'blob:a',
      verdict: { score: 1, valid: true },
      spent: zeroSpend(),
      trace: noTrace,
      seq: 0,
    }
    let deliveredKey: string | undefined
    let pending: typeof settled | undefined
    const scope = {
      spawn: (_a: unknown, _t: unknown, opts: { label: string; key?: string }) => {
        // Mirrors the real scope: a key that already settled `done` resolves to it, spawning nothing.
        if (opts.key !== undefined && opts.key === deliveredKey) {
          return {
            ok: true as const,
            handle: settled.handle,
            prior: { state: 'completed' as const, settled },
          }
        }
        live.push({ id: `w${live.length}`, status: 'running' })
        return {
          ok: true as const,
          handle: {
            id: `w${live.length - 1}`,
            label: opts.label,
            status: 'running' as const,
            abort() {},
          },
        }
      },
      next: async () => {
        const s = pending
        pending = undefined
        return s ?? null
      },
      send: () => false,
      get view() {
        return { root: 'root', nodes: live, inFlight: live.length }
      },
      budget: { tokensLeft: 1e9, usdLeft: 0, deadlineMs: 0, reservedTokens: 0 },
      signal: new AbortController().signal,
    } as unknown as Scope<unknown>

    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      maxLiveWorkers: 1,
    })
    const spawnKeyed = (key: string) =>
      tool(tb, 'spawn_worker').handler({ profile: {}, task: 'go', key })

    // Key 'a' runs and takes the only slot, then delivers.
    expect(await spawnKeyed('a')).toEqual({
      workerId: 'w0',
      assignmentId: 'key:a',
      continuity: 'fresh',
      live: 1,
      freeSlots: 0,
    })
    live[0]!.status = 'done'
    deliveredKey = 'a'
    // Drain the settlement the way the driver does — this is what teaches the toolbox that key
    // 'a' is complete.
    pending = settled
    await tool(tb, 'await_event').handler({ kinds: ['settled'] })

    // A different assignment now occupies the single slot.
    expect(await spawnKeyed('b')).toEqual({
      workerId: 'w1',
      assignmentId: 'key:b',
      continuity: 'fresh',
      live: 1,
      freeSlots: 0,
    })

    // Re-asking for the DELIVERED key at the cap must return its committed result, not a refusal.
    expect(await spawnKeyed('a')).toEqual({
      workerId: 'w0',
      resumed: 'completed',
      status: 'done',
      score: 1,
      valid: true,
      outRef: 'blob:a',
      spent: zeroSpend(),
      trace: noTrace,
      live: 1,
      freeSlots: 0,
    })
    // An unrelated new assignment is still correctly fenced.
    expect(await spawnKeyed('c')).toEqual({
      error: 'max-live-workers',
      reason:
        "1 worker is already live, which is this manager's ceiling — await_event until one settles, then spawn",
      live: 1,
      freeSlots: 0,
    })
  })

  it('spawn_worker reserves the per-worker default when no budget is given', async () => {
    const { scope, spawns } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 2, maxTokens: 100 },
    })
    await tool(tb, 'spawn_worker').handler({ profile: {}, task: 'go' })
    expect(spawns).toHaveLength(1)
    expect(spawns[0].opts.budget).toEqual({ maxIterations: 2, maxTokens: 100 })
  })

  it('spawn_worker honors a per-spawn budget, merged per-field over the default', async () => {
    const { scope, spawns } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 2, maxTokens: 100 },
    })
    // Only raise maxTokens + add a usd ceiling; maxIterations falls through from the default.
    expect(
      await tool(tb, 'spawn_worker').handler({
        profile: {},
        task: 'hard',
        budget: { maxTokens: 5000, maxUsd: 0.5 },
      }),
    ).toEqual({
      workerId: 'w0',
      assignmentId: 'ordinal:0',
      continuity: 'fresh',
      live: 1,
      freeSlots: null,
    })
    expect(spawns[0].opts.budget).toEqual({ maxIterations: 2, maxTokens: 5000, maxUsd: 0.5 })
  })

  it('spawn_worker fails loud on a malformed per-spawn budget (never silently uses the default)', async () => {
    const { scope } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 2, maxTokens: 100 },
    })
    await expect(
      tool(tb, 'spawn_worker').handler({ profile: {}, task: 'go', budget: 'lots' }),
    ).rejects.toThrow(/"budget" must be an object/)
    await expect(
      tool(tb, 'spawn_worker').handler({
        profile: {},
        task: 'go',
        budget: { maxTokens: Number.POSITIVE_INFINITY },
      }),
    ).rejects.toThrow(/"budget.maxTokens" must be a finite number/)
  })

  it('observe_agent returns live status and settled output', async () => {
    const { scope } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs: {
        get: async (ref) => (ref === 'blob:w1' ? { answer: 42 } : undefined),
        put: async () => {},
      },
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    expect(await tool(tb, 'observe_agent').handler({ workerId: 'w0' })).toMatchObject({
      status: 'running',
      output: null,
    })
    expect(await tool(tb, 'observe_agent').handler({ workerId: 'w1' })).toMatchObject({
      status: 'done',
      outRef: 'blob:w1',
      output: { answer: 42 },
    })
    expect(await tool(tb, 'observe_agent').handler({ workerId: 'nope' })).toEqual({
      error: 'unknown-worker',
      reason:
        'no worker of this manager has the id "nope"; spawn_worker returns the ids you may observe',
    })
  })

  it('steer_agent delivers through Scope.send', async () => {
    const { scope, sent } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    // The reply carries the worker's live `progress` alongside `delivered` (null for a scope
    // that exposes no progress read, as this hand-rolled mock does).
    expect(
      await tool(tb, 'steer_agent').handler({ workerId: 'w0', instruction: 'do X next' }),
    ).toEqual({ delivered: true, progress: null })
    expect(sent).toEqual([{ id: 'w0', msg: { steer: 'do X next', interrupt: false } }])
    // A failed delivery now says WHY, so the driver can tell "already finished" from
    // "this runtime has no inbox at all" instead of seeing a bare false.
    expect(await tool(tb, 'steer_agent').handler({ workerId: 'gone', instruction: 'x' })).toEqual({
      delivered: false,
      outcome: 'unknown-worker',
      reason: 'no worker of this manager has that id — check observe_agent for the live ids',
      progress: null,
    })
  })

  it('await_event(settled) drains settlements into the driver ledger', async () => {
    const { scope } = mockScope()
    const settlements = [
      {
        kind: 'done' as const,
        handle: { id: 'w7', label: 'w', status: 'done' as const, abort() {} },
        out: { answer: 42 },
        outRef: 'blob:w7',
        verdict: { valid: true, score: 0.83 },
        spent: zeroSpend(),
        trace: noTrace,
        seq: 0,
      },
    ]
    const drainScope = {
      ...scope,
      next: () => Promise.resolve(settlements.shift() ?? null),
    } as typeof scope
    const tb = createCoordinationTools({
      scope: drainScope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    // Every reply carries `freeSlots` — a settlement is exactly when capacity frees up, so the
    // reading travels with the event that freed it (`null` here: no cap configured).
    expect(await tool(tb, 'await_event').handler({ kinds: ['settled'] })).toEqual({
      type: 'settled',
      settled: 'w7',
      status: 'done',
      score: 0.83,
      valid: true,
      outRef: 'blob:w7',
      spent: zeroSpend(),
      trace: noTrace,
      freeSlots: null,
    })
    expect(await tool(tb, 'await_event').handler({ kinds: ['settled'] })).toEqual({
      idle: true,
      freeSlots: null,
    })
    expect(tb.settled()).toMatchObject([
      { id: 'w7', status: 'done', score: 0.83, valid: true, outRef: 'blob:w7' },
    ])
    // This hand-rolled scope supplied no durable terminal timestamp. Missing stays missing; the
    // coordination layer never invents a read-time value that would change on replay.
    expect(tb.settled()[0]?.settledAt).toBeUndefined()
  })

  it('await_event bounds the block: { pending, live } while a worker runs, then pulls the settlement once it lands', async () => {
    const { scope } = mockScope()
    // A cursor that stays blocked until we release it — models a live worker mid-run, the case where
    // the unbounded await outlived the MCP request timeout and surfaced as a hard tool error.
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    let settlement: unknown = null
    const blockingScope = {
      ...scope,
      next: async () => {
        await gate
        const s = settlement
        settlement = null
        return s
      },
    } as typeof scope
    const tb = createCoordinationTools({
      scope: blockingScope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      awaitTimeoutMs: 30,
    })

    // The drain is still blocked → the bounded wait returns a re-pollable liveness snapshot, never a
    // hang and never an error. `live` names the worker(s) still in flight (w0 is running in the mock).
    const pending = (await tool(tb, 'await_event').handler({ kinds: ['settled'] })) as {
      pending?: boolean
      live?: Array<{ id: string }>
    }
    expect(pending.pending).toBe(true)
    expect(pending.live?.map((w) => w.id)).toContain('w0')

    // The worker settles after the bound. The SAME in-flight drain publishes it to the bus, so a
    // later await_event pulls it — a settlement that lands after the fence is not lost.
    settlement = {
      kind: 'done' as const,
      handle: { id: 'w0', label: 'w', status: 'done' as const, abort() {} },
      out: { answer: 1 },
      outRef: 'blob:w0',
      verdict: { valid: true, score: 0.5 },
      spent: zeroSpend(),
      trace: noTrace,
      seq: 0,
    }
    release()
    let got: { type?: string; settled?: string; status?: string } = {}
    for (let i = 0; i < 50; i++) {
      got = (await tool(tb, 'await_event').handler({ kinds: ['settled'] })) as typeof got
      if (got.type === 'settled') break
    }
    expect(got).toMatchObject({ type: 'settled', settled: 'w0', status: 'done' })
  })

  it('blocks stop under failClosed until a parent question is answered', async () => {
    const { scope } = mockScope()
    const emitted: CoordinationEvent[] = []
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      questionPolicy: 'failClosed',
      onEvent: (event) => emitted.push(event),
    })

    const r = (await tool(tb, 'ask_parent').handler({
      from: 'w0',
      level: 'driver',
      question: 'Which API version should this migration target?',
      reason: 'worker found two supported versions',
      urgency: 'blocks-run',
    })) as { question: { id: string } }
    expect(await tool(tb, 'stop').handler({ reason: 'done' })).toMatchObject({
      stopped: false,
      error: 'unresolved-blocking-questions',
    })
    // The asker is a live worker, so accepted delivery resolves the blocking question.
    expect(
      await tool(tb, 'answer_question').handler({
        questionId: r.question.id,
        answer: 'Target v2.',
        by: 'user',
      }),
    ).toMatchObject({ question: { status: 'answered' }, delivered: true })
    expect(await tool(tb, 'stop').handler({ reason: 'answered and verified' })).toEqual({
      stopped: true,
    })
    expect(tb.questions()[0]).toMatchObject({ status: 'answered' })
    // The exact answer is committed before it is routed down.
    expect(emitted).toMatchObject([
      { type: 'question', question: expect.objectContaining(r.question) },
      // ask_parent also records what became of the escalation. This manager has no parent, so the
      // artifact says so — the question is the manager's own to decide.
      {
        type: 'escalation',
        escalation: expect.objectContaining({ questionId: r.question.id, delivered: false }),
      },
      {
        type: 'instruction',
        instruction: expect.objectContaining({
          kind: 'answer',
          toWorker: 'w0',
          instruction: 'Target v2.',
          questionId: r.question.id,
        }),
      },
      {
        type: 'delivery-attempt',
        attempt: expect.objectContaining({
          kind: 'answer',
          toWorker: 'w0',
          questionId: r.question.id,
        }),
      },
      {
        type: 'answer',
        questionId: r.question.id,
        down: expect.objectContaining({
          toWorker: 'w0',
          instruction: 'Target v2.',
          delivered: true,
          outcome: 'delivered',
        }),
      },
    ])
    const receipt = emitted[2]
    const attempt = emitted[3]
    const outcome = emitted[4]
    if (
      receipt?.type !== 'instruction' ||
      attempt?.type !== 'delivery-attempt' ||
      outcome?.type !== 'answer'
    ) {
      throw new Error('expected authorization, attempt, and answer outcome evidence')
    }
    expect(attempt.attempt.receiptId).toBe(receipt.instruction.receiptId)
    expect(outcome.down.receiptId).toBe(receipt.instruction.receiptId)
    expect(outcome.down.instructionDigest).toBe(receipt.instruction.instructionDigest)
  })

  it('keeps a blocking question open when its authorized answer cannot reach the worker', async () => {
    const { scope } = mockScope()
    const emitted: CoordinationEvent[] = []
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      questionPolicy: 'failClosed',
      onEvent: (event) => emitted.push(event),
    })
    const raised = (await tool(tb, 'ask_parent').handler({
      from: 'missing-worker',
      level: 'worker',
      question: 'Which target?',
      reason: 'blocked on a choice',
      urgency: 'blocks-run',
    })) as { question: { id: string } }

    const answer = await tool(tb, 'answer_question').handler({
      questionId: raised.question.id,
      answer: 'Target B',
    })
    expect(answer).toMatchObject({
      question: { id: raised.question.id, status: (raised.question as { status: string }).status },
      delivered: false,
      // The answer path names its unmet condition the same way steer_agent does: the machine code
      // on `outcome`, the sentence on `reason`.
      outcome: 'unknown-worker',
      reason: 'no worker of this manager has that id — check observe_agent for the live ids',
    })
    expect(tb.questions()).toMatchObject([
      { id: raised.question.id, status: (raised.question as { status: string }).status },
    ])
    expect(await tool(tb, 'stop').handler({ reason: 'cannot claim done' })).toMatchObject({
      stopped: false,
      error: 'unresolved-blocking-questions',
    })
    const outcome = emitted.find((event) => event.type === 'answer')
    expect(outcome?.down).toMatchObject({ delivered: false, outcome: 'unknown-worker' })
  })

  it('list_analysts surfaces the menu and run_analyst applies a lens to a settled worker', async () => {
    const { scope } = mockScope()
    Object.assign(scope.view.nodes.find((node) => node.id === 'w1')!, { trace: availableTrace })
    const traceBlobs = traceBlobStore('blob:w1', {
      messages: ['WORKER PROSE THAT MUST NEVER REACH A TRACE ANALYST'],
    })
    const seen: Array<{ kind: string; trace: Awaited<ReturnType<typeof traceSummary>> }> = []
    const tb = createCoordinationTools({
      scope,
      blobs: traceBlobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      analysts: {
        kinds: [{ id: 'completeness', description: 'unfinished work', area: 'failure-mode' }],
        run: async (kind, trace) => {
          seen.push({ kind, trace: await traceSummary(trace) })
          return [{ claim: 'X missing' }]
        },
      },
    })
    expect(await tool(tb, 'list_analysts').handler({})).toEqual({
      analysts: [{ id: 'completeness', description: 'unfinished work', area: 'failure-mode' }],
    })
    expect(await tool(tb, 'run_analyst').handler({ kind: 'completeness', workerId: 'w1' })).toEqual(
      {
        findings: [{ claim: 'X missing' }],
      },
    )
    expect(seen).toEqual([
      {
        kind: 'completeness',
        trace: { traces: 1, tools: ['read_file'], traceIds: ['worker-trace'] },
      },
    ])
    expect(await tool(tb, 'run_analyst').handler({ kind: 'completeness', workerId: 'w0' })).toEqual(
      {
        error: 'worker-not-settled',
        reason: expect.stringContaining('has not settled'),
      },
    )
  })

  it('refuses trace analysis when a settled worker has no structured tool spans', async () => {
    const { scope } = mockScope()
    let analystCalls = 0
    const tb = createCoordinationTools({
      scope,
      blobs: traceBlobStore('blob:w1', {
        messages: ['plausible-looking worker prose is still not tool evidence'],
      }),
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      analysts: {
        kinds: [{ id: 'completeness', description: 'unfinished work', area: 'failure-mode' }],
        run: async () => {
          analystCalls += 1
          return []
        },
      },
    })

    await expect(
      tool(tb, 'run_analyst').handler({ kind: 'completeness', workerId: 'w1' }),
    ).resolves.toEqual({
      error: 'trace-unreadable',
      reason: expect.stringContaining('trace evidence is missing'),
      trace: noTrace,
    })
    expect(analystCalls).toBe(0)
  })

  it('await_event bumps a blocking question ahead of a non-blocking one (urgency→priority)', async () => {
    const { scope } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    // A low-urgency question is raised first...
    await tool(tb, 'ask_parent').handler({
      from: 'w-a',
      level: 'worker',
      question: 'nice-to-know?',
      reason: 'minor',
      urgency: 'continue-without',
    })
    // ...then a blocking one. It arrives later but must be pulled FIRST.
    await tool(tb, 'ask_parent').handler({
      from: 'w-b',
      level: 'driver',
      question: 'which API version?',
      reason: 'blocks the run',
      urgency: 'blocks-run',
    })
    expect(await tool(tb, 'await_event').handler({ kinds: ['question'] })).toMatchObject({
      type: 'question',
      question: { question: 'which API version?', urgency: 'blocks-run' },
    })
    expect(await tool(tb, 'await_event').handler({ kinds: ['question'] })).toMatchObject({
      type: 'question',
      question: { question: 'nice-to-know?' },
    })
    // The history audit trail recorded both, in publish order, with the bumped priority stamped.
    // Each ask_parent also writes its escalation outcome (record-only, priority 0).
    expect(
      tb
        .history()
        .filter((r) => r.event.type === 'question')
        .map((r) => r.priority),
    ).toEqual([0, 20])
    expect(tb.stats()).toMatchObject({
      pulled: 2,
      byKind: { question: 2, escalation: 2 },
    })
  })

  it('steer_agent routes down + records in history but is never pulled back', async () => {
    const { scope, sent } = mockScope()
    const emitted: CoordinationEvent[] = []
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      onEvent: (e) => emitted.push(e),
    })
    expect(
      await tool(tb, 'steer_agent').handler({
        workerId: 'w0',
        instruction: 'do X',
        interrupt: true,
      }),
    ).toEqual({ delivered: true, progress: null })
    // A steer to a worker with no live inbox reports delivered:false, and says why.
    expect(await tool(tb, 'steer_agent').handler({ workerId: 'gone', instruction: 'x' })).toEqual({
      delivered: false,
      outcome: 'unknown-worker',
      reason: 'no worker of this manager has that id — check observe_agent for the live ids',
      progress: null,
    })
    // The forceful steer reached the child inbox (down delivery)...
    expect(sent).toEqual([{ id: 'w0', msg: { steer: 'do X', interrupt: true } }])
    // ...and both attempts were recorded for observability (pass-through + history)...
    expect(emitted.map((e) => e.type)).toEqual([
      'instruction',
      'delivery-attempt',
      'steer',
      'instruction',
      'delivery-attempt',
      'steer',
    ])
    expect(tb.history().map((r) => r.event.type)).toEqual([
      'instruction',
      'delivery-attempt',
      'steer',
      'instruction',
      'delivery-attempt',
      'steer',
    ])
    const [
      acceptedReceipt,
      acceptedAttempt,
      acceptedOutcome,
      refusedReceipt,
      refusedAttempt,
      refusedOutcome,
    ] = emitted
    if (
      acceptedReceipt?.type !== 'instruction' ||
      acceptedAttempt?.type !== 'delivery-attempt' ||
      acceptedOutcome?.type !== 'steer' ||
      refusedReceipt?.type !== 'instruction' ||
      refusedAttempt?.type !== 'delivery-attempt' ||
      refusedOutcome?.type !== 'steer'
    ) {
      throw new Error('expected two complete delivery evidence chains')
    }
    expect(acceptedAttempt.attempt.receiptId).toBe(acceptedReceipt.instruction.receiptId)
    expect(acceptedOutcome.down).toMatchObject({
      receiptId: acceptedReceipt.instruction.receiptId,
      outcome: 'delivered',
      delivered: true,
    })
    expect(refusedAttempt.attempt.receiptId).toBe(refusedReceipt.instruction.receiptId)
    expect(refusedOutcome.down).toMatchObject({
      receiptId: refusedReceipt.instruction.receiptId,
      outcome: 'unknown-worker',
      delivered: false,
    })
    // ...but the parent never pulls its own outbound messages back.
    expect(await tool(tb, 'await_event').handler({})).toEqual({ idle: true, freeSlots: null })
  })

  it('authorizes and commits the exact continuation before delivery', async () => {
    const { scope } = mockScope()
    const steps: string[] = []
    const mutable = scope as unknown as {
      send(id: string, message: unknown): boolean
    }
    mutable.send = (_id, message) => {
      steps.push(`send:${JSON.stringify(message)}`)
      return true
    }
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      authorizeDownMessage(input) {
        steps.push(`authorize:${input.instruction}`)
        expect(Object.isFrozen(input)).toBe(true)
        expect(Object.isFrozen(input.workerIdentity)).toBe(true)
        return { instruction: 'AUTHORIZED CONTINUATION' }
      },
      onEvent(event) {
        if (event.type === 'instruction') steps.push(`commit:${event.instruction.instruction}`)
        if (event.type === 'delivery-attempt') steps.push(`attempt:${event.attempt.kind}`)
        if (event.type === 'steer') steps.push(`outcome:${event.down.outcome}`)
      },
    })

    await tool(tb, 'steer_agent').handler({ workerId: 'w0', instruction: 'authored text' })

    expect(steps).toEqual([
      'authorize:authored text',
      'commit:AUTHORIZED CONTINUATION',
      'attempt:steer',
      'send:{"steer":"AUTHORIZED CONTINUATION","interrupt":false}',
      'outcome:delivered',
    ])
    expect(tb.history()[0]?.event).toMatchObject({
      type: 'instruction',
      instruction: {
        kind: 'steer',
        toWorker: 'w0',
        instruction: 'AUTHORIZED CONTINUATION',
        workerIdentity: {
          profileDigest: `sha256:${'a'.repeat(64)}`,
          taskDigest: `sha256:${'b'.repeat(64)}`,
        },
      },
    })
  })

  it('answer_question routes the answer down to a LIVE worker and surfaces delivered:true', async () => {
    const { scope, sent } = mockScope()
    const emitted: CoordinationEvent[] = []
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      onEvent: (e) => emitted.push(e),
    })
    // The question originates from the live worker w0, so the answer routes back to its inbox.
    const r = (await tool(tb, 'ask_parent').handler({
      from: 'w0',
      level: 'worker',
      question: 'which path?',
      reason: 'ambiguous',
      urgency: 'blocks-step',
    })) as { question: { id: string } }
    expect(
      await tool(tb, 'answer_question').handler({ questionId: r.question.id, answer: 'path B' }),
    ).toEqual({
      question: expect.objectContaining({ id: r.question.id, status: 'answered' }),
      delivered: true,
    })
    // The answer reached w0's inbox shaped { answer, questionId }...
    // The question was blocks-step, so the answer is delivered FORCEFULLY to unpark the worker now.
    expect(sent).toEqual([
      { id: 'w0', msg: { answer: 'path B', questionId: r.question.id, interrupt: true } },
    ])
    // ...and the committed exact instruction sits between question-up and answer-down.
    expect(emitted.map((e) => e.type)).toEqual([
      'question',
      'escalation',
      'instruction',
      'delivery-attempt',
      'answer',
    ])
  })

  it('analyze-on-settle auto-runs lenses and await_event surfaces settled + finding', async () => {
    const { scope } = mockScope()
    const settlements = [
      {
        kind: 'done' as const,
        handle: { id: 'w7', label: 'w', status: 'done' as const, abort() {} },
        out: { diff: '...' },
        outRef: 'blob:w7',
        verdict: { valid: false, score: 0.1 },
        spent: zeroSpend(),
        trace: availableTrace,
        seq: 0,
      },
    ]
    const drainScope = {
      ...scope,
      next: () => Promise.resolve(settlements.shift() ?? null),
    } as typeof scope
    const emitted: string[] = []
    const tb = createCoordinationTools({
      scope: drainScope,
      blobs: traceBlobStore('blob:w7', {
        messages: ['worker final prose must not be analyzed as a trace'],
      }),
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      analysts: {
        kinds: [{ id: 'completeness', description: 'unfinished work', area: 'failure-mode' }],
        run: async (_kind, trace) => {
          expect(await traceSummary(trace)).toEqual({
            traces: 1,
            tools: ['read_file'],
            traceIds: ['worker-trace'],
          })
          return [{ claim: 'stub left in place' }]
        },
      },
      analyzeOnSettle: ['completeness'],
      onEvent: (e) => emitted.push(e.type),
    })

    // First pull drains the cursor: returns the settled worker; its analyst fires as a side effect.
    expect(await tool(tb, 'await_event').handler({})).toEqual({
      type: 'settled',
      settled: 'w7',
      status: 'done',
      score: 0.1,
      valid: false,
      outRef: 'blob:w7',
      spent: zeroSpend(),
      trace: availableTrace,
      freeSlots: null,
    })
    // The analyze-on-settle finding is now queued; the next pull surfaces it.
    expect(await tool(tb, 'await_event').handler({})).toEqual({
      type: 'finding',
      fromWorker: 'w7',
      analyst: 'completeness',
      findings: [{ claim: 'stub left in place' }],
      freeSlots: null,
    })
    // Cursor dry and queue empty → idle.
    expect(await tool(tb, 'await_event').handler({})).toEqual({ idle: true, freeSlots: null })
    // Pass-through lane saw both events, in order.
    expect(emitted).toEqual(['settled', 'finding'])
  })

  it('a routed finding whose authorization THROWS is recorded on the bus — never a silent drop', async () => {
    // The authorize/record leg of `deliverRoutedFinding` throws BEFORE anything reaches the bus
    // (here: `authorizeDownMessage` is configured but the live target has no durable identity).
    // The docstring's "never a silent drop" must hold on this path too: the catch publishes the
    // same failed-`steer` shape a failed delivery attempt publishes.
    const { scope } = mockScope()
    const settlements = [
      {
        kind: 'done' as const,
        handle: { id: 'w7', label: 'w', status: 'done' as const, abort() {} },
        out: { diff: '...' },
        outRef: 'blob:w7',
        verdict: { valid: true, score: 1 },
        spent: zeroSpend(),
        trace: availableTrace,
        seq: 0,
      },
    ]
    const drainScope = {
      ...scope,
      next: () => Promise.resolve(settlements.shift() ?? null),
      // One LIVE worker the route can name (by label) — deliberately WITHOUT durable identity.
      view: {
        root: 'root',
        nodes: [
          {
            id: 'w0',
            label: 'worker',
            status: 'running' as const,
            runtime: 'router',
            budget: { maxIterations: 1, maxTokens: 10 },
            spent: zeroSpend(),
          },
        ],
        inFlight: 1,
      },
    } as typeof scope
    const emitted: CoordinationEvent[] = []
    const tb = createCoordinationTools({
      scope: drainScope,
      blobs: traceBlobStore('blob:w7', { messages: ['done'] }),
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      analysts: {
        kinds: [{ id: 'completeness', description: 'unfinished work', area: 'failure-mode' }],
        run: async () => [{ claim: 'stub left in place' }],
      },
      analyzeOnSettle: [{ kind: 'completeness', to: 'worker', directive: 'Fix these findings.' }],
      authorizeDownMessage: () => ({ instruction: 'filtered' }),
      onEvent: (e) => emitted.push(e),
    })

    expect(await tool(tb, 'await_event').handler({})).toMatchObject({ type: 'settled' })
    // The settle path SURVIVED the throw, and the failure is a recorded fact, not a silent drop.
    expect(emitted.map((e) => e.type)).toEqual(['settled', 'finding', 'steer'])
    const steer = emitted.find((e) => e.type === 'steer') as Extract<
      CoordinationEvent,
      { type: 'steer' }
    >
    expect(steer.analyst).toBe('completeness')
    expect(steer.down.delivered).toBe(false)
    expect(steer.down.outcome).toBe('runtime-error')
    expect(steer.down.toWorker).toBe('w0')
    expect(steer.down.error).toMatch(/durable identity/)
    // The record carries the exact bytes that failed to cross: directive + findings JSON.
    expect(steer.down.instruction).toContain('Fix these findings.')
    expect(steer.down.instruction).toContain('stub left in place')
  })

  it('retains a settlement when an awaited observer loses its acknowledgement', async () => {
    const { scope } = mockScope()
    const settlements = [
      {
        kind: 'done' as const,
        handle: { id: 'w-retry', label: 'w', status: 'done' as const, abort() {} },
        out: { answer: 1 },
        outRef: 'blob:w-retry',
        verdict: { valid: true, score: 0.8 },
        spent: zeroSpend(),
        trace: noTrace,
        seq: 0,
      },
    ]
    const drainScope = {
      ...scope,
      next: () => Promise.resolve(settlements.shift() ?? null),
    } as typeof scope
    const stamps: Array<{ seq: number; at: number }> = []
    let loseAcknowledgement = true
    const tb = createCoordinationTools({
      scope: drainScope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      onEvent(event, record) {
        if (event.type !== 'settled') return
        stamps.push({ seq: record.seq, at: record.at })
        if (loseAcknowledgement) throw new Error('ack lost after commit')
      },
    })

    await expect(tool(tb, 'await_event').handler({})).rejects.toThrow('ack lost after commit')
    expect(tb.settled()).toEqual([])
    expect(tb.history()).toEqual([])

    loseAcknowledgement = false
    await expect(tool(tb, 'await_event').handler({})).resolves.toMatchObject({
      type: 'settled',
      settled: 'w-retry',
      status: 'done',
    })
    expect(stamps).toHaveLength(2)
    expect(stamps[1]).toEqual(stamps[0])
    expect(tb.settled()).toHaveLength(1)
    expect(tb.history()).toHaveLength(1)
  })

  it('await_event with kinds filter waits for a specific message type', async () => {
    const { scope } = mockScope()
    const settlements = [
      {
        kind: 'done' as const,
        handle: { id: 'w8', label: 'w', status: 'done' as const, abort() {} },
        out: {},
        outRef: 'blob:w8',
        verdict: { valid: true, score: 1 },
        spent: zeroSpend(),
        trace: noTrace,
        seq: 0,
      },
    ]
    const tb = createCoordinationTools({
      scope: { ...scope, next: () => Promise.resolve(settlements.shift() ?? null) } as typeof scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    // Asking only for 'settled' drains and returns it.
    expect(await tool(tb, 'await_event').handler({ kinds: ['settled'] })).toMatchObject({
      type: 'settled',
      settled: 'w8',
      valid: true,
      trace: noTrace,
    })
    expect(await tool(tb, 'await_event').handler({ kinds: ['settled'] })).toEqual({
      idle: true,
      freeSlots: null,
    })
  })

  it('await_event returns idle when the only live event mismatches the kinds filter', async () => {
    const { scope } = mockScope()
    const settlements = [
      {
        kind: 'done' as const,
        handle: { id: 'w9', label: 'w', status: 'done' as const, abort() {} },
        out: {},
        outRef: 'blob:w9',
        verdict: { valid: true, score: 1 },
        spent: zeroSpend(),
        trace: noTrace,
        seq: 0,
      },
    ]
    const tb = createCoordinationTools({
      scope: { ...scope, next: () => Promise.resolve(settlements.shift() ?? null) } as typeof scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    // A worker is settle-able, but the driver only wants questions: await_event drains the cursor
    // (progress was made → not idle) WITHOUT leaking the settled event to a question-only pull.
    expect(await tool(tb, 'await_event').handler({ kinds: ['question'] })).toEqual({
      idle: false,
      freeSlots: null,
    })
    // The drained settled event was queued, not lost — a caller that asks for it still gets it.
    expect(await tool(tb, 'await_event').handler({ kinds: ['settled'] })).toMatchObject({
      settled: 'w9',
      trace: noTrace,
    })
  })

  it('an ONLINE detector raises a finding on the bus that the driver pulls (the live pipe → bus chain)', async () => {
    const { scope } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    // watchTrace over the worker's TraceSource raises a finding via raiseFinding when it loops.
    const { source, record } = createPushTraceSource({ runId: 'w0' })
    watchTrace(source, {
      onSignal: (s) => {
        void tb.raiseFinding({ fromWorker: 'w0', analyst: `online:${s.detector}`, findings: s })
      },
    })
    // The worker loops on the same tool call → the stuck-loop detector trips mid-run.
    record({ toolName: 'grep', args: { q: 'x' } })
    record({ toolName: 'grep', args: { q: 'x' } })
    record({ toolName: 'grep', args: { q: 'x' } })
    // The driver pulls the finding off the bus mid-run — no need to wait for settle.
    const ev = (await tool(tb, 'await_event').handler({ kinds: ['finding'] })) as {
      type: string
      fromWorker: string
      analyst: string
    }
    expect(ev).toMatchObject({
      type: 'finding',
      fromWorker: 'w0',
      analyst: 'online:repeated-action',
    })
  })

  it('createMcpServer serves coordination tools alongside built-ins; a shadow throws', () => {
    const { scope } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    const server = createMcpServer({ extraTools: tb.tools })
    expect(server.tools.has('spawn_worker')).toBe(true)
    expect(server.tools.has('steer_agent')).toBe(true)
    expect(server.tools.has('delegate_feedback')).toBe(true)
    expect(() =>
      createMcpServer({
        extraTools: [
          {
            name: 'delegate_feedback',
            description: 'x',
            inputSchema: {},
            handler: async () => ({}),
          },
        ],
      }),
    ).toThrow(/shadows a built-in/)
  })
})

describe("spawn_worker's published child-profile schema", () => {
  const profileArg = (): Record<string, unknown> => {
    const { scope } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    const input = tool(tb, 'spawn_worker').inputSchema as {
      properties: Record<string, Record<string, unknown>>
    }
    return input.properties.profile
  }
  const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8')
  const canonicalProperties = (): Record<string, unknown> =>
    agentProfileSchema.toJSONSchema({
      io: 'input',
      target: 'draft-07',
      unrepresentable: 'any',
    }).properties as Record<string, unknown>
  const publishedFields = [
    'name',
    'description',
    'version',
    'harness',
    'model',
    'prompt',
    'tools',
    'permissions',
    'mcp',
    'resources',
    'metadata',
  ]
  /** Every node in a JSON Schema tree, so a keyword can be asserted absent at EVERY depth. */
  const nodes = function* (node: unknown): Generator<Record<string, unknown>> {
    if (Array.isArray(node)) {
      for (const item of node) yield* nodes(item)
      return
    }
    if (!node || typeof node !== 'object') return
    yield node as Record<string, unknown>
    for (const value of Object.values(node as Record<string, unknown>)) yield* nodes(value)
  }

  it('declares an object shape carrying the canonical fields a spawning parent sets', () => {
    const profile = profileArg()
    expect(profile.type).toBe('object')
    const props = profile.properties as Record<string, Record<string, unknown>>
    expect(Object.keys(props)).toEqual(publishedFields)
    // Derived, not transcribed: apart from the added description and the stripped key-codec
    // artifact, each published sub-schema must be the canonical one, so a field the shared stack
    // changes changes here with no edit to this repo. `mcp` and `resources` are the two documented
    // brief forms and are asserted separately below.
    const canonical = canonicalProperties()
    const stripKeyCodec = (node: unknown): unknown => {
      if (Array.isArray(node)) return node.map(stripKeyCodec)
      if (!node || typeof node !== 'object') return node
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>)
          .filter(([k]) => k !== 'propertyNames')
          .map(([k, v]) => [k, stripKeyCodec(v)]),
      )
    }
    for (const field of publishedFields) {
      if (field === 'mcp' || field === 'resources') continue
      const { description: _added, ...rest } = props[field]
      expect(rest).toEqual(stripKeyCodec(canonical[field]))
    }
    expect((props.harness as { enum: string[] }).enum).toContain('claude-code')
    expect(profile.description).toMatch(/canonical/i)
  })

  it('publishes NO zod key-codec propertyNames pattern at any depth', () => {
    // `z.record(z.string(), …)` converts to `propertyNames: { pattern: '^u(?:[0-9a-f]{4})*$' }`,
    // a lossy-round-trip marker, not a constraint — plain keys parse fine. Published verbatim a
    // model reads it as "keys must be hex quads" and emits encoded garbage keys or drops the field.
    expect(
      agentProfileSchema.safeParse({ name: 'r', tools: { bash: true, Read: false } }).success,
    ).toBe(true)
    // The artifact is really there in the canonical conversion — so its absence below is a strip,
    // not an upstream schema that never had it.
    const canonicalHits = [...nodes(canonicalProperties())].filter((n) => 'propertyNames' in n)
    expect(canonicalHits.length).toBeGreaterThan(0)

    const profile = profileArg()
    for (const node of nodes(profile)) expect(node).not.toHaveProperty('propertyNames')
    expect(JSON.stringify(profile)).not.toContain('[0-9a-f]')
  })

  it('gives every published field a one-line description a model can act on', () => {
    const profile = profileArg()
    const props = profile.properties as Record<string, Record<string, unknown>>
    for (const field of publishedFields) {
      const description = props[field].description
      expect(typeof description, `${field} description`).toBe('string')
      expect((description as string).length, `${field} description`).toBeGreaterThan(30)
    }
    // The two brief forms must say so, and the parameter description must name both the canonical
    // schema's authority and the fact that a custom worker seam may accept a different shape.
    expect(props.mcp.description).toMatch(/brief form/i)
    expect(props.resources.description).toMatch(/brief form/i)
    expect(profile.description).toMatch(/governs validation/i)
    expect(profile.description).toMatch(/makeWorkerAgent/)
  })

  it('accepts every canonical profile and refuses an unknown field with a typed issue', async () => {
    const profile = profileArg()
    // The PUBLISHED tool schema stays permissive (no `required`, open `additionalProperties`) so a
    // harness whose schema copy lags never fails at the protocol layer…
    expect(profile.additionalProperties).toBe(true)
    expect(profile.required).toBeUndefined()

    const { scope, spawns } = mockScope()
    const seen: unknown[] = []
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent: (p) => {
        seen.push(p)
        return { name: 'w', act: async () => 0 }
      },
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    const spawn = tool(tb, 'spawn_worker')
    // …while the HANDLER validates the model-authored profile against the canonical schema and
    // fails CLOSED with named issues: an unrecognized field would otherwise be silently dropped
    // from the worker that runs, which is exactly the drop this runtime exists to refuse.
    const canonical = { tags: ['research'], name: 'w' }
    expect(await spawn.handler({ profile: {}, task: 'go' })).toMatchObject({ workerId: 'w0' })
    expect(await spawn.handler({ profile: canonical, task: 'go' })).toMatchObject({
      workerId: 'w0',
    })
    expect(
      await spawn.handler({ profile: { ...canonical, someUnknownField: true }, task: 'go' }),
    ).toMatchObject({
      error: 'invalid-profile',
      issues: [{ message: expect.stringContaining('someUnknownField') }],
    })
    // The worker factory is LAZY — the real scope invokes it only after reservation — so this
    // mock scope records the spawn without building the agent.
    expect(seen).toEqual([])
    expect(spawns).toHaveLength(2)
  })

  it('publishes every field it names — the drift check, as a TEST, never at import', () => {
    // The upstream rename this catches used to throw inside a module-load IIFE, which `src/runtime/
    // index.ts` imports statically: an Interface field rename bricked `import
    // '@tangle-network/agent-runtime/kernel'` for every consumer. It is caught here instead.
    const canonical = canonicalProperties()
    const missing = spawnProfileFieldNames.filter((f) => !(f in canonical))
    expect(missing, `canonical fields: ${Object.keys(canonical).join(', ')}`).toEqual([])
    expect([...spawnProfileFieldNames]).toEqual(publishedFields)
  })

  it('degrades to a smaller shape when an upstream field is renamed, instead of throwing', () => {
    const canonical = canonicalProperties()
    // Interface renames `tools` and drops `mcp`. Nothing throws; the two fields are simply not
    // published, and every surviving field still carries its description.
    const { tools: _renamedAway, mcp: _dropped, ...renamed } = canonical
    const degraded = deriveSpawnProfileArg({ ...renamed, toolPolicy: canonical.tools })
    const props = degraded.properties as Record<string, Record<string, unknown>>
    expect(Object.keys(props)).toEqual(publishedFields.filter((f) => f !== 'tools' && f !== 'mcp'))
    for (const field of Object.keys(props)) expect(typeof props[field].description).toBe('string')
    expect(degraded.additionalProperties).toBe(true)
    // The extreme case: the canonical schema stops being an object at all.
    expect(() => deriveSpawnProfileArg(undefined)).not.toThrow()
    expect(deriveSpawnProfileArg(undefined).properties).toEqual({})
    expect(deriveSpawnProfileArg({}).properties).toEqual({})
  })

  it('keeps the two heavy fields in their brief form and the whole shape sanely bounded', () => {
    const profile = profileArg()
    const props = profile.properties as Record<string, Record<string, unknown>>
    const canonical = canonicalProperties()
    // The load-bearing assertion is STRUCTURAL, not a byte count: `mcp` and `resources` are the
    // two fields a spawning parent is least likely to author inline (2663 B and 3122 B canonical,
    // 85% of the published cost), so they publish a brief shape, never the canonical sub-tree.
    expect(props.mcp).not.toEqual(canonical.mcp)
    expect(props.resources).not.toEqual(canonical.resources)
    expect(bytes(props.mcp)).toBeLessThan(bytes(canonical.mcp))
    expect(bytes(props.resources)).toBeLessThan(bytes(canonical.resources))
    // `mcp`'s brief form describes servers by name without the secret-ref/metadata sub-tree.
    expect(props.mcp.additionalProperties).toEqual({ type: 'object' })
    // `resources`' brief form names its four buckets and nothing deeper.
    expect(Object.keys(props.resources.properties as Record<string, unknown>)).toEqual([
      'files',
      'tools',
      'skills',
      'agents',
    ])
    // A LOOSE sanity bound, not a fence an upstream field addition can trip: the reduction is what
    // keeps this parameter from dwarfing the rest of the driver's tool list, and it stays well
    // under the whole canonical schema. The floor fails only if the derived sub-schemas stop being
    // published at all and the argument reverts to a bare prose description.
    const published = bytes(profile)
    const canonicalWhole = bytes(
      agentProfileSchema.toJSONSchema({ io: 'input', target: 'draft-07', unrepresentable: 'any' }),
    )
    expect(published).toBeGreaterThan(1024)
    expect(published).toBeLessThan(canonicalWhole)
  })
})

describe('canonicalFindingEvent — producer-side canonicalization of analyst findings', () => {
  it('strips an undefined payload to key-absence', () => {
    const event = canonicalFindingEvent({ fromWorker: 'w', analyst: 'a', findings: undefined })
    expect('findings' in event).toBe(false)
    expect(event).toEqual({ fromWorker: 'w', analyst: 'a' })
  })

  it('JSON round-trips a representable payload — nested undefined drops, array slots become null', () => {
    const event = canonicalFindingEvent({
      fromWorker: 'w',
      analyst: 'a',
      findings: { claim: 'x', detail: undefined, list: ['keep', undefined] },
    })
    expect(event.findings).toEqual({ claim: 'x', list: ['keep', null] })
    expect(event.fromWorker).toBe('w')
    expect(event.analyst).toBe('a')
  })

  it('degrades an unrepresentable payload (cycle, BigInt, bare function) to a record OF that fact', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    for (const findings of [cyclic, { n: BigInt(1) }, () => 0]) {
      const event = canonicalFindingEvent({ fromWorker: 'w', analyst: 'a', findings })
      const degraded = event.findings as { nonCanonicalFindings?: unknown }
      expect(typeof degraded.nonCanonicalFindings).toBe('string')
      expect((degraded.nonCanonicalFindings as string).length).toBeGreaterThan(0)
    }
  })
})
