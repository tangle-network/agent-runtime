/** A retained wake must include child completions received while its exact result is delayed. */
import { mkdtemp, rm } from 'node:fs/promises'
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

describe('retained root wake after a slow exact result', () => {
  it('delivers a child that settled during the exact result read without reporting it running', {
    timeout: 40_000,
  }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retained-wake-capture-'))
    directories.push(directory)
    const runId = 'retained-wake-capture'
    const context = createFileRunContext(join(directory, 'run'))
    const base = durableRetainedProvider(join(directory, 'provider.json'))
    const roles = new Map<string, string>()
    const wrappers = new Map<string, (environment: AgentEnvironment) => AgentEnvironment>()
    const rootTurns: string[] = []
    let releaseChild!: () => void
    const childMayFinish = new Promise<void>((resolve) => {
      releaseChild = resolve
    })
    let rootResults = 0
    // A settled event names the worker and its status; the worker's answer is read separately.
    const childSettledEvent = `\\"settled\\":\\"${runId}:s0\\",\\"status\\":\\"done\\"`
    const worker = testAgentProfile('delay', {
      harness: 'claude-code',
      tools: runtimeToolDeclarations('submit_result'),
    })
    const childSettled = async () =>
      ((await context.journal.loadTree(runId)) ?? []).some(
        (event) => event.kind === 'settled' && event.id !== runId,
      )
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
          session(id, options) {
            const session = environment.session!(id, options)
            return {
              ...session,
              async result() {
                if (role === 'root' && ++rootResults === 1) {
                  releaseChild()
                  await expect.poll(childSettled, { timeout: 15_000 }).toBe(true)
                }
                return session.result()
              },
            }
          },
          async dispatch(turn) {
            const result = await environment.dispatch!(turn)
            if (role === 'root') {
              rootTurns.push(JSON.stringify(turn))
              if (rootTurns.length === 1) {
                await call('spawn_worker', { profile: worker, task: 'Wait, then report.' })
              } else if (rootTurns.at(-1)!.includes(childSettledEvent)) {
                await call('submit_result', { result: { answer: 'ROOT: child received' } })
              }
            } else {
              // The child finishes only once the root's wake has been composed.
              await childMayFinish
              await call('submit_result', { result: { answer: 'CHILD: ready' } })
            }
            return result
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
      'Spawn one child, wait for its result, then submit.',
      {
        pursuitId: runId,
        runId,
        runDir: join(directory, 'run'),
        journal: context.journal,
        blobs: context.blobs,
        backend,
        driverBackend: backend,
        budget: { maxIterations: 20, maxTokens: 1_000, deadlineMs: 30_000 },
        perWorker: { maxIterations: 6, maxTokens: 100 },
        driverRetry: { enabled: false },
        retainedAtSettlement: 'release',
        teardownConfirmMs: 0,
        wake: { heartbeatMs: 50, deadlineWarningMs: 0, debounceMs: 20 },
        deliverable: {
          check: (out) => (out as { answer?: string })?.answer === 'ROOT: child received',
        },
        continuation: testContinuation(),
        coordination: {
          authentication: {
            signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
          },
          publicUrl: (address) => `http://127.0.0.1:${address.port}/manager`,
        },
      },
    )
    expect(rootResults).toBeGreaterThanOrEqual(1)
    // The turn dispatched after the delayed exact result carries the child's settlement and no stale worker.
    const second = rootTurns[1]
    expect(second).toBeDefined()
    expect(second).toContain(childSettledEvent)
    expect(second).toContain('Workers running: none.')
    expect(second).not.toContain(`Workers running: ${runId}:s0`)
    expect(result).toMatchObject({ kind: 'winner', out: { answer: 'ROOT: child received' } })
    // Exactly once: the child's settlement reaches one root turn.
    expect(rootTurns.filter((turn) => turn.includes(childSettledEvent))).toHaveLength(1)
  })
})
