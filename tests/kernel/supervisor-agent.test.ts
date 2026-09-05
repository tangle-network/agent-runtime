import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { ConfigError } from '../../src/errors'
import type { MakeWorkerAgent } from '../../src/mcp/tools/coordination'
import type { RouterTransportConfig } from '../../src/runtime/router-client'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createRootHandle, createSupervisor } from '../../src/runtime/supervise/supervisor'
import {
  coordinationMcpAlias,
  type DriveHarness,
  declaredRuntimeToolNames,
  type ResolveSupervisorTools,
  resolveSupervisorProfile,
  type SupervisorProfile,
} from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  SpawnEvent,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import { supervisorAgent } from '../helpers/runtime-with-test-brain'
import { scriptedBrain } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const perWorker: Budget = { maxIterations: 4, maxTokens: 1000 }

// A real delivering leaf — NOT a mock of the spawn path; HTTP→MCP→Scope.spawn→settle is real.
function deliveringLeaf(name: string, out: unknown): Agent<unknown, unknown> {
  const ex: Executor<unknown> = {
    runtime: 'router',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
        yield { kind: 'cost', usd: 0, usdKnown: true, provenance: 'provider-receipt' } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `w:${name}`,
      out,
      verdict: { valid: true, score: 1 },
      spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor: ex }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

async function jsonRpc(url: string, method: string, params: unknown): Promise<unknown> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return r.json()
}

function runSupervisor(
  root: Agent<unknown, unknown>,
  blobs: InMemoryResultBlobStore,
  journal: InMemorySpawnJournal,
) {
  return createSupervisor<unknown, unknown>().run(root, 'solve it', {
    budget: { maxIterations: 100, maxTokens: 100_000 },
    runId: 'sup',
    journal,
    blobs,
    executors: createExecutorRegistry(),
    maxDepth: 4,
    now: () => 0,
  })
}

describe('supervisorAgent — the brain is resolved from profile.harness (backend-as-data)', () => {
  it('rejects behavioral fields smuggled through a widened Router transport object', () => {
    const router = {
      routerBaseUrl: 'http://router.test/v1',
      routerKey: 'k',
      maxTokens: 7,
      retry: { maxAttempts: 1 },
      stream: true,
    } as unknown as RouterTransportConfig

    expect(() =>
      supervisorAgent(
        testAgentProfile('root', {
          harness: 'cli-base',
          model: { provider: 'tangle-router', default: 'deepseek-v4-flash' },
        }),
        {
          router,
          blobs: new InMemoryResultBlobStore(),
          makeWorkerAgent: () => deliveringLeaf('unused', {}),
          perWorker,
        },
      ),
    ).toThrow(/unsupported behavioral fields: maxTokens, retry, stream/u)
  })

  it('ROUTER arm (harness null): the in-process tool-loop drives a worker to delivery', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const worker = deliveringLeaf('w', { answer: 42 })
    // A scripted brain stands in for routerBrain (no creds): spawn → await → stop.
    const brain = scriptedBrain([
      {
        toolCalls: [
          {
            name: 'spawn_worker',
            arguments: { profile: testAgentProfile('worker'), task: 'go' },
          },
        ],
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ])
    const root = supervisorAgent(
      testAgentProfile('root', {
        harness: 'cli-base',
        prompt: { systemPrompt: 'drive the worker' },
        tools: runtimeToolDeclarations('spawn_worker', 'await_event'),
      }),
      { brain, blobs, makeWorkerAgent: () => worker, perWorker, maxTurns: 8 },
    )
    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
  })

  it('SANDBOX arm (harness=opencode): a sandboxed harness drives the verbs over the live MCP', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    // The stub harness drives the coordination MCP over REAL HTTP — exactly what an in-box
    // opencode/claude-code supervisor does via mcp.mcpServers. No router brain, no hand-built loop.
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl }) => {
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'spawn_worker',
        arguments: { profile: testAgentProfile('worker'), task: 'go' },
      })
      await jsonRpc(coordinationMcpUrl, 'tools/call', { name: 'await_event', arguments: {} })
      await jsonRpc(coordinationMcpUrl, 'tools/call', { name: 'stop', arguments: {} })
    }
    const root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'opencode',
        prompt: { systemPrompt: 'delegate, do not solve' },
        tools: runtimeToolDeclarations('spawn_worker', 'await_event', 'stop'),
      }),
      { blobs, makeWorkerAgent: () => deliveringLeaf('w', { answer: 7 }), perWorker, driveHarness },
    )
    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
  })

  it('refuses an enabled unknown Runtime declaration before dispatching the provider', () => {
    const blobs = new InMemoryResultBlobStore()
    let harnessCalls = 0
    expect(() =>
      supervisorAgent(
        testAgentProfile('sup', {
          harness: 'opencode',
          tools: runtimeToolDeclarations('not_a_runtime_tool'),
        }),
        {
          blobs,
          makeWorkerAgent: () => deliveringLeaf('unused', {}),
          perWorker,
          driveHarness: async () => {
            harnessCalls += 1
          },
        },
      ),
    ).toThrow(/no resolveSupervisorTools provider/u)
    expect(harnessCalls).toBe(0)
  })

  it('refuses an authored MCP entry under the Runtime coordination alias', () => {
    let harnessCalls = 0
    expect(() =>
      supervisorAgent(
        testAgentProfile('sup', {
          harness: 'opencode',
          mcp: {
            [coordinationMcpAlias]: { transport: 'http', url: 'https://untrusted.example/mcp' },
          },
        }),
        {
          blobs: new InMemoryResultBlobStore(),
          makeWorkerAgent: () => deliveringLeaf('unused', {}),
          perWorker,
          driveHarness: async () => {
            harnessCalls += 1
          },
        },
      ),
    ).toThrow(/MCP alias "agent-runtime-coordination" is reserved/u)
    expect(harnessCalls).toBe(0)
  })

  it('normalizes Runtime tool declarations before materialization', () => {
    expect(
      declaredRuntimeToolNames(
        testAgentProfile('sup', {
          tools: runtimeToolDeclarations('spawn_worker', 'await_event'),
        }),
      ),
    ).toEqual(['await_event', 'spawn_worker'])
  })

  it('SANDBOX arm retains a checked direct result even when the backend exits with an error afterward', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl }) => {
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'submit_result',
        arguments: { result: { answer: 42 } },
      })
      throw new Error('backend exited after submission')
    }
    const root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'pi',
        prompt: { systemPrompt: 'solve or delegate' },
        tools: runtimeToolDeclarations('submit_result'),
      }),
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('unused', {}),
        perWorker,
        driveHarness,
        deliverable: {
          describe: 'an object whose answer is 42',
          check: (result) => (result as { answer?: unknown }).answer === 42,
        },
      },
    )

    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ answer: 42 })
  })

  it('SANDBOX arm stops the active harness before a provider turn after accepted submission', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    let providerCalls = 0
    let observedStop = false
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl, stopSignal }) => {
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'submit_result',
        arguments: { result: { answer: 42 } },
      })
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          providerCalls += 1
          resolve()
        }, 10)
        if (stopSignal === undefined) return
        const stopped = () => {
          clearTimeout(timer)
          observedStop = true
          resolve()
        }
        if (stopSignal.aborted) stopped()
        else stopSignal.addEventListener('abort', stopped, { once: true })
      })
      if (providerCalls > 0) throw new Error('provider call after accepted submission')
    }
    const root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'pi',
        prompt: { systemPrompt: 'solve or delegate' },
        tools: runtimeToolDeclarations('submit_result'),
      }),
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('unused', {}),
        perWorker,
        driveHarness,
        deliverable: {
          describe: 'an object whose answer is 42',
          check: (result) => (result as { answer?: unknown }).answer === 42,
        },
      },
    )

    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
    expect(observedStop).toBe(true)
    expect(providerCalls).toBe(0)
  })

  it('fails loud when a sandboxed-harness supervisor has no driveHarness substrate', () => {
    const blobs = new InMemoryResultBlobStore()
    expect(() =>
      supervisorAgent(testAgentProfile('sup', { harness: 'opencode' }), {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        perWorker,
      }),
    ).toThrow(/driveHarness/)
  })

  it('fails loud when a router-brained supervisor has neither a brain nor a router config', () => {
    const blobs = new InMemoryResultBlobStore()
    expect(() =>
      supervisorAgent(testAgentProfile('root', { harness: 'cli-base' }), {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        perWorker,
      }),
    ).toThrow(/router/)
  })

  it('lowers every profile-owned Router setting into the supervisor request', async () => {
    const blobs = new InMemoryResultBlobStore()
    let sent: Record<string, unknown> | undefined
    const root = supervisorAgent(
      testAgentProfile('root', {
        harness: 'cli-base',
        tools: runtimeToolDeclarations('await_event'),
        model: {
          provider: 'offline',
          default: 'offline-test-model',
          metadata: {
            seed: 42,
            toolChoice: 'none',
            extraBody: { provider_options: { prompt_cache: true } },
          },
        },
      }),
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('unused', {}),
        perWorker,
        maxTurns: 1,
        router: {
          routerBaseUrl: 'http://injected.invalid/v1',
          routerKey: 'injected-transport',
          complete: async (body) => {
            sent = body
            return {
              model: 'offline-test-model',
              choices: [{ message: { content: 'done' } }],
              usage: { prompt_tokens: 3, completion_tokens: 2 },
            }
          },
        },
      },
    )

    await runSupervisor(root, blobs, new InMemorySpawnJournal())
    expect(sent).toMatchObject({
      seed: 42,
      tool_choice: 'none',
      provider_options: { prompt_cache: true },
    })
  })

  it('binds the same node-scoped product tool to router and external managers with trusted context', async () => {
    const identity = {
      profileDigest: `sha256:${'a'.repeat(64)}`,
      taskDigest: `sha256:${'b'.repeat(64)}`,
      correlation: { campaign: 'campaign-7' },
    } as const
    const nodeContext = {
      runId: 'sup',
      runNamespace: 'durable-run-namespace',
      ownerId: 'owner-root',
      depth: 0,
      identity,
    }
    const calls: Array<{ raw: unknown; context: unknown }> = []
    const resolveSupervisorTools: ResolveSupervisorTools = async () => [
      {
        name: 'read_product_evidence',
        description: 'Read one product-owned evidence record',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            runId: { type: 'string' },
            trustedContext: { type: 'object' },
          },
          required: ['key'],
        },
        handler: async (raw, context) => {
          calls.push({ raw, context })
          return {
            key: (raw as { key?: unknown }).key,
            suppliedRunId: (raw as { runId?: unknown }).runId,
            trustedRunId: context.runId,
            trustedNodeId: context.nodeId,
          }
        },
      },
    ]
    const modelArguments = {
      key: 'claim-1',
      runId: 'model-forged-run',
      trustedContext: { nodeId: 'model-forged-node' },
    }

    let routerDescriptor: unknown
    let routerTurn = 0
    const brain: ToolLoopChat = async (_messages, tools) => {
      routerDescriptor = tools.find((entry) => entry.function.name === 'read_product_evidence')
      routerTurn += 1
      return routerTurn === 1
        ? {
            toolCalls: [
              {
                id: 'product-call',
                name: 'read_product_evidence',
                arguments: JSON.stringify(modelArguments),
              },
            ],
          }
        : { content: 'done', toolCalls: [] }
    }
    const routerBlobs = new InMemoryResultBlobStore()
    await runSupervisor(
      supervisorAgent(
        testAgentProfile('router-manager', {
          harness: 'cli-base',
          tools: runtimeToolDeclarations('read_product_evidence'),
        }),
        {
          brain,
          blobs: routerBlobs,
          makeWorkerAgent: () => deliveringLeaf('unused', {}),
          perWorker,
          nodeContext,
          resolveSupervisorTools,
        },
      ),
      routerBlobs,
      new InMemorySpawnJournal(),
    )

    let externalDescriptor: unknown
    let externalCall: unknown
    const externalBlobs = new InMemoryResultBlobStore()
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl }) => {
      const listed = (await jsonRpc(coordinationMcpUrl, 'tools/list', {})) as {
        result?: { tools?: unknown[] }
      }
      externalDescriptor = listed.result?.tools?.find(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          (entry as { name?: unknown }).name === 'read_product_evidence',
      )
      externalCall = await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'read_product_evidence',
        arguments: modelArguments,
      })
    }
    await runSupervisor(
      supervisorAgent(
        testAgentProfile('external-manager', {
          harness: 'opencode',
          tools: runtimeToolDeclarations('read_product_evidence'),
        }),
        {
          blobs: externalBlobs,
          makeWorkerAgent: () => deliveringLeaf('unused', {}),
          perWorker,
          driveHarness,
          nodeContext,
          resolveSupervisorTools,
        },
      ),
      externalBlobs,
      new InMemorySpawnJournal(),
    )

    expect(routerDescriptor).toMatchObject({
      function: {
        name: 'read_product_evidence',
        description: 'Read one product-owned evidence record',
      },
    })
    expect(externalDescriptor).toMatchObject({
      name: 'read_product_evidence',
      description: 'Read one product-owned evidence record',
    })
    expect(externalCall).toMatchObject({
      result: {
        structuredContent: {
          key: 'claim-1',
          suppliedRunId: 'model-forged-run',
          trustedRunId: 'sup',
          trustedNodeId: 'sup',
        },
      },
    })
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.raw).toEqual(modelArguments)
      expect(Object.isFrozen(call.raw)).toBe(true)
      expect(call.context).toMatchObject({
        runId: 'sup',
        runNamespace: 'durable-run-namespace',
        nodeId: 'sup',
        ownerId: 'owner-root',
        identity,
        task: 'solve it',
      })
      expect(Object.isFrozen(call.context)).toBe(true)
      expect(Object.isFrozen((call.context as { identity: unknown }).identity)).toBe(true)
      expect((call.context as { signal: AbortSignal }).signal).toBeInstanceOf(AbortSignal)
      expect((call.context as { signal: AbortSignal }).signal.aborted).toBe(false)
    }
  })

  it('a product tool composes children through context.verbs on both arms, across the same gates', async () => {
    // The census fault #813 reports: a lead can only coordinate one model turn per verb, so it
    // never composes. `context.verbs` gives a product tool the SAME handlers the MCP verbs use —
    // so a spawn made in code is authorized, capped, journaled, and bussed identically.
    const authorized: string[] = []
    const refusals: string[] = []
    let composeResult: unknown

    const resolveSupervisorTools: ResolveSupervisorTools = async () => [
      {
        name: 'compose_children',
        description: 'Spawn two children in code and await the first settlement',
        inputSchema: { type: 'object', properties: {} },
        handler: async (_raw, context) => {
          const first = await context.verbs.spawnAgent({
            profile: testAgentProfile('composed-a'),
            task: 'go',
            label: 'composed-a',
          })
          // The second spawn crosses the same maxLiveWorkers fence the MCP verb crosses.
          let secondError: string | undefined
          try {
            await context.verbs.spawnAgent({
              profile: testAgentProfile('composed-b'),
              task: 'go',
              label: 'composed-b',
            })
          } catch (error) {
            secondError = error instanceof Error ? error.message : String(error)
          }
          const settled = await context.verbs.awaitEvent({ kinds: ['settled'] })
          return { first, secondError, settled }
        },
      },
    ]

    const runArm = async (
      arm: 'router' | 'external',
    ): Promise<{ journal: InMemorySpawnJournal; result: unknown }> => {
      authorized.length = 0
      refusals.length = 0
      const blobs = new InMemoryResultBlobStore()
      const journal = new InMemorySpawnJournal()
      const makeWorkerAgent: MakeWorkerAgent = (profile) => {
        authorized.push(profile.name ?? 'unnamed')
        return deliveringLeaf(profile.name ?? 'composed', { answer: profile.name })
      }
      const deps = {
        blobs,
        makeWorkerAgent,
        perWorker,
        maxLiveWorkers: 1,
        nodeContext: { runId: 'sup', runNamespace: 'verbs-ns', ownerId: 'owner-root', depth: 0 },
        resolveSupervisorTools,
      }
      if (arm === 'router') {
        const brain = scriptedBrain([
          { toolCalls: [{ name: 'compose_children', arguments: {} }] },
          { content: 'done' },
        ])
        await runSupervisor(
          supervisorAgent(
            testAgentProfile('router-manager', {
              harness: 'cli-base',
              tools: runtimeToolDeclarations('compose_children', 'spawn_worker', 'await_event'),
            }),
            {
              ...deps,
              brain,
            },
          ),
          blobs,
          journal,
        )
        return { journal, result: composeResult }
      }
      const driveHarness: DriveHarness = async ({ coordinationMcpUrl }) => {
        composeResult = await jsonRpc(coordinationMcpUrl, 'tools/call', {
          name: 'compose_children',
          arguments: {},
        })
      }
      await runSupervisor(
        supervisorAgent(
          testAgentProfile('external-manager', {
            harness: 'opencode',
            tools: runtimeToolDeclarations('compose_children', 'spawn_worker', 'await_event'),
          }),
          {
            ...deps,
            driveHarness,
          },
        ),
        blobs,
        journal,
      )
      return { journal, result: composeResult }
    }

    for (const arm of ['router', 'external'] as const) {
      composeResult = undefined
      const { journal } = await runArm(arm)
      // authorizeSpawn (makeWorkerAgent) observed the composed spawn on this arm.
      expect(authorized).toContain('composed-a')
      // The second spawn was refused by the live-worker cap, not silently accepted.
      expect(authorized).not.toContain('composed-b')
      // The child is journaled under THIS manager's scope, like any coordination spawn.
      const events = (await journal.loadTree('sup')) as SpawnEvent[]
      expect(events.some((e) => e.kind === 'spawned' && e.label === 'composed-a')).toBe(true)
      expect(events.some((e) => e.kind === 'settled' && e.status === 'done')).toBe(true)
    }
  })

  it('RootHandle.abort cancels a product tool inside a recursive router manager', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const handle = createRootHandle<unknown>()
    let toolStarted!: () => void
    const started = new Promise<void>((resolve) => {
      toolStarted = resolve
    })
    let toolCancelled!: () => void
    const cancelled = new Promise<void>((resolve) => {
      toolCancelled = resolve
    })
    let nestedSignal: AbortSignal | undefined
    const nested = supervisorAgent(
      testAgentProfile('nested-manager', {
        harness: 'cli-base',
        tools: runtimeToolDeclarations('run_experiment'),
      }),
      {
        brain: scriptedBrain([
          { toolCalls: [{ name: 'run_experiment', arguments: { candidate: 'a' } }] },
          { content: 'must not continue after cancellation' },
        ]),
        blobs,
        makeWorkerAgent: () => deliveringLeaf('unused', {}),
        perWorker,
        nodeContext: {
          runId: 'recursive-tool-abort',
          runNamespace: 'recursive-tool-abort-namespace',
          ownerId: 'owner-nested',
          depth: 1,
          assignmentId: 'nested-assignment',
          identity: {
            profileDigest: `sha256:${'e'.repeat(64)}`,
            taskDigest: `sha256:${'f'.repeat(64)}`,
          },
        },
        resolveSupervisorTools: async () => [
          {
            name: 'run_experiment',
            description: 'Run a long product-owned experiment',
            inputSchema: { type: 'object' },
            handler: async (_raw, context) => {
              nestedSignal = context.signal
              toolStarted()
              await new Promise<void>((_resolve, reject) => {
                const onAbort = () => {
                  toolCancelled()
                  reject(new DOMException(String(context.signal.reason), 'AbortError'))
                }
                if (context.signal.aborted) onAbort()
                else context.signal.addEventListener('abort', onAbort, { once: true })
              })
              return { unreachable: true }
            },
          },
        ],
      },
    )
    const root: Agent<unknown, unknown> = {
      name: 'root',
      async act(task, scope) {
        const spawned = scope.spawn(
          driverChild(
            testAgentProfile('nested-manager', {
              harness: 'cli-base',
              tools: runtimeToolDeclarations('run_experiment'),
            }),
            nested,
            journal,
          ),
          task,
          {
            budget: { maxIterations: 20, maxTokens: 20_000 },
            label: 'nested-manager',
          },
        )
        if (!spawned.ok) throw new Error(spawned.reason)
        await scope.next()
        return undefined
      },
    }
    const supervisor = createSupervisor<unknown, unknown>()
    supervisor.attach(handle)
    const running = supervisor.run(root, 'run the nested experiment', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'recursive-tool-abort',
      journal,
      blobs,
      executors: withDriverExecutor(createExecutorRegistry()),
      maxDepth: 4,
      now: () => 0,
    })

    await started
    handle.abort('stop the experiment tree')
    await cancelled
    const result = await running

    expect(result).toMatchObject({ kind: 'no-winner', reason: 'aborted' })
    expect(nestedSignal?.aborted).toBe(true)
    expect(nestedSignal?.reason).toBe('stop the experiment tree')
  })

  it('a caller abort cancels a product tool invoked through the external MCP path', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const caller = new AbortController()
    let toolStarted!: () => void
    const started = new Promise<void>((resolve) => {
      toolStarted = resolve
    })
    let toolCancelled!: () => void
    const cancelled = new Promise<void>((resolve) => {
      toolCancelled = resolve
    })
    let harnessFinished!: () => void
    const finished = new Promise<void>((resolve) => {
      harnessFinished = resolve
    })
    let externalSignal: AbortSignal | undefined
    let externalResponse: unknown
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl }) => {
      try {
        externalResponse = await jsonRpc(coordinationMcpUrl, 'tools/call', {
          name: 'run_experiment',
          arguments: { candidate: 'b' },
        })
      } finally {
        harnessFinished()
      }
    }
    const root = supervisorAgent(
      testAgentProfile('external-manager', {
        harness: 'opencode',
        tools: runtimeToolDeclarations('run_experiment'),
      }),
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('unused', {}),
        perWorker,
        driveHarness,
        nodeContext: {
          runId: 'external-tool-abort',
          runNamespace: 'external-tool-abort-namespace',
          ownerId: 'owner-external',
          depth: 0,
          identity: {
            profileDigest: `sha256:${'1'.repeat(64)}`,
            taskDigest: `sha256:${'2'.repeat(64)}`,
          },
        },
        resolveSupervisorTools: async () => [
          {
            name: 'run_experiment',
            description: 'Run a long product-owned experiment',
            inputSchema: { type: 'object' },
            handler: async (_raw, context) => {
              externalSignal = context.signal
              toolStarted()
              await new Promise<void>((_resolve, reject) => {
                const onAbort = () => {
                  toolCancelled()
                  reject(new DOMException(String(context.signal.reason), 'AbortError'))
                }
                if (context.signal.aborted) onAbort()
                else context.signal.addEventListener('abort', onAbort, { once: true })
              })
              return { unreachable: true }
            },
          },
        ],
      },
    )
    const running = createSupervisor<unknown, unknown>().run(root, 'run the external experiment', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'external-tool-abort',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 4,
      now: () => 0,
      signal: caller.signal,
    })

    await started
    caller.abort()
    await cancelled
    const result = await running
    await finished

    expect(result).toMatchObject({ kind: 'no-winner', reason: 'aborted' })
    expect(externalSignal?.aborted).toBe(true)
    expect(externalSignal?.reason).toBe('caller signal aborted')
    expect(externalResponse).toMatchObject({
      error: { code: -32000, message: 'caller signal aborted' },
    })
  })

  it('captures the resolver and rejects descriptor collisions before brain compute or MCP listen', async () => {
    const seed = {
      runId: 'sup',
      runNamespace: 'namespace',
      ownerId: 'owner',
      depth: 0,
      identity: {
        profileDigest: `sha256:${'c'.repeat(64)}`,
        taskDigest: `sha256:${'d'.repeat(64)}`,
      },
    } as const
    let originalCalls = 0
    let replacementCalls = 0
    let brainCalls = 0
    let harnessCalls = 0
    const deps = {
      blobs: new InMemoryResultBlobStore(),
      makeWorkerAgent: () => deliveringLeaf('unused', {}),
      perWorker,
      nodeContext: seed,
      resolveSupervisorTools: (async () => {
        originalCalls += 1
        return [
          {
            name: 'spawn_worker',
            description: 'collision',
            inputSchema: { type: 'object' },
            handler: async () => ({}),
          },
        ]
      }) as ResolveSupervisorTools,
    }
    const brain: ToolLoopChat = async () => {
      brainCalls += 1
      return { content: 'must not run', toolCalls: [] }
    }
    const mutableRouterDeps = { ...deps, brain }
    const router = supervisorAgent(
      testAgentProfile('router', { harness: 'cli-base' }),
      mutableRouterDeps,
    )
    mutableRouterDeps.resolveSupervisorTools = async () => {
      replacementCalls += 1
      return []
    }
    const routerResult = await runSupervisor(router, deps.blobs, new InMemorySpawnJournal())
    expect(routerResult.kind).toBe('no-winner')
    expect(originalCalls).toBe(1)
    expect(replacementCalls).toBe(0)
    expect(brainCalls).toBe(0)

    const externalBlobs = new InMemoryResultBlobStore()
    const external = supervisorAgent(testAgentProfile('external', { harness: 'opencode' }), {
      ...deps,
      blobs: externalBlobs,
      resolveSupervisorTools: async () => [
        {
          name: 'spawn_worker',
          description: 'collision',
          inputSchema: { type: 'object' },
          handler: async () => ({}),
        },
      ],
      driveHarness: async () => {
        harnessCalls += 1
      },
    })
    const externalResult = await runSupervisor(external, externalBlobs, new InMemorySpawnJournal())
    expect(externalResult.kind).toBe('no-winner')
    expect(harnessCalls).toBe(0)
  })
})

describe('resolveSupervisorProfile — a canonical AgentProfile IS a supervisor profile', () => {
  it('reduces a canonical AgentProfile: model.default is the id, prompt.systemPrompt is the prompt', () => {
    const profile = testAgentProfile('root', {
      harness: 'claude-code',
      model: {
        provider: 'anthropic',
        default: 'anthropic/claude-opus-5',
        small: 'anthropic/claude-haiku-5',
      },
      prompt: { systemPrompt: 'delegate, do not solve' },
    })
    expect(resolveSupervisorProfile(profile)).toEqual({
      name: 'root',
      harness: 'claude-code',
      modelId: 'anthropic/claude-opus-5',
      systemPrompt: 'delegate, do not solve',
    })
  })

  it('defaults only the optional name while preserving exact execution identity', () => {
    const { name: _name, ...unnamed } = testAgentProfile('temporary', {
      harness: 'cli-base',
      model: { provider: 'offline', default: 'm', reasoningEffort: 'xhigh' },
    })
    expect(resolveSupervisorProfile(unnamed)).toEqual({
      name: 'supervisor',
      harness: null,
      modelId: 'm',
    })
  })

  it('refuses an incomplete execution identity', () => {
    expect(() =>
      resolveSupervisorProfile({
        name: 'root',
        harness: 'cli-base',
        model: { provider: 'anthropic' },
      } as AgentProfile),
    ).toThrow(/AgentProfile\.model\.default is missing/)
  })

  it('appends prompt.instructions and resources.instructions to the system prompt, in that order', () => {
    expect(
      resolveSupervisorProfile(
        testAgentProfile('root', {
          harness: 'cli-base',
          prompt: { systemPrompt: 'delegate, do not solve', instructions: ['one', 'two'] },
          resources: { instructions: 'from resources' },
        }),
      ).systemPrompt,
    ).toBe('delegate, do not solve\none\ntwo\nfrom resources')
  })

  it('reads an INLINE resources.instructions resource as its content', () => {
    expect(
      resolveSupervisorProfile(
        testAgentProfile('root', {
          harness: 'cli-base',
          prompt: { systemPrompt: 'base' },
          resources: { instructions: { kind: 'inline', name: 'memory', content: 'learned: X' } },
        }),
      ).systemPrompt,
    ).toBe('base\nlearned: X')
  })

  it('resolves instruction lines even when no system prompt is named', () => {
    expect(
      resolveSupervisorProfile(
        testAgentProfile('root', {
          harness: 'cli-base',
          prompt: { instructions: ['only this'] },
        }),
      ).systemPrompt,
    ).toBe('only this')
  })

  it('fails loud on a github resources.instructions reference it cannot fetch', () => {
    expect(() =>
      resolveSupervisorProfile(
        testAgentProfile('root', {
          harness: 'cli-base',
          resources: { instructions: { kind: 'github', path: 'docs/INSTRUCTIONS.md' } },
        }),
      ),
    ).toThrow(/github resource reference.*docs\/INSTRUCTIONS\.md/s)
  })
})

describe('supervisorAgent — coordination bind + prompt hoisting on the harness arm', () => {
  it('SANDBOX arm hands the harness the resolved prompt BESIDE the profile, not hoisted onto it', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    // A canonical AgentProfile: the schema rejects unknown top-level keys, so a `systemPrompt`
    // hoisted onto this object would make the profile fail its own validator.
    const profile = testAgentProfile('sup', {
      harness: 'opencode',
      prompt: { systemPrompt: 'delegate, do not solve', instructions: ['keep it small'] },
      resources: { instructions: 'prefer the fewest workers' },
    })
    let seen: SupervisorProfile | undefined
    let seenPrompt: string | undefined
    const driveHarness: DriveHarness = async (args) => {
      seen = args.profile
      seenPrompt = args.systemPrompt
    }
    const root = supervisorAgent(profile, {
      blobs,
      makeWorkerAgent: () => deliveringLeaf('w', {}),
      perWorker,
      driveHarness,
    })
    await runSupervisor(root, blobs, journal)
    // The harness receives the caller's profile VALUE untouched — a detached, frozen snapshot so a
    // later mutation of the caller's object cannot redirect a live run — with nothing hoisted on.
    expect(seen).toEqual(profile)
    expect(Object.isFrozen(seen)).toBe(true)
    expect(Object.hasOwn(seen as object, 'systemPrompt')).toBe(false)
    expect(seenPrompt).toBe('delegate, do not solve\nkeep it small\nprefer the fewest workers')
  })

  it('hands a custom harness the provider view and retains the canonical profile for receipt binding', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const profile = testAgentProfile('sup', {
      harness: 'opencode',
      tools: {
        agent_runtime_coordination_spawn_worker: true,
        agent_runtime_coordination_await_event: true,
        // A false declaration grants nothing and never becomes a provider-native tool.
        agent_runtime_coordination_not_a_grant: false,
      },
    })
    let providerProfile: SupervisorProfile | undefined
    let authoredProfile: SupervisorProfile | undefined
    const root = supervisorAgent(profile, {
      blobs,
      makeWorkerAgent: () => deliveringLeaf('w', {}),
      perWorker,
      driveHarness: async (args) => {
        providerProfile = args.profile
        authoredProfile = args.authoredProfile
      },
    })

    await runSupervisor(root, blobs, journal)

    expect(providerProfile?.tools).toBeUndefined()
    expect(authoredProfile).toEqual(profile)
    expect(Object.isFrozen(providerProfile)).toBe(true)
    expect(Object.isFrozen(authoredProfile)).toBe(true)
  })

  it('SANDBOX arm runs the exact profile model without router configuration', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    let ran = false
    const root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'opencode',
        model: { provider: 'anthropic', default: 'claude-sonnet-4' },
      }),
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        perWorker,
        driveHarness: async () => {
          ran = true
        },
      },
    )
    await runSupervisor(root, blobs, journal)
    expect(ran).toBe(true)
  })

  it('uses instruction lines as the complete prompt when no system prompt is declared', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    let seen: string | undefined
    // A profile that names ONLY instructions receives those exact bytes. Runtime supplies no
    // hidden standing policy.
    const root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'cli-base',
        prompt: { instructions: ['never edit main'] },
      }),
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        perWorker,
        brain: async (messages) => {
          seen = messages.find((m) => m.role === 'system')?.content as string
          return { content: '', toolCalls: [] }
        },
      },
    )
    await runSupervisor(root, blobs, journal)
    expect(seen).toBe('never edit main')
  })

  it('leaves a harness supervisor with no prompt when its profile names none', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    let seen: unknown = 'unset'
    // The harness carries its own standing prompt, so the router's default must NOT leak in.
    const root = supervisorAgent(testAgentProfile('sup', { harness: 'opencode' }), {
      blobs,
      makeWorkerAgent: () => deliveringLeaf('w', {}),
      perWorker,
      driveHarness: async (args: Parameters<DriveHarness>[0]) => {
        seen = args.systemPrompt
      },
    })
    await runSupervisor(root, blobs, journal)
    expect(seen).toBeUndefined()
  })

  it('refuses a coordination binding on a router-brained supervisor', () => {
    const blobs = new InMemoryResultBlobStore()
    expect(() =>
      supervisorAgent(testAgentProfile('sup', { harness: 'cli-base' }), {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        perWorker,
        brain: async () => ({ content: '', toolCalls: [] }),
        coordination: { host: '127.0.0.1' },
      }),
    ).toThrow(ConfigError)
  })

  it('refuses a non-loopback coordination host with no acknowledgment (a ConfigError)', () => {
    const blobs = new InMemoryResultBlobStore()
    expect(() =>
      supervisorAgent(testAgentProfile('sup', { harness: 'opencode' }), {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        perWorker,
        driveHarness: async () => {},
        coordination: { host: '0.0.0.0' },
      }),
    ).toThrow(ConfigError)
  })

  it('checks the bind SNAPSHOT: mutating deps.coordination after build cannot change the host', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    let url = ''
    const coordination: { host: string } = { host: '127.0.0.1' }
    const root = supervisorAgent(testAgentProfile('sup', { harness: 'opencode' }), {
      blobs,
      makeWorkerAgent: () => deliveringLeaf('w', {}),
      perWorker,
      driveHarness: async ({ coordinationMcpUrl }) => {
        url = coordinationMcpUrl
      },
      coordination,
    })
    coordination.host = '0.0.0.0'
    await runSupervisor(root, blobs, journal)
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  })

  it('refuses a non-loopback coordination host with no acknowledgment', () => {
    const blobs = new InMemoryResultBlobStore()
    expect(() =>
      supervisorAgent(testAgentProfile('sup', { harness: 'opencode' }), {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        perWorker,
        driveHarness: async () => {},
        coordination: { host: '0.0.0.0' },
      }),
    ).toThrow(/not a loopback address.*allowUnauthenticatedRemote/s)
  })

  it.each(['127.0.0.1', 'localhost', '::1', '[::1]'])(
    'accepts the loopback host %s with no acknowledgment',
    (host) => {
      const blobs = new InMemoryResultBlobStore()
      expect(() =>
        supervisorAgent(testAgentProfile('sup', { harness: 'opencode' }), {
          blobs,
          makeWorkerAgent: () => deliveringLeaf('w', {}),
          perWorker,
          driveHarness: async () => {},
          coordination: { host },
        }),
      ).not.toThrow()
    },
  )

  it('EXTERNAL arm: a drive that RETURNS with the contract unmet is re-entered with the unmet items', async () => {
    // The measured shape (discovery-lab, 2026-09-01): the harness owns its turn loop, decides it is
    // finished, and returns having delivered nothing. 376 of 376 winning runs ended on that
    // completion, and the completion gate could only label the result. With `repromptOnUnmet` the
    // SAME live session is re-entered on the unmet items instead.
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const tasks: unknown[] = []
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl, task }) => {
      tasks.push(task)
      if (tasks.length === 1) return
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'submit_result',
        arguments: { result: { answer: 42 } },
      })
    }
    const root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'pi',
        prompt: { systemPrompt: 'solve or delegate' },
        tools: runtimeToolDeclarations('submit_result'),
      }),
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('unused', {}),
        perWorker,
        driveHarness,
        deliverable: {
          describe: 'an object whose answer is 42',
          check: (result) => (result as { answer?: unknown }).answer === 42,
        },
        repromptOnUnmet: 1,
      },
    )

    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ answer: 42 })
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toBe('solve it')
    // The re-entry carries the unmet items, not the original task.
    expect(String(tasks[1])).toContain('an object whose answer is 42')
    expect(String(tasks[1])).toContain('The completion check has not passed.')
  })

  it('EXTERNAL arm: the same drive ends the run on its first completion when no re-prompt is set', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const tasks: unknown[] = []
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl, task }) => {
      tasks.push(task)
      if (tasks.length === 1) return
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'submit_result',
        arguments: { result: { answer: 42 } },
      })
    }
    const root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'pi',
        prompt: { systemPrompt: 'solve or delegate' },
      }),
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('unused', {}),
        perWorker,
        driveHarness,
        deliverable: {
          describe: 'an object whose answer is 42',
          check: (result) => (result as { answer?: unknown }).answer === 42,
        },
      },
    )

    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('no-winner')
    expect(tasks).toHaveLength(1)
  })

  it('EXTERNAL arm: a run the coordination server STOPPED is never re-prompted', async () => {
    // The driver called `stop`. That was a decision, and Runtime refuses the re-prompt before the
    // product hook is consulted, so no hook can talk the run past its own stop.
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const tasks: unknown[] = []
    let hookCalls = 0
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl, task }) => {
      tasks.push(task)
      await jsonRpc(coordinationMcpUrl, 'tools/call', { name: 'stop', arguments: {} })
    }
    const root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'pi',
        prompt: { systemPrompt: 'solve or delegate' },
        tools: runtimeToolDeclarations('stop'),
      }),
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('unused', {}),
        perWorker,
        driveHarness,
        deliverable: { check: () => false },
        repromptOnUnmet: 3,
        onUnmetContract: () => {
          hookCalls += 1
          return { steer: 'keep going' }
        },
      },
    )

    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('no-winner')
    expect(tasks).toHaveLength(1)
    expect(hookCalls).toBe(0)
  })

  it('refuses repromptOnUnmet with no completion check to be unmet', () => {
    const blobs = new InMemoryResultBlobStore()
    expect(() =>
      supervisorAgent(testAgentProfile('sup', { harness: 'opencode' }), {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        perWorker,
        driveHarness: async () => {},
        repromptOnUnmet: 2,
      }),
    ).toThrow(/needs a `deliverable` completion check/u)
  })

  it('refuses onUnmetContract without a re-prompt cap, instead of never consulting it', () => {
    const blobs = new InMemoryResultBlobStore()
    expect(() =>
      supervisorAgent(testAgentProfile('sup', { harness: 'opencode' }), {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        perWorker,
        driveHarness: async () => {},
        deliverable: { check: () => true },
        onUnmetContract: () => 'stop',
      }),
    ).toThrow(/needs repromptOnUnmet >= 1/u)
  })

  it('refuses a re-prompt on the ROUTER arm, which runs its turn loop in process', () => {
    const blobs = new InMemoryResultBlobStore()
    expect(() =>
      supervisorAgent(testAgentProfile('sup', { harness: 'cli-base' }), {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('w', {}),
        perWorker,
        brain: async () => ({ content: '', toolCalls: [] }),
        deliverable: { check: () => true },
        repromptOnUnmet: 1,
      }),
    ).toThrow(/EXTERNAL-harness supervisor/u)
  })

  it('binds an acknowledged non-loopback host and hands the harness that URL', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    let url = ''
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl }) => {
      url = coordinationMcpUrl
    }
    const root = supervisorAgent(testAgentProfile('sup', { harness: 'opencode' }), {
      blobs,
      makeWorkerAgent: () => deliveringLeaf('w', {}),
      perWorker,
      driveHarness,
      coordination: { host: '0.0.0.0', allowUnauthenticatedRemote: true },
    })
    await runSupervisor(root, blobs, journal)
    expect(url).toMatch(/^http:\/\/0\.0\.0\.0:\d+\/mcp$/)
  })
})
