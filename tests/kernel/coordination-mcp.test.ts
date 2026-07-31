import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { serveCoordinationMcp } from '../../src/runtime/supervise/coordination-mcp'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  Scope,
  UsageEvent,
} from '../../src/runtime/supervise/types'

// A real (simple) delivering leaf — NOT a mock of the MCP path; the HTTP→MCP→Scope.spawn is real.
function deliveringLeaf(name: string, out: unknown): Agent<unknown, unknown> {
  const ex: Executor<unknown> = {
    runtime: 'router',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `w:${name}`,
      out,
      verdict: { valid: true, score: 1 },
      spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor: ex }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

async function jsonRpc(
  url: string,
  method: string,
  params: unknown,
): Promise<{ result?: unknown; error?: unknown }> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return (await r.json()) as { result?: unknown; error?: unknown }
}

describe('coordination MCP over a live Scope — the real keystone (HTTP → MCP → Scope.spawn)', () => {
  it('a real HTTP tools/call spawn_agent lands on Scope.spawn and the worker settles', async () => {
    const blobs = new InMemoryResultBlobStore()
    let observed: { toolsList: unknown; settled: ReadonlyArray<{ valid?: boolean }> } | undefined

    // The root agent fronts its LIVE scope with the MCP, then drives it as an external client would —
    // over real HTTP. This is exactly what an in-box opencode supervisor does via mcp.mcpServers.
    const root: Agent<unknown, unknown> = {
      name: 'mcp-driver',
      async act(_task, scope: Scope<unknown>) {
        const mcp = await serveCoordinationMcp({
          scope,
          blobs,
          makeWorkerAgent: () => deliveringLeaf('w', { answer: 42 }),
          perWorker: { maxIterations: 4, maxTokens: 1000 } as Budget,
        })
        try {
          const toolsList = await jsonRpc(mcp.url, 'tools/list', {})
          await jsonRpc(mcp.url, 'tools/call', {
            name: 'spawn_agent',
            arguments: { profile: {}, task: 'go' },
          })
          await jsonRpc(mcp.url, 'tools/call', { name: 'await_event', arguments: {} })
          observed = { toolsList: toolsList.result, settled: mcp.settled() }
          const done = mcp.settled().filter((w) => w.status === 'done' && w.valid === true)
          return done[0]?.outRef ? await blobs.get(done[0].outRef) : undefined
        } finally {
          await mcp.close()
        }
      },
    }

    const result = await createSupervisor<unknown, unknown>().run(root, 'solve', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'mcp',
      journal: new InMemorySpawnJournal(),
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 4,
      now: () => 0,
    })

    expect(result.kind).toBe('winner') // a real worker delivered through the MCP
    expect(result.kind === 'winner' && result.out).toEqual({ answer: 42 })
    expect(observed?.settled.length).toBe(1)
    expect(observed?.settled[0]?.valid).toBe(true)
    // tools/list surfaces the coordination verbs the in-box harness will call.
    const names = ((observed?.toolsList as { tools?: Array<{ name: string }> })?.tools ?? []).map(
      (t) => t.name,
    )
    expect(names).toContain('spawn_agent')
    expect(names).toContain('await_event')
  })
})

/** Run `body` against a REAL live scope — the same path the sandbox supervisor arm uses — and
 *  surface whatever it returned or threw. No stub scope: a bind gate is only meaningful on the
 *  scope the server would actually have fronted. */
async function withLiveScope<T>(body: (scope: Scope<unknown>) => Promise<T>): Promise<T> {
  const blobs = new InMemoryResultBlobStore()
  let captured: { ok: true; value: T } | { ok: false; error: unknown } | undefined
  const root: Agent<unknown, unknown> = {
    name: 'bind-gate',
    async act(_task, scope: Scope<unknown>) {
      try {
        captured = { ok: true, value: await body(scope) }
      } catch (error) {
        captured = { ok: false, error }
      }
      return undefined
    },
  }
  await createSupervisor<unknown, unknown>().run(root, 'bind', {
    budget: { maxIterations: 10, maxTokens: 1000 },
    runId: 'bind-gate',
    journal: new InMemorySpawnJournal(),
    blobs,
    executors: createExecutorRegistry(),
    maxDepth: 2,
    now: () => 0,
  })
  if (!captured) throw new Error('the root agent never ran')
  if (!captured.ok) throw captured.error
  return captured.value
}

describe('serveCoordinationMcp itself fails closed on a non-loopback bind', () => {
  // The verbs this server mounts (spawn_agent / steer_agent / stop) are unauthenticated, and this
  // function is a PUBLIC export taking `host` directly — so the rule has to live HERE, not only at
  // the `supervise` / `supervisorAgent` composition sites that happen to call it.
  const serve = (
    scope: Scope<unknown>,
    extra: { host?: string; allowUnauthenticatedRemote?: true },
  ) =>
    serveCoordinationMcp({
      scope,
      blobs: new InMemoryResultBlobStore(),
      makeWorkerAgent: () => deliveringLeaf('w', {}),
      perWorker: { maxIterations: 1, maxTokens: 10 } as Budget,
      ...extra,
    })

  it.each(['0.0.0.0', '10.0.0.7', '::', 'runner-7.internal'])(
    'refuses the non-loopback host %s with no acknowledgment',
    async (host) => {
      // An unresolvable/unknown name counts as remote: whether it lands on a loopback interface is
      // not knowable at bind time, and the safe direction of that doubt is "exposed".
      await expect(
        withLiveScope(async (scope) => {
          const mcp = await serve(scope, { host })
          await mcp.close()
        }),
      ).rejects.toThrow(/not a loopback address.*allowUnauthenticatedRemote/s)
    },
  )

  it('accepts an acknowledged non-loopback host and serves the verbs on it', async () => {
    const names = await withLiveScope(async (scope) => {
      const mcp = await serve(scope, { host: '0.0.0.0', allowUnauthenticatedRemote: true })
      try {
        expect(mcp.url).toMatch(/^http:\/\/0\.0\.0\.0:\d+\/mcp$/)
        const listed = (await jsonRpc(mcp.url, 'tools/list', {})).result as {
          tools?: Array<{ name: string }>
        }
        return (listed.tools ?? []).map((t) => t.name)
      } finally {
        await mcp.close()
      }
    })
    expect(names).toContain('spawn_agent')
  })

  it.each(['127.0.0.1', '127.0.0.53', 'localhost', '::1', '::ffff:127.0.0.1'])(
    'binds the loopback host %s with no acknowledgment needed',
    async (host) => {
      const port = await withLiveScope(async (scope) => {
        const mcp = await serve(scope, { host })
        try {
          return mcp.port
        } finally {
          await mcp.close()
        }
      })
      expect(port).toBeGreaterThan(0)
    },
  )

  it('classifies the bracketed loopback literal [::1] as loopback, not as remote', async () => {
    // Node's own `listen` rejects the bracketed spelling (`ENOTFOUND [::1]`) — a transport error a
    // caller fixes by unbracketing. What matters here is that the SECURITY gate let it through:
    // callers carry `[::1]` from config, and refusing it as "remote" would be wrong.
    const error = await withLiveScope(async (scope) => {
      try {
        const mcp = await serve(scope, { host: '[::1]' })
        await mcp.close()
        return undefined
      } catch (e) {
        return e
      }
    })
    expect((error as Error | undefined)?.message ?? '').not.toMatch(/loopback/)
  })

  it('defaults to loopback when no host is given', async () => {
    const url = await withLiveScope(async (scope) => {
      const mcp = await serve(scope, {})
      try {
        return mcp.url
      } finally {
        await mcp.close()
      }
    })
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  })
})
