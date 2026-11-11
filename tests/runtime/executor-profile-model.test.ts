import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import { type AgentSpec, createExecutor } from '../../src/runtime'

const profile: AgentProfile = {
  name: 'profile-model-worker',
  harness: 'cli-base',
  model: { provider: 'tangle-router', default: 'profile-selected-model' },
}

const spec: AgentSpec = { profile, harness: null }

let server: Server | undefined

async function startRouter(
  onRequest: (body: Record<string, unknown>) => void,
  responseStatus: () => number = () => 200,
): Promise<string> {
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    onRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
    const status = responseStatus()
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(
      status === 200
        ? JSON.stringify({
            choices: [{ message: { content: 'done', tool_calls: [] } }],
            usage: { prompt_tokens: 3, completion_tokens: 2 },
          })
        : JSON.stringify({ error: 'caller-selected retry status' }),
    )
  })
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

async function drainExecution(value: unknown): Promise<void> {
  if (value !== null && typeof value === 'object' && Symbol.asyncIterator in value) {
    for await (const _event of value as AsyncIterable<unknown>) {
      // drain
    }
    return
  }
  await value
}

describe('router executor exact-profile identity', () => {
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
  })

  it.each(['router', 'router-tools'] as const)(
    'uses only the AgentProfile model on the %s backend',
    async (backend) => {
      let request: Record<string, unknown> | undefined
      const routerBaseUrl = await startRouter((body) => {
        request = body
      })
      const factory = createExecutor({
        backend,
        routerBaseUrl,
        routerKey: 'key',
        ...(backend === 'router-tools' ? { tools: [], executeToolCall: async () => '' } : {}),
      })
      const executor = factory(spec, {
        signal: new AbortController().signal,
        seams: {},
      })

      await drainExecution(executor.execute('do the task', new AbortController().signal))

      expect(request?.model).toBe('profile-selected-model')
    },
  )

  it.each(['router', 'router-tools'] as const)(
    'carries AgentProfile.model.metadata.retry through the %s executor',
    async (backend) => {
      let requests = 0
      const routerBaseUrl = await startRouter(
        () => {
          requests += 1
        },
        () => (requests === 1 ? 409 : 200),
      )
      const factory = createExecutor({
        backend,
        routerBaseUrl,
        routerKey: 'key',
        ...(backend === 'router-tools' ? { tools: [], executeToolCall: async () => '' } : {}),
      })
      const retryProfile: AgentProfile = {
        ...profile,
        model: {
          ...profile.model,
          metadata: {
            retry: {
              maxAttempts: 2,
              initialBackoffMs: 0,
              maxBackoffMs: 0,
              jitter: 0,
              retryStatuses: [409],
              requestTimeoutMs: 0,
            },
          },
        },
      }
      const executor = factory(
        { profile: retryProfile, harness: null },
        { signal: new AbortController().signal, seams: {} },
      )

      await drainExecution(executor.execute('retry the task', new AbortController().signal))

      expect(requests).toBe(2)
    },
  )
})
