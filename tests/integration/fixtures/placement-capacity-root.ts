import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { Sandbox } from '@tangle-network/sandbox'
import { expect, type onTestFinished } from 'vitest'
import { FileSpawnJournal } from '../../../src/durable/spawn-journal/journal-store'
import { createFileRunContext, supervise } from '../../../src/runtime'
import { runtimeToolDeclarations, testAgentProfile } from '../../kernel/test-agent-profile'
import { ProcessFixture, prepareExecutables } from './uncertain-create-harness'

// The release gate exercises the SDK and Runtime defaults past the original outage duration.
const createBudgetMs = 5_000
const placementTiming =
  process.env.RUNTIME_FULL_PLACEMENT_WINDOWS === '1'
    ? {
        provider: {},
        executor: {},
        roomAfter: 8 * 60_000,
        minimumRefusal: 7 * 60_000,
        deadline: 13 * 60_000,
        success: 20 * 60_000,
      }
    : {
        provider: { readyTimeoutMs: createBudgetMs },
        executor: { capacityRetryWindowMs: 2 * createBudgetMs },
        roomAfter: 12 * createBudgetMs,
        minimumRefusal: 3 * createBudgetMs,
        deadline: 10 * createBudgetMs,
        success: 24 * createBudgetMs,
      }

/**
 * Drive a provider root whose every create a Sandbox-shaped HTTP service refuses with the real
 * 503 body and Retry-After, through the real SDK and Tangle provider, until its room returns
 * after several complete SDK create budgets or the run reaches its own deadline. `capacity` says
 * no host has room; `keyed` says the key's existence probe failed, then that its recovery is in
 * progress.
 */
export async function runPlacementCapacityRoot(
  end: 'success' | 'deadline',
  refusal: 'capacity' | 'keyed' = 'capacity',
  finished?: typeof onTestFinished,
) {
  const { bundle, executables } = await prepareExecutables()
  const fixture = await ProcessFixture.start(
    `json-observation-long-create-capacity-${end}`,
    executables,
    { coordinator: false, ...(finished ? { onTestFinished: finished } : {}) },
  )
  const runId = `placement-${refusal}-${end}`
  const runDir = join(fixture.directory, 'run')
  try {
    await fixture.control({
      finish: true,
      capacityOutage: {
        ms: placementTiming.roomAfter,
        retryAfterSeconds: 2,
        phases: ['acquisition'],
        refusal,
      },
    })
    const context = createFileRunContext(runDir)
    const provider = createTangleProvider({
      ...placementTiming.provider,
      client: new Sandbox({
        apiKey: 'offline-not-a-secret',
        baseUrl: fixture.url,
        platformUrl: fixture.url,
        trustLocalCliAuth: false,
        directExec: false,
      }),
    })
    const backend = {
      backend: 'provider' as const,
      provider,
      ...placementTiming.executor,
    }
    const result = await supervise(
      testAgentProfile('placement-capacity-root', {
        harness: 'opencode',
        model: { provider: 'openai', default: 'fixture-model' },
        tools: runtimeToolDeclarations('stop'),
      }),
      'Report the offline native result.',
      {
        runDir,
        runId,
        journal: context.journal,
        blobs: context.blobs,
        backend,
        driverBackend: backend,
        budget: { maxTokens: 100, maxIterations: 4, deadlineMs: placementTiming[end] },
        coordination: {
          host: '127.0.0.1',
          port: 0,
          authentication: true,
          publicUrl: (address) => `http://127.0.0.1:${address.port}/manager`,
        },
      },
    )
    const state = await fixture.state()
    const events = await new FileSpawnJournal(join(runDir, 'spawn-journal.jsonl')).loadTree(runId)
    const records = (events ?? []).flatMap((event) =>
      event.kind === 'driver-attempt' ? [event.record] : [],
    )
    const refused = state.requests.filter((row) => row.kind === 'capacity-create-refused')
    // No drive ended on the unchanged refusal, though it outlasted three such drives.
    expect(records.filter((record) => record.stop === 'repeated-failure')).toEqual([])
    expect(result).not.toMatchObject({ reason: 'driver-failed' })
    expect(Date.parse(refused.at(-1)!.at) - Date.parse(refused[0]!.at)).toBeGreaterThan(
      placementTiming.minimumRefusal,
    )
    // Every create, refused or admitted, carried the one environment key.
    const creates = [...refused, ...state.requests.filter((row) => row.kind === 'create')]
    expect(new Set(creates.map((row) => row.key)).size).toBe(1)
    // The keyed case met the probe's refusal once, then the reconciler's hold on every resend.
    if (refusal === 'keyed')
      expect(refused.map((row) => row.code)).toEqual([
        'IDEMPOTENT_CREATE_PROBE_FAILED',
        ...refused.slice(1).map(() => 'SANDBOX_CREATE_RECONCILING'),
      ])
    return { result, records, state }
  } finally {
    await fixture.close()
    await rm(bundle, { recursive: true, force: true })
  }
}
