/** Actual coordination flows conserve a manager's authored owner share. */
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../../src/durable/in-memory-spawn-stores'
import { createCoordinationTools } from '../../src/mcp/tools/coordination-manager'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, Budget, Scope, Spend } from '../../src/runtime/supervise/types'
import { testAgentProfile } from '../kernel/test-agent-profile'

/**
 * magnetar-rust-sandbox-20261101b (agent-runtime 3.0.22, `ownerShare: 0.5`): manager `:s3` held
 * 2,800,000 tokens. Its own turns had charged 610,298 and its first worker 417,963 when its next
 * two 500,000-token workers were refused with "free 371739": the pool still kept the whole
 * 1,400,000 owner share free although the manager had already spent 610,298 of it, so its own
 * turns came out of its team's half. Seven workers under two managers settled `down` that way.
 */
describe("a manager's own share", () => {
  const MANAGER: Budget = { maxTokens: 2_800_000, maxIterations: 380 }
  const tokens = (input: number): Spend => ({
    iterations: 0,
    tokens: { input, output: 0 },
    usd: 0,
    ms: 0,
  })
  const WORKER: Budget = { maxTokens: 500_000, maxIterations: 16 }

  function team(spentBy: Record<string, number>, gate: Promise<void>) {
    const makeWorkerAgent = (profile: { name?: string }): Agent<unknown, unknown> => {
      const name = profile.name ?? 'worker'
      const result = { outRef: name, out: name, spent: tokens(spentBy[name] ?? 0) }
      return {
        name,
        act: async () => name,
        executorSpec: {
          profile: testAgentProfile(name),
          harness: null,
          executor: {
            runtime: 'owner-share-test',
            async execute() {
              if (name !== 'ladder') await gate
              return result
            },
            resultArtifact: () => result,
            teardown: async () => ({ destroyed: true }),
          },
        },
      }
    }
    return (scope: Scope<unknown>) => {
      const coord = createCoordinationTools({
        scope,
        blobs: new InMemoryResultBlobStore(),
        makeWorkerAgent,
        // A nested manager's default slice at this budget: an eighth of it at ownerShare 0.5.
        perWorker: { maxTokens: 350_000, maxIterations: 47 },
      })
      const tool = coord.tools.find((entry) => entry.name === 'spawn_worker')!
      const spawn = (name: string, budget: Budget) =>
        tool.handler({
          profile: testAgentProfile(name),
          task: name,
          label: name,
          budget,
        }) as Promise<Record<string, unknown>>
      const settled = async (count: number) => {
        while (coord.settled().length < count) {
          const wake = await coord.awaitWake({
            signal: scope.signal,
            heartbeatMs: 60_000,
            debounceMs: 0,
          })
          if (wake === undefined) break
        }
        return coord.settled().map(({ id, status }) => ({ id, status }))
      }
      return { spawn, settled }
    }
  }

  const stores = () => ({
    journal: new InMemorySpawnJournal(),
    blobs: new InMemoryResultBlobStore(),
  })
  const run = (
    act: (scope: Scope<unknown>) => Promise<unknown>,
    { journal, blobs }: ReturnType<typeof stores>,
    resume = false,
  ) =>
    createSupervisor().run({ name: 'manager', act: (_task, scope) => act(scope) }, 'task', {
      budget: MANAGER,
      reservationPolicy: { ownerShare: 0.5 },
      runId: 'owner-share',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      rootIdentity: {
        profileDigest: canonicalCandidateDigest({ profile: 'manager' }),
        taskDigest: canonicalCandidateDigest('task'),
      },
      ...(resume ? { resume: true } : {}),
    })

  it('spends its own turns from its own half, so its team keeps the other half', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tools = team({ ladder: 417_963, keccak: 120_000, merkle: 90_000 }, gate)
    const seen: Record<string, unknown> = {}
    await run(async (scope) => {
      const { spawn, settled } = tools(scope)
      await scope.meter(tokens(610_298))
      await spawn('ladder', { maxTokens: 500_000, maxIterations: 180 })
      await settled(1)
      seen.keccak = await spawn('keccak', WORKER)
      seen.merkle = await spawn('merkle', WORKER)
      seen.oversized = await spawn('oversized', { maxTokens: 2_000_000, maxIterations: 16 })
      release()
      await settled(2)
      seen.merkleAfterRefund = await spawn('merkle', WORKER)
      seen.settled = await settled(3)
      return 'done'
    }, stores())
    // 1,400,000 for the team, less the 417,963 its first worker spent, is 982,037: the first
    // 500,000 worker starts at once; another requires an actual refund.
    expect(seen.keccak).toMatchObject({ status: 'acquiring' })
    expect(seen.merkle).toMatchObject({ error: 'budget-exhausted' })
    expect(seen.merkleAfterRefund).toMatchObject({ status: 'acquiring' })
    // A request no settlement could cover is refused at once, naming what is free now and what
    // its running workers hold, as fields.
    expect(seen.oversized).toMatchObject({
      error: 'budget-exhausted',
      shortfalls: [{ channel: 'tokens', requested: 2_000_000, free: 482_037, held: 500_000 }],
    })
    expect(seen.settled).toEqual([
      { id: 'owner-share:s0', status: 'done' },
      { id: 'owner-share:s1', status: 'done' },
      { id: 'owner-share:s2', status: 'done' },
    ])
  })

  it('still counts the turns it took before a restart', async () => {
    const durable = stores()
    const gate = Promise.resolve()
    const tools = team({ ladder: 417_963, keccak: 120_000 }, gate)
    await run(async (scope) => {
      const { spawn, settled } = tools(scope)
      await scope.meter(tokens(610_298))
      await spawn('ladder', { maxTokens: 500_000, maxIterations: 180 })
      await settled(1)
      throw new Error('the manager process stopped')
    }, durable).catch(() => undefined)
    let resumed: Record<string, unknown> = {}
    await run(
      async (scope) => {
        const { spawn, settled } = tools(scope)
        resumed = await spawn('keccak', WORKER)
        await settled(1)
        return 'done'
      },
      durable,
      true,
    )
    expect(resumed).toMatchObject({ status: 'acquiring' })
  })
})
