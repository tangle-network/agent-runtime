import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  type AgentProfile,
  canonicalAgentProfileDigest,
  type ReasoningEffort,
} from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spendFromUsageEvents } from './budget'
import { bridgeExecutor, createExecutor } from './runtime'
import type { UsageEvent } from './types'

const TEST_RUN_DIGEST = `sha256:${'b'.repeat(64)}`
const TEST_WORKSPACE_DIGEST = `sha256:${'a'.repeat(64)}`

function respondBridgeCapabilities(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'GET' || req.url !== '/') return false
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({
      capabilities: {
        profileMaterialization: 'cli-bridge.profile-materialization.v2',
        usageCostProvenance: 'cli-bridge.usage-cost.v1',
      },
    }),
  )
  return true
}

function appliedReasoning(harness: string, requested: ReasoningEffort | null): string | null {
  if (requested === null) return null
  if (harness === 'pi') {
    if (requested === 'none') return 'off'
    return requested === 'ultracode' ? 'xhigh' : requested
  }
  if (harness === 'claude-code') {
    if (requested === 'none' || requested === 'minimal') return 'low'
    return requested === 'ultracode' ? 'max' : requested
  }
  if (harness === 'codex') {
    if (requested === 'none') return 'minimal'
    return requested === 'xhigh' || requested === 'ultracode' ? 'high' : requested
  }
  if (harness === 'kimi-code') {
    if (requested === 'medium') return null
    return requested === 'none' || requested === 'minimal' || requested === 'low'
      ? '--no-thinking'
      : '--thinking'
  }
  if (harness === 'gemini') return null
  return requested
}

function bridgeProfileReceipt(body: Record<string, unknown>): Record<string, unknown> {
  const profile = body.agent_profile as AgentProfile
  const model = String(body.model)
  const harness = model.split('/')[0] ?? model
  const parts = model.split('/')
  const requested = profile.model?.reasoningEffort ?? null
  return {
    schema: 'cli-bridge.profile-materialization.v2',
    effectiveProfileDigest: canonicalAgentProfileDigest(profile),
    harness,
    provider: parts.length >= 3 ? (parts[1] ?? null) : (profile.model?.provider ?? null),
    model,
    reasoningEffort: { requested, applied: appliedReasoning(harness, requested) },
    workspacePlanDigest: TEST_WORKSPACE_DIGEST,
    files: [],
    unsupported: [],
  }
}

/** Upgrade a fixture to the exact v2 wire: explicit cost provenance on every usage frame and one
 * terminal profile acknowledgement before `[DONE]`. */
function bridgeProtocolSse(body: string, requestBody: Record<string, unknown>): string {
  const usageBound = body
    .split('\n')
    .map((line) => {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') return line
      try {
        const payload = JSON.parse(line.slice('data: '.length)) as Record<string, unknown>
        if (payload.usage && typeof payload.usage === 'object') {
          const usage = payload.usage as Record<string, unknown>
          payload.usage = {
            ...usage,
            ...(typeof usage.cost === 'number'
              ? { cost_known: true, cost_provenance: 'provider-receipt' }
              : { cost_known: false }),
          }
        }
        return `data: ${JSON.stringify(payload)}`
      } catch {
        return line
      }
    })
    .join('\n')
  if (!usageBound.includes('data: [DONE]')) return usageBound
  return usageBound.replace(
    'data: [DONE]',
    `data: ${JSON.stringify({ profile_materialization: bridgeProfileReceipt(requestBody) })}\n\ndata: [DONE]`,
  )
}

function numberSseDataFrames(body: string): string {
  let seq = 0
  return body.replace(/^data: (?!\[DONE\])/gmu, () => `id: ${++seq}\ndata: `)
}

function durableRunHeaders(runId: string): Record<string, string> {
  return {
    'x-run-id': runId,
    'x-run-request-digest': TEST_RUN_DIGEST,
  }
}

function terminalCancelBody(runId: string): string {
  return JSON.stringify({
    cancelled: true,
    cancel_requested: true,
    terminal: true,
    run: {
      id: runId,
      requestDigest: TEST_RUN_DIGEST,
      terminal: true,
      status: 'cancelled',
      state: 'terminal',
    },
  })
}

function cancelledRunId(url: string | undefined): string | undefined {
  const match = url?.match(/^\/v1\/runs\/([^/]+)\/cancel(?:\?|$)/u)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** Serve one canned cli-bridge response body per request (HTTP 200 unless told
 *  otherwise) and hand back the bridge URL — the upstream-failure shapes under
 *  test are byte-level wire artifacts, so the test speaks real HTTP. */
async function startBridgeStub(
  body: string,
  opts: {
    status?: number
    contentType?: string
    protocol?: boolean
    onRequest?: (body: Record<string, unknown>) => void
  } = {},
): Promise<{ url: string; server: Server }> {
  const server = createServer(async (req, res) => {
    if (respondBridgeCapabilities(req, res)) return
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<
      string,
      unknown
    >
    if (opts.onRequest) {
      opts.onRequest(requestBody)
    }
    res.writeHead(opts.status ?? 200, {
      'content-type': opts.contentType ?? 'text/event-stream',
      'x-run-id': String(requestBody.run_id),
      'x-run-request-digest': TEST_RUN_DIGEST,
    })
    res.end(
      (opts.contentType ?? 'text/event-stream') === 'text/event-stream'
        ? numberSseDataFrames(opts.protocol === false ? body : bridgeProtocolSse(body, requestBody))
        : body,
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, server }
}

function makeExecutor(bridgeUrl: string) {
  const profile: AgentProfile = {
    name: 'bridge-test-worker',
    harness: 'pi',
    model: { provider: 'tangle-router', default: 'glm-5.2' },
  }
  return bridgeExecutor(
    { profile, harness: null },
    {
      signal: new AbortController().signal,
      seams: { bridge: { bridgeUrl, bridgeBearer: 'test-bearer' } },
    },
  )
}

async function drain(stream: AsyncIterable<UsageEvent>): Promise<UsageEvent[]> {
  const events: UsageEvent[] = []
  for await (const ev of stream) events.push(ev)
  return events
}

function terminalOpenAiReceipt(input: number, output: number, finishReason: string): string {
  return [
    `data: ${JSON.stringify({
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
      usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output },
    })}`,
    'data: [DONE]',
    '',
  ].join('\n\n')
}

async function consumeDirectRouterReceipt(body: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Promise.resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } })),
    ),
  )
  try {
    const profile: AgentProfile = {
      name: 'direct-router-receipt-test',
      harness: 'cli-base',
      model: {
        provider: 'tangle-router',
        default: 'glm-5.2',
        metadata: { stream: true },
      },
    }
    const executor = createExecutor({
      backend: 'router',
      routerBaseUrl: 'https://router.example.test/v1',
      routerKey: 'test-key',
      tools: [],
    })(
      {
        profile,
        harness: null,
      },
      { signal: new AbortController().signal, seams: {} },
    )
    await executor.execute('do the task', new AbortController().signal)
    return executor.resultArtifact()
  } finally {
    vi.unstubAllGlobals()
  }
}

describe('bridgeExecutor upstream-error propagation', () => {
  let server: Server | undefined
  afterEach(async () => {
    vi.unstubAllGlobals()
    if (server) await new Promise((resolve) => server?.close(resolve))
    server = undefined
  })

  it('throws the upstream error from a bare JSON error body (no SSE framing)', async () => {
    // The kimi failure shape: HTTP 200, plain JSON error object, zero SSE frames.
    // Before the tail parse this drained as one empty zero-token result.
    const stub = await startBridgeStub(
      JSON.stringify({ error: { type: 'access_terminated_error', message: 'account terminated' } }),
      { contentType: 'application/json' },
    )
    server = stub.server
    const executor = makeExecutor(stub.url)
    const stream = executor.execute('do the task', new AbortController().signal)
    await expect(drain(stream as AsyncIterable<UsageEvent>)).rejects.toThrow(
      /bridge upstream error: account terminated/,
    )
    // The run still fails loud end-to-end: no artifact was produced.
    expect(() => executor.resultArtifact()).toThrow(/before stream drained/)
  })

  it('throws from an UNTERMINATED final SSE error frame (no trailing blank line)', async () => {
    const frame = `data: ${JSON.stringify({ error: { type: 'access_terminated_error' } })}\n`
    const stub = await startBridgeStub(frame)
    server = stub.server
    const executor = makeExecutor(stub.url)
    const stream = executor.execute('do the task', new AbortController().signal)
    // No `message` on the payload — the error class must still surface, never 'unknown'.
    await expect(drain(stream as AsyncIterable<UsageEvent>)).rejects.toThrow(
      /bridge stream error: access_terminated_error/,
    )
  })

  it('still throws on a mid-stream terminated SSE error frame', async () => {
    const body = `data: ${JSON.stringify({ error: { message: 'quota exhausted' } })}\n\n`
    const stub = await startBridgeStub(body)
    server = stub.server
    const executor = makeExecutor(stub.url)
    const stream = executor.execute('do the task', new AbortController().signal)
    await expect(drain(stream as AsyncIterable<UsageEvent>)).rejects.toThrow(
      /bridge stream error: quota exhausted/,
    )
  })

  it('refuses an old bridge before any model POST', async () => {
    let posts = 0
    server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ capabilities: {} }))
        return
      }
      posts += 1
      res.writeHead(500)
      res.end()
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const executor = makeExecutor(`http://127.0.0.1:${port}`)

    await expect(
      drain(
        executor.execute(
          'must not dispatch',
          new AbortController().signal,
        ) as AsyncIterable<UsageEvent>,
      ),
    ).rejects.toThrow(/does not advertise cli-bridge\.profile-materialization\.v2/u)
    expect(posts).toBe(0)
  })

  it('rejects a v2 bridge that completes without its terminal profile acknowledgement', async () => {
    const stub = await startBridgeStub(
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'untrusted' } }] })}\n\ndata: [DONE]\n\n`,
      { protocol: false },
    )
    server = stub.server
    const executor = makeExecutor(stub.url)

    await expect(
      drain(
        executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
      ),
    ).rejects.toThrow(/completed without cli-bridge\.profile-materialization\.v2/u)
    expect(() => executor.resultArtifact()).toThrow(/before stream drained/u)
  })

  it('rejects a terminal profile acknowledgement with the wrong effective profile digest', async () => {
    const badReceipt = {
      schema: 'cli-bridge.profile-materialization.v2',
      effectiveProfileDigest: `sha256:${'f'.repeat(64)}`,
      harness: 'kimi-k2',
      provider: null,
      model: 'kimi-k2',
      reasoningEffort: { requested: null, applied: null },
      workspacePlanDigest: TEST_WORKSPACE_DIGEST,
      files: [],
      unsupported: [],
    }
    const stub = await startBridgeStub(
      `data: ${JSON.stringify({ profile_materialization: badReceipt })}\n\ndata: [DONE]\n\n`,
      { protocol: false },
    )
    server = stub.server
    const executor = makeExecutor(stub.url)

    await expect(
      drain(
        executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
      ),
    ).rejects.toThrow(/bridge materialized profile .* expected/u)
  })

  it('drains a healthy stream unchanged and settles the artifact (tail parse is inert)', async () => {
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'final answer' } }] })}`,
      `data: ${JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 4, cost: 0.01 } })}`,
      'data: [DONE]',
    ]
    const stub = await startBridgeStub(`${chunks.join('\n\n')}\n\n`)
    server = stub.server
    const executor = makeExecutor(stub.url)
    const events = await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )
    expect(events).toContainEqual({ kind: 'tokens', input: 10, output: 4 })
    const artifact = executor.resultArtifact()
    expect(artifact.out).toMatchObject({ content: 'final answer' })
    expect(artifact.spent.tokens).toEqual({ input: 10, output: 4 })
  })

  it('meters the same terminal OpenAI receipt through direct Router and bridge paths', async () => {
    const receipt = terminalOpenAiReceipt(3_020, 55, 'stop')
    const direct = await consumeDirectRouterReceipt(receipt)
    const stub = await startBridgeStub(receipt)
    server = stub.server
    const executor = makeExecutor(stub.url)
    const events = await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    expect(direct).toMatchObject({
      out: { finishReason: 'stop' },
      spent: { tokens: { input: 3_020, output: 55 } },
    })
    expect(events.filter((event) => event.kind === 'tokens')).toEqual([
      { kind: 'tokens', input: 3_020, output: 55 },
    ])
    expect(executor.resultArtifact().spent.tokens).toEqual(direct.spent.tokens)
  })

  it('meters an error-shaped terminal OpenAI receipt instead of treating it as free', async () => {
    const receipt = terminalOpenAiReceipt(408, 12, 'error')
    const direct = await consumeDirectRouterReceipt(receipt)
    const stub = await startBridgeStub(receipt)
    server = stub.server
    const executor = makeExecutor(stub.url)
    const events = await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    expect(direct).toMatchObject({
      out: { finishReason: 'error' },
      spent: { tokens: { input: 408, output: 12 } },
    })
    expect(events.filter((event) => event.kind === 'tokens')).toEqual([
      { kind: 'tokens', input: 408, output: 12 },
    ])
    expect(executor.resultArtifact().spent.tokens).toEqual(direct.spent.tokens)
  })

  it('meters one iteration per bridge turn instead of one per content chunk', async () => {
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'first ' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'second ' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'third' } }] })}`,
      `data: ${JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 4, cost: 0.01 } })}`,
      'data: [DONE]',
    ]
    const stub = await startBridgeStub(`${chunks.join('\n\n')}\n\n`)
    server = stub.server
    const executor = makeExecutor(stub.url)
    const events = await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    expect(events.filter((event) => event.kind === 'iteration')).toHaveLength(1)
    const normalized = spendFromUsageEvents(events)
    const artifact = executor.resultArtifact()
    expect(artifact.out).toMatchObject({ content: 'first second third' })
    expect(normalized).toEqual({ ...artifact.spent, ms: 0 })
  })

  it('sends the complete canonical profile once and lets it select the harness and model', async () => {
    let requestBody: Record<string, unknown> | undefined
    const stub = await startBridgeStub('data: [DONE]\n\n', {
      onRequest: (body) => {
        requestBody = body
      },
    })
    server = stub.server
    const profile: AgentProfile = {
      name: 'research-leader',
      description: 'Design and supervise discriminating experiments',
      harness: 'codex',
      prompt: {
        systemPrompt: 'Lead the pursuit.',
        instructions: ['Prefer falsifiable hypotheses.'],
      },
      model: { provider: 'openai', default: 'gpt-5.6', reasoningEffort: 'high' },
      permissions: { shell: 'ask' },
      tools: { web: true },
      mcp: {
        literature: { transport: 'http', url: 'https://papers.example.test/mcp' },
      },
      subagents: {
        reviewer: { description: 'Challenge the evidence', prompt: 'Find confounds.' },
      },
      resources: {
        skills: [{ kind: 'inline', name: 'hypothesis', content: '# Hypothesis\nTest mechanisms.' }],
        failOnError: true,
      },
      hooks: { afterTool: [{ command: './record-result', blocking: true }] },
      modes: { adversarial: { prompt: 'Try to falsify the leading claim.' } },
      metadata: { role: 'driver', source: 'test-fixture' },
    }
    const executor = bridgeExecutor(
      { profile, harness: null },
      {
        signal: new AbortController().signal,
        seams: {
          bridge: { bridgeUrl: stub.url, bridgeBearer: 'test-bearer' },
        },
      },
    )
    await drain(
      executor.execute(
        'design the experiment',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>,
    )

    expect(requestBody?.model).toBe('codex/openai/gpt-5.6')
    expect(requestBody?.agent_profile).toEqual(profile)
    expect(requestBody?.messages).toEqual([{ role: 'user', content: 'design the experiment' }])
  })

  it('marks dollar cost unknown when the bridge reports no price', async () => {
    const stub = await startBridgeStub(
      `data: ${JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
    )
    server = stub.server
    const executor = makeExecutor(stub.url)
    await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )
    expect(executor.resultArtifact().spent).toMatchObject({
      tokens: { input: 3, output: 2 },
      usd: 0,
      usdKnown: false,
    })
  })

  it('lets a trusted terminal total supersede an earlier incomplete cost chunk', async () => {
    const body = [
      `data: ${JSON.stringify({
        usage: {
          prompt_tokens: 3,
          completion_tokens: 2,
          cost_known: false,
          cost_scope: 'incremental',
        },
      })}`,
      `data: ${JSON.stringify({
        usage: {
          cost: 0.012,
          cost_known: true,
          cost_provenance: 'billing-receipt',
          cost_scope: 'total',
        },
      })}`,
      'data: [DONE]',
    ].join('\n\n')
    const stub = await startBridgeStub(`${body}\n\n`)
    server = stub.server
    const executor = makeExecutor(stub.url)

    const events = await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    expect(events).toContainEqual({ kind: 'cost', usd: 0.012 })
    expect(executor.resultArtifact().spent).toMatchObject({ usd: 0.012 })
    expect(executor.resultArtifact().spent.usdKnown).not.toBe(false)
  })

  it('preserves absent prompt-cache fields instead of inventing zeroes', async () => {
    const body = `data: ${JSON.stringify({
      usage: {
        prompt_tokens: 7,
        completion_tokens: 2,
        fresh_input_tokens: 7,
      },
    })}\n\ndata: [DONE]\n\n`
    const stub = await startBridgeStub(body)
    server = stub.server
    const executor = makeExecutor(stub.url)

    await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    const out = executor.resultArtifact().out as {
      promptCache?: Record<string, number>
    }
    expect(out.promptCache).toEqual({ freshInput: 7 })
    expect(out.promptCache).not.toHaveProperty('readInput')
    expect(out.promptCache).not.toHaveProperty('writeInput')
  })

  it('keeps dollar cost unknown when a later completed turn omits price', async () => {
    let requests = 0
    let deliver: (message: unknown) => void = () => {}
    server = createServer(async (req, res) => {
      if (respondBridgeCapabilities(req, res)) return
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
        string,
        unknown
      >
      const runId = String(requestBody.run_id)
      requests += 1
      if (requests === 1) deliver({ steer: 'check the edge case too' })
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        ...durableRunHeaders(runId),
      })
      const usage =
        requests === 1
          ? { prompt_tokens: 3, completion_tokens: 2, cost: 0.01 }
          : { prompt_tokens: 4, completion_tokens: 1 }
      res.end(
        numberSseDataFrames(
          bridgeProtocolSse(
            `data: ${JSON.stringify({ choices: [{ delta: { content: `turn-${requests}` } }], usage })}\n\ndata: [DONE]\n\n`,
            requestBody,
          ),
        ),
      )
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const executor = makeExecutor(`http://127.0.0.1:${port}`)
    deliver = (message) => executor.deliver?.(message)

    await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    expect(requests).toBe(2)
    expect(executor.resultArtifact().spent).toMatchObject({
      iterations: 2,
      tokens: { input: 7, output: 3 },
      usd: 0.01,
      usdKnown: false,
    })
  })

  it.each([
    { defect: 'changed run id', expected: /run identity mismatch/u },
    { defect: 'changed request digest', expected: /request digest changed/u },
    { defect: 'skipped replay event', expected: /replay gap: expected event 2, received 3/u },
  ])('fails closed when a reconnect has a $defect', async ({ defect, expected }) => {
    const requests: Array<{
      body: Record<string, unknown>
      lastEventId: string | undefined
    }> = []
    server = createServer(async (req, res) => {
      if (respondBridgeCapabilities(req, res)) return
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      const runId = String(body.run_id)
      requests.push({ body, lastEventId: firstHeader(req.headers['last-event-id']) })
      const responseRunId =
        requests.length === 2 && defect === 'changed run id' ? `wrong-${runId}` : runId
      const responseDigest =
        requests.length === 2 && defect === 'changed request digest'
          ? `sha256:${'c'.repeat(64)}`
          : TEST_RUN_DIGEST
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'x-run-id': responseRunId,
        'x-run-request-digest': responseDigest,
      })
      if (requests.length === 1) {
        res.end(
          `id: 1\n${bridgeProtocolSse(`data: ${JSON.stringify({ usage: { prompt_tokens: 1 } })}\n\n`, body)}`,
        )
        return
      }
      const eventId = defect === 'skipped replay event' ? 3 : 2
      res.end(
        `id: ${eventId}\n${bridgeProtocolSse(`data: ${JSON.stringify({ usage: { completion_tokens: 1 } })}\n\ndata: [DONE]\n\n`, body)}`,
      )
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const executor = makeExecutor(`http://127.0.0.1:${port}`)

    await expect(
      drain(
        executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
      ),
    ).rejects.toThrow(expected)
    expect(requests).toHaveLength(2)
    expect(requests[1]?.body).toEqual(requests[0]?.body)
    expect(requests[1]?.lastEventId).toBe('1')
  })

  it('reattaches one live execution after disconnect and cancels that exact run on teardown', async () => {
    const chatRequests: Array<{
      body: Record<string, unknown>
      lastEventId: string | undefined
    }> = []
    const liveRuns = new Set<string>()
    const cancelledRuns: string[] = []
    let executions = 0
    let reattached: () => void = () => {}
    const reattachedPromise = new Promise<void>((resolve) => {
      reattached = resolve
    })
    let cancelSeen: () => void = () => {}
    const cancelSeenPromise = new Promise<void>((resolve) => {
      cancelSeen = resolve
    })
    let acknowledgeTerminal: () => void = () => {}
    const terminalAcknowledged = new Promise<void>((resolve) => {
      acknowledgeTerminal = resolve
    })

    server = createServer(async (req, res) => {
      if (respondBridgeCapabilities(req, res)) return
      const cancelledId = cancelledRunId(req.url)
      if (cancelledId) {
        cancelledRuns.push(cancelledId)
        cancelSeen()
        await terminalAcknowledged
        liveRuns.delete(cancelledId)
        res.writeHead(200, {
          'content-type': 'application/json',
          ...durableRunHeaders(cancelledId),
        })
        res.end(terminalCancelBody(cancelledId))
        return
      }

      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      const runId = String(body.run_id)
      chatRequests.push({ body, lastEventId: firstHeader(req.headers['last-event-id']) })
      if (!liveRuns.has(runId)) {
        liveRuns.add(runId)
        executions += 1
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        ...durableRunHeaders(runId),
      })
      if (chatRequests.length === 1) {
        res.write(
          `id: 1\n${bridgeProtocolSse(`data: ${JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\n`, body)}`,
        )
        setTimeout(() => res.destroy(), 5)
        return
      }
      reattached()
      // Keep the second reader attached. Only the explicit cancel endpoint
      // changes the logical run state; closing either socket does not.
      res.write(': attached\n\n')
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const executor = makeExecutor(`http://127.0.0.1:${port}`)
    const iterator = (
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>
    )[Symbol.asyncIterator]()

    expect(await iterator.next()).toMatchObject({
      value: { kind: 'tokens', input: 5, output: 2 },
      done: false,
    })
    const draining = drain({ [Symbol.asyncIterator]: () => iterator }).catch((error) => error)
    await reattachedPromise

    expect(executions).toBe(1)
    expect(liveRuns.size).toBe(1)
    expect(chatRequests).toHaveLength(2)
    expect(chatRequests[1]?.body).toEqual(chatRequests[0]?.body)
    expect(chatRequests[1]?.lastEventId).toBe('1')

    let teardownSettled = false
    const teardown = executor.teardown('infinity').then((receipt) => {
      teardownSettled = true
      return receipt
    })
    await cancelSeenPromise
    await Promise.resolve()
    expect(teardownSettled).toBe(false)
    expect(liveRuns.size).toBe(1)
    acknowledgeTerminal()
    await expect(teardown).resolves.toEqual({ destroyed: true })
    await draining
    expect(cancelledRuns).toEqual([chatRequests[0]?.body.run_id])
    expect(liveRuns.size).toBe(0)
  })

  it('interrupts an active response body, accounts its partial usage, and resumes with the steer', async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    const liveRuns = new Set<string>()
    const cancelledRuns: string[] = []
    server = createServer(async (req, res) => {
      if (respondBridgeCapabilities(req, res)) return
      const cancelledId = cancelledRunId(req.url)
      if (cancelledId) {
        cancelledRuns.push(cancelledId)
        liveRuns.delete(cancelledId)
        res.writeHead(200, {
          'content-type': 'application/json',
          ...durableRunHeaders(cancelledId),
        })
        res.end(terminalCancelBody(cancelledId))
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
        string,
        unknown
      >
      requestBodies.push(requestBody)
      const runId = String(requestBody.run_id)
      liveRuns.add(runId)
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        ...durableRunHeaders(runId),
      })
      if (requestBodies.length === 1) {
        res.write(
          `id: 1\n${bridgeProtocolSse(`data: ${JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\n`, requestBody)}`,
        )
        return
      }
      res.end(
        numberSseDataFrames(
          bridgeProtocolSse(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: 'corrected answer' } }],
              usage: { prompt_tokens: 3, completion_tokens: 1, cost: 0.01 },
            })}\n\ndata: [DONE]\n\n`,
            requestBody,
          ),
        ),
      )
      liveRuns.delete(runId)
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const executor = makeExecutor(`http://127.0.0.1:${port}`)
    const iterator = (
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>
    )[Symbol.asyncIterator]()

    expect(await iterator.next()).toMatchObject({
      value: { kind: 'tokens', input: 5, output: 2 },
      done: false,
    })
    executor.deliver?.({ steer: 'stop and use the corrected method', interrupt: true })
    const remaining = await drain({ [Symbol.asyncIterator]: () => iterator })

    expect(remaining).toContainEqual({ kind: 'tokens', input: 3, output: 1 })
    expect(requestBodies).toHaveLength(2)
    expect(cancelledRuns).toEqual([requestBodies[0]?.run_id])
    expect(liveRuns.size).toBe(0)
    expect(requestBodies[1]?.messages).toEqual([
      {
        role: 'user',
        content: expect.stringContaining('stop and use the corrected method'),
      },
    ])
    expect(executor.resultArtifact()).toMatchObject({
      out: { content: 'corrected answer' },
      spent: {
        iterations: 2,
        tokens: { input: 8, output: 3 },
        usd: 0.01,
        usdKnown: false,
      },
    })
  })

  it('marks pre-header interrupted bridge work unknown instead of treating it as free', async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    const cancelledRuns: string[] = []
    let firstRequestSeen: () => void = () => {}
    const firstRequest = new Promise<void>((resolve) => {
      firstRequestSeen = resolve
    })
    server = createServer(async (req, res) => {
      if (respondBridgeCapabilities(req, res)) return
      const cancelledId = cancelledRunId(req.url)
      if (cancelledId) {
        cancelledRuns.push(cancelledId)
        res.writeHead(200, {
          'content-type': 'application/json',
          ...durableRunHeaders(cancelledId),
        })
        res.end(terminalCancelBody(cancelledId))
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
        string,
        unknown
      >
      requestBodies.push(requestBody)
      if (requestBodies.length === 1) {
        firstRequestSeen()
        return
      }
      const runId = String(requestBody.run_id)
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        ...durableRunHeaders(runId),
      })
      res.end(
        numberSseDataFrames(
          bridgeProtocolSse(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: 'resumed answer' } }],
              usage: { prompt_tokens: 3, completion_tokens: 1, cost: 0.01 },
            })}\n\ndata: [DONE]\n\n`,
            requestBody,
          ),
        ),
      )
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const executor = makeExecutor(`http://127.0.0.1:${port}`)
    const draining = drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    await firstRequest
    executor.deliver?.({ steer: 'resume with the corrected plan', interrupt: true })
    await draining

    expect(requestBodies).toHaveLength(2)
    expect(cancelledRuns).toEqual([requestBodies[0]?.run_id])
    expect(executor.resultArtifact()).toMatchObject({
      out: { content: 'resumed answer' },
      spent: {
        iterations: 2,
        tokens: { input: 3, output: 1 },
        tokensKnown: false,
        usd: 0.01,
        usdKnown: false,
      },
    })
  })
})

/**
 * The harness-control channel. There is no argv field on `BridgeSeam` on purpose (see its doc):
 * a worker isolates its harness by DECLARING it on the `AgentProfile`, and cli-bridge maps that
 * declaration onto each harness's native flags.
 *
 * These pin the half of that contract this package owns — the declaration reaching the wire
 * unmodified. It is worth pinning because the failure is SILENT: a body-shaping change that drops
 * or filters `agent_profile.extensions` does not fail a request, it just starts the harness with
 * its ambient extensions loaded. For a paired experiment whose arms must not share state, that is
 * a state leak between arms that no assertion downstream can see.
 */
describe('bridgeExecutor harness control rides the profile, not argv', () => {
  let server: Server | undefined
  afterEach(async () => {
    if (server) await new Promise((resolve) => server?.close(resolve))
    server = undefined
  })

  const okFrame = `data: ${JSON.stringify({
    choices: [{ delta: { content: 'done' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  })}\n\ndata: [DONE]\n\n`

  it('forwards the spawn profile’s per-harness extension controls verbatim', async () => {
    const bodies: Record<string, unknown>[] = []
    const stub = await startBridgeStub(okFrame, { onRequest: (body) => bodies.push(body) })
    server = stub.server
    // `extensions: { pi: { load: [] } }` is how a caller says "load NO ambient extensions" —
    // the declarative form of pi's `--no-extensions`, and the reason a rig that must not carry
    // state between arms does not need its own executor.
    const profile: AgentProfile = {
      name: 'isolated-worker',
      harness: 'pi',
      model: { provider: 'tangle-router', default: 'glm-5.2' },
      extensions: { pi: { load: [] } },
    }
    const executor = bridgeExecutor(
      { profile, harness: null },
      {
        signal: new AbortController().signal,
        seams: {
          bridge: { bridgeUrl: stub.url, bridgeBearer: 'test-bearer' },
        },
      },
    )
    await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    expect(bodies).toHaveLength(1)
    expect(bodies[0]?.agent_profile).toMatchObject({
      name: 'isolated-worker',
      extensions: { pi: { load: [] } },
    })
    // And no argv channel was invented alongside it.
    expect(Object.keys(bodies[0] ?? {})).not.toContain('args')
  })
})
