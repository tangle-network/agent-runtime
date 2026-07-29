import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import {
  type DriveHarness,
  type ResolveSupervisorTools,
  supervisorAgent,
} from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import { scriptedBrain } from './scripted-brain'

const perWorker: Budget = { maxIterations: 4, maxTokens: 1000 }

// A real delivering leaf — NOT a mock of the spawn path; HTTP→MCP→Scope.spawn→settle is real.
function deliveringLeaf(name: string, out: unknown): Agent<unknown, unknown> {
  const ex: Executor<unknown> = {
    runtime: 'router',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
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
  const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor: ex }
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
  it('ROUTER arm (harness null): the in-process tool-loop drives a worker to delivery', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const worker = deliveringLeaf('w', { answer: 42 })
    // A scripted brain stands in for routerBrain (no creds): spawn → await → stop.
    const brain = scriptedBrain([
      {
        toolCalls: [
          { name: 'spawn_agent', arguments: { profile: { name: 'worker' }, task: 'go' } },
        ],
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ])
    const root = supervisorAgent(
      {
        name: 'root',
        harness: 'cli-base',
        prompt: { systemPrompt: 'drive the worker' },
      },
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
        name: 'spawn_agent',
        arguments: { profile: {}, task: 'go' },
      })
      await jsonRpc(coordinationMcpUrl, 'tools/call', { name: 'await_event', arguments: {} })
      await jsonRpc(coordinationMcpUrl, 'tools/call', { name: 'stop', arguments: {} })
    }
    const root = supervisorAgent(
      {
        name: 'sup',
        harness: 'opencode',
        prompt: { systemPrompt: 'delegate, do not solve' },
      },
      { blobs, makeWorkerAgent: () => deliveringLeaf('w', { answer: 7 }), perWorker, driveHarness },
    )
    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
  })

  it('fails loud when a sandboxed-harness supervisor has no driveHarness substrate', () => {
    const blobs = new InMemoryResultBlobStore()
    expect(() =>
      supervisorAgent(
        { name: 'sup', harness: 'opencode' },
        { blobs, makeWorkerAgent: () => deliveringLeaf('w', {}), perWorker },
      ),
    ).toThrow(/driveHarness/)
  })

  it('fails loud when a router-brained supervisor has neither a brain nor a router config', () => {
    const blobs = new InMemoryResultBlobStore()
    expect(() =>
      supervisorAgent(
        { name: 'root', harness: 'cli-base' },
        { blobs, makeWorkerAgent: () => deliveringLeaf('w', {}), perWorker },
      ),
    ).toThrow(/router/)
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
        { name: 'router-manager', harness: 'cli-base' },
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
        { name: 'external-manager', harness: 'opencode' },
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
    }
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
            name: 'spawn_agent',
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
    const router = supervisorAgent({ name: 'router', harness: 'cli-base' }, mutableRouterDeps)
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
    const external = supervisorAgent(
      { name: 'external', harness: 'opencode' },
      {
        ...deps,
        blobs: externalBlobs,
        resolveSupervisorTools: async () => [
          {
            name: 'spawn_agent',
            description: 'collision',
            inputSchema: { type: 'object' },
            handler: async () => ({}),
          },
        ],
        driveHarness: async () => {
          harnessCalls += 1
        },
      },
    )
    const externalResult = await runSupervisor(external, externalBlobs, new InMemorySpawnJournal())
    expect(externalResult.kind).toBe('no-winner')
    expect(harnessCalls).toBe(0)
  })
})
