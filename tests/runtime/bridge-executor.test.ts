import { PassThrough, type Readable } from 'node:stream'
import { HARNESS_NATIVE_MODEL } from '@tangle-network/agent-eval'
import {
  type AgentProfile,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { createExecutor, type ExecutorConfig, inlineSandboxClient } from '../../src/runtime'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import {
  runtimeOwnedExecutorMaterialization,
  runtimeOwnedExecutorProviderEvidence,
  runtimeOwnedPendingExecutorMaterialization,
} from '../../src/runtime/supervise/materialization'
import {
  bridgeExecutor,
  bridgeStopSignalKey,
  createExecutorRegistry,
} from '../../src/runtime/supervise/runtime'
import { createScope } from '../../src/runtime/supervise/scope'
import { workerFromBackend } from '../../src/runtime/supervise/supervise'
import type { Agent, AgentSpec, Executor, UsageEvent } from '../../src/runtime/supervise/types'

// `bridgeExecutor` POSTs each turn over the `node:http` core client, not global
// `fetch`: the bridge runs a harness CLI and streams only once it starts
// producing (first byte routinely >5 min in), and undici's fixed ~300s
// `headersTimeout` — unoverridable by any option or AbortSignal — would kill a
// live-but-slow bridge. Tests drive that transport by setting `bridgeHttpHandler`.
let bridgeHttpHandler: ((payload: Record<string, unknown>) => Readable) | null = null
let lastBridgeUrl: URL | null = null
let lastBridgePostHeaders: Record<string, unknown> | null = null
let activeBridgePayload: Record<string, unknown> | null = null

vi.mock('node:http', async () => {
  const actual = await vi.importActual<typeof import('node:http')>('node:http')
  return {
    ...actual,
    request: (url: URL, opts: unknown, cb: (res: Readable) => void) => {
      lastBridgeUrl = url
      if ((opts as { method?: string }).method === 'POST') {
        lastBridgePostHeaders = (opts as { headers?: Record<string, unknown> }).headers ?? null
      }
      let body = ''
      return {
        write: (chunk: string) => {
          body += chunk
        },
        end: () => {
          if ((opts as { method?: string }).method === 'GET' && url.pathname === '/') {
            const capability = new PassThrough() as Readable & {
              statusCode?: number
              headers?: Record<string, string>
            }
            capability.statusCode = 200
            capability.headers = { 'content-type': 'application/json' }
            capability.end(
              JSON.stringify({
                capabilities: {
                  profileMaterialization: 'cli-bridge.profile-materialization.v2',
                  usageCostProvenance: 'cli-bridge.usage-cost.v1',
                },
              }),
            )
            cb(capability)
            return
          }
          const payload = JSON.parse(body || '{}') as Record<string, unknown>
          if (!bridgeHttpHandler) throw new Error('bridgeHttpHandler not set')
          activeBridgePayload = payload
          const res = bridgeHttpHandler(payload) as Readable & {
            statusCode?: number
            headers?: Record<string, string>
          }
          activeBridgePayload = null
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

function sse(
  content: string,
  input: number,
  output: number,
  inference?: Record<string, unknown>,
): Readable {
  if (!activeBridgePayload) throw new Error('sse: no active bridge request')
  const payload = activeBridgePayload
  const profile = payload.agent_profile as AgentProfile
  const model = String(payload.model)
  const parts = model.split('/')
  const stream = new PassThrough()
  stream.end(
    [
      'id: 1',
      `data: ${JSON.stringify({
        choices: [{ delta: { content } }],
        usage: {
          prompt_tokens: input,
          completion_tokens: output,
          cost: 0.001,
          cost_known: true,
          cost_provenance: 'provider-receipt',
        },
      })}`,
      '',
      'id: 2',
      `data: ${JSON.stringify({
        profile_materialization: {
          schema: 'cli-bridge.profile-materialization.v2',
          effectiveProfileDigest: canonicalAgentProfileDigest(profile),
          harness: parts[0],
          provider: parts.length >= 3 ? parts[1] : (profile.model?.provider ?? null),
          model,
          reasoningEffort: {
            requested: profile.model?.reasoningEffort ?? null,
            applied: profile.model?.reasoningEffort ?? null,
          },
          ...(inference === undefined ? {} : { inference }),
          workspacePlanDigest: `sha256:${'b'.repeat(64)}`,
          files: [],
          unsupported: [],
        },
      })}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n'),
  )
  return stream
}

function exactBridgeProfile(
  name: string,
  model = 'kimi-k2.6',
  metadata?: Record<string, unknown>,
): AgentProfile {
  return {
    name,
    harness: 'kimi-code',
    model: {
      provider: 'moonshot',
      default: model,
      ...(metadata ? { metadata } : {}),
    },
  }
}

function bridgeClient(model: string) {
  const profile = exactBridgeProfile('bridge-test', model)
  return inlineSandboxClient(
    createExecutor({
      backend: 'bridge',
      bridgeUrl: 'http://bridge.test',
      bridgeBearer: 'secret',
    }),
    { profile },
  )
}

async function runOnce(
  client: ReturnType<typeof bridgeClient>,
  prompt: string,
): Promise<{ finalText: string; tokensIn: number; tokensOut: number }> {
  const box = await client.create()
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
    lastBridgePostHeaders = null
  })

  it('stamps the inherited trace context as traceparent (+ legacy pair) headers on the bridge POST', async () => {
    bridgeHttpHandler = () => sse('traced turn', 1, 1)
    const traceId = '12345678901234567890123456789012'
    const parentSpanId = '1234567890123456'
    const profile: AgentProfile = {
      name: 'traced-worker',
      harness: 'pi',
      model: { provider: 'tangle-router', default: 'safe-model' },
    }
    const executor = bridgeExecutor(
      { profile, harness: null },
      {
        signal: new AbortController().signal,
        seams: {
          bridge: { bridgeUrl: 'http://bridge.test', bridgeBearer: 'secret' },
          'worker-trace': { traceId, parentSpanId },
        },
      },
    )
    await drainExecutor(executor)

    // The exact W3C wire the bridge parses at spawn, plus the legacy pair it also reads —
    // the same dual-write the env channel performs, so both spellings name one trace.
    expect(lastBridgePostHeaders).toMatchObject({
      traceparent: `00-${traceId}-${parentSpanId}-01`,
      'x-trace-id': traceId,
      'x-parent-span-id': parentSpanId,
    })
  })

  it('sends no trace headers when the run records no spans', async () => {
    bridgeHttpHandler = () => sse('untraced turn', 1, 1)
    const profile: AgentProfile = {
      name: 'untraced-worker',
      harness: 'pi',
      model: { provider: 'tangle-router', default: 'safe-model' },
    }
    const executor = bridgeExecutor(
      { profile, harness: null },
      {
        signal: new AbortController().signal,
        seams: { bridge: { bridgeUrl: 'http://bridge.test', bridgeBearer: 'secret' } },
      },
    )
    await drainExecutor(executor)

    expect(lastBridgePostHeaders).not.toBeNull()
    expect(lastBridgePostHeaders).not.toHaveProperty('traceparent')
    expect(lastBridgePostHeaders).not.toHaveProperty('x-trace-id')
    expect(lastBridgePostHeaders).not.toHaveProperty('x-parent-span-id')
  })

  it('streams a completion and meters the reported usage', async () => {
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('done from bridge', 7, 11)
    }
    const out = await runOnce(bridgeClient('kimi-k2.6'), 'compute the return')
    expect(out.finalText).toBe('done from bridge')
    expect(out.tokensIn).toBe(7)
    expect(out.tokensOut).toBe(11)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.model).toBe('kimi-code/moonshot/kimi-k2.6')
    expect(seen[0]?.stream).toBe(true)
    const msgs = seen[0]?.messages as Array<{ role: string; content: string }>
    expect(msgs.some((m) => m.content.includes('compute the return'))).toBe(true)
    // The bridge base URL is turned into the endpoint EXACTLY once — no doubled
    // `/v1/chat/completions` from a caller that already built the full path.
    expect(lastBridgeUrl?.pathname).toBe('/v1/chat/completions')
    expect(lastBridgeUrl?.host).toBe('bridge.test')
  })

  it('carries the caller-owned turn timeout in the structured execution request', async () => {
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('done', 1, 1)
    }
    const client = inlineSandboxClient(
      createExecutor({
        backend: 'bridge',
        bridgeUrl: 'http://bridge.test',
        bridgeBearer: 'secret',
        timeoutMs: 14_400_000,
      }),
      {
        profile: {
          name: 'timeout-worker',
          harness: 'pi',
          model: { provider: 'tangle-router', default: 'deepseek-v4-flash' },
        },
      },
    )

    await runOnce(client, 'work until the task is complete')

    expect(seen).toHaveLength(1)
    expect(seen[0]?.execution).toEqual({ kind: 'host', timeoutMs: 14_400_000 })
  })

  it.each([0, -1, 1.5, 2_147_483_648])(
    'rejects unsupported caller timeout %s before dispatch',
    async (timeoutMs) => {
      const client = inlineSandboxClient(
        createExecutor({
          backend: 'bridge',
          bridgeUrl: 'http://bridge.test',
          bridgeBearer: 'secret',
          timeoutMs,
        }),
        {
          profile: {
            name: 'timeout-worker',
            harness: 'pi',
            model: { provider: 'tangle-router', default: 'deepseek-v4-flash' },
          },
        },
      )

      await expect(runOnce(client, 'do not dispatch')).rejects.toThrow(
        /timeoutMs must be an integer/,
      )
      expect(lastBridgeUrl).toBeNull()
    },
  )

  it('uses the exact profile model verbatim', async () => {
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('ok', 1, 2)
    }
    await runOnce(bridgeClient('kimi-k2.6'), 'go')
    expect(seen[0]?.model).toBe('kimi-code/moonshot/kimi-k2.6')
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
    }
    const profile: AgentProfile = {
      name: 'policy-worker',
      harness: 'pi',
      model: { provider: 'tangle-router', default: 'safe-model' },
      permissions: { shell: 'deny' },
    }
    const client = inlineSandboxClient(createExecutor(config), { profile })
    profile.model.default = 'mutated-model'
    profile.permissions.shell = 'allow'

    await runOnce(client, 'go')

    expect(seen[0]?.model).toBe('pi/tangle-router/safe-model')
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
    }
    const factory = createExecutor(config)
    const profile = exactBridgeProfile('budget-worker', 'safe-model', { maxTurns: 1 })
    const executor = factory(
      { profile, harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    if (!profile.model?.metadata) throw new Error('test profile metadata missing')
    profile.model.metadata.maxTurns = 3
    deliver = (message) => executor.deliver?.(message)
    const run = executor.execute('go', new AbortController().signal)
    if (!isUsageStream(run)) throw new Error('bridge worker must stream usage')
    for await (const _event of run) {
      // drain the bridge stream
    }

    expect(requests).toBe(1)
    expect(executor.resultArtifact().spent.iterations).toBe(1)
  })

  it('drains an active turn after completion and blocks the next bridge request', async () => {
    let requests = 0
    const stop = new AbortController()
    let deliver: (message: unknown) => void = () => {}
    bridgeHttpHandler = () => {
      requests += 1
      deliver({ steer: 'a queued continuation must not start' })
      if (!activeBridgePayload) throw new Error('active bridge payload missing')
      const payload = activeBridgePayload
      const profile = payload.agent_profile as AgentProfile
      const model = String(payload.model)
      const stream = new PassThrough()
      stream.write(
        `id: 1\ndata: ${JSON.stringify({
          model,
          choices: [{ delta: { content: 'accepted answer' } }],
        })}\n\n`,
      )
      setImmediate(() => {
        stop.abort('result accepted')
        stream.end(
          [
            `id: 2\ndata: ${JSON.stringify({
              model,
              usage: {
                prompt_tokens: 7,
                completion_tokens: 3,
                cost: 0.001,
                cost_known: true,
                cost_provenance: 'provider-receipt',
              },
            })}\n\n`,
            `id: 3\ndata: ${JSON.stringify({
              profile_materialization: {
                schema: 'cli-bridge.profile-materialization.v2',
                effectiveProfileDigest: canonicalAgentProfileDigest(profile),
                harness: 'pi',
                provider: 'tangle-router',
                model,
                reasoningEffort: { requested: null, applied: null },
                workspacePlanDigest: `sha256:${'b'.repeat(64)}`,
                files: [],
                unsupported: [],
              },
            })}\n\n`,
            'data: [DONE]\n\n',
          ].join(''),
        )
      })
      return stream
    }
    const profile: AgentProfile = {
      name: 'completion-stop-worker',
      harness: 'pi',
      model: {
        provider: 'tangle-router',
        default: 'deepseek-v4-flash',
        metadata: { maxTurns: 3 },
      },
    }
    const executor = bridgeExecutor(
      { profile, harness: null },
      {
        signal: new AbortController().signal,
        seams: {
          bridge: { bridgeUrl: 'http://bridge.test', bridgeBearer: 'secret' },
          [bridgeStopSignalKey]: stop.signal,
        },
      },
    )
    deliver = (message) => executor.deliver?.(message)

    await drainExecutor(executor)

    expect(requests).toBe(1)
    expect(runtimeOwnedExecutorMaterialization(executor)).toMatchObject({
      plan: {
        terminalAcknowledgement: {
          model: 'pi/tangle-router/deepseek-v4-flash',
        },
      },
    })
    expect(runtimeOwnedExecutorProviderEvidence(executor)).toMatchObject({
      status: 'known',
      attempts: [{ observations: ['pi/tangle-router/deepseek-v4-flash'] }],
    })
    expect(executor.resultArtifact().out).toMatchObject({ content: 'accepted answer' })
  })

  it('keeps identity and materialization unknown when an active stream aborts before [DONE]', async () => {
    const abort = new AbortController()
    bridgeHttpHandler = () => {
      const stream = new PassThrough()
      stream.write(frame(1, { choices: [{ delta: { content: 'partial' } }] }))
      queueMicrotask(() => {
        abort.abort('bridge disconnected')
        stream.end()
      })
      return stream
    }
    const profile = exactBridgeProfile('ambiguous-abort-worker', 'safe-model')
    const executor = bridgeExecutor(
      { profile, harness: null },
      {
        signal: new AbortController().signal,
        seams: { bridge: { bridgeUrl: 'http://bridge.test', bridgeBearer: 'secret' } },
      },
    )

    const run = executor.execute('go', abort.signal)
    if (!isUsageStream(run)) throw new Error('bridge worker must stream usage')
    await expect(
      (async () => {
        for await (const _event of run) {
          // consume the partial response before the transport aborts
        }
      })(),
    ).rejects.toThrow(/aborted/u)

    expect(runtimeOwnedExecutorProviderEvidence(executor)).toEqual({
      status: 'unknown',
      attempts: [{ observations: [] }],
      models: [],
      reason: 'provider-model-missing',
    })
    expect(runtimeOwnedExecutorMaterialization(executor)).toBeUndefined()
    expect(runtimeOwnedPendingExecutorMaterialization(executor)).toBeDefined()
  })

  it('forwards the profile completion cap on initial and resumed bridge requests', async () => {
    const seen: Array<Record<string, unknown>> = []
    let deliver: (message: unknown) => void = () => {}
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      if (seen.length === 1) deliver({ steer: 'continue with the edge case' })
      return sse(`turn-${seen.length}`, 7, 11)
    }
    const profile: AgentProfile = {
      name: 'capped-worker',
      harness: 'pi',
      model: {
        provider: 'tangle-router',
        default: 'safe-model',
        metadata: { maxTokens: 1_000 },
      },
    }
    const executor = bridgeExecutor(
      { profile, harness: null },
      {
        signal: new AbortController().signal,
        seams: { bridge: { bridgeUrl: 'http://bridge.test', bridgeBearer: 'secret' } },
      },
    )
    const pending = runtimeOwnedPendingExecutorMaterialization(executor)
    expect(pending?.declaration.plan).toMatchObject({ maxTokens: 1_000 })
    deliver = (message) => executor.deliver?.(message)

    const events = await drainExecutor(executor)

    expect(seen).toHaveLength(2)
    expect(seen.map((request) => request.max_tokens)).toEqual([1_000, 1_000])
    for (const request of seen) {
      const requestProfile = request.agent_profile as AgentProfile
      expect(request.max_tokens).toBe(requestProfile.model?.metadata?.maxTokens)
    }

    // The profile cap is a per-completion request field. The conserved Runtime budget still meters
    // the actual two-turn usage against its independently authored aggregate ceiling.
    const pool = createBudgetPool({ maxIterations: 2, maxTokens: 50 }, () => 0)
    const reservation = pool.reserve({ maxIterations: 2, maxTokens: 50 })
    if (!reservation.ok) throw new Error('aggregate budget reservation should succeed')
    const spent = await pool.spendFrom(events)
    pool.reconcile(reservation.ticket, spent)
    expect(pool.readout()).toMatchObject({
      iterationsLeft: 0,
      tokensLeft: 14,
      reservedTokens: 0,
    })
  })

  it('omits the completion cap when the profile leaves it absent', async () => {
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('uncapped', 1, 2)
    }
    const profile: AgentProfile = {
      name: 'uncapped-worker',
      harness: 'pi',
      model: { provider: 'tangle-router', default: 'safe-model' },
    }
    const executor = bridgeExecutor(
      { profile, harness: null },
      {
        signal: new AbortController().signal,
        seams: { bridge: { bridgeUrl: 'http://bridge.test', bridgeBearer: 'secret' } },
      },
    )
    const pending = runtimeOwnedPendingExecutorMaterialization(executor)
    expect(pending?.declaration.plan).not.toHaveProperty('maxTokens')

    await drainExecutor(executor)

    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toHaveProperty('max_tokens')
  })

  it('retains bridge inference evidence in the materialization receipt and journal', async () => {
    const profile = exactBridgeProfile('inference-worker', 'safe-model')
    const inference = {
      effectiveEndpoint: 'http://127.0.0.1:4317/v1',
      apiMode: 'openai-completions',
      transport: 'scoped-loopback',
      appliedMaxTokens: 64_000,
      observation: {
        requests: 3,
        generationRequests: 2,
        auxiliaryRequests: 1,
        usageReceipts: 2,
        rejectedRequests: 0,
        failedRequests: 0,
        inFlightRequests: 0,
        accountingMatched: true,
        usage: {
          inputTokens: 21,
          freshInputTokens: 8,
          cacheReadInputTokens: 13,
          cacheWriteInputTokens: 0,
          outputTokens: 5,
          costKnown: false,
          estimatedCost: 0.0042,
        },
      },
    }
    let captured: Executor<unknown> | undefined
    const root = 'bridge-inference-journal'
    const journal = new InMemorySpawnJournal()
    await journal.beginTree(root, new Date(0).toISOString())
    const scope = createScope({
      parentId: root,
      root,
      pool: createBudgetPool({ maxIterations: 1, maxTokens: 100 }, Date.now),
      journal,
      blobs: new InMemoryResultBlobStore(),
      executors: createExecutorRegistry(),
      seams: { bridge: { bridgeUrl: 'http://bridge.test', bridgeBearer: 'secret' } },
      depth: 0,
      signal: new AbortController().signal,
      now: Date.now,
    })
    const worker = {
      name: profile.name ?? 'inference-worker',
      act: async () => 'unused',
      executorSpec: {
        profile,
        harness: null,
        executorFactory: (spec: AgentSpec, ctx: Parameters<typeof bridgeExecutor>[1]) => {
          const executor = bridgeExecutor(spec, ctx)
          captured = executor
          return executor
        },
      },
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }

    bridgeHttpHandler = () => sse('ok', 3, 5, inference)
    const spawned = scope.spawn(worker, 'capture inference', {
      budget: { maxIterations: 1, maxTokens: 100 },
      label: 'inference-worker',
    })
    expect(spawned.ok).toBe(true)

    expect((await scope.next())?.kind).toBe('done')
    expect(captured).toBeDefined()
    const declaration = runtimeOwnedExecutorMaterialization(captured!)
    expect(declaration).toBeDefined()
    const plan = declaration!.plan as {
      terminalAcknowledgement: { inference?: Record<string, unknown> }
    }
    expect(plan.terminalAcknowledgement.inference).toEqual(inference)
    expect(plan.terminalAcknowledgement.inference).not.toBe(inference)
    expect(Object.isFrozen(plan.terminalAcknowledgement.inference)).toBe(true)
    expect(Object.isFrozen(plan.terminalAcknowledgement.inference?.observation)).toBe(true)
    expect(Object.isFrozen(plan.terminalAcknowledgement.inference?.observation?.usage)).toBe(true)

    const events = await journal.loadTree(root)
    const materialized = events?.find((event) => event.kind === 'materialized')
    expect(materialized?.receipt.status).toBe('known')
    if (materialized?.receipt.status !== 'known') {
      throw new Error('bridge inference materialization receipt was not journaled')
    }
    expect(materialized.receipt.materializationPlanDigest).toBe(
      canonicalCandidateDigest(declaration!.plan),
    )
    const changedPlan = {
      ...(declaration!.plan as Record<string, unknown>),
      terminalAcknowledgement: {
        ...plan.terminalAcknowledgement,
        inference: {
          ...plan.terminalAcknowledgement.inference,
          effectiveEndpoint: 'http://127.0.0.1:4318/v1',
        },
      },
    }
    expect(canonicalCandidateDigest(changedPlan)).not.toBe(
      materialized.receipt.materializationPlanDigest,
    )
  })

  it.each([0, -1, 1.5, '64000'])(
    'rejects invalid applied inference max tokens %s',
    async (appliedMaxTokens) => {
      bridgeHttpHandler = () =>
        sse('must not settle', 1, 1, {
          effectiveEndpoint: 'http://127.0.0.1:4317/v1',
          apiMode: 'openai-completions',
          transport: 'scoped-loopback',
          appliedMaxTokens,
        })
      const executor = bridgeExecutor(
        { profile: exactBridgeProfile('invalid-applied-cap'), harness: null },
        {
          signal: new AbortController().signal,
          seams: { bridge: { bridgeUrl: 'http://bridge.test', bridgeBearer: 'secret' } },
        },
      )

      await expect(drainExecutor(executor)).rejects.toThrow(
        /appliedMaxTokens must be a positive safe integer/,
      )
    },
  )

  it.each([0, -1, 1.5, '100'])(
    'rejects invalid profile maxTokens %s before any bridge request',
    (maxTokens) => {
      let requests = 0
      bridgeHttpHandler = (_payload) => {
        requests += 1
        return sse('must not dispatch', 1, 1)
      }
      const profile: AgentProfile = {
        name: 'invalid-cap-worker',
        harness: 'pi',
        model: {
          provider: 'tangle-router',
          default: 'safe-model',
          metadata: { maxTokens },
        },
      }

      expect(() =>
        bridgeExecutor(
          { profile, harness: null },
          {
            signal: new AbortController().signal,
            seams: { bridge: { bridgeUrl: 'http://bridge.test', bridgeBearer: 'secret' } },
          },
        ),
      ).toThrow(/maxTokens/)
      expect(requests).toBe(0)
    },
  )

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
    })
    const workers = ['a', 'b'].map(
      (name, index) =>
        make(exactBridgeProfile(name, 'safe-model'), {
          assignmentId: `ordinal:${index}`,
          budget: { maxIterations: 1, maxTokens: 100 },
          task: 'go',
          label: name,
        }) as Agent<unknown, unknown> & {
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
        make(exactBridgeProfile('worker', 'safe-model'), context) as Agent<unknown, unknown> & {
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
    await expect(runOnce(bridgeClient('k2'), 'go')).rejects.toThrow(/bridge 500/)
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
})

/** One numbered SSE data frame, exactly as cli-bridge writes it. */
function frame(id: number, payload: unknown): string {
  return `id: ${id}\ndata: ${JSON.stringify(payload)}\n\n`
}

function streamOf(frames: ReadonlyArray<string>): Readable {
  if (!activeBridgePayload) throw new Error('streamOf: no active bridge request')
  const payload = activeBridgePayload
  const profile = payload.agent_profile as AgentProfile
  const model = String(payload.model)
  const parts = model.split('/')
  let maxId = 0
  const normalized = frames.map((raw) => {
    const id = /^id: (\d+)/u.exec(raw)?.[1]
    if (id) maxId = Math.max(maxId, Number(id))
    const data = /data: (\{.*\})/u.exec(raw)?.[1]
    if (!data) return raw
    const parsed = JSON.parse(data) as { usage?: Record<string, unknown> }
    if (!parsed.usage) return raw
    parsed.usage = {
      ...parsed.usage,
      ...(typeof parsed.usage.cost === 'number'
        ? { cost_known: true, cost_provenance: 'provider-receipt' }
        : { cost_known: false }),
    }
    return raw.replace(data, JSON.stringify(parsed))
  })
  const receipt = frame(maxId + 1, {
    profile_materialization: {
      schema: 'cli-bridge.profile-materialization.v2',
      effectiveProfileDigest: canonicalAgentProfileDigest(profile),
      harness: parts[0],
      provider: parts[1] ?? null,
      model,
      reasoningEffort: {
        requested: profile.model?.reasoningEffort ?? null,
        applied: profile.model?.reasoningEffort ?? null,
      },
      workspacePlanDigest: `sha256:${'b'.repeat(64)}`,
      files: [],
      unsupported: [],
    },
  })
  const stream = new PassThrough()
  stream.end(
    normalized.map((raw) => (raw === 'data: [DONE]\n\n' ? `${receipt}${raw}` : raw)).join(''),
  )
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
    {
      profile: {
        name: 'observed-worker',
        harness: 'pi',
        model: { provider: 'tangle-router', default: 'gpt-5-mini' },
      },
      harness: null,
    } as AgentSpec,
    {
      signal: new AbortController().signal,
      seams: {
        bridge: {
          bridgeUrl: 'http://bridge.test',
          bridgeBearer: 'secret',
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

async function drainExecutor(executor: Executor<unknown>): Promise<UsageEvent[]> {
  const run = executor.execute('go', new AbortController().signal)
  if (!isUsageStream(run)) throw new Error('bridge worker must stream usage')
  const events: UsageEvent[] = []
  for await (const event of run) events.push(event)
  return events
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

  it('refuses a profile with no declared provider before dispatch', async () => {
    await expect(
      wireModelFor({ name: 'w', harness: 'pi', model: { default: 'glm-5.2' } }),
    ).rejects.toThrow(/model\.provider must be explicit/)
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

  it.each([
    ['nested provider model id', 'fireworks/deepseek-v4-flash'],
    ['provider-qualified nested model id', 'tangle-router/fireworks/deepseek-v4-flash'],
    ['harness-qualified nested model id', 'pi/tangle-router/fireworks/deepseek-v4-flash'],
  ])('preserves %s across bridge execution and materialization', async (_label, defaultModel) => {
    const expected = 'pi/tangle-router/fireworks/deepseek-v4-flash'
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('ok', 1, 2)
    }
    const profile: AgentProfile = {
      name: 'nested-provider-worker',
      harness: 'pi',
      model: { provider: 'tangle-router', default: defaultModel },
    }
    const executor = createExecutor({
      backend: 'bridge',
      bridgeUrl: 'http://bridge.test',
      bridgeBearer: 'secret',
    })({ profile, harness: null } as AgentSpec, {
      signal: new AbortController().signal,
      seams: {},
    })

    expect(runtimeOwnedPendingExecutorMaterialization(executor)?.declaration.model).toEqual({
      status: 'known',
      id: expected,
    })
    await drainExecutor(executor)

    expect(seen[0]?.model).toBe(expected)
    const materialization = runtimeOwnedExecutorMaterialization(executor)
    expect(materialization).toBeDefined()
    if (!materialization) throw new Error('bridge materialization was not finalized')
    expect(materialization.model).toEqual({ status: 'known', id: expected })
    const plan = materialization.plan as { terminalAcknowledgement?: { model?: string } }
    expect(plan.terminalAcknowledgement?.model).toBe(expected)
  })

  it('refuses runtime-selected model markers before dispatch', async () => {
    await expect(
      wireModelFor({
        name: 'w',
        harness: 'pi',
        model: { provider: 'tangle-router', default: HARNESS_NATIVE_MODEL },
      }),
    ).rejects.toThrow(/model\.default is runtime-selected/)
  })
})
