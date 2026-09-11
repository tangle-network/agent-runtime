import { request } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { serveCoordinationMcp } from '../../src/runtime/supervise/coordination-mcp'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  Scope,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { supervisorAgent } from '../helpers/runtime-with-test-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

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
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor: ex }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

async function jsonRpc(
  url: string,
  method: string,
  params: unknown,
  headers?: Readonly<Record<string, string>>,
): Promise<{ result?: unknown; error?: unknown }> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return (await r.json()) as { result?: unknown; error?: unknown }
}

describe('coordination MCP over a live Scope — the real keystone (HTTP → MCP → Scope.spawn)', () => {
  it('a real HTTP tools/call spawn_worker lands on Scope.spawn and the worker settles', async () => {
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
          toolNames: ['spawn_worker', 'await_event'],
          authentication: true,
        })
        try {
          const toolsList = await jsonRpc(mcp.url, 'tools/list', {}, mcp.headers)
          await jsonRpc(
            mcp.url,
            'tools/call',
            {
              name: 'spawn_worker',
              arguments: { profile: {}, task: 'go' },
            },
            mcp.headers,
          )
          await jsonRpc(mcp.url, 'tools/call', { name: 'await_event', arguments: {} }, mcp.headers)
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
    expect(names).toContain('spawn_worker')
    expect(names).toContain('await_event')
  })

  it('hands the coordination tools to the caller BEFORE the listener opens', async () => {
    // A node tool bound to `context.verbs` must work on the FIRST request. The hook therefore has
    // to fire before listen; a bind moved after it would leave the first caller with no verbs.
    let boundNames: ReadonlyArray<string> | undefined
    let boundBeforeFirstCall: boolean | undefined
    const scope = {} as Scope<unknown>
    const mcp = await serveCoordinationMcp({
      scope,
      blobs: new InMemoryResultBlobStore(),
      makeWorkerAgent: () => deliveringLeaf('unused', {}),
      perWorker: { maxIterations: 1, maxTokens: 1 },
      toolNames: ['spawn_worker', 'read_binding'],
      onCoordinationTools: (tools) => {
        boundNames = tools.map((tool) => tool.name)
      },
      nodeTools: [
        {
          name: 'read_binding',
          description: 'Report whether the coordination tools were bound before this call',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => {
            boundBeforeFirstCall = boundNames !== undefined
            return { bound: boundBeforeFirstCall }
          },
        },
      ],
    })
    try {
      const called = await jsonRpc(mcp.url, 'tools/call', {
        name: 'read_binding',
        arguments: {},
      })
      expect(called.error).toBeUndefined()
      expect(boundBeforeFirstCall).toBe(true)
      expect(boundNames).toContain('spawn_worker')
    } finally {
      await mcp.close()
    }
  })

  it('serves product-owned node tools beside coordination tools over the same HTTP MCP', async () => {
    const calls: unknown[] = []
    const scope = {} as Scope<unknown>
    const mcp = await serveCoordinationMcp({
      scope,
      blobs: new InMemoryResultBlobStore(),
      makeWorkerAgent: () => deliveringLeaf('unused', {}),
      perWorker: { maxIterations: 1, maxTokens: 1 },
      toolNames: ['spawn_worker', 'lookup_evidence'],
      nodeTools: [
        {
          name: 'lookup_evidence',
          description: 'Read product evidence',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
          handler: async (raw) => {
            calls.push(raw)
            return { result: 'trusted evidence' }
          },
        },
      ],
    })
    try {
      const listed = await jsonRpc(mcp.url, 'tools/list', {})
      const names = ((listed.result as { tools?: Array<{ name: string }> })?.tools ?? []).map(
        (entry) => entry.name,
      )
      expect(names).toContain('spawn_worker')
      expect(names).toContain('lookup_evidence')

      const called = await jsonRpc(mcp.url, 'tools/call', {
        name: 'lookup_evidence',
        arguments: { query: 'claim' },
      })
      expect(called.error).toBeUndefined()
      expect(called.result).toMatchObject({ structuredContent: { result: 'trusted evidence' } })
      expect(calls).toEqual([{ query: 'claim' }])
    } finally {
      await mcp.close()
    }
  })

  it('refuses a product tool that shadows spawn_worker before opening a listener', async () => {
    await expect(
      serveCoordinationMcp({
        scope: {} as Scope<unknown>,
        blobs: new InMemoryResultBlobStore(),
        makeWorkerAgent: () => deliveringLeaf('unused', {}),
        perWorker: { maxIterations: 1, maxTokens: 1 },
        toolNames: [],
        nodeTools: [
          {
            name: 'spawn_worker',
            description: 'must not shadow coordination',
            inputSchema: { type: 'object' },
            handler: async () => ({}),
          },
        ],
      }),
    ).rejects.toThrow(/spawn_worker.*shadows/)
  })

  it('refuses duplicate explicit tool grants before opening a listener', async () => {
    await expect(
      serveCoordinationMcp({
        scope: {} as Scope<unknown>,
        blobs: new InMemoryResultBlobStore(),
        makeWorkerAgent: () => deliveringLeaf('unused', {}),
        perWorker: { maxIterations: 1, maxTokens: 1 },
        toolNames: ['spawn_worker', 'spawn_worker'],
      }),
    ).rejects.toThrow(/toolNames contains a duplicate name/)
  })
})

/** Run `body` against a REAL live scope — the same path the sandbox supervisor arm uses — and
 *  surface whatever it returned or threw. No stub scope: a bind gate is only meaningful on the
 *  scope the server would actually have fronted. */
async function withLiveScope<T>(
  body: (scope: Scope<unknown>) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const blobs = new InMemoryResultBlobStore()
  let captured: { ok: true; value: T } | { ok: false; error: unknown } | undefined
  let started = false
  let complete!: () => void
  const completed = new Promise<void>((resolve) => {
    complete = resolve
  })
  const root: Agent<unknown, unknown> = {
    name: 'bind-gate',
    async act(_task, scope: Scope<unknown>) {
      started = true
      try {
        captured = { ok: true, value: await body(scope) }
      } catch (error) {
        captured = { ok: false, error }
      } finally {
        complete()
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
    signal,
  })
  if (!started) throw new Error('the root agent never ran')
  // Cancellation can settle the supervisor before the listener finishes closing.
  await completed
  if (!captured) throw new Error('the root agent never ran')
  if (!captured.ok) throw captured.error
  return captured.value
}

describe('serveCoordinationMcp itself fails closed on a non-loopback bind', () => {
  // The verbs this server mounts (spawn_worker / steer_agent / stop) are unauthenticated, and this
  // function is a PUBLIC export taking `host` directly — so the rule has to live HERE, not only at
  // the `supervise` / `supervisorAgent` composition sites that happen to call it.
  const serve = (scope: Scope<unknown>, extra: { host?: string; authentication?: true }) =>
    serveCoordinationMcp({
      scope,
      blobs: new InMemoryResultBlobStore(),
      makeWorkerAgent: () => deliveringLeaf('w', {}),
      perWorker: { maxIterations: 1, maxTokens: 10 } as Budget,
      toolNames: ['spawn_worker'],
      ...extra,
    })

  it.each(['0.0.0.0', '10.0.0.7', '::', 'runner-7.internal'])(
    'refuses the non-loopback host %s without authentication',
    async (host) => {
      // An unresolvable/unknown name counts as remote: whether it lands on a loopback interface is
      // not knowable at bind time, and the safe direction of that doubt is "exposed".
      await expect(
        withLiveScope(async (scope) => {
          const mcp = await serve(scope, { host })
          await mcp.close()
        }),
      ).rejects.toThrow(/non-loopback address requires authentication/s)
    },
  )

  it('accepts an authenticated non-loopback host and serves the verbs on it', async () => {
    const names = await withLiveScope(async (scope) => {
      const mcp = await serve(scope, { host: '0.0.0.0', authentication: true })
      try {
        expect(mcp.url).toMatch(/^http:\/\/0\.0\.0\.0:\d+\/mcp$/)
        const listed = (await jsonRpc(mcp.url, 'tools/list', {}, mcp.headers)).result as {
          tools?: Array<{ name: string }>
        }
        return (listed.tools ?? []).map((t) => t.name)
      } finally {
        await mcp.close()
      }
    })
    expect(names).toContain('spawn_worker')
  })

  it.each(['127.0.0.1', '127.0.0.53', 'localhost', '::1', '::ffff:127.0.0.1'])(
    'binds the loopback host %s without authentication needed',
    async (host) => {
      // Linux gives every 127/8 address to the loopback interface; macOS assigns only
      // 127.0.0.1, so `listen` there answers EADDRNOTAVAIL for 127.0.0.53. That is a
      // transport outcome the caller fixes by choosing an assigned address. What this case
      // pins on every host is the SECURITY gate: the host must never be refused as remote.
      const outcome = await withLiveScope(async (scope) => {
        let mcp: Awaited<ReturnType<typeof serve>>
        try {
          mcp = await serve(scope, { host })
        } catch (err) {
          return { error: err as NodeJS.ErrnoException }
        }
        try {
          return { port: mcp.port }
        } finally {
          await mcp.close()
        }
      })
      if ('error' in outcome) {
        expect(outcome.error.message).not.toMatch(/loopback/)
        expect(outcome.error.code).toBe('EADDRNOTAVAIL')
        return
      }
      expect(outcome.port).toBeGreaterThan(0)
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

describe('serveCoordinationMcp receives the peerMail the supervisor forwards', () => {
  it('serves peer mail when supervise forwards peerMail', async () => {
    const blobs = new InMemoryResultBlobStore()
    const mailUrls: Array<string | undefined> = []
    let mailToolNames: ReadonlyArray<string> = []
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl }) => {
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'spawn_worker',
        arguments: { profile: {}, task: 'go' },
      })
      await jsonRpc(coordinationMcpUrl, 'tools/call', { name: 'await_event', arguments: {} })
      const mailUrl = mailUrls[0]
      if (mailUrl !== undefined) {
        const listed = await jsonRpc(mailUrl, 'tools/list', {})
        mailToolNames = ((listed.result as { tools?: Array<{ name: string }> })?.tools ?? []).map(
          (tool) => tool.name,
        )
      }
      await jsonRpc(coordinationMcpUrl, 'tools/call', { name: 'stop', arguments: {} })
    }
    const root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'opencode',
        tools: runtimeToolDeclarations('spawn_worker', 'await_event', 'stop'),
      }),
      {
        blobs,
        makeWorkerAgent: (_profile, context) => {
          mailUrls.push(context?.peerMailUrl)
          return deliveringLeaf('w', { answer: 1 })
        },
        perWorker: { maxIterations: 4, maxTokens: 1000 } as Budget,
        driveHarness,
        peerMail: true,
      },
    )
    const result = await createSupervisor<unknown, unknown>().run(root, 'solve', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'mail-mcp',
      journal: new InMemorySpawnJournal(),
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 4,
      now: () => 0,
    })
    expect(result.kind).toBe('winner')
    expect(mailUrls).toHaveLength(1)
    expect(mailUrls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mail\/[0-9a-f]{32}$/)
    expect([...mailToolNames].sort()).toEqual(['read_mail', 'send_mail'])
  })
})

async function withBoundHttp<T>(
  extra: Partial<Parameters<typeof serveCoordinationMcp>[0]>,
  body: (mcp: Awaited<ReturnType<typeof serveCoordinationMcp>>) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  return withLiveScope(async (scope) => {
    const mcp = await serveCoordinationMcp({
      scope,
      blobs: new InMemoryResultBlobStore(),
      makeWorkerAgent: () => deliveringLeaf('unused', {}),
      perWorker: { maxIterations: 1, maxTokens: 10 },
      authentication: true,
      identity: { runId: 'run-a', actorId: 'actor-a' },
      toolNames: ['probe'],
      nodeTools: [
        {
          name: 'probe',
          description: 'Exercise the real HTTP boundary',
          inputSchema: { type: 'object' },
          handler: async () => ({ ok: true }),
        },
      ],
      ...extra,
    })
    try {
      return await body(mcp)
    } finally {
      await mcp.close()
    }
  }, signal)
}

function postHttp(
  mcp: Awaited<ReturnType<typeof serveCoordinationMcp>>,
  headers: Record<string, string> = {},
  body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'probe', arguments: {} },
  }),
) {
  return fetch(mcp.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

describe('authenticated and bounded coordination HTTP', () => {
  it('rejects absent, wrong-run, wrong-actor and revoked credentials before handler execution', async () => {
    let calls = 0
    await withBoundHttp(
      {
        nodeTools: [
          {
            name: 'probe',
            description: 'Count accepted calls',
            inputSchema: { type: 'object' },
            handler: async () => {
              calls++
              return {}
            },
          },
        ],
      },
      async (mcp) => {
        expect((await postHttp(mcp)).status).toBe(401)
        await withBoundHttp({ identity: { runId: 'run-b', actorId: 'actor-b' } }, async (other) => {
          expect((await postHttp(mcp, other.headers)).status).toBe(401)
          expect((await postHttp(other, mcp.headers)).status).toBe(401)
        })
        const old = mcp.headers
        mcp.rotateCredential()
        expect((await postHttp(mcp, old)).status).toBe(401)
        expect((await postHttp(mcp, mcp.headers)).status).toBe(200)
        expect(calls).toBe(1)
        const unknown = await jsonRpc(
          mcp.url,
          'tools/call',
          { name: 'spawn_worker', arguments: {} },
          mcp.headers,
        )
        expect(unknown.error).toBeDefined()
        expect(calls).toBe(1)
      },
    )
  })

  it('enforces expiration and audience, and does not leak bearer credentials into audit records', async () => {
    const events: unknown[] = []
    await withBoundHttp(
      {
        onAudit: (event) => {
          events.push(event)
        },
      },
      async (mcp) => {
        const wrongAudience = await new Promise<number>((resolve, reject) => {
          // Node's HTTP client preserves the wire Host header; fetch can replace it.
          const req = request(
            mcp.url,
            {
              method: 'POST',
              headers: {
                ...mcp.headers,
                Host: 'wrong-audience.invalid',
                'content-type': 'application/json',
              },
            },
            (res) => {
              res.resume()
              resolve(res.statusCode!)
            },
          )
          req.on('error', reject)
          req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
        })
        expect(wrongAudience).toBe(403)
        expect(
          (await fetch(mcp.url.replace('/mcp', '/other'), { method: 'POST', headers: mcp.headers }))
            .status,
        ).toBe(404)
        const clock = vi.spyOn(Date, 'now').mockReturnValue(mcp.credentialExpiresAt! + 1)
        try {
          expect((await postHttp(mcp, mcp.headers)).status).toBe(401)
        } finally {
          clock.mockRestore()
        }
        expect((await postHttp(mcp, mcp.headers)).status).toBe(200)
        expect(events).toContainEqual(
          expect.objectContaining({
            runId: 'run-a',
            actorId: 'actor-a',
            outcome: 'accepted',
            action: 'probe',
          }),
        )
        expect(JSON.stringify(events)).not.toContain(mcp.headers.Authorization)
      },
    )
  })

  it('rechecks credential revocation after an asynchronous admission audit', async () => {
    let rotate: (() => void) | undefined
    let calls = 0
    await withBoundHttp(
      {
        onAudit: async (event) => {
          if (event.outcome === 'accepted') rotate?.()
        },
        nodeTools: [
          {
            name: 'probe',
            description: 'Must remain uncalled',
            inputSchema: { type: 'object' },
            handler: async () => {
              calls++
              return {}
            },
          },
        ],
      },
      async (mcp) => {
        rotate = () => mcp.rotateCredential()
        expect((await postHttp(mcp, mcp.headers)).status).toBe(401)
        expect(calls).toBe(0)
      },
    )
  })

  it('checks origins, content type, JSON shape and both declared and streamed body size', async () => {
    await withBoundHttp(
      { maxRequestBytes: 128, allowedOrigins: ['https://console.example'] },
      async (mcp) => {
        expect(
          (await postHttp(mcp, { ...mcp.headers, Origin: 'https://attacker.example' })).status,
        ).toBe(403)
        expect(
          (await postHttp(mcp, { ...mcp.headers, Origin: 'https://console.example' })).status,
        ).toBe(200)
        expect((await postHttp(mcp, { ...mcp.headers, 'content-type': 'text/plain' })).status).toBe(
          415,
        )
        expect((await postHttp(mcp, mcp.headers, '[]')).status).toBe(400)
        expect((await postHttp(mcp, mcp.headers, '{')).status).toBe(400)
        expect((await postHttp(mcp, mcp.headers, 'x'.repeat(129))).status).toBe(413)
        const streamed = await new Promise<number>((resolve, reject) => {
          const req = request(
            mcp.url,
            { method: 'POST', headers: { ...mcp.headers, 'content-type': 'application/json' } },
            (res) => {
              res.resume()
              resolve(res.statusCode!)
            },
          )
          req.on('error', reject)
          req.write('x'.repeat(65))
          req.end('x'.repeat(64))
        })
        expect(streamed).toBe(413)
      },
    )
  })

  it('times out a slow body before any tool executes', async () => {
    let calls = 0
    await withBoundHttp(
      {
        requestTimeoutMs: 50,
        nodeTools: [
          {
            name: 'probe',
            description: 'Never called',
            inputSchema: { type: 'object' },
            handler: async () => {
              calls++
              return {}
            },
          },
        ],
      },
      async (mcp) => {
        const status = await new Promise<number>((resolve, reject) => {
          const req = request(
            mcp.url,
            { method: 'POST', headers: { ...mcp.headers, 'content-type': 'application/json' } },
            (res) => {
              res.resume()
              req.destroy()
              resolve(res.statusCode!)
            },
          )
          req.on('error', reject)
          req.write('{')
        })
        expect(status).toBe(408)
        expect(calls).toBe(0)
      },
    )
  })

  it('keeps a timed-out action charged against concurrency until it actually settles', async () => {
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    let finished!: () => void
    const settled = new Promise<void>((resolve) => {
      finished = resolve
    })
    let calls = 0
    await withBoundHttp(
      {
        maxConcurrentRequests: 1,
        requestTimeoutMs: 50,
        onAudit: (event) => {
          if (event.outcome === 'completed-after-deadline') finished()
        },
        nodeTools: [
          {
            name: 'probe',
            description: 'A bounded blocked handler',
            inputSchema: { type: 'object' },
            handler: async () => {
              if (++calls === 1) {
                entered()
                await blocked
              }
              return {}
            },
          },
        ],
      },
      async (mcp) => {
        try {
          const pending = postHttp(mcp, mcp.headers)
          await started
          expect((await pending).status).toBe(504)
          expect((await postHttp(mcp, mcp.headers)).status).toBe(429)
          release()
          await settled
          expect((await postHttp(mcp, mcp.headers)).status).toBe(200)
        } finally {
          release()
        }
      },
    )
  })

  it('bounds admitted request rate without invoking excess actions', async () => {
    await withBoundHttp({ requestsPerMinute: 2 }, async (mcp) => {
      expect((await postHttp(mcp, mcp.headers)).status).toBe(200)
      expect((await postHttp(mcp, mcp.headers)).status).toBe(200)
      expect((await postHttp(mcp, mcp.headers)).status).toBe(429)
    })
  })

  it.each([false, true])(
    'binds the caller-owned endpoint and credential audience with async resolution=%s',
    async (asynchronous) => {
      await withBoundHttp(
        {
          publicUrl: ({ actorId }) => {
            const url = `https://coordination.example/${actorId}`
            return asynchronous ? Promise.resolve(url) : url
          },
        },
        async (mcp) => {
          expect(mcp.url).toBe('https://coordination.example/actor-a')
          expect(mcp.url).not.toContain(mcp.headers.Authorization!)
          const response = await fetch(`http://127.0.0.1:${mcp.port}/actor-a`, {
            method: 'POST',
            headers: {
              ...mcp.headers,
              Host: 'coordination.example',
              'content-type': 'application/json',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
          })
          expect(response.status).toBe(200)
        },
      )
    },
  )

  it('denies requests while the public address is being resolved', async () => {
    const addresses: string[] = []
    await withBoundHttp(
      {
        publicUrl: async ({ host, port, runId, actorId, signal }) => {
          expect({ host, runId, actorId }).toEqual({
            host: '127.0.0.1',
            runId: 'run-a',
            actorId: 'actor-a',
          })
          expect(signal.aborted).toBe(false)
          const url = `http://${host}:${port}/mcp`
          addresses.push(url)
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
          })
          expect(response.status).toBe(403)
          return url
        },
      },
      async (mcp) => {
        expect(mcp.url).toBe(addresses[0])
        expect((await postHttp(mcp, mcp.headers)).status).toBe(200)
      },
    )
  })

  it.each([
    'http://coordination.example/mcp',
    'https://secret@coordination.example/mcp',
    'https://coordination.example/mcp?secret=value',
    'https://coordination.example/mcp#secret',
  ])('closes the listener when async resolution returns an unsafe endpoint: %s', async (url) => {
    let localUrl = ''
    const ready = vi.fn()
    await expect(
      withBoundHttp(
        {
          publicUrl: async ({ port }) => {
            localUrl = `http://127.0.0.1:${port}/mcp`
            return url
          },
        },
        ready,
      ),
    ).rejects.toThrow(/coordination publicUrl/)
    expect(ready).not.toHaveBeenCalled()
    await expect(fetch(localUrl)).rejects.toThrow()
  })

  it('closes the listener when the async resolver rejects', async () => {
    let localUrl = ''
    const ready = vi.fn()
    const failure = new Error('endpoint provisioning failed')
    await expect(
      withBoundHttp(
        {
          publicUrl: async ({ port }) => {
            localUrl = `http://127.0.0.1:${port}/mcp`
            throw failure
          },
        },
        ready,
      ),
    ).rejects.toBe(failure)
    expect(ready).not.toHaveBeenCalled()
    await expect(fetch(localUrl)).rejects.toThrow()
  })

  it('cancels a pending resolver, closes its listener, and observes a late rejection', async () => {
    const controller = new AbortController()
    let resolverSignal: AbortSignal | undefined
    let localUrl = ''
    let rejectResolution!: (error: Error) => void
    const pending = new Promise<string>((_resolve, reject) => {
      rejectResolution = reject
    })
    const ready = vi.fn()
    await expect(
      withBoundHttp(
        {
          publicUrl: ({ port, signal }) => {
            resolverSignal = signal
            localUrl = `http://127.0.0.1:${port}/mcp`
            queueMicrotask(() => controller.abort('manager cancelled'))
            return pending
          },
        },
        ready,
        controller.signal,
      ),
    ).rejects.toMatchObject({
      name: 'AbortError',
      message: 'manager cancelled',
    })
    expect(resolverSignal?.aborted).toBe(true)
    expect(ready).not.toHaveBeenCalled()
    await expect(fetch(localUrl)).rejects.toThrow()
    rejectResolution(new Error('late provisioning failure'))
    await new Promise<void>((resolve) => setImmediate(resolve))
  })
})

describe('coordination credential continuity', () => {
  it('accepts an original credential only for its exact restarted authority and retained verification key', async () => {
    const signingKeys = { activeKeyId: 'original', keys: { original: 'a'.repeat(48) } }
    const publicUrl = 'https://coordination.example/manager'
    let original: Readonly<Record<string, string>> = {}
    await withBoundHttp({ authentication: { signingKeys }, publicUrl }, async (mcp) => {
      original = mcp.headers
    })
    const request = (mcp: Awaited<ReturnType<typeof serveCoordinationMcp>>) =>
      fetch(`http://127.0.0.1:${mcp.port}/mcp`, {
        method: 'POST',
        headers: { ...original, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
    const rotated = { activeKeyId: 'next', keys: { ...signingKeys.keys, next: 'b'.repeat(48) } }
    await withBoundHttp({ authentication: { signingKeys: rotated }, publicUrl }, async (mcp) => {
      expect((await request(mcp)).status).toBe(200)
    })
    for (const mismatch of [
      { identity: { runId: 'other-run', actorId: 'actor-a' } },
      { identity: { runId: 'run-a', actorId: 'other-actor' } },
      { publicUrl: 'https://coordination.example/other' },
      { toolNames: ['probe', 'stop'] },
      { authentication: { signingKeys: { activeKeyId: 'next', keys: { next: 'b'.repeat(48) } } } },
    ]) {
      await withBoundHttp(
        { authentication: { signingKeys: rotated }, publicUrl, ...mismatch },
        async (mcp) => {
          expect((await request(mcp)).status).toBe(401)
        },
      )
    }
    const time = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 900_001)
    try {
      await withBoundHttp({ authentication: { signingKeys }, publicUrl }, async (mcp) => {
        expect((await request(mcp)).status).toBe(401)
      })
    } finally {
      time.mockRestore()
    }
  })
})
