import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import { providerAsExecutor } from '../../src/runtime/environment-provider'
import type { RetainedRunAdmission } from '../../src/runtime/retained-run-types'
import {
  type DriverAttemptRecord,
  type DriverBudgetReadout,
  runDriverWithRetry,
} from '../../src/runtime/supervise/driver-retry'
import {
  RetainedExecutionPendingError,
  type RetainedExecutorContext,
  retainedExecutorSeamKey,
} from '../../src/runtime/supervise/retained-executor'
import type { ExecutorContext } from '../../src/runtime/supervise/types'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const profile: AgentProfile = {
  name: 'admission-worker',
  harness: 'opencode',
  model: { provider: 'fixture', default: 'fixture/model' },
}
const budget: DriverBudgetReadout = {
  tokensLeft: 100,
  tokensKnown: true,
  cacheBreakdownKnown: true,
  usdLeft: 0,
  usdCapped: false,
  usdKnown: true,
  iterationsLeft: 10,
  deadlineMs: 0,
  reservedTokens: 0,
}

const sdkError = (status: number, cause?: unknown) =>
  Object.assign(new Error('provider refusal', { cause }), {
    name: status >= 500 ? 'ServerError' : 'SandboxError',
    status,
  })

describe('retained provider admission retry', () => {
  it.each([
    [400, 'terminal'],
    [401, 'terminal'],
    [429, 'unavailable'],
    [408, 'transient'],
    [500, 'transient'],
    [502, 'transient'],
    [503, 'unavailable'],
    [529, 'unavailable'],
  ] as const)('classifies a dispatch refusal HTTP %i as %s', async (status, classification) => {
    const fixture = await refusedTurn('dispatch', sdkError(status))
    expect(fixture.admissions.map((admission) => admission.phase)).toEqual([
      'intent',
      'environment',
    ])
    expect(fixture.failure).toBeInstanceOf(RetainedExecutionPendingError)
    expect(fixture.records[0]?.classification).toBe(classification)
    expect(fixture.attempts).toEqual(classification === 'terminal' ? [1] : [1, 2])
    expect(fixture.counts).toEqual({ creates: 1, dispatches: 1 })
  })

  it.each(['lookup', 'result'] as const)(
    'keeps an accepted execution uncertain when its %s fails with nested HTTP 400',
    async (stage) => {
      const fixture = await refusedTurn(stage, sdkError(404, sdkError(400)))
      expect(fixture.admissions.map((admission) => admission.phase)).toEqual([
        'intent',
        'environment',
        'dispatched',
      ])
      expect(fixture.failure).toBeInstanceOf(RetainedExecutionPendingError)
      if (!(fixture.failure instanceof RetainedExecutionPendingError)) return
      expect(fixture.failure.pendingCause).toBe('unobservable')
      expect(fixture.records[0]?.classification).toBe('transient')
      expect(fixture.attempts).toEqual([1, 2])
      expect(fixture.counts).toEqual({ creates: 1, dispatches: 1 })
    },
  )
})

async function refusedTurn(stage: 'dispatch' | 'lookup' | 'result', failure: Error) {
  const root = await mkdtemp(join(tmpdir(), 'runtime-admission-retry-'))
  roots.push(root)
  const base = durableRetainedProvider(join(root, 'provider.json'))
  const admissions: RetainedRunAdmission[] = []
  const counts = { creates: 0, dispatches: 0 }
  let accepted = false
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    async dispatch(input) {
      counts.dispatches += 1
      if (stage === 'dispatch') throw failure
      const session = await environment.dispatch!(input)
      accepted = true
      return session
    },
    session(id) {
      const session = environment.session!(id)
      if (!session || stage !== 'result') return session
      return {
        ...session,
        result: async () => {
          throw failure
        },
      }
    },
  })
  const provider: AgentEnvironmentProvider = {
    ...base,
    async create(input) {
      counts.creates += 1
      return wrap(await base.create(input))
    },
    async get(id) {
      if (accepted && stage === 'lookup') throw failure
      const environment = await base.get!(id)
      return environment ? wrap(environment) : null
    },
  }
  const signal = new AbortController().signal
  const retained: RetainedExecutorContext = {
    executionId: 'admission-execution',
    admissions,
    async onAdmission(admission) {
      admissions.push(admission)
    },
    async onResult() {},
  }
  const context: ExecutorContext = { signal, seams: { [retainedExecutorSeamKey]: retained } }
  const executor = providerAsExecutor(provider, { destroyOnSettle: false })(
    { profile, harness: 'opencode' },
    context,
  )
  const records: DriverAttemptRecord[] = []
  const attempts: number[] = []
  let observed: unknown
  await runDriverWithRetry({
    drive: async (attempt) => {
      attempts.push(attempt)
      if (attempt > 1) return
      try {
        for await (const _event of executor.execute('produce result', signal)) {
          // Consume the production provider executor through admission or result failure.
        }
      } catch (error) {
        observed = error
        throw error
      }
    },
    progress: () => ({ poolTokensSpent: 0, settledCount: 0, submitted: false }),
    budget: () => budget,
    signal,
    policy: { maxAttempts: 2 },
    sleep: async () => {},
    onAttempt: (record) => {
      records.push(record)
    },
  }).catch((error: unknown) => error)
  return { admissions, records, attempts, counts, failure: observed }
}
