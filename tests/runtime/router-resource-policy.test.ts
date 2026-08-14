import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AgentProfile, AgentProfileResources } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import { type AgentSpec, createExecutor } from '../../src/runtime'
import { supervise } from '../../src/runtime/supervise/supervise'

const inlineSkill = {
  kind: 'inline',
  name: 'edge-cases',
  content: 'Check the empty string first.',
} as const

const remoteSkill = {
  kind: 'github',
  repository: 'tangle-network/skills',
  path: 'skills/edge-cases/SKILL.md',
  ref: 'main',
  name: 'edge-cases',
} as const

let server: Server | undefined

function routerProfile(resources: AgentProfileResources): AgentProfile {
  return {
    name: 'router-resource-policy',
    harness: 'cli-base',
    model: { provider: 'tangle-router', default: 'profile-selected-model' },
    resources,
  }
}

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

function systemPromptOf(request: Record<string, unknown> | undefined): string {
  const messages = (request?.messages ?? []) as Array<{ role: string; content: unknown }>
  const system = messages.find((message) => message.role === 'system')
  return typeof system?.content === 'string' ? system.content : ''
}

/**
 * `resources.failOnError` is the profile's resource-failure policy. Strict is the canonical
 * default: `true` or absent fails closed on a resource the run path cannot materialize. These
 * tests hold the policy on the two router paths — one direct Router turn, and the router-brained
 * supervisor root — where the profile has no workspace and resources are inlined into the prompt.
 */
describe('router resource failure policy', () => {
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
  })

  it('carries a strict profile and attaches the resources it can inline', async () => {
    let request: Record<string, unknown> | undefined
    const routerBaseUrl = await startRouter((body) => {
      request = body
    })
    const factory = createExecutor({ backend: 'router', routerBaseUrl, routerKey: 'key' })
    const spec: AgentSpec = {
      profile: routerProfile({ failOnError: true, skills: [inlineSkill] }),
      harness: null,
    }

    const executor = factory(spec, { signal: new AbortController().signal, seams: {} })
    await drainExecution(executor.execute('do the task', new AbortController().signal))

    expect(systemPromptOf(request)).toContain('## Attached skill: edge-cases')
  })

  it.each(['router', 'router-tools'] as const)(
    'fails closed on a resource the %s backend cannot inline when the profile is strict',
    async (backend) => {
      let requests = 0
      const routerBaseUrl = await startRouter(() => {
        requests += 1
      })
      const factory = createExecutor({
        backend,
        routerBaseUrl,
        routerKey: 'key',
        ...(backend === 'router-tools' ? { tools: [], executeToolCall: async () => '' } : {}),
      })
      const spec: AgentSpec = {
        profile: routerProfile({ failOnError: true, skills: [remoteSkill] }),
        harness: null,
      }

      expect(() => factory(spec, { signal: new AbortController().signal, seams: {} })).toThrow(
        /skill resource "edge-cases" is not inline/,
      )
      expect(requests).toBe(0)
    },
  )

  it('applies the same strict default when the profile omits the policy', async () => {
    const routerBaseUrl = await startRouter(() => {})
    const factory = createExecutor({ backend: 'router', routerBaseUrl, routerKey: 'key' })
    const spec: AgentSpec = { profile: routerProfile({ skills: [remoteSkill] }), harness: null }

    expect(() => factory(spec, { signal: new AbortController().signal, seams: {} })).toThrow(
      /skill resource "edge-cases" is not inline/,
    )
  })

  it.each(['router', 'router-tools'] as const)(
    'refuses a best-effort profile on the %s backend instead of applying strict behind the caller',
    async (backend) => {
      const routerBaseUrl = await startRouter(() => {})
      const factory = createExecutor({
        backend,
        routerBaseUrl,
        routerKey: 'key',
        ...(backend === 'router-tools' ? { tools: [], executeToolCall: async () => '' } : {}),
      })
      const spec: AgentSpec = {
        profile: routerProfile({ failOnError: false, skills: [inlineSkill] }),
        harness: null,
      }

      expect(() => factory(spec, { signal: new AbortController().signal, seams: {} })).toThrow(
        /resources\.failOnError: false/,
      )
    },
  )

  it('accepts a strict root profile on the router supervisor root path', async () => {
    const routerBaseUrl = await startRouter(() => {})

    await expect(
      supervise(routerProfile({ failOnError: true, instructions: 'Stay strict.' }), 'do the task', {
        backend: { backend: 'router', routerBaseUrl, routerKey: 'key' },
        router: { routerBaseUrl, routerKey: 'key' },
        budget: { maxIterations: 2, maxTokens: 1000 },
      }),
    ).resolves.toBeDefined()
  })

  it('refuses a best-effort root profile on the router supervisor path', async () => {
    const routerBaseUrl = await startRouter(() => {})

    await expect(
      supervise(routerProfile({ failOnError: false, instructions: 'Be lenient.' }), 'do the task', {
        backend: { backend: 'router', routerBaseUrl, routerKey: 'key' },
        router: { routerBaseUrl, routerKey: 'key' },
        budget: { maxIterations: 2, maxTokens: 1000 },
      }),
    ).rejects.toThrow(/resources\.failOnError: false/)
  })

  it('fails a strict root profile closed on an instruction resource it cannot fetch', async () => {
    const routerBaseUrl = await startRouter(() => {})

    await expect(
      supervise(
        routerProfile({
          failOnError: true,
          instructions: {
            kind: 'github',
            repository: 'tangle-network/skills',
            path: 'policies/root.md',
            ref: 'main',
          },
        }),
        'do the task',
        {
          backend: { backend: 'router', routerBaseUrl, routerKey: 'key' },
          router: { routerBaseUrl, routerKey: 'key' },
          budget: { maxIterations: 2, maxTokens: 1000 },
        },
      ),
    ).rejects.toThrow(/resources\.instructions is a github resource reference/)
  })
})
