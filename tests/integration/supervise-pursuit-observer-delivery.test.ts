import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PURSUIT_OBSERVER_DELIVERY_PATH } from '../../src/durable/pursuit-observer-delivery'
import { supervisePursuit } from '../../src/durable/supervise-pursuit'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

const budget: Budget = { maxIterations: 100, maxTokens: 100_000 }
const perWorker: Budget = { maxIterations: 4, maxTokens: 1_000 }

function deliveringLeaf(name: string): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime: 'deterministic-integration-worker',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
        yield {
          kind: 'cost',
          usd: 0.25,
          usdKnown: true,
          provenance: 'provider-receipt',
        } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `integration:${name}`,
      out: { answer: 42 },
      verdict: { valid: true, score: 1 },
      spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0.25, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor }
  return { name, act: async () => ({ answer: 42 }), executorSpec: spec } as Agent<
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

/** Spawns one worker and ends its turn; the wake that carries its settlement stops. */
function delegateOnce(): DriveHarness {
  let drives = 0
  return async ({ coordinationMcpUrl }) => {
    drives += 1
    if (drives === 1) {
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'spawn_worker',
        arguments: { profile: testAgentProfile('worker'), task: 'answer', label: 'worker' },
      })
      return
    }
    await jsonRpc(coordinationMcpUrl, 'tools/call', { name: 'stop', arguments: {} })
  }
}

const rootProfile = testAgentProfile('root', {
  harness: 'opencode',
  prompt: { systemPrompt: 'Delegate once, wait, then stop.' },
  tools: runtimeToolDeclarations('spawn_worker', 'stop'),
})

interface Delivered {
  url: string
  authorization: string | null
  body: {
    subjectKey: string
    state: string
    attributes?: Record<string, string>
    projection: { pursuitId: string; runs: Array<{ runId: string; status: string }> }
  }
}

describe('supervisePursuit observer delivery', () => {
  let runDir: string
  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), 'pursuit-observer-delivery-'))
  })
  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true })
  })

  it('delivers the projection at start and the settled projection at the end', async () => {
    const delivered: Delivered[] = []
    const fakeFetch = (async (url: string, init: RequestInit) => {
      delivered.push({
        url,
        authorization: new Headers(init.headers).get('authorization'),
        body: JSON.parse(String(init.body)),
      })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const executed = await supervisePursuit(rootProfile, 'answer the question', {
      pursuitId: 'run-a',
      runId: 'run-a',
      runDir,
      budget,
      perWorker,
      driveHarness: delegateOnce(),
      makeWorkerAgent: () => deliveringLeaf('worker'),
      observerDelivery: {
        baseUrl: 'https://intelligence.example/',
        apiKey: 'sk-test',
        subjectKey: 'discovery-lab',
        attributes: { programId: 'program:alpha', ideaId: 'idea:beta' },
        fetch: fakeFetch,
      },
    })

    expect(executed.result.kind).toBe('winner')
    expect(delivered.length).toBeGreaterThanOrEqual(2)
    for (const one of delivered) {
      expect(one.url).toBe(`https://intelligence.example${PURSUIT_OBSERVER_DELIVERY_PATH}`)
      expect(one.authorization).toBe('Bearer sk-test')
      expect(one.body.subjectKey).toBe('discovery-lab')
      expect(one.body.attributes).toEqual({ programId: 'program:alpha', ideaId: 'idea:beta' })
      expect(one.body.projection.pursuitId).toBe('run-a')
    }
    expect(delivered[0]?.body.state).toBe('running')
    const last = delivered.at(-1)
    expect(last?.body.state).toBe('done')
    expect(last?.body.projection.runs).toEqual([
      expect.objectContaining({ runId: 'run-a', status: 'done' }),
    ])
  })

  it('fails open: an unreachable Intelligence is reported once and the run settles', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let calls = 0
    const refusing = (async () => {
      calls += 1
      throw new Error('connect ECONNREFUSED')
    }) as unknown as typeof fetch
    try {
      const executed = await supervisePursuit(rootProfile, 'answer the question', {
        pursuitId: 'run-b',
        runId: 'run-b',
        runDir,
        budget,
        perWorker,
        driveHarness: delegateOnce(),
        makeWorkerAgent: () => deliveringLeaf('worker'),
        observerDelivery: {
          baseUrl: 'https://intelligence.example',
          apiKey: 'sk-test',
          subjectKey: 'discovery-lab',
          fetch: refusing,
        },
      })
      expect(executed.result.kind).toBe('winner')
      expect(calls).toBeGreaterThanOrEqual(2)
      const deliveryWarnings = warn.mock.calls.filter(([message]) =>
        String(message).includes('pursuit observer delivery'),
      )
      expect(deliveryWarnings).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })
})
