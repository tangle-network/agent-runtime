import { PassThrough, type Readable } from 'node:stream'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExecutor, type ExecutorConfig, inlineSandboxClient } from '../../src/runtime'
import { workerFromBackend } from '../../src/runtime/supervise/supervise'
import type { Agent, AgentSpec, UsageEvent } from '../../src/runtime/supervise/types'

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

function isUsageStream(value: unknown): value is AsyncIterable<UsageEvent> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  )
}
