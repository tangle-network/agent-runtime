import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import { supervisePursuit } from '../../src/durable/supervise-pursuit'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { testContinuation } from '../helpers/continuation'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('nested retained owner native custody', () => {
  it('continues the same nested native session while preserving an independent parent result', {
    timeout: 40_000,
  }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nested-capture-gate-'))
    directories.push(directory)
    const runId = 'nested-capture-gate'
    const context = createFileRunContext(join(directory, 'run'))
    const base = durableRetainedProvider(join(directory, 'provider.json'))
    const roles = new Map<string, string>()
    const wrappers = new Map<string, (environment: AgentEnvironment) => AgentEnvironment>()
    const dispatched: Array<{ role: string; environmentId: string; executionId?: string }> = []
    const destroyed: string[] = []
    const director = testAgentProfile('director', {
      harness: 'claude-code',
      tools: runtimeToolDeclarations('submit_result'),
    })
    const provider: AgentEnvironmentProvider = {
      ...base,
      capabilities: async () => ({
        ...(await base.capabilities()),
        create: { runtimeAttachments: { mcp: true } },
      }),
      async create(input) {
        const created = await base.create(input)
        const role = typeof input.profile === 'string' ? input.profile : input.profile.name
        roles.set(created.id, role)
        const attachment = input.runtimeAttachments?.mcp?.['agent-runtime-coordination']
        if (attachment?.transport !== 'http') throw new Error('missing coordination attachment')
        const call = async (name: string, args: unknown) => {
          const response = await fetch(attachment.url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${input.env?.AGENT_RUNTIME_COORDINATION_TOKEN}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: name,
              method: 'tools/call',
              params: { name, arguments: args },
            }),
          })
          const body = await response.json()
          if (!response.ok || body.error || body.result?.isError)
            throw new Error(JSON.stringify(body))
          return JSON.parse(body.result.content[0].text)
        }
        const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
          ...environment,
          async dispatch(turn) {
            const result = await environment.dispatch!(turn)
            dispatched.push({
              role,
              environmentId: environment.id,
              executionId: turn.executionId,
            })
            const count = dispatched.filter((event) => event.role === role).length
            if (role === 'root') {
              if (count === 1) {
                await call('spawn_worker', { profile: director, task: 'Find a nested answer.' })
              } else {
                // The parent independently resolves its task. This is deliberately NOT proof
                // that the nested manager completed or that a sealed pursuit can resume it.
                await expect
                  .poll(
                    async () => {
                      const events = (await context.journal.loadTree(runId)) ?? []
                      return (
                        events.some((event) => event.kind === 'reconciled') ||
                        dispatched.filter((event) => event.role === 'director').length > 1
                      )
                    },
                    { timeout: 10_000 },
                  )
                  .toBe(true)
                expect(
                  await call('submit_result', { result: { answer: 'independent parent' } }),
                ).toMatchObject({ accepted: true })
              }
            } else if (count > 1) {
              // The nested manager continues its admitted native session.
              await call('submit_result', { result: { answer: 'nested' } })
            }
            return result
          },
          async destroy() {
            destroyed.push(environment.id)
            await environment.destroy?.()
          },
        })
        wrappers.set(created.id, wrap)
        return wrap(created)
      },
      async get(id) {
        const environment = await base.get!(id)
        const wrap = wrappers.get(id)
        return environment && wrap ? wrap(environment) : environment
      },
    }
    const backend = { backend: 'provider' as const, provider }
    const { result } = await supervisePursuit(
      testAgentProfile('root', {
        harness: 'claude-code',
        tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
      }),
      'Resolve this task independently of any blocked nested manager.',
      {
        pursuitId: runId,
        runId,
        runDir: join(directory, 'run'),
        journal: context.journal,
        blobs: context.blobs,
        backend,
        driverBackend: backend,
        budget: { maxIterations: 20, maxTokens: 1_000, deadlineMs: 25_000 },
        perWorker: { maxIterations: 6, maxTokens: 100 },
        maxDepth: 3,
        driverRetry: { enabled: false },
        retainedAtSettlement: 'release',
        teardownConfirmMs: 0,
        wake: { deadlineWarningMs: 0, debounceMs: 20 },
        deliverable: {
          check: (out) => (out as { answer?: string })?.answer === 'independent parent',
        },
        resolveDeliverable: () => ({
          check: (out) => (out as { answer?: string })?.answer === 'nested',
        }),
        continuation: testContinuation(),
        coordination: {
          authentication: {
            signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
          },
          publicUrl: (address) => `http://127.0.0.1:${address.port}/manager`,
        },
      },
    )
    expect(result).toMatchObject({ kind: 'winner', out: { answer: 'independent parent' } })
    expect(await readFile(join(directory, 'run', 'result.json'), 'utf8')).toContain(
      'independent parent',
    )
    const nestedDispatches = dispatched.filter((event) => event.role === 'director')
    expect(nestedDispatches).toHaveLength(2)
    expect([...roles.values()].filter((role) => role === 'director')).toHaveLength(1)
    expect(nestedDispatches[1]!.environmentId).toBe(nestedDispatches[0]!.environmentId)
    expect(destroyed).toContain(nestedDispatches[0]!.environmentId)
    const parentEvents = (await context.journal.loadTree(runId)) ?? []
    const spawn = parentEvents.find(
      (event) => event.kind === 'spawned' && event.ownedTreeRoot !== undefined,
    )
    if (spawn?.kind !== 'spawned' || spawn.ownedTreeRoot === undefined)
      throw new Error('missing nested owner tree')
    const events = (await context.journal.loadTree(spawn.ownedTreeRoot)) ?? []
    const accepted = events.filter((event) => event.kind === 'execution-result')
    expect(accepted).toHaveLength(2)
    expect(await context.blobs.get(accepted[0]!.outRef)).toBeDefined()
    expect(events.filter((event) => event.kind === 'execution-input')).toHaveLength(2)
    expect(events.filter((event) => event.kind === 'execution-abandoned')).toHaveLength(0)
    expect(events.filter((event) => event.kind === 'evidence-pending')).toEqual([])
    expect(
      events
        .filter((event) => event.kind === 'execution-input')
        .every((event) => event.workspaceRetention !== true),
    ).toBe(true)
  })
})
