import { describe, expect, it } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../../src/durable/in-memory-spawn-stores'
import type { MakeWorkerAgent } from '../../src/mcp/tools/coordination-contracts'
import { CheckUnavailableError } from '../../src/runtime/supervise/completion-gate'
import type {
  DriverAttemptRecord,
  DriverContinuationRecord,
} from '../../src/runtime/supervise/driver-retry'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  DriveHarness,
  ResolveSupervisorTools,
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
import { testContinuation } from '../helpers/continuation'
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

/** A leaf that does nothing until `gate` opens, so its manager is provably waiting meanwhile. */
function gatedLeaf(name: string, out: unknown, gate: Promise<void>): Agent<unknown, unknown> {
  const delivering = deliveringLeaf(name, out) as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
  const executor = delivering.executorSpec.executor as Executor<unknown>
  const gated: Executor<unknown> = {
    ...executor,
    execute: (task, signal) =>
      (async function* () {
        await gate
        yield* executor.execute(task, signal) as AsyncIterable<UsageEvent>
      })(),
  }
  return { ...delivering, executorSpec: { ...delivering.executorSpec, executor: gated } } as Agent<
    unknown,
    unknown
  > & { executorSpec: AgentSpec }
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
  workerSlots?: number,
) {
  return createSupervisor<unknown, unknown>().run(root, 'solve it', {
    budget: { maxIterations: 100, maxTokens: 100_000 },
    runId: 'sup',
    journal,
    blobs,
    executors: createExecutorRegistry(),
    maxDepth: 4,
    now: () => 0,
    ...(workerSlots === undefined ? {} : { workerSlots }),
  })
}

describe('supervisorAgent — the brain is resolved from profile.harness (backend-as-data)', () => {
  it('SANDBOX arm (harness=opencode): a sandboxed harness drives the verbs over the live MCP', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    // The stub harness drives the coordination MCP over REAL HTTP — exactly what an in-box
    // opencode/claude-code supervisor does via mcp.mcpServers. No router brain, no hand-built loop.
    // Turn 1 spawns and ends; Runtime wakes the harness with the settlement; turn 2 stops.
    const tasks: unknown[] = []
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl, task }) => {
      tasks.push(task)
      if (tasks.length === 1) {
        await jsonRpc(coordinationMcpUrl, 'tools/call', {
          name: 'spawn_worker',
          arguments: { profile: testAgentProfile('worker'), task: 'go' },
        })
        return
      }
      await jsonRpc(coordinationMcpUrl, 'tools/call', { name: 'stop', arguments: {} })
    }
    const root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'opencode',
        prompt: { systemPrompt: 'delegate, do not solve' },
        tools: runtimeToolDeclarations('spawn_worker', 'stop'),
      }),
      { blobs, makeWorkerAgent: () => deliveringLeaf('w', { answer: 7 }), perWorker, driveHarness },
    )
    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
    expect(tasks).toHaveLength(2)
    expect(String(tasks[1])).toContain('"type":"settled"')
  })

  it('SANDBOX arm: a drive that returns while its worker runs spends no drive until the settlement wakes it', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    // The manager's wait starts when the first drive returns, so the hold is timed from there;
    // timing it from run start lets a slow spawn_worker call shorten the measured wait.
    let firstDriveReturned!: () => void
    const driveReturned = new Promise<void>((resolve) => {
      firstDriveReturned = resolve
    })
    const tasks: string[] = []
    const attempts: DriverAttemptRecord[] = []
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl, task }) => {
      tasks.push(String(task))
      if (tasks.length === 1) {
        await jsonRpc(coordinationMcpUrl, 'tools/call', {
          name: 'spawn_worker',
          arguments: { profile: testAgentProfile('worker'), task: 'go' },
        })
        firstDriveReturned()
        return
      }
      await jsonRpc(coordinationMcpUrl, 'tools/call', { name: 'stop', arguments: {} })
    }
    const root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'opencode',
        tools: runtimeToolDeclarations('spawn_worker', 'stop'),
      }),
      {
        blobs,
        makeWorkerAgent: () => gatedLeaf('w', { answer: 7 }, held),
        perWorker,
        driveHarness,
        onDriverAttempt: (record) => void attempts.push(record),
      },
    )
    const running = runSupervisor(root, blobs, journal)
    try {
      // The worker holds. The first drive has returned and the manager waits with no model turn.
      await driveReturned
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(tasks).toHaveLength(1)
      expect(attempts).toHaveLength(0)
    } finally {
      release()
    }
    const result = await running

    expect(result.kind).toBe('winner')
    // One more drive, started by the settlement, and its task is the wake input carrying it.
    expect(tasks).toHaveLength(2)
    expect(tasks[1]).toContain('"type":"settled"')
    expect(tasks[1]).toContain('"status":"done"')
    expect(attempts).toMatchObject([
      { attempt: 1, retryInMs: 0 },
      { attempt: 2, reentry: 'wake', stop: 'completed' },
    ])
    expect(attempts[0]?.waitedMs).toBeGreaterThanOrEqual(250)
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
        continuation: testContinuation(),
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
        continuation: testContinuation(),
      },
    )

    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
    expect(observedStop).toBe(true)
    expect(providerCalls).toBe(0)
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
        description: 'Spawn two children in code and wait in code for the first settlement',
        inputSchema: { type: 'object', properties: {} },
        handler: async (_raw, context) => {
          const first = await context.verbs.spawnAgent({
            profile: testAgentProfile('composed-a'),
            task: 'go',
            label: 'composed-a',
          })
          // The second spawn crosses the same worker-slot queue the MCP verb crosses.
          const second = await context.verbs.spawnAgent({
            profile: testAgentProfile('composed-b'),
            task: 'go',
            label: 'composed-b',
          })
          const workerIds = [first, second].map(
            (spawned) => (spawned as { workerId: string }).workerId,
          )
          const settled = await context.verbs.awaitSettlement({ workerIds })
          return { first, second, settled }
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
              tools: runtimeToolDeclarations('compose_children', 'spawn_worker'),
            }),
            {
              ...deps,
              brain,
            },
          ),
          blobs,
          journal,
          1,
        )
        return { journal, result: composeResult }
      }
      let turns = 0
      const driveHarness: DriveHarness = async ({ coordinationMcpUrl }) => {
        // The woken turn has nothing left to compose.
        turns += 1
        if (turns > 1) return
        composeResult = await jsonRpc(coordinationMcpUrl, 'tools/call', {
          name: 'compose_children',
          arguments: {},
        })
      }
      await runSupervisor(
        supervisorAgent(
          testAgentProfile('external-manager', {
            harness: 'opencode',
            tools: runtimeToolDeclarations('compose_children', 'spawn_worker'),
          }),
          {
            ...deps,
            driveHarness,
          },
        ),
        blobs,
        journal,
        1,
      )
      return { journal, result: composeResult }
    }

    for (const arm of ['router', 'external'] as const) {
      composeResult = undefined
      const { journal } = await runArm(arm)
      // authorizeSpawn (makeWorkerAgent) observed the composed spawn on this arm.
      expect(authorized).toContain('composed-a')
      // The second spawn met a full slot bound and was queued, not refused.
      expect(authorized).toContain('composed-b')
      if (arm === 'external') {
        expect(JSON.stringify(composeResult)).toMatch(/\\?"status\\?":\\?"queued/u)
      }
      // The children are journaled under THIS manager's scope, like any coordination spawn.
      const events = (await journal.loadTree('sup')) as SpawnEvent[]
      expect(events.some((e) => e.kind === 'spawned' && e.label === 'composed-a')).toBe(true)
      expect(events.some((e) => e.kind === 'spawned' && e.label === 'composed-b')).toBe(true)
      expect(events.some((e) => e.kind === 'settled' && e.status === 'done')).toBe(true)
    }
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

    expect(result).toMatchObject({ kind: 'no-winner', reason: 'cancelled' })
    expect(externalSignal?.aborted).toBe(true)
    expect(externalSignal?.reason).toMatchObject({
      message: 'caller signal aborted',
      source: 'signal',
    })
    expect(externalResponse).toMatchObject({
      error: { code: -32000, message: 'caller signal aborted' },
    })
  })

  it('a method tool that outruns the coordination fence runs once for a director that retries', async () => {
    // The observed failure: run mech-interp-foundations-glm2-20260911d called `literature_sourcing`
    // at 21:39:12Z, the POST failed after 30.0 s while the handler kept spawning children, and the
    // director's retry at 21:40:19Z — the same arguments with the object keys in another order —
    // started the whole literature graph a second time.
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    let invocations = 0
    let invocationsWhileRunning = 0
    let resolveGraph!: (value: unknown) => void
    const graph = new Promise<unknown>((resolve) => {
      resolveGraph = resolve
    })
    const responses: Array<{ result?: unknown; error?: unknown }> = []
    const tasks: string[] = []
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl, task }) => {
      tasks.push(String(task))
      // The second turn is Runtime's wake with the receipted outcome; it calls nothing.
      if (tasks.length > 1) return
      const call = async (sources: unknown) =>
        (await jsonRpc(coordinationMcpUrl, 'tools/call', {
          name: 'literature_sourcing',
          arguments: { sources },
        })) as { result?: unknown; error?: unknown }
      responses.push(await call([{ id: 'daniel-murfet', kind: 'researcher' }]))
      responses.push(await call([{ kind: 'researcher', id: 'daniel-murfet' }]))
      invocationsWhileRunning = invocations
      resolveGraph({ charter: 'one graph, one run' })
      await new Promise<void>((resolve) => setImmediate(resolve))
      responses.push(await call([{ id: 'daniel-murfet', kind: 'researcher' }]))
    }
    const root = supervisorAgent(
      testAgentProfile('external-manager', {
        harness: 'opencode',
        tools: runtimeToolDeclarations('literature_sourcing'),
      }),
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('unused', {}),
        perWorker,
        driveHarness,
        // 200 ms request timeout ⇒ a 100 ms fence, the shape the 30 s default gives at 15 s.
        coordination: { requestTimeoutMs: 200 },
        nodeContext: {
          runId: 'method-tool-single-flight',
          runNamespace: 'method-tool-single-flight-namespace',
          ownerId: 'owner-external',
          depth: 0,
          identity: {
            profileDigest: `sha256:${'1'.repeat(64)}`,
            taskDigest: `sha256:${'2'.repeat(64)}`,
          },
        },
        resolveSupervisorTools: async () => [
          {
            name: 'literature_sourcing',
            description: 'Run the registered source-to-charter method through this node’s children',
            inputSchema: { type: 'object', properties: { sources: { type: 'array' } } },
            handler: async () => {
              invocations++
              return graph
            },
          },
        ],
      },
    )
    await createSupervisor<unknown, unknown>().run(root, 'source the literature', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'method-tool-single-flight',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 4,
      now: () => 0,
    })

    // The reordered retry joined the run in flight, and both calls got the one receipt.
    expect(invocationsWhileRunning).toBe(1)
    expect(responses).toHaveLength(3)
    for (const running of responses.slice(0, 2)) {
      expect(running.error).toBeUndefined()
      expect(running.result).toMatchObject({
        isError: false,
        structuredContent: { running: true, tool: 'literature_sourcing' },
      })
    }
    const receiptOf = (response: { result?: unknown } | undefined): unknown =>
      (response?.result as { structuredContent?: { receipt?: unknown } } | undefined)
        ?.structuredContent?.receipt
    const receipt = String(receiptOf(responses[0]))
    expect(receipt).not.toBe('undefined')
    expect(receiptOf(responses[1])).toBe(receipt)
    // A call after the run settled is a fresh run, and it answers within the fence.
    expect(invocations).toBe(2)
    expect(responses[2]?.error).toBeUndefined()
    expect(responses[2]?.result).toMatchObject({
      structuredContent: { charter: 'one graph, one run' },
    })
    // The receipted outcome reaches the manager in its next wake, with no call to collect it.
    expect(tasks).toHaveLength(2)
    expect(tasks[1]).toContain('"type":"tool-outcome"')
    expect(tasks[1]).toContain(receipt)
    expect(tasks[1]).toContain('one graph, one run')
  })
})

describe('supervisorAgent — coordination bind + prompt hoisting on the harness arm', () => {
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

  it("EXTERNAL arm: a drive that RETURNS with the check unmet is sent back with Runtime's note", async () => {
    // The measured shape (discovery-lab, 2026-09-01): the harness owns its turn loop, decides it is
    // finished, and returns having delivered nothing. 376 of 376 winning runs ended on that
    // completion. With a continuation the director is sent back with the check's verdict.
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const tasks: unknown[] = []
    const loops: DriverContinuationRecord[] = []
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl, task }) => {
      tasks.push(task)
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'submit_result',
        arguments: { result: { answer: tasks.length === 1 ? 41 : 42 } },
      })
    }
    const root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'pi',
        prompt: { systemPrompt: 'solve or delegate' },
        tools: runtimeToolDeclarations('submit_result', 'read_continuation'),
      }),
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('unused', {}),
        perWorker,
        driveHarness,
        deliverable: {
          describe: 'an object whose answer is 42',
          check: (result) => {
            const answer = (result as { answer?: unknown }).answer
            return answer === 42
              ? true
              : {
                  pass: false,
                  items: { parses: 1, answer: 0 },
                  composite: 0.5,
                  threshold: 1,
                  failures: [`FAIL answer result.answer: ${String(answer)}, expected 42`],
                }
          },
        },
        continuation: testContinuation(),
        onDriverLoopSettled: (record) => void loops.push(record),
      },
    )

    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ answer: 42 })
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toBe('solve it')
    const note = String(tasks[1])
    // The verdict as a located fact, the protected items, the plan, and — because this harness
    // proves nothing about its session — the original objective.
    expect(note).toContain('The outside check failed: 1 of 2 items fail. Check reads: 1.')
    expect(note).toContain('## Failures\nFAIL answer result.answer: 41, expected 42')
    expect(note).toContain('## Passing now; keep them passing\nparses')
    expect(note).toContain('## Before the next submit')
    expect(note).toContain('solve it')
    expect(loops).toEqual([
      expect.objectContaining({
        reprompts: 1,
        closedBy: 'result-accepted',
        continuations: [
          expect.objectContaining({
            continuation: 1,
            profile: 'test-profile',
            before: { pass: false, composite: 0.5, failed: 1, total: 2 },
            after: { pass: true },
            noteDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
          }),
        ],
      }),
    ])
  })

  it('EXTERNAL arm: a check that judges state reads the run at a turn end with no submit', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const tasks: string[] = []
    let stateReads = 0
    let files = 0
    const root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'pi',
        tools: runtimeToolDeclarations('submit_result'),
      }),
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('unused', {}),
        perWorker,
        driveHarness: async ({ coordinationMcpUrl, task }) => {
          tasks.push(String(task))
          files += 1
          if (tasks.length === 3) {
            await jsonRpc(coordinationMcpUrl, 'tools/call', {
              name: 'submit_result',
              arguments: { result: 'done' },
            })
          }
        },
        deliverable: {
          check: () => files >= 3,
          checkState: () => {
            stateReads += 1
            return {
              pass: false,
              items: { first: files >= 1 ? 1 : 0, second: files >= 2 ? 1 : 0, third: 0 },
              composite: files / 3,
              failures: ['FAIL third files: missing'],
            }
          },
        },
        continuation: testContinuation(),
      },
    )
    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
    expect(stateReads).toBe(2)
    // The composite rose between the two notes, so the second turn was progress, and the note
    // says what changed.
    expect(tasks[2]).toContain('## Changed since the last note\nNow passing: second.')
  })

  it('EXTERNAL arm: a check that could not run pauses the loop instead of blaming the director', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const tasks: string[] = []
    const attempts: DriverAttemptRecord[] = []
    let up = false
    const root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'pi',
        tools: runtimeToolDeclarations('submit_result'),
      }),
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('unused', {}),
        perWorker,
        driverRetry: { unavailablePauseMs: 0 },
        driveHarness: async ({ coordinationMcpUrl, task }) => {
          tasks.push(String(task))
          if (tasks.length === 2) up = true
          await jsonRpc(coordinationMcpUrl, 'tools/call', {
            name: 'submit_result',
            arguments: { result: 'answer' },
          })
        },
        deliverable: {
          check: () => {
            if (!up) throw new CheckUnavailableError('check box did not start')
            return true
          },
        },
        continuation: testContinuation(),
        onDriverAttempt: (record) => void attempts.push(record),
      },
    )
    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
    expect(attempts[0]).toMatchObject({
      classification: 'unavailable',
      unavailableSignal: 'check-unavailable',
    })
    // A pause re-enters with the objective, never with a verdict the check did not give.
    expect(tasks[1]).not.toContain('The outside check failed')
    expect(tasks[1]).toContain('solve it')
  })

  it('EXTERNAL arm: a drive that died is re-entered with the objective, the late child, and the unread delivery', async () => {
    // Autopsy A (2026-09-16), in miniature: the root spawned a child, received its settlement, and
    // died before acting on it. The next drive must learn the objective, that the child settled,
    // and that the delivery it got before dying is unread, all from the coordinator.
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const tasks: string[] = []
    const loops: unknown[] = []
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl, task }) => {
      tasks.push(String(task))
      if (tasks.length === 1) {
        await jsonRpc(coordinationMcpUrl, 'tools/call', {
          name: 'spawn_worker',
          arguments: { profile: testAgentProfile('holder'), task: 'return the token' },
        })
        return
      }
      // The woken turn receives the child's settlement and dies before acting on it.
      if (tasks.length === 2) throw new Error('Sandbox not found')
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'submit_result',
        arguments: { result: { answer: 42 } },
      })
    }
    const root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'pi',
        tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
      }),
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('holder', { token: 't-1' }),
        perWorker,
        driveHarness,
        driverRetry: { initialBackoffMs: 0 },
        deliverable: {
          describe: 'an object whose answer is 42',
          check: (result) => (result as { answer?: unknown }).answer === 42,
        },
        continuation: testContinuation(),
        onDriverLoopSettled: (record) => loops.push(record),
      },
    )

    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
    expect(tasks).toHaveLength(3)
    expect(tasks[1]).toContain('"type":"settled"')
    const reentry = tasks[2] ?? ''
    expect(reentry).toContain('re-entering a run that is already in progress')
    expect(reentry).toContain('Your previous turn ended before it finished (retry 1)')
    expect(reentry).not.toContain('Sandbox not found')
    expect(reentry).toContain('solve it')
    expect(reentry).toContain('an object whose answer is 42')
    expect(reentry).toMatch(/Workers settled: sup:s0 \(done/u)
    expect(reentry).toMatch(
      /Events delivered to a turn that has not finished, so treat them as unread \(1\):\n- \{"type":"settled".*"sup:s0"/u,
    )
    expect(reentry).toMatch(/Journal: \d+ rows/u)
    expect(loops).toEqual([
      expect.objectContaining({
        attempts: 3,
        reprompts: 0,
        failureRetries: 1,
        wakes: 1,
        ended: 'completed',
        closedBy: 'result-accepted',
        continuations: [],
      }),
    ])
  })

  it('EXTERNAL arm: a steer delivered to a turn that died reaches the re-entry in full', async () => {
    // magnetar-rust-20261017c: two operator steers arrived during usage-limit storms. Each was
    // delivered to a turn that the limit ended, the re-entry named it only as '#N lead-message',
    // and neither steer ever reached a prompt.
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const tasks: string[] = []
    const steer = 'Operator: cap the run at 8 sessions and finish the open crates first.'
    let root!: ReturnType<typeof supervisorAgent>
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl, task }) => {
      tasks.push(String(task))
      if (tasks.length === 1) {
        await jsonRpc(coordinationMcpUrl, 'tools/call', {
          name: 'spawn_worker',
          arguments: { profile: testAgentProfile('holder'), task: 'return the token' },
        })
        expect(root.deliver?.({ steer })).toBe(true)
        return
      }
      // The woken turn carries the steer and dies before the model reads it.
      if (tasks.length === 2) throw new Error('Sandbox not found')
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'submit_result',
        arguments: { result: { answer: 42 } },
      })
    }
    root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'pi',
        tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
      }),
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('holder', { token: 't-1' }),
        perWorker,
        driveHarness,
        driverRetry: { initialBackoffMs: 0 },
        deliverable: {
          describe: 'an object whose answer is 42',
          check: (result) => (result as { answer?: unknown }).answer === 42,
        },
        continuation: testContinuation(),
      },
    )

    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
    expect(tasks).toHaveLength(3)
    expect(tasks[1]).toContain(steer)
    expect(tasks[2]).toContain('Events delivered to a turn that has not finished')
    expect(tasks[2]).toContain(steer)
  })

  it('EXTERNAL arm: a valid partial child leaves the parent contract unmet and re-enters its director', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const checked: unknown[] = []
    const tasks: string[] = []
    let finalizations = 0
    const partial = { component: 'database', ready: true }
    const complete = { answer: 42 }
    const root = supervisorAgent(
      testAgentProfile('sup', {
        harness: 'pi',
        tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
      }),
      {
        blobs,
        makeWorkerAgent: () => deliveringLeaf('component', partial),
        perWorker,
        driveHarness: async ({ coordinationMcpUrl, task }) => {
          tasks.push(String(task))
          if (tasks.length === 1) {
            await jsonRpc(coordinationMcpUrl, 'tools/call', {
              name: 'spawn_worker',
              arguments: { profile: testAgentProfile('component'), task: 'build the database' },
            })
            return
          }
          // The woken turn reads the partial component and ends without finishing: the unmet
          // check, not the wake, sends the director back in.
          if (tasks.length === 2) return
          await jsonRpc(coordinationMcpUrl, 'tools/call', {
            name: 'submit_result',
            arguments: { result: complete },
          })
        },
        finalizer: ({ delivered }) => {
          finalizations += 1
          expect(delivered).toHaveLength(1)
          return delivered[0]?.out
        },
        deliverable: {
          check: (out) => {
            checked.push(out)
            return JSON.stringify(out) === JSON.stringify(complete)
              ? true
              : {
                  pass: false,
                  items: { database: 1, product: 0 },
                  failures: ['FAIL product result: only the database component'],
                }
          },
        },
        continuation: testContinuation(),
      },
    )

    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual(complete)
    expect(tasks).toHaveLength(3)
    expect(tasks[1]).toContain('"type":"settled"')
    expect(finalizations).toBe(1)
    expect(checked).toEqual([partial, complete])
    // The finalizer's check of the child candidate is the verdict the note reports.
    expect(tasks[2]).toContain('FAIL product result: only the database component')
    expect(await journal.loadTree('sup')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'settled',
          id: 'sup:s0',
          status: 'done',
          verdict: expect.objectContaining({ valid: true }),
        }),
      ]),
    )
  })

  it.each([
    { name: 'partial', out: { component: 'database' }, valid: false },
    { name: 'complete', out: { answer: 42 }, valid: true },
    { name: 'throwing check', out: { throw: true }, valid: false },
    { name: 'aggregate', out: { component: 'database' }, aggregate: true, valid: true },
  ])('both arms check the parent contract for a $name child candidate', async (scenario) => {
    for (const harness of ['pi', 'cli-base'] as const) {
      const blobs = new InMemoryResultBlobStore()
      const journal = new InMemorySpawnJournal()
      let checks = 0
      let finalizations = 0
      let turns = 0
      const root = supervisorAgent(
        testAgentProfile('sup', {
          harness,
          tools: runtimeToolDeclarations('spawn_worker'),
        }),
        {
          blobs,
          makeWorkerAgent: () => deliveringLeaf('component', scenario.out),
          perWorker,
          ...(harness === 'pi'
            ? {
                driveHarness: async ({ coordinationMcpUrl }: Parameters<DriveHarness>[0]) => {
                  // The woken turn finds nothing left to start.
                  turns += 1
                  if (turns > 1) return
                  await jsonRpc(coordinationMcpUrl, 'tools/call', {
                    name: 'spawn_worker',
                    arguments: { profile: testAgentProfile('component'), task: 'build component' },
                  })
                },
                // A deadline already past: the external arm ends on its first turn, as the router
                // arm does, so both arms are compared on one drive.
                continuation: testContinuation({ deadline: 1 }),
              }
            : {
                brain: scriptedBrain([
                  {
                    toolCalls: [
                      {
                        name: 'spawn_worker',
                        arguments: {
                          profile: testAgentProfile('component'),
                          task: 'build component',
                        },
                      },
                    ],
                  },
                  { content: 'waiting for the worker' },
                  { content: 'done' },
                ]),
              }),
          finalizer: ({ delivered }) => {
            finalizations += 1
            return scenario.aggregate ? { answer: 42 } : delivered[0]?.out
          },
          deliverable: {
            check: (out) => {
              checks += 1
              if (scenario.name === 'throwing check') throw new Error('oracle unavailable')
              return JSON.stringify(out) === JSON.stringify({ answer: 42 })
            },
          },
        },
      )

      const result = await runSupervisor(root, blobs, journal)
      expect(result.kind, `${harness}: ${scenario.name}`).toBe(
        scenario.valid ? 'winner' : 'no-winner',
      )
      if (scenario.name === 'throwing check' && result.kind === 'no-winner') {
        expect(result.reason).toBe('driver-failed')
        if (result.reason === 'driver-failed') {
          expect(result.error.message).toContain(
            'parent completion check threw: oracle unavailable',
          )
        }
      }
      expect(checks).toBe(1)
      expect(finalizations).toBe(1)
    }
  })

  it('binds an authenticated non-loopback host and hands the harness that URL', async () => {
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
      coordination: { host: '0.0.0.0', authentication: true },
    })
    await runSupervisor(root, blobs, journal)
    expect(url).toMatch(/^http:\/\/0\.0\.0\.0:\d+\/mcp$/)
  })
})
