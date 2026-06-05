import { describe, expect, it } from 'vitest'
import type { Agent, ResultBlobStore, Scope, Spend } from '../../src/loops'
import { createMcpServer } from '../../src/mcp/server'
import { createOperatorToolbox } from '../../src/mcp/tools/operator-toolbox'

// The toolbox is a thin wrapper over the keystone Scope (spawn/view/send are tested in
// supervise.test.ts); this verifies the MCP handlers call the right verbs and shape the results.
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
  } as unknown as Scope<unknown>
  return { scope, sent, setAdmit: (v: boolean) => (admit = v) }
}

const blobs: ResultBlobStore = { get: async () => undefined, put: async () => {} }
const makeWorkerAgent = (): Agent<unknown, unknown> => ({ name: 'w', act: async () => 0 })
const tool = (tb: ReturnType<typeof createOperatorToolbox>, name: string) => {
  const t = tb.tools.find((x) => x.name === name)
  if (!t) throw new Error(`no tool ${name}`)
  return t
}

describe('operator toolbox (Scope-as-MCP)', () => {
  it('spawn_worker → workerId; fail-closed → { error }', async () => {
    const { scope, setAdmit } = mockScope()
    const tb = createOperatorToolbox({
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

  it('observe_worker returns status; unknown id → error', async () => {
    const { scope } = mockScope()
    const tb = createOperatorToolbox({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    const o = (await tool(tb, 'observe_worker').handler({ workerId: 'w0' })) as { status: string }
    expect(o.status).toBe('running')
    expect(await tool(tb, 'observe_worker').handler({ workerId: 'nope' })).toEqual({
      error: 'unknown workerId "nope"',
    })
  })

  it('steer_worker delivers to a live worker via scope.send; false for unknown', async () => {
    const { scope, sent } = mockScope()
    const tb = createOperatorToolbox({
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

  it('stop flips isStopped + records the reason', async () => {
    const { scope } = mockScope()
    const tb = createOperatorToolbox({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    expect(tb.isStopped()).toBe(false)
    await tool(tb, 'stop').handler({ reason: 'all verified' })
    expect(tb.isStopped()).toBe(true)
    expect(tb.stopReason()).toBe('all verified')
  })

  it('list_analysts surfaces the menu; run_analyst applies a lens to a SETTLED worker', async () => {
    const { scope } = mockScope()
    const traceBlobs: ResultBlobStore = {
      get: async (ref) => (ref === 'blob:w1' ? { messages: ['trace'] } : undefined),
      put: async () => {},
    }
    const seen: Array<{ kind: string; trace: unknown }> = []
    const tb = createOperatorToolbox({
      scope,
      blobs: traceBlobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
      analystKinds: [{ id: 'completeness', description: 'unfinished work', area: 'failure-mode' }],
      runAnalyst: async (kind, trace) => {
        seen.push({ kind, trace })
        return [{ claim: 'X missing' }]
      },
    })
    expect((await tool(tb, 'list_analysts').handler({})) as { analysts: unknown[] }).toEqual({
      analysts: [{ id: 'completeness', description: 'unfinished work', area: 'failure-mode' }],
    })
    // settled worker → the lens runs over its trace.
    const r = (await tool(tb, 'run_analyst').handler({ kind: 'completeness', workerId: 'w1' })) as {
      findings: unknown
    }
    expect(r).toEqual({ findings: [{ claim: 'X missing' }] })
    expect(seen).toEqual([{ kind: 'completeness', trace: { messages: ['trace'] } }])
    // running worker has no trace yet → typed error, lens not run.
    const r2 = await tool(tb, 'run_analyst').handler({ kind: 'completeness', workerId: 'w0' })
    expect(r2).toEqual({ error: expect.stringContaining('has not settled') })
  })

  it('createMcpServer serves the operator tools alongside built-ins; a shadow throws', () => {
    const { scope } = mockScope()
    const tb = createOperatorToolbox({
      scope,
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 1, maxTokens: 10 },
    })
    const server = createMcpServer({ extraTools: tb.tools })
    expect(server.tools.has('spawn_worker')).toBe(true)
    expect(server.tools.has('steer_worker')).toBe(true)
    expect(server.tools.has('delegate_feedback')).toBe(true) // built-in still present
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
