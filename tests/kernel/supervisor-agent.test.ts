import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import { type DriveHarness, supervisorAgent } from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
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
          { name: 'spawn_agent', arguments: { profile: { kind: 'worker' }, task: 'go' } },
        ],
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ])
    const root = supervisorAgent(
      { name: 'root', harness: null, systemPrompt: 'drive the worker' },
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
      { name: 'sup', harness: 'opencode', systemPrompt: 'delegate, do not solve' },
      { blobs, makeWorkerAgent: () => deliveringLeaf('w', { answer: 7 }), perWorker, driveHarness },
    )
    const result = await runSupervisor(root, blobs, journal)
    expect(result.kind).toBe('winner')
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
      { name: 'sup', harness: 'pi', systemPrompt: 'solve or delegate' },
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
        { name: 'root', harness: null },
        { blobs, makeWorkerAgent: () => deliveringLeaf('w', {}), perWorker },
      ),
    ).toThrow(/router/)
  })
})
