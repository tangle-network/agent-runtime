import { describe, expect, it } from 'vitest'
import { createMcpServer } from '../../src/mcp/server'
import { createCoordinationTools } from '../../src/mcp/tools/coordination'
import type { Agent, ResultBlobStore, Scope, Spend } from '../../src/runtime'
import { createPushTraceSource, watchTrace } from '../../src/runtime'

const zeroSpend = (): Spend => ({ iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 })

function mockScope() {
  const sent: Array<{ id: string; msg: unknown }> = []
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
    spawn: (_agent: unknown, _task: unknown, opts: { label: string }) =>
      admit
        ? {
            ok: true as const,
            handle: { id: 'w0', label: opts.label, status: 'running' as const, abort() {} },
          }
        : { ok: false as const, reason: 'budget-exhausted' as const },
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
  return { scope, sent, setAdmit: (v: boolean) => (admit = v) }
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
    expect(await tool(tb, 'spawn_agent').handler({ profile: {}, task: 'go' })).toEqual({
      workerId: 'w0',
    })
    setAdmit(false)
    expect(await tool(tb, 'spawn_agent').handler({ profile: {}, task: 'go' })).toEqual({
      error: 'budget-exhausted',
    })
  })

  it('observe_worker returns live status and settled output', async () => {
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
    expect(await tool(tb, 'observe_worker').handler({ workerId: 'w0' })).toMatchObject({
      status: 'running',
      output: null,
    })
    expect(await tool(tb, 'observe_worker').handler({ workerId: 'w1' })).toMatchObject({
      status: 'done',
      outRef: 'blob:w1',
      output: { answer: 42 },
    })
    expect(await tool(tb, 'observe_worker').handler({ workerId: 'nope' })).toEqual({
      error: 'unknown workerId "nope"',
    })
  })

  it('steer_worker delivers through Scope.send', async () => {
    const { scope, sent } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    expect(
      await tool(tb, 'steer_worker').handler({ workerId: 'w0', instruction: 'do X next' }),
    ).toEqual({ delivered: true })
    expect(sent).toEqual([{ id: 'w0', msg: { steer: 'do X next', interrupt: false } }])
    expect(await tool(tb, 'steer_worker').handler({ workerId: 'gone', instruction: 'x' })).toEqual({
      delivered: false,
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
    expect(await tool(tb, 'await_event').handler({ kinds: ['settled'] })).toEqual({
      type: 'settled',
      settled: 'w7',
      status: 'done',
      score: 0.83,
      valid: true,
      outRef: 'blob:w7',
    })
    expect(await tool(tb, 'await_event').handler({ kinds: ['settled'] })).toEqual({ idle: true })
    expect(tb.settled()).toEqual([
      { id: 'w7', status: 'done', score: 0.83, valid: true, outRef: 'blob:w7' },
    ])
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

  it('steer_worker routes down + records in history but is never pulled back', async () => {
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
      await tool(tb, 'steer_worker').handler({
        workerId: 'w0',
        instruction: 'do X',
        interrupt: true,
      }),
    ).toEqual({ delivered: true })
    // A steer to a worker with no live inbox reports delivered:false.
    expect(await tool(tb, 'steer_worker').handler({ workerId: 'gone', instruction: 'x' })).toEqual({
      delivered: false,
    })
    // The forceful steer reached the child inbox (down delivery)...
    expect(sent).toEqual([{ id: 'w0', msg: { steer: 'do X', interrupt: true } }])
    // ...and both attempts were recorded for observability (pass-through + history)...
    expect(emitted.map((e) => e.type)).toEqual(['steer', 'steer'])
    expect(tb.history().map((r) => r.event.type)).toEqual(['steer', 'steer'])
    // ...but the parent never pulls its own outbound messages back.
    expect(await tool(tb, 'await_event').handler({})).toEqual({ idle: true })
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
    })
    // The analyze-on-settle finding is now queued; the next pull surfaces it.
    expect(await tool(tb, 'await_event').handler({})).toEqual({
      type: 'finding',
      fromWorker: 'w7',
      analyst: 'completeness',
      findings: [{ claim: 'stub left in place' }],
    })
    // Cursor dry and queue empty → idle.
    expect(await tool(tb, 'await_event').handler({})).toEqual({ idle: true })
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
    expect(await tool(tb, 'await_event').handler({ kinds: ['settled'] })).toEqual({ idle: true })
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
    expect(await tool(tb, 'await_event').handler({ kinds: ['question'] })).toEqual({ idle: false })
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
    expect(server.tools.has('steer_worker')).toBe(true)
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
