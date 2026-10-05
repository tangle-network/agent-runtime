import type {
  AgentEnvironmentProvider,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import { expect, it } from 'vitest'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { ExecutorNodeContext } from '../../src/runtime/supervise/types'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

async function callTool(
  input: CreateAgentEnvironmentInput,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const server = input.runtimeAttachments?.mcp['agent-runtime-coordination']
  if (server?.transport !== 'http') throw new Error('missing coordination attachment')
  const headers = Object.fromEntries(
    Object.entries(server.headers ?? {}).map(([key, value]) => {
      if (value.kind !== 'secret-ref' || value.format !== 'bearer') {
        throw new Error('expected private bearer reference')
      }
      return [key, `Bearer ${input.env?.[value.key]}`]
    }),
  )
  const response = await fetch(server.url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: name,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const reply = (await response.json()) as {
    result?: { structuredContent?: Record<string, unknown>; isError?: boolean }
  }
  if (!response.ok || reply.result?.isError || !reply.result?.structuredContent) {
    throw new Error(`coordination ${name} failed: ${JSON.stringify(reply)}`)
  }
  return reply.result.structuredContent
}

it('scopes a live product check to the root across a provider director and its leaf', async () => {
  const tools = runtimeToolDeclarations('spawn_worker')
  const root = testAgentProfile('root', { harness: 'codex', tools })
  const director = testAgentProfile('director', { harness: 'codex', tools })
  const leaf = testAgentProfile('leaf', { harness: 'codex' })
  const checked: Array<{ name: string; node: ExecutorNodeContext }> = []
  const commands: string[] = []
  const destroyed = new Set<string>()
  const spawners = new Set<string>()
  let environments = 0
  const provider: AgentEnvironmentProvider = {
    name: 'recursive-validation-fixture',
    capabilities: () => ({ create: { runtimeAttachments: { mcp: true } } }),
    async create(input) {
      const name = input.profile?.name ?? 'missing'
      const id = `env-${name}-${environments++}`
      return {
        id,
        provider: 'recursive-validation-fixture',
        status: async () => 'running',
        destroy: async () => {
          destroyed.add(id)
        },
        exec: async (command) => {
          expect(destroyed.has(id)).toBe(false)
          commands.push(`${name}:${command}`)
          return { exitCode: name === 'root' ? 0 : 1, stdout: '', stderr: '' }
        },
        async *stream() {
          // A manager spawns on its first turn and ends it; its wake finds nothing left to start.
          if (name !== 'leaf' && !spawners.has(name)) {
            spawners.add(name)
            const spawned = await callTool(input, 'spawn_worker', {
              profile: name === 'root' ? director : leaf,
              task: 'Complete this assignment.',
              budget: {
                maxIterations: name === 'root' ? 8 : 2,
                maxTokens: name === 'root' ? 1000 : 100,
              },
            })
            expect(typeof spawned.workerId, JSON.stringify(spawned)).toBe('string')
          }
          yield { type: 'text', data: { text: name } }
          yield { type: 'done', data: { outcome: { type: 'completed' } } }
        },
      }
    },
  }

  const result = await supervise(root, 'Build the product.', {
    runId: 'validator-context',
    backend: {
      backend: 'provider',
      provider,
      validator: {
        async validate(out, ctx) {
          if (ctx.node?.depth === undefined) throw new Error('missing supervised depth')
          checked.push({ name: out.content, node: ctx.node })
          if (ctx.node.depth !== 0) return { valid: out.content.length > 0, score: 1 }
          const check = await ctx.box?.exec('verify-product')
          return { valid: check?.exitCode === 0, score: 1 }
        },
      },
    },
    budget: { maxIterations: 32, maxTokens: 4000 },
    perWorker: { maxIterations: 8, maxTokens: 1000 },
    driverRetry: { enabled: false },
    coordination: {
      authentication: true,
      publicUrl: ({ port }) => `http://127.0.0.1:${port}/mcp`,
    },
  })

  // Every manager drive is checked: the turn that spawns, and the turn Runtime wakes with the
  // result. The check still scopes to the root's live box and to each node's own depth.
  expect(
    checked.map(({ name, node }) => `${name}:${node.depth}`).sort(),
    JSON.stringify(result),
  ).toEqual(['director:1', 'director:1', 'leaf:2', 'root:0', 'root:0'])
  expect(new Set(checked.map(({ node }) => node.nodeId)).size).toBe(3)
  expect(new Set(checked.map(({ node }) => node.attemptId)).size).toBe(checked.length)
  expect(checked.every(({ node }) => Object.isFrozen(node))).toBe(true)
  expect(commands).toEqual(['root:verify-product', 'root:verify-product'])
  expect(destroyed.size).toBe(environments)
})
