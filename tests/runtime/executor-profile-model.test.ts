import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { HARNESS_NATIVE_MODEL } from '@tangle-network/agent-eval'
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

async function startRouter(onRequest: (body: Record<string, unknown>) => void): Promise<string> {
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    onRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        choices: [{ message: { content: 'done', tool_calls: [] } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      }),
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
    'refuses runtime-selected model markers on the %s backend before dispatch',
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

      expect(() =>
        factory(
          {
            profile: {
              name: 'runtime-selected-model',
              harness: 'cli-base',
              model: { provider: 'tangle-router', default: HARNESS_NATIVE_MODEL },
            },
            harness: null,
          },
          { signal: new AbortController().signal, seams: {} },
        ),
      ).toThrow(/model\.default is runtime-selected/)
      expect(request).toBeUndefined()
    },
  )
})
