import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import { type AgentSpec, createExecutor } from '../../src/runtime'

const profile: AgentProfile = {
  name: 'profile-model-worker',
  model: { default: 'profile-selected-model' },
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

describe('router executor model precedence', () => {
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
  })

  it('uses AgentProfile.model.default instead of the router fallback', async () => {
    let request: Record<string, unknown> | undefined
    const routerBaseUrl = await startRouter((body) => {
      request = body
    })
    const factory = createExecutor({
      backend: 'router',
      routerBaseUrl,
      routerKey: 'key',
      model: 'backend-fallback-model',
    })
    const executor = factory(spec, {
      signal: new AbortController().signal,
      seams: {},
    })

    await executor.execute('do the task', new AbortController().signal)

    expect(request?.model).toBe('profile-selected-model')
  })

  it('uses AgentProfile.model.default instead of the router-tools fallback', async () => {
    let request: Record<string, unknown> | undefined
    const routerBaseUrl = await startRouter((body) => {
      request = body
    })
    const factory = createExecutor({
      backend: 'router-tools',
      routerBaseUrl,
      routerKey: 'key',
      model: 'backend-fallback-model',
      tools: [],
      executeToolCall: async () => '',
    })
    const executor = factory(spec, {
      signal: new AbortController().signal,
      seams: {},
    })

    await executor.execute('do the task', new AbortController().signal)

    expect(request?.model).toBe('profile-selected-model')
  })
})
