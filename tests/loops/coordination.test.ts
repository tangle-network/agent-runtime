import { describe, expect, it } from 'vitest'
import { createMcpServer } from '../../src/mcp/server'
import { createCoordinationTools } from '../../src/mcp/tools/coordination'
import type { Agent, ResultBlobStore, Scope, Spend } from '../../src/runtime'

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
  it('spawn_worker returns workerId and fails closed when admission fails', async () => {
    const { scope, setAdmit } = mockScope()
    const tb = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    expect(await tool(tb, 'spawn_worker').handler({ profile: {}, task: 'go' })).toEqual({
      workerId: 'w0',
    })
    setAdmit(false)
    expect(await tool(tb, 'spawn_worker').handler({ profile: {}, task: 'go' })).toEqual({
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
    expect(sent).toEqual([{ id: 'w0', msg: { steer: 'do X next' } }])
    expect(await tool(tb, 'steer_worker').handler({ workerId: 'gone', instruction: 'x' })).toEqual({
      delivered: false,
    })
  })

  it('await_next drains settlements into the driver ledger', async () => {
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
    expect(await tool(tb, 'await_next').handler({})).toEqual({
      settled: 'w7',
      status: 'done',
      score: 0.83,
      valid: true,
      outRef: 'blob:w7',
    })
    expect(await tool(tb, 'await_next').handler({})).toEqual({ idle: true })
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
    await tool(tb, 'answer_question').handler({
      questionId: r.question.id,
      answer: 'Target v2.',
      by: 'user',
    })
    expect(await tool(tb, 'stop').handler({ reason: 'answered and verified' })).toEqual({
      stopped: true,
    })
    expect(tb.questions()[0]).toMatchObject({ status: 'answered' })
    expect(emitted).toEqual([{ type: 'question', question: expect.objectContaining(r.question) }])
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
