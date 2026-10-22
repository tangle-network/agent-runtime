import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { AGENT_PROFILE_MATERIALIZATION_AXES } from '@tangle-network/agent-interface'
import { createWaterfallCollector, supervise } from '@tangle-network/agent-runtime/kernel'
import { expect, it } from 'vitest'

const profile = (name: string, manager: boolean): AgentProfile => ({
  name,
  harness: manager ? 'codex' : 'cli-base',
  model: { provider: 'offline', default: 'waterfall-protocol-model' },
  ...(manager
    ? {
        tools: {
          agent_runtime_coordination_spawn_worker: true,
          agent_runtime_coordination_stop: true,
        },
      }
    : { tools: { agent_runtime_coordination_spawn_worker: false } }),
})

async function callTool(url: string, name: string, args: Record<string, unknown> = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const body = await response.json()
  if (!response.ok || body.error || body.result?.isError)
    throw new Error(`${name}: ${JSON.stringify(body)}`)
  return body.result?.structuredContent
}

// Only the external harness and model HTTP protocols are fixtures. Supervisor admission,
// recursive scopes, tools, HTTP transport, settlement and collector are the public SDK path.
it('snapshots growing nested spans over a live Supervisor and HTTP worker', async () => {
  const collector = createWaterfallCollector()
  const cancellation = new AbortController()
  let requested!: () => void
  let release!: () => void
  const requestArrived = new Promise<void>((resolve) => {
    requested = resolve
  })
  const responseReady = new Promise<void>((resolve) => {
    release = resolve
  })
  let requests = 0
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* drain the real request */
    }
    requests += 1
    requested()
    await responseReady
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        model: 'waterfall-protocol-model',
        choices: [{ message: { role: 'assistant', content: 'delivered' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 3, cost_usd: 0.25 },
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('HTTP fixture did not bind')
  const pending = supervise(profile('root', true), 'deliver through a nested manager', {
    runId: 'waterfall-http',
    signal: cancellation.signal,
    hooks: collector.hooks,
    budget: { maxIterations: 100, maxTokens: 100_000 },
    perWorker: { maxIterations: 10, maxTokens: 10_000 },
    driverRetry: { enabled: false },
    backend: {
      backend: 'router',
      routerBaseUrl: `http://127.0.0.1:${address.port}/v1`,
      routerKey: 'local-protocol-fixture',
    },
    driveHarnessMaterialization: {
      name: 'fixture-harness-protocol',
      axes: AGENT_PROFILE_MATERIALIZATION_AXES,
    },
    resolveDriveHarness: ({ depth }) => {
      let turns = 0
      return async ({ coordinationMcpUrl }) => {
        turns += 1
        if (turns === 1) {
          const spawned = await callTool(coordinationMcpUrl, 'spawn_worker', {
            profile: profile(depth === 0 ? 'manager' : 'worker', depth === 0),
            task: 'deliver',
            label: depth === 0 ? 'manager:0' : 'worker:0',
            budget:
              depth === 0
                ? { maxIterations: 20, maxTokens: 20_000 }
                : { maxIterations: 1, maxTokens: 100 },
          })
          if (typeof spawned?.workerId !== 'string')
            throw new Error(`spawn refused: ${JSON.stringify(spawned)}`)
        } else {
          await callTool(coordinationMcpUrl, 'stop')
        }
      }
    },
  })
  try {
    await Promise.race([
      requestArrived,
      pending.then((result) => {
        throw new Error(`Supervisor settled before worker HTTP request: ${JSON.stringify(result)}`)
      }),
    ])
    const first = collector.report()
    expect(first.spans).toHaveLength(2)
    const manager = first.spans.find((span) => span.label === 'manager:0')!
    const worker = first.spans.find((span) => span.label === 'worker:0')!
    expect(worker.parentId).toBe(manager.id)
    expect(manager.parentId).toBe('waterfall-http')
    expect(first.spans.every((span) => span.status === 'running' && span.endMs === undefined)).toBe(
      true,
    )
    await delay(30)
    const growing = collector.report()
    expect(growing.observedAtMs).toBeGreaterThan(first.observedAtMs)
    expect(growing.totalMs).toBeGreaterThan(first.totalMs)
    expect(growing.byKind.worker?.ms).toBeGreaterThan(first.byKind.worker!.ms)
    const replay = collector.report({ nowMs: worker.startMs + 1_000 })
    expect(replay.byKind.worker?.ms).toBe(1_000)
    expect(collector.render({ nowMs: worker.startMs + 1_000 })).toContain('1.0s')
    release()
    await pending
    const settled = collector.report()
    expect(requests).toBe(1)
    expect(
      settled.spans.every((span) => span.endMs !== undefined && span.status !== 'running'),
    ).toBe(true)
    expect(first.spans.every((span) => span.status === 'running' && span.endMs === undefined)).toBe(
      true,
    )
    const settledWorker = settled.spans.find((span) => span.id === worker.id)!
    expect(settledWorker.tokens).toEqual({ input: 11, output: 3 })
    expect(settledWorker.usd).toBe(0.25)
    const later = collector.report({ nowMs: settled.observedAtMs + 10_000 })
    expect(later.totalMs).toBe(settled.totalMs)
    expect(later.byKind).toEqual(settled.byKind)
    settledWorker.tokens.input = 999
    settledWorker.label = 'mutated'
    expect(collector.report().spans.find((span) => span.id === worker.id)).toMatchObject({
      label: 'worker:0',
      tokens: { input: 11, output: 3 },
    })
    collector.reset()
    expect(collector.report().spans).toEqual([])
  } finally {
    release()
    cancellation.abort()
    await pending.catch(() => undefined)
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
