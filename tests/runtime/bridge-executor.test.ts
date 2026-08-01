import { PassThrough, type Readable } from 'node:stream'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExecutor, type ExecutorConfig, inlineSandboxClient } from '../../src/runtime'
import { bridgeExecutor } from '../../src/runtime/supervise/runtime'
import { workerFromBackend } from '../../src/runtime/supervise/supervise'
import type { Agent, AgentSpec, Executor, UsageEvent } from '../../src/runtime/supervise/types'

// `bridgeExecutor` POSTs each turn over the `node:http` core client, not global
// `fetch`: the bridge runs a harness CLI and streams only once it starts
// producing (first byte routinely >5 min in), and undici's fixed ~300s
// `headersTimeout` — unoverridable by any option or AbortSignal — would kill a
// live-but-slow bridge. Tests drive that transport by setting `bridgeHttpHandler`.
let bridgeHttpHandler: ((payload: Record<string, unknown>) => Readable) | null = null
let lastBridgeUrl: URL | null = null

vi.mock('node:http', async () => {
  const actual = await vi.importActual<typeof import('node:http')>('node:http')
  return {
    ...actual,
    request: (url: URL, _opts: unknown, cb: (res: Readable) => void) => {
      lastBridgeUrl = url
      let body = ''
      return {
        write: (chunk: string) => {
          body += chunk
        },
        end: () => {
          const payload = JSON.parse(body || '{}') as Record<string, unknown>
          if (!bridgeHttpHandler) throw new Error('bridgeHttpHandler not set')
          const res = bridgeHttpHandler(payload) as Readable & {
            statusCode?: number
            headers?: Record<string, string>
          }
          res.statusCode = res.statusCode ?? 200
          if (res.statusCode >= 200 && res.statusCode < 300) {
            res.headers = {
              'x-run-id': String(payload.run_id),
              'x-run-request-digest': `sha256:${'a'.repeat(64)}`,
            }
          }
          cb(res)
        },
        on: () => {},
        destroy: () => {},
      }
    },
  }
})

function sse(content: string, input: number, output: number): Readable {
  const stream = new PassThrough()
  stream.end(
    [
      'id: 1',
      `data: ${JSON.stringify({
        choices: [{ delta: { content } }],
        usage: { prompt_tokens: input, completion_tokens: output },
      })}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n'),
  )
  return stream
}

function bridgeClient(model: string) {
  return inlineSandboxClient(
    createExecutor({
      backend: 'bridge',
      bridgeUrl: 'http://bridge.test',
      bridgeBearer: 'secret',
      model,
    }),
  )
}

async function runOnce(
  client: ReturnType<typeof bridgeClient>,
  prompt: string,
  backend?: unknown,
): Promise<{ finalText: string; tokensIn: number; tokensOut: number }> {
  const box = await client.create(backend ? ({ backend } as never) : undefined)
  let finalText = ''
  let tokensIn = 0
  let tokensOut = 0
  for await (const ev of box.streamPrompt(prompt) as AsyncIterable<SandboxEvent>) {
    const e = ev as { type: string; data?: Record<string, unknown> }
    if (e.type === 'result') {
      finalText = String(e.data?.finalText ?? '')
      const usage = e.data?.tokenUsage as
        | { inputTokens?: number; outputTokens?: number }
        | undefined
      tokensIn = usage?.inputTokens ?? 0
      tokensOut = usage?.outputTokens ?? 0
    }
  }
  return { finalText, tokensIn, tokensOut }
}

describe('bridgeExecutor over node:http', () => {
  afterEach(() => {
    bridgeHttpHandler = null
    lastBridgeUrl = null
  })

  it('streams a completion and meters the reported usage', async () => {
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('done from bridge', 7, 11)
    }
    const out = await runOnce(bridgeClient('kimi-code/kimi-k2.6'), 'compute the return')
    expect(out.finalText).toBe('done from bridge')
    expect(out.tokensIn).toBe(7)
    expect(out.tokensOut).toBe(11)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.model).toBe('kimi-code/kimi-k2.6')
    expect(seen[0]?.stream).toBe(true)
    const msgs = seen[0]?.messages as Array<{ role: string; content: string }>
    expect(msgs.some((m) => m.content.includes('compute the return'))).toBe(true)
    // The bridge base URL is turned into the endpoint EXACTLY once — no doubled
    // `/v1/chat/completions` from a caller that already built the full path.
    expect(lastBridgeUrl?.pathname).toBe('/v1/chat/completions')
    expect(lastBridgeUrl?.host).toBe('bridge.test')
  })

  it('a per-create backend override targets the cell model as harness/model', async () => {
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('ok', 1, 2)
    }
    const client = bridgeClient('kimi-code/default')
    await runOnce(client, 'go', { type: 'opencode', model: { model: 'glm-4.6' } })
    expect(seen[0]?.model).toBe('opencode/glm-4.6')
  })

  it('an already-prefixed override model passes through unchanged', async () => {
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('ok', 1, 2)
    }
    await runOnce(bridgeClient('kimi-code/default'), 'go', {
      type: 'opencode',
      model: { model: 'opencode/glm-4.6' },
    })
    expect(seen[0]?.model).toBe('opencode/glm-4.6')
  })

  it('uses the seam model verbatim when no per-create override is given', async () => {
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('ok', 1, 2)
    }
    await runOnce(bridgeClient('kimi-code/kimi-k2.6'), 'go')
    expect(seen[0]?.model).toBe('kimi-code/kimi-k2.6')
  })

  it('captures model and nested profile policy when createExecutor is called', async () => {
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('ok', 1, 2)
    }
    const config: Extract<ExecutorConfig, { backend: 'bridge' }> = {
      backend: 'bridge',
      bridgeUrl: 'http://bridge.test',
      bridgeBearer: 'secret',
      model: 'safe-model',
      agentProfile: {
        name: 'policy-overlay',
        permissions: { shell: 'deny' },
      },
    }
    const client = inlineSandboxClient(createExecutor(config))
    config.model = 'mutated-model'
    if (config.agentProfile?.permissions) config.agentProfile.permissions.shell = 'allow'

    await runOnce(client, 'go')

    expect(seen[0]?.model).toBe('safe-model')
    expect(seen[0]?.agent_profile).toMatchObject({ permissions: { shell: 'deny' } })
  })

  it('captures the turn limit before callers can expand the execution budget', async () => {
    let requests = 0
    let deliver: (message: unknown) => void = () => {}
    bridgeHttpHandler = () => {
      requests += 1
      if (requests === 1) deliver({ steer: 'run another turn' })
      return sse(`turn-${requests}`, 1, 1)
    }
    const config: Extract<ExecutorConfig, { backend: 'bridge' }> = {
      backend: 'bridge',
      bridgeUrl: 'http://bridge.test',
      bridgeBearer: 'secret',
      model: 'safe-model',
      maxTurns: 1,
    }
    const factory = createExecutor(config)
    config.maxTurns = 3
    const executor = factory(
      { profile: { name: 'budget-worker' }, harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    deliver = (message) => executor.deliver?.(message)
    const run = executor.execute('go', new AbortController().signal)
    if (!isUsageStream(run)) throw new Error('bridge worker must stream usage')
    for await (const _event of run) {
      // drain the bridge stream
    }

    expect(requests).toBe(1)
    expect(executor.resultArtifact().spent.iterations).toBe(1)
  })

  it('gives parallel reusable workers isolated bridge sessions', async () => {
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('ok', 1, 2)
    }
    const make = workerFromBackend({
      backend: 'bridge',
      bridgeUrl: 'http://bridge.test',
      bridgeBearer: 'secret',
      model: 'safe-model',
    })
    const workers = ['a', 'b'].map(
      (name, index) =>
        make(
          { name },
          {
            assignmentId: `ordinal:${index}`,
            budget: { maxIterations: 1, maxTokens: 100 },
            task: 'go',
            label: name,
          },
        ) as Agent<unknown, unknown> & {
          executorSpec: AgentSpec
        },
    )
    const executors = workers.map((worker) =>
      worker.executorSpec.executorFactory?.(worker.executorSpec, {
        signal: new AbortController().signal,
        seams: {},
      }),
    )

    await Promise.all(
      executors.map(async (executor) => {
        if (!executor) throw new Error('worker executor factory missing')
        const run = executor.execute('go', new AbortController().signal)
        if (!isUsageStream(run)) throw new Error('bridge worker must stream usage')
        for await (const _event of run) {
          // drain the bridge stream
        }
      }),
    )

    expect(seen).toHaveLength(2)
    const sessions = seen.map((request) => request.session_id)
    expect(sessions.every((session) => typeof session === 'string')).toBe(true)
    expect(new Set(sessions).size).toBe(2)
  })

  it('reconstructs the same bridge session for the same durable worker assignment', async () => {
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('ok', 1, 2)
    }
    const backend = {
      backend: 'bridge' as const,
      bridgeUrl: 'http://bridge.test',
      bridgeBearer: 'secret',
      model: 'safe-model',
    }
    const context = {
      assignmentId: 'key:stable-experiment',
      budget: { maxIterations: 1, maxTokens: 100 },
      task: 'go',
      label: 'stable-experiment',
      key: 'stable-experiment',
    }
    const workers = [workerFromBackend(backend), workerFromBackend(backend)].map(
      (make) =>
        make({ name: 'worker' }, context) as Agent<unknown, unknown> & {
          executorSpec: AgentSpec
        },
    )

    for (const worker of workers) {
      const executor = worker.executorSpec.executorFactory?.(worker.executorSpec, {
        signal: new AbortController().signal,
        seams: {},
      })
      if (!executor) throw new Error('worker executor factory missing')
      const run = executor.execute('go', new AbortController().signal)
      if (!isUsageStream(run)) throw new Error('bridge worker must stream usage')
      for await (const _event of run) {
        // drain the bridge stream
      }
    }

    expect(seen).toHaveLength(2)
    expect(seen[0]?.session_id).toMatch(/^supervised-worker-[a-f0-9]{64}$/)
    expect(seen[1]?.session_id).toBe(seen[0]?.session_id)
  })

  it('throws on a non-2xx bridge response', async () => {
    bridgeHttpHandler = () => {
      const s = new PassThrough() as PassThrough & { statusCode?: number }
      s.statusCode = 500
      s.end('boom')
      return s
    }
    await expect(runOnce(bridgeClient('kimi-code/k2'), 'go')).rejects.toThrow(/bridge 500/)
  })
})

/**
 * `progress()` / `traceSource()` — the supervisor's LIVE read of a bridge worker (#683).
 *
 * The SSE frames below are the REAL bytes cli-bridge emitted for one
 * `pi/tangle-router/gpt-5-mini` turn (captured 2026-08-01 off the bridge on 127.0.0.1:3355):
 * each tool call arrives complete in ONE delta as
 * `{index, id, type:'function', function:{name, arguments}}`, followed by a usage-only frame.
 * Testing against replayed real bytes is the point — a decoder proven only against bytes this
 * file invented proves nothing about the wire.
 */
describe('bridgeExecutor live observability', () => {
  afterEach(() => {
    bridgeHttpHandler = null
    lastBridgeUrl = null
  })

  const REAL_TOOL_CALL_FRAMES = [
    frame(1, {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_FjvWUA36BXG4yDn9LMw3Yc9R',
                type: 'function',
                function: {
                  name: 'belief_hypothesize',
                  arguments:
                    '{"hypothesis":"The file /tmp/bridge-obs-probe-683.txt contains exactly one word."}',
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }),
    frame(2, { choices: [], usage: { prompt_tokens: 6108, completion_tokens: 309 } }),
    frame(3, {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_cBWLA0691IaJwXyA4HFvli6u',
                type: 'function',
                function: {
                  name: 'read',
                  arguments: '{"path":"/tmp/bridge-obs-probe-683.txt"}',
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }),
    frame(4, { choices: [{ index: 0, delta: { content: 'PLATYPUS' }, finish_reason: null }] }),
    frame(5, { choices: [], usage: { prompt_tokens: 6273, completion_tokens: 7, cost: 0.004 } }),
    'data: [DONE]\n\n',
  ]

  it('reports the live turn, tool activity and queued steers while the turn streams', async () => {
    bridgeHttpHandler = () => streamOf(REAL_TOOL_CALL_FRAMES)
    const executor = observedBridgeExecutor()

    expect(typeof executor.progress).toBe('function')
    expect(executor.progress?.()).toMatchObject({ turns: 0, pendingMessages: 0, note: 'starting' })

    const run = executor.execute('read the probe file', new AbortController().signal)
    if (!isUsageStream(run)) throw new Error('bridge worker must stream usage')
    const iterator = run[Symbol.asyncIterator]()
    // The first metered event arrives AFTER the first tool-call frame, so this read happens with
    // the turn still in flight — exactly when a supervisor decides to steer, respawn, or wait.
    await iterator.next()
    executor.deliver?.({ steer: 'also print the file size' })

    const mid = executor.progress?.()
    expect(mid?.note).toMatch(/^turn 0/)
    expect(mid?.pendingMessages).toBe(1)
    expect(mid?.recentActivity?.map((note) => note.label)).toContain('belief_hypothesize')
    // The arguments the model actually sent are the detail a driver reads instead of the
    // worker's whole transcript.
    const read = mid?.recentActivity?.find((note) => note.label === 'read')
    if (read) expect(read.detail).toBe('/tmp/bridge-obs-probe-683.txt')

    for (;;) {
      const next = await iterator.next()
      if (next.done) break
    }
    const settled = executor.progress?.()
    // The steer became a SECOND resume turn on the same session, and the window shows the whole
    // causal chain a driver needs: what the worker did, what it was told, what it did next.
    expect(settled?.turns).toBe(2)
    expect(settled?.note).toBe('settled')
    expect(settled?.recentActivity?.map((note) => note.label)).toEqual([
      'belief_hypothesize',
      'read',
      'turn 1',
      'follow-up',
      'belief_hypothesize',
      'read',
      'turn 2',
    ])
    expect(settled?.recentActivity?.find((note) => note.label === 'follow-up')?.detail).toBe(
      'also print the file size',
    )
  })

  it('yields honest instant tool spans — real args, no invented status or duration', async () => {
    bridgeHttpHandler = () => streamOf(REAL_TOOL_CALL_FRAMES)
    const executor = observedBridgeExecutor()
    await drain(executor)

    const spans = await executor.traceSource?.()?.collect()
    expect(spans?.map((span) => span.toolName)).toEqual(['belief_hypothesize', 'read'])
    expect(spans?.[1]?.args).toEqual({ path: '/tmp/bridge-obs-probe-683.txt' })
    for (const span of spans ?? []) {
      // The bridge reports the DECISION to call a tool and never reports the call finishing, so
      // an outcome and a duration are both unknowable. Asserting their ABSENCE is the contract:
      // a defaulted 'ok' would count an unobserved call as a success in every error-rate read,
      // and an end time later than the start would be a fabricated latency.
      expect('status' in span).toBe(false)
      expect(span.endedAt).toBe(span.startedAt)
      expect(span.argsCaptured).toBeUndefined()
    }
  })

  it('records every tool call in one delta, not just the first', async () => {
    bridgeHttpHandler = () =>
      streamOf([
        frame(1, {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'a',
                    type: 'function',
                    function: { name: 'read', arguments: '{"path":"x"}' },
                  },
                  {
                    index: 1,
                    id: 'b',
                    type: 'function',
                    function: { name: 'grep', arguments: '{"pattern":"y"}' },
                  },
                ],
              },
            },
          ],
        }),
        frame(2, { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        'data: [DONE]\n\n',
      ])
    const executor = observedBridgeExecutor()
    await drain(executor)

    const spans = await executor.traceSource?.()?.collect()
    expect(spans?.map((span) => span.toolName)).toEqual(['read', 'grep'])
    expect((executor.resultArtifact().out as { toolCalls: string[] }).toolCalls).toEqual([
      'read',
      'grep',
    ])
  })

  it('records a named call whose entry type is not "function"', async () => {
    // The decoder used to normalize only when `type` was ABSENT, so an entry carrying a different
    // type was dropped whole — out of the spans AND out of the public `out.toolCalls`. A named
    // function is a tool call whatever the entry calls itself.
    bridgeHttpHandler = () =>
      streamOf([
        frame(1, {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'c1',
                    type: 'custom',
                    function: { name: 'grep', arguments: '{"pattern":"z"}' },
                  },
                ],
              },
            },
          ],
        }),
        frame(2, { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        'data: [DONE]\n\n',
      ])
    const executor = observedBridgeExecutor()
    await drain(executor)

    const spans = await executor.traceSource?.()?.collect()
    expect(spans?.map((span) => span.toolName)).toEqual(['grep'])
    expect((executor.resultArtifact().out as { toolCalls: string[] }).toolCalls).toEqual(['grep'])
  })

  it('marks a tool call whose arguments the wire omitted as uncaptured, not as empty', async () => {
    bridgeHttpHandler = () =>
      streamOf([
        frame(1, {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'a',
                    type: 'function',
                    function: { name: 'read', arguments: '' },
                  },
                ],
              },
            },
          ],
        }),
        frame(2, { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        'data: [DONE]\n\n',
      ])
    const executor = observedBridgeExecutor()
    await drain(executor)

    const spans = await executor.traceSource?.()?.collect()
    expect(spans?.[0]?.args).toEqual({})
    expect(spans?.[0]?.argsCaptured).toBe(false)
  })

  it("folds the bridge's own run state into the note, then drops it once the run is terminal", async () => {
    bridgeHttpHandler = (payload) => {
      if (lastBridgeUrl?.pathname.startsWith('/v1/runs/')) {
        const id = decodeURIComponent(lastBridgeUrl.pathname.slice('/v1/runs/'.length))
        return jsonOf({
          id,
          status: 'running',
          state: 'running',
          terminal: false,
          lastSeq: 3,
        })
      }
      void payload
      return streamOf(REAL_TOOL_CALL_FRAMES)
    }
    const executor = observedBridgeExecutor()
    const run = executor.execute('go', new AbortController().signal)
    if (!isUsageStream(run)) throw new Error('bridge worker must stream usage')
    const iterator = run[Symbol.asyncIterator]()
    await iterator.next()

    // The run-state read is deliberately OUT OF BAND: `progress()` schedules it and never awaits
    // it, so the answer lands on a later read. Poll for that rather than blocking the run.
    let note = ''
    for (let attempt = 0; attempt < 50 && !note.includes('bridge run'); attempt += 1) {
      note = executor.progress?.()?.note ?? ''
      if (!note.includes('bridge run')) await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(note).toMatch(/^turn 0 · bridge run running \(status running, seq 3, read \d+ms ago\)$/)

    for (;;) {
      const next = await iterator.next()
      if (next.done) break
    }
    // Terminal proof invalidates the last-known "running": reporting it after settle would be a
    // stale claim dressed as a live one.
    expect(executor.progress?.()?.note).toBe('settled')
  })

  it('degrades to the local mirror when the bridge cannot answer a run-state read', async () => {
    bridgeHttpHandler = (payload) => {
      if (lastBridgeUrl?.pathname.startsWith('/v1/runs/')) {
        const failed = new PassThrough() as PassThrough & { statusCode?: number }
        failed.statusCode = 500
        failed.end('bridge exploded')
        return failed
      }
      void payload
      return streamOf(REAL_TOOL_CALL_FRAMES)
    }
    const executor = observedBridgeExecutor()
    const run = executor.execute('go', new AbortController().signal)
    if (!isUsageStream(run)) throw new Error('bridge worker must stream usage')
    const iterator = run[Symbol.asyncIterator]()
    await iterator.next()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() => executor.progress?.()).not.toThrow()
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    // A failed observability read is not evidence about the run: the local mirror still answers,
    // and the stream is untouched.
    const during = executor.progress?.()
    expect(during?.note).toBe('turn 0')
    expect(during?.recentActivity?.length).toBeGreaterThan(0)
    for (;;) {
      const next = await iterator.next()
      if (next.done) break
    }
    expect((executor.resultArtifact().out as { content: string }).content).toBe('PLATYPUS')
  })

  it('reports what it derived about the caller declaration, before any turn runs', () => {
    bridgeHttpHandler = () => streamOf(REAL_TOOL_CALL_FRAMES)
    const executor = bridgeExecutor(
      { profile: { name: 'derived-worker' }, harness: null } as unknown as AgentSpec,
      {
        signal: new AbortController().signal,
        seams: {
          bridge: {
            bridgeUrl: 'http://bridge.test',
            bridgeBearer: 'secret',
            model: 'kimi-code/kimi-k2.6',
            agentProfile: { name: 'overlay', permissions: { shell: 'deny' } },
          },
          // A per-create backend override resolves a DIFFERENT wire model than the seam default.
          createOptions: { backend: { type: 'opencode', model: { model: 'glm-4.6' } } },
        },
      },
    )
    // Readable BEFORE the first turn and never evicted, so a run that dies on turn 40 can still
    // answer "which model did this actually run, and whose profile?" — the questions a failure
    // raises and that neither the activity ring nor the settled artifact can answer.
    const derived = executor.progress?.()?.derived ?? []
    expect(derived).toEqual([
      "profile: merged the bridge seam's agentProfile over the spawn profile before materialization",
      'model: resolved the bridge wire model to opencode/glm-4.6 (seam default kimi-code/kimi-k2.6)',
    ])
  })
})

/** One numbered SSE data frame, exactly as cli-bridge writes it. */
function frame(id: number, payload: unknown): string {
  return `id: ${id}\ndata: ${JSON.stringify(payload)}\n\n`
}

function streamOf(frames: ReadonlyArray<string>): Readable {
  const stream = new PassThrough()
  stream.end(frames.join(''))
  return stream
}

function jsonOf(body: unknown): Readable {
  const stream = new PassThrough() as PassThrough & { statusCode?: number }
  stream.statusCode = 200
  stream.end(JSON.stringify(body))
  return stream
}

function observedBridgeExecutor(): Executor<unknown> {
  return bridgeExecutor(
    { profile: { name: 'observed-worker' }, harness: null } as unknown as AgentSpec,
    {
      signal: new AbortController().signal,
      seams: {
        bridge: {
          bridgeUrl: 'http://bridge.test',
          bridgeBearer: 'secret',
          model: 'pi/tangle-router/gpt-5-mini',
        },
      },
    },
  )
}

async function drain(executor: Executor<unknown>): Promise<void> {
  const run = executor.execute('go', new AbortController().signal)
  if (!isUsageStream(run)) throw new Error('bridge worker must stream usage')
  for await (const _event of run) {
    // drain the bridge stream
  }
}

function isUsageStream(value: unknown): value is AsyncIterable<UsageEvent> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  )
}

describe('profile-selected model keeps its provider', () => {
  // A harness addresses a model as `provider/model`. Building the wire id from `model.default`
  // alone dropped the provider: `{provider:'tangle-router', default:'glm-5.2'}` became
  // `pi/glm-5.2`, which routes to the right BACKEND and then hands pi a bare id it cannot place.
  // pi fell back to its own default provider and died with "No API key found for opencode" — a
  // credential error naming a provider nobody chose. Measured live against a real cli-bridge:
  // `pi/tangle-router/glm-5.2` returns 200, `pi/glm-5.2` does not.
  async function wireModelFor(profile: Record<string, unknown>): Promise<unknown> {
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('ok', 1, 2)
    }
    const executor = createExecutor({
      backend: 'bridge',
      bridgeUrl: 'http://bridge.test',
      bridgeBearer: 'secret',
      model: 'pi/seam-default',
    })({ profile, harness: null } as unknown as AgentSpec, {
      signal: new AbortController().signal,
      seams: {},
    })
    const run = executor.execute('go', new AbortController().signal)
    if (!isUsageStream(run)) throw new Error('bridge worker must stream usage')
    for await (const _event of run) {
      // drain
    }
    return seen[0]?.model
  }

  it('composes backend/provider/model when the profile names a provider', async () => {
    expect(
      await wireModelFor({
        name: 'w',
        harness: 'pi',
        model: { provider: 'tangle-router', default: 'glm-5.2' },
      }),
    ).toBe('pi/tangle-router/glm-5.2')
  })

  it('leaves a model with no declared provider to the harness own resolution', async () => {
    expect(await wireModelFor({ name: 'w', harness: 'pi', model: { default: 'glm-5.2' } })).toBe(
      'pi/glm-5.2',
    )
  })

  it('does not double-qualify a model that already carries its provider', async () => {
    expect(
      await wireModelFor({
        name: 'w',
        harness: 'pi',
        model: { provider: 'tangle-router', default: 'tangle-router/glm-5.2' },
      }),
    ).toBe('pi/tangle-router/glm-5.2')
  })
})
