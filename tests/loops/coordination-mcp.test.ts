import type { AgentProfile } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { serveCoordinationMcp } from '../../src/runtime/supervise/coordination-mcp'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  Scope,
  UsageEvent,
} from '../../src/runtime/supervise/types'

// A real (simple) delivering leaf — NOT a mock of the MCP path; the HTTP→MCP→Scope.spawn is real.
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

async function jsonRpc(
  url: string,
  method: string,
  params: unknown,
): Promise<{ result?: unknown; error?: unknown }> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return (await r.json()) as { result?: unknown; error?: unknown }
}

describe('coordination MCP over a live Scope — the real keystone (HTTP → MCP → Scope.spawn)', () => {
  it('a real HTTP tools/call spawn_worker lands on Scope.spawn and the worker settles', async () => {
    const blobs = new InMemoryResultBlobStore()
    let observed: { toolsList: unknown; settled: ReadonlyArray<{ valid?: boolean }> } | undefined

    // The root agent fronts its LIVE scope with the MCP, then drives it as an external client would —
    // over real HTTP. This is exactly what an in-box opencode supervisor does via mcp.mcpServers.
    const root: Agent<unknown, unknown> = {
      name: 'mcp-driver',
      async act(_task, scope: Scope<unknown>) {
        const mcp = await serveCoordinationMcp({
          scope,
          blobs,
          makeWorkerAgent: () => deliveringLeaf('w', { answer: 42 }),
          perWorker: { maxIterations: 4, maxTokens: 1000 } as Budget,
        })
        try {
          const toolsList = await jsonRpc(mcp.url, 'tools/list', {})
          await jsonRpc(mcp.url, 'tools/call', {
            name: 'spawn_worker',
            arguments: { profile: {}, task: 'go' },
          })
          await jsonRpc(mcp.url, 'tools/call', { name: 'await_next', arguments: {} })
          observed = { toolsList: toolsList.result, settled: mcp.settled() }
          const done = mcp.settled().filter((w) => w.status === 'done' && w.valid === true)
          return done[0]?.outRef ? await blobs.get(done[0].outRef) : undefined
        } finally {
          await mcp.close()
        }
      },
    }

    const result = await createSupervisor<unknown, unknown>().run(root, 'solve', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'mcp',
      journal: new InMemorySpawnJournal(),
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 4,
      now: () => 0,
    })

    expect(result.kind).toBe('winner') // a real worker delivered through the MCP
    expect(result.kind === 'winner' && result.out).toEqual({ answer: 42 })
    expect(observed?.settled.length).toBe(1)
    expect(observed?.settled[0]?.valid).toBe(true)
    // tools/list surfaces the coordination verbs the in-box harness will call.
    const names = ((observed?.toolsList as { tools?: Array<{ name: string }> })?.tools ?? []).map(
      (t) => t.name,
    )
    expect(names).toContain('spawn_worker')
    expect(names).toContain('await_next')
  })
})
