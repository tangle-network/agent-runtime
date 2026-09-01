import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { estimateCost } from '@tangle-network/agent-eval'
import {
  type AgentProfile,
  canonicalAgentProfileDigest,
  type ReasoningEffort,
} from '@tangle-network/agent-interface'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  materializeTreeView,
  replaySpawnTree,
} from '../../durable/spawn-journal'
import { BackendTransportError } from '../../errors'
import { spendFromUsageEvents } from './budget'
import { classifyDriverFailure } from './driver-retry'
import {
  runtimeOwnedExecutorMaterialization,
  runtimeOwnedExecutorProviderEvidence,
} from './materialization'
import {
  type BridgeModelCredential,
  bridgeExecutor,
  captureReusableExecutorConfig,
  createExecutor,
  createExecutorRegistry,
} from './runtime'
import { createSupervisor } from './supervisor'
import type { Agent, AgentSpec, Scope, SpawnEvent, UsageEvent } from './types'

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

/**
 * What cli-bridge 0.3.0 really puts in `reasoningEffort.applied`, transcribed from the argv
 * builders that spawn each CLI and NOT from `nativeReasoningControl`. Reading the shared table
 * here would make this test assert that the runtime agrees with itself, which is how a stale
 * codex expectation survived long enough to refuse three of the seven rungs in production.
 *
 * A harness with no case plumbs no thinking flag, so its receipt carries `null` — gemini derives
 * its budget from the model, and the rest read no reasoning effort at all.
 */
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
  if (harness === 'codex') return requested === 'ultracode' ? 'ultra' : requested
  if (harness === 'kimi-code') {
    if (requested === 'medium') return null
    return requested === 'none' || requested === 'minimal' || requested === 'low'
      ? '--no-thinking'
      : '--thinking'
  }
  if (harness === 'opencode') return requested
  return null
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
    onRequest?: (body: Record<string, unknown>, req: IncomingMessage) => void
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
      opts.onRequest(requestBody, req)
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

function makeExecutor(bridgeUrl: string, modelCredential?: BridgeModelCredential) {
  const profile: AgentProfile = {
    name: 'bridge-test-worker',
    harness: 'pi',
    model: { provider: 'tangle-router', default: 'glm-5.2' },
  }
  return bridgeExecutor(
    { profile, harness: null },
    {
      signal: new AbortController().signal,
      seams: {
        bridge: {
          bridgeUrl,
          bridgeBearer: 'test-bearer',
          ...(modelCredential === undefined ? {} : { modelCredential }),
        },
      },
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

  it('publishes a terminal profile acknowledgement before rethrowing a provider error', async () => {
    const body = [
      `data: ${JSON.stringify({ error: { message: 'provider failed' } })}`,
      'data: [DONE]',
      '',
    ].join('\n\n')
    const stub = await startBridgeStub(body)
    server = stub.server
    const executor = makeExecutor(stub.url)

    await expect(
      drain(
        executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
      ),
    ).rejects.toThrow(/bridge stream error: provider failed/)
    expect(runtimeOwnedExecutorMaterialization(executor)).toBeDefined()
  })

  it('carries the upstream status the bridge reports in its message, so a 400 is not retried', async () => {
    // The bridge reports the provider status as TEXT inside the message, and `status` was left
    // undefined. `classifyDriverFailure` reads `status`, so a malformed request took the
    // "unknown, assume a bad moment" branch and the driver retried it to the ceiling — measured at
    // 12 attempts against `The max_tokens parameter is illegal`, which fails identically forever.
    const body = [
      `data: ${JSON.stringify({
        error: {
          message:
            'pi assistant turn failed: 400: {"message":"The max_tokens parameter is illegal.","type":"invalid_request_error"}',
        },
      })}`,
      'data: [DONE]',
      '',
    ].join('\n\n')
    const stub = await startBridgeStub(body)
    server = stub.server
    const executor = makeExecutor(stub.url)

    const failure = await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    ).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(BackendTransportError)
    expect((failure as BackendTransportError).status).toBe(400)
    expect(classifyDriverFailure(failure)).toBe('terminal')
  })

  it('leaves a 503 retryable, so a provider outage still recovers', async () => {
    const body = [
      `data: ${JSON.stringify({
        error: { message: 'pi assistant turn failed: 503: {"message":"Platform unreachable"}' },
      })}`,
      'data: [DONE]',
      '',
    ].join('\n\n')
    const stub = await startBridgeStub(body)
    server = stub.server
    const executor = makeExecutor(stub.url)

    const failure = await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    ).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect((failure as BackendTransportError).status).toBe(503)
    expect(classifyDriverFailure(failure)).toBe('transient')
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

  it('reports the bridge error, not the missing receipt, when the bridge refused the profile', async () => {
    // A bridge that refuses a profile at setup fails before it can retain a receipt, so the
    // absence is downstream of the refusal. The refusal message is the only actionable text on
    // the wire and it names the fix; reporting the absence instead renames a fixable profile
    // defect as a broken transport.
    const body = [
      `data: ${JSON.stringify({
        error: {
          message:
            'backend opencode cannot replace its harness’s system prompt: agent_profile.prompt.systemPrompt deletes the harness’s own prompt, and this backend has no control that does that. Use agent_profile.prompt.appendSystemPrompt',
        },
      })}`,
      'data: [DONE]',
      '',
    ].join('\n\n')
    const stub = await startBridgeStub(body, { protocol: false })
    server = stub.server
    const executor = makeExecutor(stub.url)

    await expect(
      drain(
        executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
      ),
    ).rejects.toThrow(/appendSystemPrompt/u)
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
    expect(artifact.spent.tokens).toEqual({ input: 10, output: 4, cacheBreakdownKnown: false })
  })

  it('retains the provider response model and fingerprint in the Runtime artifact', async () => {
    const responseModel = 'glm-5.2@fp_provider_snapshot_20260811'
    const chunks = [
      `data: ${JSON.stringify({
        model: responseModel,
        system_fingerprint: 'fp_provider_snapshot_20260811',
        choices: [{ delta: { content: 'identified' } }],
      })}`,
      `data: ${JSON.stringify({
        model: responseModel,
        system_fingerprint: 'fp_provider_snapshot_20260811',
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      })}`,
      'data: [DONE]',
    ]
    const stub = await startBridgeStub(`${chunks.join('\n\n')}\n\n`)
    server = stub.server
    const executor = makeExecutor(stub.url)

    await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    expect(executor.resultArtifact().out).toMatchObject({
      model: responseModel,
      system_fingerprint: 'fp_provider_snapshot_20260811',
    })
  })

  it('accepts a routed DeepSeek response and retains its upstream identity', async () => {
    const responseModel = 'deepseek/deepseek-v4-flash@fp_a18b46594c_prod0820_fp8_kvcache_20260402'
    const chunks = [
      `data: ${JSON.stringify({
        model: 'pi/tangle-router/deepseek-v4-flash',
        choices: [{ delta: { content: 'routed' } }],
      })}`,
      `data: ${JSON.stringify({
        model: responseModel,
        system_fingerprint: 'fp_a18b46594c_prod0820_fp8_kvcache_20260402',
        choices: [{ delta: { content: ' response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      })}`,
      'data: [DONE]',
    ]
    const stub = await startBridgeStub(`${chunks.join('\n\n')}\n\n`)
    server = stub.server
    const profile: AgentProfile = {
      name: 'routed-deepseek-worker',
      harness: 'pi',
      model: { provider: 'tangle-router', default: 'deepseek-v4-flash' },
    }
    const executor = bridgeExecutor(
      { profile, harness: null },
      {
        signal: new AbortController().signal,
        seams: { bridge: { bridgeUrl: stub.url, bridgeBearer: 'test-bearer' } },
      },
    )

    await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    expect(executor.resultArtifact().out).toMatchObject({
      content: 'routed response',
      model: responseModel,
      system_fingerprint: 'fp_a18b46594c_prod0820_fp8_kvcache_20260402',
    })
    expect(runtimeOwnedExecutorProviderEvidence(executor)).toEqual({
      status: 'known',
      attempts: [{ observations: [responseModel] }],
      models: [responseModel],
    })
  })

  it('rejects a routed stream that changes its provider snapshot', async () => {
    const chunks = [
      `data: ${JSON.stringify({
        model: 'deepseek/deepseek-v4-flash@fp_a',
        choices: [{ delta: { content: 'partial' } }],
      })}`,
      `data: ${JSON.stringify({
        model: 'deepseek/deepseek-v4-flash@fp_b',
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      })}`,
      'data: [DONE]',
    ]
    const stub = await startBridgeStub(`${chunks.join('\n\n')}\n\n`)
    server = stub.server
    const profile: AgentProfile = {
      name: 'routed-deepseek-worker',
      harness: 'pi',
      model: { provider: 'tangle-router', default: 'deepseek-v4-flash' },
    }
    const executor = bridgeExecutor(
      { profile, harness: null },
      {
        signal: new AbortController().signal,
        seams: { bridge: { bridgeUrl: stub.url, bridgeBearer: 'test-bearer' } },
      },
    )

    await expect(
      drain(
        executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
      ),
    ).rejects.toThrow(/bridge changed response model/u)
    expect(runtimeOwnedExecutorProviderEvidence(executor)).toEqual({
      status: 'unknown',
      attempts: [
        {
          observations: ['deepseek/deepseek-v4-flash@fp_a', 'deepseek/deepseek-v4-flash@fp_b'],
          identityConflict: true,
        },
      ],
      models: ['deepseek/deepseek-v4-flash@fp_a', 'deepseek/deepseek-v4-flash@fp_b'],
      reason: 'provider-model-conflict',
    })
  })

  it('journals served identity and paid usage when a bridge child aborts before terminal materialization', async () => {
    const servedModel = 'tangle-router/deepseek-v4-flash@fp_provider_snapshot_abort'
    let abortChild: (() => void) | undefined
    let resolveCancel!: () => void
    const cancelSeen = new Promise<void>((resolve) => {
      resolveCancel = resolve
    })
    server = createServer(async (req, res) => {
      if (respondBridgeCapabilities(req, res)) return
      if (req.method === 'POST' && req.url?.startsWith('/v1/runs/')) {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const runId = cancelledRunId(req.url)
        if (runId !== undefined) {
          resolveCancel()
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(terminalCancelBody(runId))
          return
        }
      }
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.writeHead(404)
        res.end()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      const runId = String(body.run_id)
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'x-run-id': runId,
        'x-run-request-digest': TEST_RUN_DIGEST,
      })
      res.write(
        `id: 1\ndata: ${JSON.stringify({
          model: servedModel,
          choices: [{ delta: { content: 'partial' } }],
        })}\n\n`,
      )
      res.write(
        `id: 2\ndata: ${JSON.stringify({
          model: servedModel,
          usage: {
            prompt_tokens: 17,
            completion_tokens: 3,
            cost: 0.01,
            cost_known: true,
            cost_provenance: 'provider-receipt',
          },
        })}\n\n`,
      )
      setTimeout(() => abortChild?.(), 10)
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const bridgeUrl = `http://127.0.0.1:${port}`
    const profile: AgentProfile = {
      name: 'abort-identity-child',
      harness: 'pi',
      model: { provider: 'tangle-router', default: 'deepseek-v4-flash' },
    }
    const child: Agent<unknown, unknown> = {
      name: 'bridge-child',
      act: async () => undefined,
      executorSpec: {
        profile,
        harness: null,
        executorFactory: (_spec, ctx) =>
          bridgeExecutor(
            { profile, harness: null },
            {
              signal: ctx.signal,
              node: ctx.node,
              seams: { bridge: { bridgeUrl, bridgeBearer: 'test-bearer' } },
            },
          ),
      },
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    const root: Agent<unknown, unknown> = {
      name: 'root',
      async act(_task, scope: Scope<unknown>) {
        const spawned = scope.spawn(child, 'partial task', {
          label: 'abort-identity-child',
          budget: { maxIterations: 4, maxTokens: 1_000 },
        })
        if (!spawned.ok) throw new Error(spawned.reason)
        abortChild = () => spawned.handle.abort('abort after paid model frame')
        return scope.next()
      },
    }
    const journal = new InMemorySpawnJournal()
    const runId = 'bridge-abort-provider-identity'
    await createSupervisor<unknown, unknown>().run(root, 'root task', {
      budget: { maxIterations: 10, maxTokens: 10_000 },
      runId,
      journal,
      blobs: new InMemoryResultBlobStore(),
      executors: createExecutorRegistry(),
    })
    await cancelSeen
    const events = (await journal.loadTree(runId)) ?? []
    const settlement = events.find(
      (event): event is Extract<SpawnEvent, { kind: 'settled' }> =>
        event.kind === 'settled' && event.id.endsWith(':s0'),
    )
    expect(settlement?.status).toBe('down')
    expect(settlement?.spent.tokens).toMatchObject({ input: 17, output: 3 })
    expect(settlement?.providerModel).toEqual({
      status: 'known',
      attempts: [{ observations: [servedModel] }],
      models: [servedModel],
    })
    const view = materializeTreeView(events)
    const node = view.nodes.find((candidate) => candidate.id.endsWith(':s0'))
    expect(node?.providerModel).toEqual(settlement?.providerModel)
    const replayed = await replaySpawnTree(journal, new InMemoryResultBlobStore(), runId)
    expect(replayed[0]?.providerModel).toEqual(settlement?.providerModel)
  })

  it('resolves a live model credential immediately before the bridge POST without serializing it', async () => {
    const secret = 'model-token-must-not-leak'
    const baseUrl = 'https://router.tangle.tools/v1'
    const provider = {
      get: vi.fn(async (name: string) => {
        if (name === 'MODEL_GATEWAY_TOKEN') return secret
        if (name === 'MODEL_GATEWAY_BASE_URL') return baseUrl
        throw new Error(`unexpected key ${name}`)
      }),
    }
    const requestHeaders: Array<string | undefined> = []
    const requestBaseUrls: Array<string | undefined> = []
    const stub = await startBridgeStub('data: [DONE]\n\n', {
      onRequest: (_body, req) => {
        requestHeaders.push(firstHeader(req.headers['x-cli-bridge-model-credential']))
        requestBaseUrls.push(firstHeader(req.headers['x-cli-bridge-model-base-url']))
      },
    })
    server = stub.server
    const captured = captureReusableExecutorConfig(
      {
        backend: 'bridge',
        bridgeUrl: stub.url,
        bridgeBearer: 'test-bearer',
        modelCredential: {
          key: 'MODEL_GATEWAY_TOKEN',
          baseUrlKey: 'MODEL_GATEWAY_BASE_URL',
          provider,
        },
      },
      'credential-test',
    )

    expect(JSON.stringify(captured)).not.toContain(secret)
    expect(captured.backend === 'bridge' ? captured.modelCredential?.key : undefined).toBe(
      'MODEL_GATEWAY_TOKEN',
    )
    expect(captured.backend === 'bridge' ? captured.modelCredential?.provider : undefined).toBe(
      provider,
    )

    const profile: AgentProfile = {
      name: 'credential-worker',
      harness: 'pi',
      model: { provider: 'tangle-router', default: 'deepseek-v4-flash' },
    }
    const executor = createExecutor(captured)(
      { profile, harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    await drain(
      executor.execute(
        'use the protected model',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>,
    )

    expect(provider.get).toHaveBeenCalledTimes(2)
    expect(provider.get).toHaveBeenNthCalledWith(1, 'MODEL_GATEWAY_TOKEN')
    expect(provider.get).toHaveBeenNthCalledWith(2, 'MODEL_GATEWAY_BASE_URL')
    expect(requestHeaders).toEqual([secret])
    expect(requestBaseUrls).toEqual([baseUrl])
  })

  it('fails before a model POST when the request credential is missing', async () => {
    let posts = 0
    const stub = await startBridgeStub('data: [DONE]\n\n', {
      onRequest: () => {
        posts += 1
      },
    })
    server = stub.server
    const executor = bridgeExecutor(
      {
        profile: {
          name: 'missing-credential-worker',
          harness: 'pi',
          model: { provider: 'tangle-router', default: 'deepseek-v4-flash' },
        },
        harness: null,
      },
      {
        signal: new AbortController().signal,
        seams: {
          bridge: {
            bridgeUrl: stub.url,
            bridgeBearer: 'test-bearer',
            modelCredential: {
              key: 'MODEL_GATEWAY_TOKEN',
              baseUrlKey: 'MODEL_GATEWAY_BASE_URL',
              provider: { get: async () => undefined },
            },
          },
        },
      },
    )

    await expect(
      drain(
        executor.execute('must refuse', new AbortController().signal) as AsyncIterable<UsageEvent>,
      ),
    ).rejects.toThrow(/no usable value for 'MODEL_GATEWAY_TOKEN'/u)
    expect(posts).toBe(0)
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

  it('prices a turn the bridge reported no price for, and keeps the dollars unknown', async () => {
    const stub = await startBridgeStub(
      `data: ${JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
    )
    server = stub.server
    const executor = makeExecutor(stub.url)
    const events = await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )
    // glm rates over this turn's own 3 in / 2 out. The dollars reach the channel instead of a
    // zero, and they carry the marker that says the catalog priced them.
    const priced = estimateCost(3, 2, 'pi/tangle-router/glm-5.2')
    expect(priced).toBeGreaterThan(0)
    expect(events).toContainEqual({
      kind: 'cost',
      usd: priced,
      usdKnown: false,
      usdEstimated: priced,
      provenance: 'catalog-estimate',
    })
    const spend = spendFromUsageEvents(events)
    expect(spend.usdKnown).toBe(false)
    expect(spend.usd).toBe(priced)
    expect(spend.usdEstimated).toBe(priced)
    expect(executor.resultArtifact().spent).toMatchObject({
      tokens: { input: 3, output: 2 },
      usd: priced,
      usdEstimated: priced,
      usdKnown: false,
    })
  })

  it('reports no dollars for an unpriced model rather than inventing a rate', async () => {
    const stub = await startBridgeStub(
      `data: ${JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
    )
    server = stub.server
    const executor = bridgeExecutor(
      {
        profile: {
          name: 'bridge-test-worker',
          harness: 'pi',
          model: { provider: 'in-house', default: 'no-such-model-family' },
        },
        harness: null,
      },
      {
        signal: new AbortController().signal,
        seams: { bridge: { bridgeUrl: stub.url, bridgeBearer: 'test-bearer' } },
      },
    )
    const events = await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )
    expect(events).toContainEqual({
      kind: 'cost',
      usd: 0,
      usdKnown: false,
      provenance: 'uncaptured',
    })
    const spend = spendFromUsageEvents(events)
    expect(spend.usd).toBe(0)
    expect(spend.usdKnown).toBe(false)
    expect(spend.usdEstimated).toBeUndefined()
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

    expect(events).toContainEqual({
      kind: 'cost',
      usd: 0.012,
      usdKnown: true,
      provenance: 'provider-receipt',
    })
    expect(executor.resultArtifact().spent).toMatchObject({ usd: 0.012 })
    expect(executor.resultArtifact().spent.usdKnown).not.toBe(false)
  })

  it('takes a claude invocation receipt as measured dollars, with no estimated part', async () => {
    // The EXACT usage object cli-bridge emits for a claude turn carrying `total_cost_usd`
    // (drewstone/cli-bridge#159), captured off `deltaToOpenAIChunk`. Tokens and the receipt
    // arrive in ONE frame, which is the shape that must not be re-priced.
    const body = `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 12_000,
        completion_tokens: 900,
        total_tokens: 12_900,
        cost: 0.0731,
        cost_known: true,
        cost_provenance: 'provider-receipt',
        cost_scope: 'total',
      },
    })}\n\ndata: [DONE]\n\n`
    const stub = await startBridgeStub(body)
    server = stub.server
    const executor = makeExecutor(stub.url)

    const events = await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    expect(events).toContainEqual({
      kind: 'cost',
      usd: 0.0731,
      usdKnown: true,
      provenance: 'provider-receipt',
    })
    const spent = executor.resultArtifact().spent
    expect(spent).toMatchObject({ tokens: { input: 12_000, output: 900 }, usd: 0.0731 })
    // A receipt is a measurement, and a turn holding one is never catalog-priced on top.
    expect(spent.usdKnown).not.toBe(false)
    expect(spent.usdEstimated).toBeUndefined()
    expect(spendFromUsageEvents(events).usdEstimated).toBeUndefined()
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
    expect(executor.resultArtifact().spent.tokens).toEqual({
      input: 7,
      output: 2,
      freshInput: 7,
      cacheBreakdownKnown: false,
    })
  })

  it('normalizes the router Fireworks cache receipt into complete prompt classes', async () => {
    const body = `data: ${JSON.stringify({
      usage: {
        prompt_tokens: 20,
        completion_tokens: 3,
        prompt_tokens_details: { cached_tokens: 7 },
        prompt_cache: {
          enabled: true,
          status: 'read',
          provider: 'fireworks',
          request_mode: 'prompt_cache_key',
          read_tokens: 7,
          write_tokens: 0,
        },
      },
    })}\n\ndata: [DONE]\n\n`
    const stub = await startBridgeStub(body)
    server = stub.server
    const executor = makeExecutor(stub.url)

    const events = await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    expect(events).toContainEqual({
      kind: 'tokens',
      input: 20,
      output: 3,
      freshInput: 13,
      cacheRead: 7,
      cacheWrite: 0,
    })
    expect(executor.resultArtifact().spent.tokens).toEqual({
      input: 20,
      output: 3,
      freshInput: 13,
      cacheRead: 7,
      cacheWrite: 0,
    })
    // The artifact's own cache report must speak the `PromptCacheUsage` vocabulary. Every consumer
    // of `out.promptCache` reads `readTokens` / `writeTokens`; a private dialect reaches them as no
    // cache report at all, and the cost receipt then charges the re-read prefix in full.
    const out = executor.resultArtifact().out as { promptCache?: Record<string, number> }
    expect(out.promptCache).toEqual({ freshInput: 13, readTokens: 7, writeTokens: 0 })
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
    // Turn 1 billed a real $0.01. Turn 2 sent no receipt, so only turn 2's own 4 in / 1 out is
    // priced — the receipt and the estimate stay separable in the settled spend.
    const turn2 = estimateCost(4, 1, 'pi/tangle-router/glm-5.2')
    expect(executor.resultArtifact().spent).toMatchObject({
      iterations: 2,
      tokens: { input: 7, output: 3 },
      usd: 0.01 + turn2,
      usdEstimated: turn2,
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
    const credentialHeaders: Array<string | undefined> = []
    const credentialBaseUrls: Array<string | undefined> = []
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
      credentialHeaders.push(firstHeader(req.headers['x-cli-bridge-model-credential']))
      credentialBaseUrls.push(firstHeader(req.headers['x-cli-bridge-model-base-url']))
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
    const provider = {
      get: vi.fn(async (name: string) =>
        name === 'MODEL_GATEWAY_TOKEN' ? 'reattach-secret' : 'https://router.tangle.tools/v1',
      ),
    }
    const executor = makeExecutor(`http://127.0.0.1:${port}`, {
      key: 'MODEL_GATEWAY_TOKEN',
      baseUrlKey: 'MODEL_GATEWAY_BASE_URL',
      provider,
    })
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
    expect(provider.get).toHaveBeenCalledTimes(4)
    expect(credentialHeaders).toEqual(['reattach-secret', 'reattach-secret'])
    expect(credentialBaseUrls).toEqual([
      'https://router.tangle.tools/v1',
      'https://router.tangle.tools/v1',
    ])

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
    // The interrupted turn presented 5 in / 2 out and billed nothing, so it is priced. The
    // resumed turn carried a real $0.01 receipt and is not priced on top of it.
    const interruptedTurn = estimateCost(5, 2, 'pi/tangle-router/glm-5.2')
    expect(executor.resultArtifact()).toMatchObject({
      out: { content: 'corrected answer' },
      spent: {
        iterations: 2,
        tokens: { input: 8, output: 3 },
        usd: 0.01 + interruptedTurn,
        usdEstimated: interruptedTurn,
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

describe('bridgeExecutor cross-turn materialization identity', () => {
  let server: Server | undefined
  afterEach(async () => {
    if (server) await new Promise((resolve) => server?.close(resolve))
    server = undefined
  })

  /** Per-turn traffic and token counters, shaped like the live `mitten` s0 receipt pair
   *  (2026-08-22): turn 1 measured 34 requests / 1,313,406 input tokens, turn 2 measured
   *  9 / 553,971. cli-bridge's pi backend re-measures this block on EVERY turn by design. */
  function mittenObservation(turn: number): Record<string, unknown> {
    const first = turn === 1
    return {
      requests: first ? 34 : 9,
      generationRequests: first ? 21 : 6,
      auxiliaryRequests: first ? 13 : 3,
      usageReceipts: first ? 21 : 6,
      rejectedRequests: 0,
      failedRequests: 0,
      inFlightRequests: 0,
      accountingMatched: true,
      usage: {
        inputTokens: first ? 1_313_406 : 553_971,
        cacheReadInputTokens: first ? 1_201_882 : 490_027,
        outputTokens: first ? 24_118 : 9_804,
        costKnown: false,
      },
    }
  }

  /** Two-turn bridge stub: turn 1 delivers a steer so the executor re-calls the same session,
   *  and each turn acknowledges with a caller-built receipt. */
  async function runTwoTurnSession(
    receiptForTurn: (requestBody: Record<string, unknown>, turn: number) => Record<string, unknown>,
  ): Promise<{ turns: number; failure: unknown; executor: ReturnType<typeof makeExecutor> }> {
    let turns = 0
    let deliver: (message: unknown) => void = () => {}
    server = createServer(async (req, res) => {
      if (respondBridgeCapabilities(req, res)) return
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
        string,
        unknown
      >
      turns += 1
      if (turns === 1) deliver({ steer: 'check the edge case too' })
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        ...durableRunHeaders(String(requestBody.run_id)),
      })
      const frames = [
        `data: ${JSON.stringify({
          choices: [{ delta: { content: `turn-${turns}` } }],
          usage: { prompt_tokens: 5, completion_tokens: 2, cost_known: false },
        })}`,
        `data: ${JSON.stringify({ profile_materialization: receiptForTurn(requestBody, turns) })}`,
        'data: [DONE]',
        '',
      ].join('\n\n')
      res.end(numberSseDataFrames(frames))
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const executor = makeExecutor(`http://127.0.0.1:${port}`)
    deliver = (message) => executor.deliver?.(message)
    const failure = await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    ).then(
      () => undefined,
      (error: unknown) => error,
    )
    return { turns, failure, executor }
  }

  function inferenceBlock(turn: number, overrides: Record<string, unknown> = {}) {
    return {
      effectiveEndpoint: 'http://127.0.0.1:39117/v1',
      apiMode: 'openai-completions',
      transport: 'scoped-loopback',
      appliedMaxTokens: 32_768,
      observation: mittenObservation(turn),
      ...overrides,
    }
  }

  it('accepts receipts that differ ONLY in inference.observation across turns', async () => {
    // cli-bridge re-measures `inference.observation` on every turn, so two honest receipts from
    // the same session are never byte-equal; the identity compare must not read that block.
    const { turns, failure, executor } = await runTwoTurnSession((requestBody, turn) => ({
      ...bridgeProfileReceipt(requestBody),
      inference: inferenceBlock(turn),
    }))
    expect(failure).toBeUndefined()
    expect(turns).toBe(2)
    expect(runtimeOwnedExecutorMaterialization(executor)).toBeDefined()
  })

  it('still refuses a cross-turn change to a stable inference identity field', async () => {
    // Only `observation` is excluded: `effectiveEndpoint` is model-transport identity, and a
    // bridge that moves it mid-session must keep hitting the same drift refusal.
    const { failure } = await runTwoTurnSession((requestBody, turn) => ({
      ...bridgeProfileReceipt(requestBody),
      inference: inferenceBlock(
        turn,
        turn === 2 ? { effectiveEndpoint: 'http://127.0.0.1:39118/v1' } : {},
      ),
    }))
    expect(String(failure)).toMatch(/profile materialization changed across session turns/u)
  })

  it('still refuses a cross-turn change to workspacePlanDigest', async () => {
    // Format-valid digests pass the per-receipt validator, so the cross-turn compare is the
    // only guard that sees the drift.
    const { failure } = await runTwoTurnSession((requestBody, turn) => ({
      ...bridgeProfileReceipt(requestBody),
      ...(turn === 2 ? { workspacePlanDigest: `sha256:${'c'.repeat(64)}` } : {}),
      inference: inferenceBlock(turn),
    }))
    expect(String(failure)).toMatch(/profile materialization changed across session turns/u)
  })

  it('still refuses a tampered model before the cross-turn compare is reached', async () => {
    // The per-receipt validator pins `model` to the wire model on EVERY turn, so a model swap
    // fails closed one layer earlier than the cross-turn compare.
    const { failure } = await runTwoTurnSession((requestBody, turn) => ({
      ...bridgeProfileReceipt(requestBody),
      ...(turn === 2 ? { model: 'pi/tangle-router/other-model' } : {}),
      inference: inferenceBlock(turn),
    }))
    expect(String(failure)).toMatch(/bridge materialized model/u)
  })

  it('keeps receipts without any inference block byte-compared as before', async () => {
    const { turns, failure } = await runTwoTurnSession((requestBody) =>
      bridgeProfileReceipt(requestBody),
    )
    expect(failure).toBeUndefined()
    expect(turns).toBe(2)
  })

  it('accepts identical receipts whose inference block carries no observation', async () => {
    const { turns, failure } = await runTwoTurnSession((requestBody) => ({
      ...bridgeProfileReceipt(requestBody),
      inference: {
        effectiveEndpoint: 'http://127.0.0.1:39117/v1',
        apiMode: 'openai-completions',
        transport: 'scoped-loopback',
        appliedMaxTokens: 32_768,
      },
    }))
    expect(failure).toBeUndefined()
    expect(turns).toBe(2)
  })
})

/**
 * cli-bridge's own scoped-loopback accounting, credited when the stream carries no usage frame.
 *
 * The numbers are one production opencode turn transcribed verbatim: run
 * `q-zk-pr374-gating-cpu-r3` (2026-09-01, `opencode/zai-coding-plan/glm-5.3` on a subscription
 * seat) measured 17,418,155 prompt tokens of which 17,301,440 were cache reads and 116,715 were
 * fresh, against 63,455 completion tokens. The three classes partition the prompt total exactly,
 * which is the invariant every consumer of `Spend.tokens` reads.
 */
describe('bridgeExecutor credits the turn receipt cli-bridge already normalized', () => {
  let server: Server | undefined
  afterEach(async () => {
    if (server) await new Promise((resolve) => server?.close(resolve))
    server = undefined
  })

  const OPENCODE_TURN = {
    inputTokens: 17_418_155,
    freshInputTokens: 116_715,
    cacheReadInputTokens: 17_301_440,
    cacheWriteInputTokens: 0,
    outputTokens: 63_455,
    costKnown: false as const,
  }

  function observationWith(usage: Record<string, unknown>): Record<string, unknown> {
    return {
      requests: 41,
      generationRequests: 38,
      auxiliaryRequests: 3,
      usageReceipts: 38,
      rejectedRequests: 0,
      failedRequests: 0,
      inFlightRequests: 0,
      accountingMatched: true,
      usage,
    }
  }

  /** One opencode turn. `usageFrame` is the SSE `usage` object, omitted for the measured case
   *  where opencode's stream carries none. `observation` rides the turn's receipt. */
  async function runOpencodeTurn(opts: {
    observation?: Record<string, unknown>
    usageFrame?: Record<string, unknown>
  }) {
    server = createServer(async (req, res) => {
      if (respondBridgeCapabilities(req, res)) return
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
        string,
        unknown
      >
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        ...durableRunHeaders(String(requestBody.run_id)),
      })
      const receipt = {
        ...bridgeProfileReceipt(requestBody),
        ...(opts.observation === undefined
          ? {}
          : {
              inference: {
                effectiveEndpoint: 'http://127.0.0.1:4317/v1',
                apiMode: 'openai-completions',
                transport: 'scoped-loopback',
                observation: opts.observation,
              },
            }),
      }
      const frames = [
        `data: ${JSON.stringify({
          choices: [{ delta: { content: 'gate map built' } }],
          ...(opts.usageFrame === undefined ? {} : { usage: opts.usageFrame }),
        })}`,
        `data: ${JSON.stringify({ profile_materialization: receipt })}`,
        'data: [DONE]',
        '',
      ].join('\n\n')
      res.end(numberSseDataFrames(frames))
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const profile: AgentProfile = {
      name: 'lead-zk-d2',
      harness: 'opencode',
      model: { provider: 'zai-coding-plan', default: 'glm-5.3' },
    }
    const executor = bridgeExecutor(
      { profile, harness: null },
      {
        signal: new AbortController().signal,
        seams: {
          bridge: { bridgeUrl: `http://127.0.0.1:${port}`, bridgeBearer: 'test-bearer' },
        },
      },
    )
    const events = await drain(
      executor.execute(
        'build the gate map',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>,
    )
    return { events, artifact: executor.resultArtifact() }
  }

  it('reports an opencode turn whose stream carried no usage frame, cache split intact', async () => {
    const { events, artifact } = await runOpencodeTurn({
      observation: observationWith(OPENCODE_TURN),
    })

    expect(events).toContainEqual({
      kind: 'tokens',
      input: 17_418_155,
      output: 63_455,
      freshInput: 116_715,
      cacheRead: 17_301_440,
      cacheWrite: 0,
    })
    expect(artifact.spent.tokens).toMatchObject({
      input: 17_418_155,
      output: 63_455,
      freshInput: 116_715,
      cacheRead: 17_301_440,
      cacheWrite: 0,
    })
    // The receipt WAS read, so the token channel is a measured total, not a floor.
    expect(artifact.spent.tokensKnown).toBeUndefined()
    expect(artifact.out).not.toHaveProperty('tokensUnknownReason')
    expect(artifact.out).toMatchObject({
      promptCache: { freshInput: 116_715, readTokens: 17_301_440, writeTokens: 0 },
    })
  })

  it('charges a turn once when the stream reported usage AND the receipt did', async () => {
    const { events, artifact } = await runOpencodeTurn({
      observation: observationWith(OPENCODE_TURN),
      usageFrame: {
        prompt_tokens: 900,
        completion_tokens: 40,
        cache_read_input_tokens: 800,
        cache_write_input_tokens: 0,
        cost_known: false,
      },
    })

    // The canonical frame wins; the receipt's 17.4M is NOT added on top of it.
    expect(events.filter((event) => event.kind === 'tokens')).toHaveLength(1)
    expect(artifact.spent.tokens).toMatchObject({ input: 900, output: 40, cacheRead: 800 })
  })

  it('leaves the turn unknown and names the reason when the receipt omits a total', async () => {
    const { events, artifact } = await runOpencodeTurn({
      observation: observationWith({
        inputTokens: 17_418_155,
        cacheReadInputTokens: 17_301_440,
        costKnown: false,
      }),
    })

    expect(events.some((event) => event.kind === 'tokens')).toBe(false)
    expect(artifact.spent.tokensKnown).toBe(false)
    // A zero here would read as a measured free turn.
    expect(artifact.spent.tokens).toMatchObject({ input: 0, output: 0 })
    expect(artifact.out).toMatchObject({
      tokensUnknownReason: 'usage-unreadable: the turn receipt named no completion total',
    })
  })

  it('leaves the turn unknown and names the reason when the receipt carries no observation', async () => {
    const { artifact } = await runOpencodeTurn({})

    expect(artifact.spent.tokensKnown).toBe(false)
    expect(artifact.out).toMatchObject({
      tokensUnknownReason:
        'usage-unreadable: the turn receipt carried no bridge inference observation',
    })
  })

  it('keeps both measured counters and declares the split incomplete when the receipt contradicts itself', async () => {
    const { events, artifact } = await runOpencodeTurn({
      observation: observationWith({
        inputTokens: 1_000,
        // 1000 - 600 - 0 leaves 400 fresh by partition. The receipt says 300, so one of its own
        // two answers is wrong and neither may be picked as the winner.
        freshInputTokens: 300,
        cacheReadInputTokens: 600,
        cacheWriteInputTokens: 0,
        outputTokens: 25,
        costKnown: false,
      }),
    })

    expect(events).toContainEqual({
      kind: 'tokens',
      input: 1_000,
      output: 25,
      freshInput: 400,
      cacheRead: 600,
      cacheWrite: 0,
      cacheBreakdownKnown: false,
    })
    // The totals are still measured; only the classification of the prompt total is incomplete.
    expect(artifact.spent.tokensKnown).toBeUndefined()
    expect(artifact.spent.tokens.cacheBreakdownKnown).toBe(false)
  })

  it('carries a fresh count the receipt reports alone, and says the split is incomplete', async () => {
    const { events } = await runOpencodeTurn({
      observation: observationWith({
        inputTokens: 1_000,
        freshInputTokens: 400,
        outputTokens: 25,
        costKnown: false,
      }),
    })

    // One class named out of three classifies PART of the prompt total, never all of it.
    expect(events).toContainEqual({
      kind: 'tokens',
      input: 1_000,
      output: 25,
      freshInput: 400,
      cacheBreakdownKnown: false,
    })
  })
})

/**
 * The harness's own rollout, read as the receipt cli-bridge never sends.
 *
 * MEASURED MOTIVE (discovery#80, 2026-09-01). A live codex seat on this exact path metered
 * `{input: 0, output: 0, tokensKnown: false}` on 9 of 9 turns while 27,320,482 codex tokens sat in
 * the run's own rollout directory, 1,453,948 of them spent by three `spawn_agent` children the
 * journal has no row for. cli-bridge forwards no codex usage, so the store is the only receipt this
 * path produces.
 */
describe('bridgeExecutor credits the harness store cli-bridge does not forward', () => {
  let server: Server | undefined
  let storeRoot = ''
  let sessionsDir = ''

  beforeEach(async () => {
    storeRoot = await mkdtemp(join(tmpdir(), 'bridge-codex-store-'))
    sessionsDir = join(storeRoot, 'sessions', '2026', '09', '01')
    await mkdir(sessionsDir, { recursive: true })
  })

  afterEach(async () => {
    if (server) await new Promise((resolve) => server?.close(resolve))
    server = undefined
    await rm(storeRoot, { recursive: true, force: true })
  })

  const SEAT_SESSION = '01a05e99-3b2e-7023-91e4-0b43ce7d5477'
  const CHILD_SESSION = '01a05eac-c4c2-7911-9582-731c6ebfcb69'

  const rolloutLine = (row: unknown) => `${JSON.stringify(row)}\n`

  const tokenCount = (input: number, output: number, cached = 0, reasoning = 0) =>
    rolloutLine({
      timestamp: '2026-09-01T20:11:40.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: input,
            cached_input_tokens: cached,
            cache_write_input_tokens: 0,
            output_tokens: output,
            reasoning_output_tokens: reasoning,
            total_tokens: input + output,
          },
        },
      },
    })

  const taskStarted = (turnId: string, startedAt: number) =>
    rolloutLine({
      timestamp: '2026-09-01T20:11:40.000Z',
      type: 'event_msg',
      payload: { type: 'task_started', turn_id: turnId, started_at: startedAt },
    })

  /** The seat's own rollout: 25,809,518 prompt / 57,016 completion, the measured run's real total. */
  const seatRollout = () =>
    [
      rolloutLine({
        timestamp: '2026-09-01T20:11:40.000Z',
        type: 'session_meta',
        payload: {
          id: SEAT_SESSION,
          timestamp: '2026-09-01T20:11:40.000Z',
          cwd: '/work/pursuit',
          cli_version: '0.152.0',
          originator: 'codex-exec',
        },
      }),
      taskStarted('01a05e99-4000-7000-8000-00000000000a', 1_788_293_500),
      tokenCount(25_809_518, 57_016, 24_000_000, 30_000),
    ].join('')

  /**
   * One `spawn_agent` child, forked: 5,000,000 inherited prompt tokens are prepended before its own
   * turn, and only the 555,804 after the boundary belong to it.
   */
  const nativeChildRollout = () =>
    [
      rolloutLine({
        timestamp: '2026-09-01T20:33:00.000Z',
        type: 'session_meta',
        payload: {
          id: CHILD_SESSION,
          parent_thread_id: SEAT_SESSION,
          forked_from_id: SEAT_SESSION,
          thread_source: 'subagent',
          agent_nickname: 'Turing',
          agent_path: '/root/c1_b_grid',
          timestamp: '2026-09-01T20:33:00.000Z',
          cwd: '/work/pursuit',
          cli_version: '0.152.0',
          source: { subagent: { thread_spawn: { parent_thread_id: SEAT_SESSION, depth: 1 } } },
        },
      }),
      taskStarted('e6b7a614-6156-4d3e-891d-de80de86e1c9', 1_788_200_000),
      tokenCount(5_000_000, 40_000),
      taskStarted('01a05eac-c500-7000-8000-00000000000b', 1_788_294_780),
      tokenCount(5_555_804, 42_049),
    ].join('')

  /** One codex turn against a fake bridge that writes `rollouts` into the store while it runs. */
  async function runCodexTurn(opts: {
    rollouts?: ReadonlyArray<{ name: string; text: string }>
    observation?: Record<string, unknown>
    harness?: string
    workspaceRoot?: string
  }) {
    server = createServer(async (req, res) => {
      if (respondBridgeCapabilities(req, res)) return
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
        string,
        unknown
      >
      // The harness writes its own rollout while the turn runs, exactly as codex does.
      for (const rollout of opts.rollouts ?? []) {
        await writeFile(join(sessionsDir, rollout.name), rollout.text)
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        ...durableRunHeaders(String(requestBody.run_id)),
      })
      const receipt = {
        ...bridgeProfileReceipt(requestBody),
        ...(opts.observation === undefined
          ? {}
          : {
              inference: {
                effectiveEndpoint: 'http://127.0.0.1:4317/v1',
                apiMode: 'openai-completions',
                transport: 'scoped-loopback',
                observation: opts.observation,
              },
            }),
      }
      const frames = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'pareto knee mapped' } }] })}`,
        `data: ${JSON.stringify({ profile_materialization: receipt })}`,
        'data: [DONE]',
        '',
      ].join('\n\n')
      res.end(numberSseDataFrames(frames))
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const profile: AgentProfile = {
      name: 'research-lead-codex',
      harness: 'codex',
      model: { provider: 'openai', default: 'gpt-5.6-sol' },
    }
    const executor = bridgeExecutor(
      { profile, harness: null },
      {
        signal: new AbortController().signal,
        seams: {
          bridge: {
            bridgeUrl: `http://127.0.0.1:${port}`,
            bridgeBearer: 'test-bearer',
            harnessStore: {
              harness: opts.harness ?? 'codex',
              root: storeRoot,
              ...(opts.workspaceRoot === undefined ? {} : { workspaceRoot: opts.workspaceRoot }),
            },
          },
        },
      },
    )
    const events = await drain(
      executor.execute(
        'map the pareto knee',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>,
    )
    return { events, artifact: executor.resultArtifact() }
  }

  it('meters a codex seat from its rollout when the bridge forwards no usage at all', async () => {
    const { events, artifact } = await runCodexTurn({
      rollouts: [{ name: `rollout-${SEAT_SESSION}.jsonl`, text: seatRollout() }],
    })

    expect(events).toContainEqual({
      kind: 'tokens',
      input: 25_809_518,
      output: 57_016,
      freshInput: 1_809_518,
      cacheRead: 24_000_000,
      cacheWrite: 0,
      provenance: 'harness-store',
    })
    // The whole point: the provider's own counters, so the channel is measured, not a floor.
    expect(artifact.spent.tokensKnown).toBeUndefined()
    expect(artifact.spent.tokens).toMatchObject({ input: 25_809_518, output: 57_016 })
    expect(artifact.spent.tokensProvenance).toBe('harness-store')
  })

  it('adds a harness-native child the parent receipt never counted, scoped to its fork', async () => {
    const { events, artifact } = await runCodexTurn({
      rollouts: [
        { name: `rollout-${SEAT_SESSION}.jsonl`, text: seatRollout() },
        { name: `rollout-${CHILD_SESSION}.jsonl`, text: nativeChildRollout() },
      ],
      observation: {
        requests: 4,
        generationRequests: 4,
        auxiliaryRequests: 0,
        usageReceipts: 4,
        rejectedRequests: 0,
        failedRequests: 0,
        inFlightRequests: 0,
        accountingMatched: true,
        usage: { inputTokens: 25_809_518, outputTokens: 57_016, costKnown: false },
      },
    })

    const store = events.filter(
      (event) => event.kind === 'tokens' && event.provenance === 'harness-store',
    )
    // The receipt covered the seat, so ONLY the native child is added — the seat is not charged
    // twice, and the child's 5,555,804 file total is never the number.
    expect(store).toEqual([
      {
        kind: 'tokens',
        input: 555_804,
        output: 2_049,
        freshInput: 555_804,
        cacheRead: 0,
        cacheWrite: 0,
        provenance: 'harness-store',
      },
    ])
    expect(artifact.spent.tokens).toMatchObject({ input: 26_365_322, output: 59_065 })
    expect(artifact.spent.tokensProvenance).toBe('mixed')
  })

  it('names an unattributable fork instead of charging its file total', async () => {
    const { events, artifact } = await runCodexTurn({
      observation: {
        requests: 1,
        generationRequests: 1,
        auxiliaryRequests: 0,
        usageReceipts: 1,
        rejectedRequests: 0,
        failedRequests: 0,
        inFlightRequests: 0,
        accountingMatched: true,
        usage: { inputTokens: 1_000, outputTokens: 20, costKnown: false },
      },
      rollouts: [
        {
          name: 'rollout-opaque.jsonl',
          text: [
            rolloutLine({
              timestamp: '2026-09-01T20:11:40.000Z',
              type: 'session_meta',
              payload: {
                id: 'opaque-child',
                forked_from_id: 'opaque-parent',
                thread_source: 'subagent',
                timestamp: '2026-09-01T20:11:40.000Z',
                cwd: '/work/pursuit',
              },
            }),
            taskStarted('aaaaaaaa-0000-4000-8000-000000000001', 1_700_000_000),
            tokenCount(5_896_355_271, 9_000_000),
          ].join(''),
        },
      ],
    })

    // The 5,896,355,271 the file's own total reads is charged to nothing.
    expect(
      events.some((event) => event.kind === 'tokens' && event.provenance === 'harness-store'),
    ).toBe(false)
    expect(artifact.spent.tokens).toMatchObject({ input: 1_000, output: 20 })
    // The receipt was read, so the counters are real — but the store holds spend nobody can
    // attribute, so the total is a floor and the settlement says why.
    expect(artifact.spent.tokensKnown).toBe(false)
    expect(artifact.out).toMatchObject({
      tokensUnknownReason: expect.stringContaining('harness-store'),
    })
  })

  it('ignores a rollout recorded outside the run workspace', async () => {
    const { artifact } = await runCodexTurn({
      workspaceRoot: '/work/pursuit',
      rollouts: [
        {
          name: 'rollout-foreign.jsonl',
          text: [
            rolloutLine({
              timestamp: '2026-09-01T20:11:40.000Z',
              type: 'session_meta',
              payload: {
                id: 'foreign-seat',
                timestamp: '2026-09-01T20:11:40.000Z',
                cwd: '/somewhere/else',
              },
            }),
            taskStarted('01a05e99-7000-7000-8000-00000000000c', 1_788_293_500),
            tokenCount(903_000, 4_000),
          ].join(''),
        },
      ],
    })

    expect(artifact.spent.tokens).toMatchObject({ input: 0, output: 0 })
    expect(artifact.spent.tokensKnown).toBe(false)
  })

  it('refuses a harness whose store this runtime cannot read', async () => {
    await expect(runCodexTurn({ harness: 'claude-code' })).rejects.toThrow(
      /has no store reader; only "codex" is readable today/,
    )
  })
})
