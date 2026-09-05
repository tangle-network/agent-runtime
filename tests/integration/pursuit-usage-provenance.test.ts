import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileObserverJournal } from '../../src/durable/observer-journal'
import { projectPursuit } from '../../src/durable/observer-projection'
import { supervisePursuit } from '../../src/durable/supervise-pursuit'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  Spend,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

const budget: Budget = { maxIterations: 100, maxTokens: 100_000 }
const perWorker: Budget = { maxIterations: 4, maxTokens: 1_000 }

/** A worker whose provider reports the prompt-cache split, so replay has cache classes to lose. */
function cachingLeaf(
  name: string,
  input: number,
  cacheRead: number,
  cacheWrite: number,
  usd: number,
): Agent<unknown, unknown> {
  // Every prompt token is classified: the pool refuses a split whose classes exceed `input`.
  const tokens = {
    input,
    output: 20,
    freshInput: input - cacheRead - cacheWrite,
    cacheRead,
    cacheWrite,
  }
  const spent: Spend = { iterations: 1, tokens, usd, ms: 40 }
  const executor: Executor<unknown> = {
    runtime: 'caching-test-worker',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', ...tokens } as UsageEvent
        yield { kind: 'cost', usd, usdKnown: true, provenance: 'provider-receipt' } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `usage:${name}`,
      out: { worker: name },
      verdict: { valid: true, score: 1 },
      spent,
    }),
  }
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor }
  return { name, act: async () => ({ worker: name }), executorSpec: spec } as Agent<
    unknown,
    unknown
  > & { executorSpec: AgentSpec }
}

async function jsonRpc(url: string, method: string, params: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!response.ok) throw new Error(`coordination MCP returned ${response.status}`)
  await response.json()
}

describe('pursuit projection usage and totals', () => {
  it('replays one real supervised tree to the same ids, cache classes, and telescoping totals', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'pursuit-usage-'))
    const pursuitId = 'pursuit:usage-provenance'
    const runId = 'run:usage-provenance:1'
    const workers = ['reader', 'writer']
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl }) => {
      for (const label of workers) {
        await jsonRpc(coordinationMcpUrl, 'tools/call', {
          name: 'spawn_worker',
          arguments: { profile: testAgentProfile(label), task: `work as ${label}`, label },
        })
      }
      for (const _ of workers) {
        await jsonRpc(coordinationMcpUrl, 'tools/call', {
          name: 'await_event',
          arguments: { kinds: ['settled'] },
        })
      }
      await jsonRpc(coordinationMcpUrl, 'tools/call', { name: 'stop', arguments: {} })
    }

    try {
      const executed = await supervisePursuit(
        testAgentProfile('usage-root', {
          prompt: { systemPrompt: 'Delegate twice, wait for both, then stop.' },
          tools: runtimeToolDeclarations('spawn_worker', 'await_event', 'stop'),
        }),
        'measure two workers exactly once',
        {
          pursuitId,
          runId,
          runDir,
          budget,
          perWorker,
          driveHarness,
          makeWorkerAgent: (profile: { name: string }) =>
            profile.name === 'reader'
              ? cachingLeaf('reader', 120, 80, 8, 0.002)
              : cachingLeaf('writer', 60, 10, 5, 0.001),
        },
      )

      // Replay is the contract: rebuilding from the durable journal must produce the same tree.
      const replayed = projectPursuit(
        await new FileObserverJournal(executed.observerPath, pursuitId).read(),
      )
      expect(replayed).toEqual(executed.pursuit)

      const nodes = replayed.nodes.filter((node) => node.runId === runId)
      expect(nodes.map((node) => node.label).sort()).toEqual(['reader', 'writer'])
      expect(nodes.every((node) => node.status === 'done')).toBe(true)
      expect(nodes.every((node) => node.parentId === runId)).toBe(true)

      // Cache classes survive live -> storage -> replay; absence would silently become zero.
      const reader = nodes.find((node) => node.label === 'reader')
      expect(reader?.usage).toMatchObject({ input: 120, output: 20, cacheRead: 80, cacheWrite: 8 })
      expect(reader?.cost).toMatchObject({ usd: 0.002, usdKnown: true, provenance: 'reported' })
      expect(reader?.timing?.wallMs).toBeGreaterThanOrEqual(0)
      expect(reader?.timing?.settledAt).toBeGreaterThanOrEqual(reader?.timing?.startedAt ?? 0)

      const run = replayed.runs.find((candidate) => candidate.runId === runId)
      const totals = run?.totals
      expect(totals).toBeDefined()
      if (!totals) throw new Error('unreachable')

      // Each worker's model call is counted once: the inclusive total equals the two settlements.
      expect(totals.inclusive.tokens.input).toBe(180)
      expect(totals.inclusive.tokens.output).toBe(40)
      expect(totals.inclusive.usd).toBeCloseTo(0.003, 10)

      // Exclusive shares telescope back to the inclusive total.
      const exclusive = Object.values(totals.exclusiveByNode)
      expect(exclusive.reduce((sum, share) => sum + share.tokens.input, 0)).toBe(
        totals.inclusive.tokens.input,
      )
      expect(exclusive.reduce((sum, share) => sum + share.tokens.output, 0)).toBe(
        totals.inclusive.tokens.output,
      )
      expect(exclusive.reduce((sum, share) => sum + share.usd, 0)).toBeCloseTo(
        totals.inclusive.usd,
        10,
      )
      expect(run?.spendGaps).toBeUndefined()
    } finally {
      await rm(runDir, { recursive: true, force: true })
    }
  })
})
