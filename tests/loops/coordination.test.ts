import { describe, expect, it } from 'vitest'
import { createMcpServer } from '../../src/mcp/server'
import { createCoordinationTools } from '../../src/mcp/tools/coordination'
import type { Agent, ResultBlobStore, Scope, Spend } from '../../src/runtime'
import { createPushTraceSource, watchTrace } from '../../src/runtime'

const zeroSpend = (): Spend => ({ iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 })

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
    },
  ]
  let admit = true
  const scope = {
    spawn: (_agent: unknown, task: unknown, opts: { budget: unknown; label: string }) => {
      spawns.push({ task, opts })
      return admit
        ? {
            ok: true as const,
            handle: { id: 'w0', label: opts.label, status: 'running' as const, abort() {} },
          }
        : { ok: false as const, reason: 'budget-exhausted' as const }
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
  return { scope, sent, spawns, setAdmit: (v: boolean) => (admit = v) }
}

const blobs: ResultBlobStore = { get: async () => undefined, put: async () => {} }
const makeWorkerAgent = (): Agent<unknown, unknown> => ({ name: 'w', act: async () => 0 })
const tool = (tb: ReturnType<typeof createCoordinationTools>, name: string) => {
  const t = tb.tools.find((x) => x.name === name)
  if (!t) throw new Error(`no tool ${name}`)
  return t
}

describe('coordination tools', () => {
  it('spawn_agent returns workerId and fails closed when admission fails', async () => {
    const { scope, setAdmit } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    // No `maxLiveWorkers` cap ⇒ `freeSlots: null` (uncapped; the conserved pool is the fence).
    expect(await tool(tb, 'spawn_agent').handler({ profile: {}, task: 'go' })).toEqual({
      workerId: 'w0',
      live: 1,
      freeSlots: null,
    })
    setAdmit(false)
    expect(await tool(tb, 'spawn_agent').handler({ profile: {}, task: 'go' })).toEqual({
      error: 'budget-exhausted',
      live: 1,
      freeSlots: null,
    })
  })

  it('spawn_agent fails closed at the maxLiveWorkers cap WITHOUT touching the pool', async () => {
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
    const spawn = () => tool(tb, 'spawn_agent').handler({ profile: {}, task: 'go' })
    // `freeSlots` counts down as the cap fills — the reading that tells the driver capacity is
    // still idle, so it can fill slots instead of opening one worker per turn.
    expect(await spawn()).toEqual({ workerId: 'w0', live: 1, freeSlots: 1 })
    expect(await spawn()).toEqual({ workerId: 'w1', live: 2, freeSlots: 0 })
    // The 2 live workers fill the cap → the 3rd fails closed BEFORE scope.spawn is called.
    expect(await spawn()).toEqual({ error: 'max-live-workers', live: 2, freeSlots: 0 })
    expect(spawns).toHaveLength(2)
    // A settled worker frees a slot — mark one terminal and the next spawn admits again.
    live[0]!.status = 'done'
    expect(await spawn()).toEqual({ workerId: 'w2', live: 2, freeSlots: 0 })

    // No cap (omitted) → the pool stays the only fence; the same scope admits past the prior cap.
    const uncapped = createCoordinationTools({
      scope: cappedScope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    expect(await tool(uncapped, 'spawn_agent').handler({ profile: {}, task: 'go' })).toEqual({
      workerId: 'w3',
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
      tool(tb, 'spawn_agent').handler({ profile: {}, task: 'go', key })

    // Key 'a' runs and takes the only slot, then delivers.
    expect(await spawnKeyed('a')).toEqual({ workerId: 'w0', live: 1, freeSlots: 0 })
    live[0]!.status = 'done'
    deliveredKey = 'a'
    // Drain the settlement the way the driver does — this is what teaches the toolbox that key
    // 'a' is complete.
    pending = settled
    await tool(tb, 'await_event').handler({ kinds: ['settled'] })

    // A different assignment now occupies the single slot.
    expect(await spawnKeyed('b')).toEqual({ workerId: 'w1', live: 1, freeSlots: 0 })

    // Re-asking for the DELIVERED key at the cap must return its committed result, not a refusal.
    expect(await spawnKeyed('a')).toEqual({
      workerId: 'w0',
      resumed: 'completed',
      status: 'done',
      score: 1,
      valid: true,
      outRef: 'blob:a',
      live: 1,
      freeSlots: 0,
    })
    // An unrelated new assignment is still correctly fenced.
    expect(await spawnKeyed('c')).toEqual({ error: 'max-live-workers', live: 1, freeSlots: 0 })
  })

  it('spawn_agent reserves the per-worker default when no budget is given', async () => {
    const { scope, spawns } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 2, maxTokens: 100 },
    })
    await tool(tb, 'spawn_agent').handler({ profile: {}, task: 'go' })
    expect(spawns).toHaveLength(1)
    expect(spawns[0].opts.budget).toEqual({ maxIterations: 2, maxTokens: 100 })
  })

  it('spawn_agent honors a per-spawn budget, merged per-field over the default', async () => {
    const { scope, spawns } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 2, maxTokens: 100 },
    })
    // Only raise maxTokens + add a usd ceiling; maxIterations falls through from the default.
    expect(
      await tool(tb, 'spawn_agent').handler({
        profile: {},
        task: 'hard',
        budget: { maxTokens: 5000, maxUsd: 0.5 },
      }),
    ).toEqual({ workerId: 'w0', live: 1, freeSlots: null })
    expect(spawns[0].opts.budget).toEqual({ maxIterations: 2, maxTokens: 5000, maxUsd: 0.5 })
  })

  it('spawn_agent fails loud on a malformed per-spawn budget (never silently uses the default)', async () => {
    const { scope } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 2, maxTokens: 100 },
    })
    expect(() =>
      tool(tb, 'spawn_agent').handler({ profile: {}, task: 'go', budget: 'lots' }),
    ).toThrow(/"budget" must be an object/)
    expect(() =>
      tool(tb, 'spawn_agent').handler({
        profile: {},
        task: 'go',
        budget: { maxTokens: Number.POSITIVE_INFINITY },
      }),
    ).toThrow(/"budget.maxTokens" must be a finite number/)
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
      error: 'unknown workerId "nope"',
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
      reason: 'unknown-worker',
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
      freeSlots: null,
    })
    expect(await tool(tb, 'await_event').handler({ kinds: ['settled'] })).toEqual({
      idle: true,
      freeSlots: null,
    })
    expect(tb.settled()).toMatchObject([
      { id: 'w7', status: 'done', score: 0.83, valid: true, outRef: 'blob:w7' },
    ])
    // The ledger stamps WHEN the settlement landed — the resolution a progress-based stop rule
    // reads to answer "how long since anything landed?" without inventing a timestamp at read time.
    expect(typeof tb.settled()[0]?.settledAt).toBe('number')
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
    const emitted: unknown[] = []
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      questionPolicy: 'failClosed',
      onEvent: (event) => emitted.push(event),
    })

    const r = (await tool(tb, 'ask_parent').handler({
      from: 'driver-1',
      level: 'driver',
      question: 'Which API version should this migration target?',
      reason: 'worker found two supported versions',
      urgency: 'blocks-run',
    })) as { question: { id: string } }
    expect(await tool(tb, 'stop').handler({ reason: 'done' })).toMatchObject({
      stopped: false,
      error: 'unresolved-blocking-questions',
    })
    // The driver-1 asker is not a live worker in the mock scope → the answer reports delivered:false.
    expect(
      await tool(tb, 'answer_question').handler({
        questionId: r.question.id,
        answer: 'Target v2.',
        by: 'user',
      }),
    ).toMatchObject({ question: { status: 'answered' }, delivered: false })
    expect(await tool(tb, 'stop').handler({ reason: 'answered and verified' })).toEqual({
      stopped: true,
    })
    expect(tb.questions()[0]).toMatchObject({ status: 'answered' })
    // The pass-through trail records BOTH legs: the question up, then the answer routed down.
    expect(emitted).toEqual([
      { type: 'question', question: expect.objectContaining(r.question) },
      {
        type: 'answer',
        questionId: r.question.id,
        down: { toWorker: 'driver-1', instruction: 'Target v2.', delivered: false },
      },
    ])
  })

  it('list_analysts surfaces the menu and run_analyst applies a lens to a settled worker', async () => {
    const { scope } = mockScope()
    const traceBlobs: ResultBlobStore = {
      get: async (ref) => (ref === 'blob:w1' ? { messages: ['trace'] } : undefined),
      put: async () => {},
    }
    const seen: Array<{ kind: string; trace: unknown }> = []
    const tb = createCoordinationTools({
      scope,
      blobs: traceBlobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      analysts: {
        kinds: [{ id: 'completeness', description: 'unfinished work', area: 'failure-mode' }],
        run: async (kind, trace) => {
          seen.push({ kind, trace })
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
    expect(seen).toEqual([{ kind: 'completeness', trace: { messages: ['trace'] } }])
    expect(await tool(tb, 'run_analyst').handler({ kind: 'completeness', workerId: 'w0' })).toEqual(
      {
        error: expect.stringContaining('has not settled'),
      },
    )
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
    expect(tb.history().map((r) => r.priority)).toEqual([0, 20])
    expect(tb.stats()).toMatchObject({ published: 2, pulled: 2, byKind: { question: 2 } })
  })

  it('steer_agent routes down + records in history but is never pulled back', async () => {
    const { scope, sent } = mockScope()
    const emitted: Array<{ type: string }> = []
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
      reason: 'unknown-worker',
      progress: null,
    })
    // The forceful steer reached the child inbox (down delivery)...
    expect(sent).toEqual([{ id: 'w0', msg: { steer: 'do X', interrupt: true } }])
    // ...and both attempts were recorded for observability (pass-through + history)...
    expect(emitted.map((e) => e.type)).toEqual(['steer', 'steer'])
    expect(tb.history().map((r) => r.event.type)).toEqual(['steer', 'steer'])
    // ...but the parent never pulls its own outbound messages back.
    expect(await tool(tb, 'await_event').handler({})).toEqual({ idle: true, freeSlots: null })
  })

  it('answer_question routes the answer down to a LIVE worker and surfaces delivered:true', async () => {
    const { scope, sent } = mockScope()
    const emitted: Array<{ type: string }> = []
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
    // ...and both legs are on the trail: question up, answer down.
    expect(emitted.map((e) => e.type)).toEqual(['question', 'answer'])
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
      blobs: {
        get: async (ref) => (ref === 'blob:w7' ? { messages: ['trace'] } : undefined),
        put: async () => {},
      },
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      analysts: {
        kinds: [{ id: 'completeness', description: 'unfinished work', area: 'failure-mode' }],
        run: async () => [{ claim: 'stub left in place' }],
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
    expect(server.tools.has('spawn_agent')).toBe(true)
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
