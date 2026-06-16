/**
 * The critical de-risk for the real e2e: does an in-box opencode harness (via the cli-bridge)
 * actually MOUNT my coordination MCP and CALL spawn_worker — landing on a real Scope.spawn?
 *
 * Serves the coordination MCP over a live Scope, then asks the bridge's opencode (with that MCP in
 * its config) to call spawn_worker + await_next. If the Scope spawned+settled, the in-box driving
 * path is real. No mock.
 *
 *   ROUTER_BASE=http://127.0.0.1:3355/v1 TANGLE_API_KEY=<bridge-bearer> \
 *   WORKER_MODEL=opencode/zai-coding-plan/glm-5-turbo npx tsx bench/src/mcp-mount-probe.mts
 */

import {
  type Agent,
  type AgentProfile,
  type AgentSpec,
  createExecutorRegistry,
  createSupervisor,
  type Executor,
  type ExecutorResult,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  type Scope,
  type UsageEvent,
} from '../../src/runtime/index'
import { serveCoordinationMcp } from '../../src/runtime/supervise/coordination-mcp'

const BRIDGE = process.env.ROUTER_BASE ?? 'http://127.0.0.1:3355/v1'
const BEARER = process.env.TANGLE_API_KEY ?? ''
const MODEL = process.env.WORKER_MODEL ?? 'opencode/zai-coding-plan/glm-5-turbo'

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

async function bridgeChat(messages: Array<{ role: string; content: string }>, mcpUrl: string): Promise<string> {
  const r = await fetch(`${BRIDGE.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${BEARER}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages,
      mcp: { mcpServers: { coordination: { type: 'http', url: mcpUrl } } },
    }),
  })
  if (!r.ok) return `(bridge HTTP ${r.status}: ${(await r.text()).slice(0, 200)})`
  const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return j.choices?.[0]?.message?.content ?? ''
}

async function main(): Promise<void> {
  const blobs = new InMemoryResultBlobStore()
  let mounted = false
  const root: Agent<unknown, unknown> = {
    name: 'mcp-mount-probe',
    async act(_t, scope: Scope<unknown>) {
      const mcp = await serveCoordinationMcp({
        scope,
        blobs,
        makeWorkerAgent: () => deliveringLeaf('w', { ok: true }),
        perWorker: { maxIterations: 4, maxTokens: 2000 },
      })
      console.error(`[probe] coordination MCP live at ${mcp.url}`)
      try {
        const content = await bridgeChat(
          [
            {
              role: 'user',
              content:
                'You have an MCP server named "coordination" with tools: spawn_worker, await_next, stop. ' +
                'Call spawn_worker with arguments {"profile":{},"task":"hello"}. Then call await_next. ' +
                'Then reply with exactly what await_next returned.',
            },
          ],
          mcp.url,
        )
        const settled = mcp.settled()
        mounted = settled.length > 0
        console.error(`[probe] opencode replied: ${content.slice(0, 400)}`)
        console.error(`[probe] Scope spawned+settled = ${settled.length}: ${JSON.stringify(settled)}`)
        return mounted ? { mounted: true } : undefined
      } finally {
        await mcp.close()
      }
    },
  }

  const result = await createSupervisor<unknown, unknown>().run(root, 'probe', {
    budget: { maxIterations: 100, maxTokens: 400_000 },
    runId: 'mcp-probe',
    journal: new InMemorySpawnJournal(),
    blobs,
    executors: createExecutorRegistry(),
    maxDepth: 4,
    now: () => Date.now(),
  })
  console.log(
    mounted
      ? '✅ MCP MOUNT WORKS — the in-box opencode harness called spawn_worker → real Scope.spawn'
      : `❌ opencode did NOT call spawn_worker (result=${result.kind}) — protocol/mount needs work`,
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
