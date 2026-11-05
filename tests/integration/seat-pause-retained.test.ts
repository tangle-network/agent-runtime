import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { expect, it } from 'vitest'
import { loadSpawnForest } from '../../src/durable/spawn-journal/spawn-forest'
import { runSettledCommand } from '../../src/mcp/worktree-harness'
import { startRetainedRun } from '../../src/runtime/retained-run-start'
import { driverChild, driverExecutorFactory } from '../../src/runtime/supervise/driver-executor'
import { ManagerDriveSession } from '../../src/runtime/supervise/manager-drive-session'
import {
  RetainedExecutionPendingError,
  registerRetainedExecutorPreparation,
} from '../../src/runtime/supervise/retained-executor'
import { prepareScopeRetainedOwnerTask } from '../../src/runtime/supervise/retained-owner-invocation'
import {
  bindScopeRetainedOwnerProvider,
  scopeRetainedOwnerContext,
} from '../../src/runtime/supervise/retained-owner-state'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { SeatPauseError } from '../../src/runtime/supervise/seat-chain'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  AgentSpec,
  Budget,
  Scope,
  SpawnEvent,
  SupervisorOpts,
} from '../../src/runtime/supervise/types'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { testAgentProfile } from '../kernel/test-agent-profile'

it.each(['pending-release', 'pending-refuse', 'complete-release', 'complete-refuse'] as const)(
  'backs native uncertainty while retirement is blocked and after pending close (%s)',
  async (mode) => {
    const completed = mode.startsWith('complete')
    const refused = mode.endsWith('refuse')
    const directory = await mkdtemp(join(tmpdir(), 'seat-retained-'))
    const context = createFileRunContext(join(directory, 'run'), { withDriver: true })
    const base = durableRetainedProvider(join(directory, 'provider.json'))
    let retiring = false
    const environment = (env: AgentEnvironment): AgentEnvironment => ({
      ...env,
      async destroy() {
        if (refused) throw new Error('actual fixture owner refuses retirement')
        await env.destroy!()
      },
    })
    const provider: AgentEnvironmentProvider = {
      ...base,
      create: async (input) => environment(await base.create(input)),
      get: async (id) => {
        const env = await base.get!(id)
        return env ? environment(env) : null
      },
      capabilities: async () => {
        if (retiring) {
          await writeFile(join(directory, 'retirement-entered'), 'entered')
          const answer = await runSettledCommand({
            command: process.execPath,
            args: [
              '-e',
              `const fs=require('node:fs'); const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(join(directory, 'retire'))}))clearInterval(timer)},10)`,
            ],
            cwd: directory,
            timeoutMs: 5000,
          })
          if (answer.exitCode !== 0) throw new Error(answer.stderr)
        }
        return base.capabilities()
      },
    }
    const profile = testAgentProfile('native-seat-manager', {
      harness: 'opencode',
      model: { provider: 'fixture', default: 'fixture/model' },
      seats: [
        {
          harness: 'opencode',
          provider: 'fixture',
          model: 'fixture/model',
          selector: { kind: 'all-eligible' },
        },
      ],
    })
    const ceiling = (amount: number) => ({
      maxTokens: amount,
      maxIterations: amount / 10,
      resources: { io: { unit: 'bytes', limit: amount / 10 } },
    })
    const processWork = async (scope: Scope<unknown>, name: string) => {
      const answer = await runSettledCommand({
        command: process.execPath,
        args: [
          '-e',
          `require('node:fs').writeFileSync(${JSON.stringify(join(directory, name))},'executed')`,
        ],
        cwd: directory,
        signal: scope.signal,
        timeoutMs: 5000,
      })
      if (answer.exitCode !== 0) throw new Error(answer.stderr)
      await scope.meter({
        iterations: 1,
        tokens: { input: 10, output: 0 },
        usd: 0,
        ms: 0,
        resources: { io: { unit: 'bytes', amount: 1, known: true } },
      })
      return name
    }
    let paused!: () => void
    const waiting = new Promise<void>((resolve) => {
      paused = resolve
    })
    const manager = driverChild(
      profile,
      {
        name: 'native-seat-manager',
        async act(task, scope) {
          await processWork(scope, 'manager')
          bindScopeRetainedOwnerProvider(scope, provider)
          await prepareScopeRetainedOwnerTask(scope, task)
          const retained = scopeRetainedOwnerContext(scope)!
          await startRetainedRun({
            provider,
            environment: { profile, idempotencyKey: `runtime:${retained.executionId}` },
            turn: {
              prompt: 'retain this exact invocation',
              turnId: `${retained.executionId}:turn:0`,
            },
            onAdmission: retained.onAdmission,
          })
          retiring = true
          const session = new ManagerDriveSession(
            { backend: 'provider', provider },
            'native-seat-execution',
          )
          try {
            await session.selectSeat(
              {
                profile,
                authoredProfile: profile,
                scope,
                task,
                coordinationMcpUrl: 'http://127.0.0.1/unused',
                coordinationTools: [],
              },
              {
                journal: context.journal,
                rootId: 'retained-seat',
                select: async () => {
                  const action = await readFile(join(directory, 'reentry'), 'utf8').catch(
                    () => undefined,
                  )
                  if (action === 'pending')
                    throw new RetainedExecutionPendingError(
                      new Error('exact native result remains unobservable'),
                    )
                  if (action === 'resume')
                    return { seat: 'local-seat', backend: { backend: 'provider', provider } }
                  throw new SeatPauseError(new Date(Date.now() + 1000).toISOString())
                },
                onPause: async (_id, _at, phase) => {
                  if (phase === 'paused') paused()
                },
                onSegment: async () => {},
              },
              'native-seat-execution',
              Date.now,
            )
            return 'completed manager'
          } finally {
            await session.closeSeatSegment('completed')
          }
        },
      },
      context.journal,
    )
    let complete = false
    let closedHold: number | undefined
    let legacyForest: Awaited<ReturnType<typeof loadSpawnForest>> | undefined
    const common = {
      ...context,
      runId: 'retained-seat',
      budget: { ...ceiling(100), deadlineMs: 10_000 },
      workerSlots: 1,
      deadlineCheckIn: false as const,
      rootIdentity: {
        profileDigest: canonicalCandidateDigest({ name: 'root' }),
        taskDigest: canonicalCandidateDigest('task'),
      },
    }
    try {
      const result = await createSupervisor().run(
        {
          name: 'root',
          async act(_task, scope) {
            const admitted = scope.spawn(manager, 'task', { key: 'manager', budget: ceiling(80) })
            if (!admitted.ok) throw new Error('native manager refused')
            await expect
              .poll(() =>
                readFile(join(directory, 'retirement-entered'), 'utf8').catch(() => undefined),
              )
              .toBe('entered')
            expect(scope.workerCapacity.working).toBe(0)
            expect(scope.budget).toMatchObject({ reservedTokens: 70, tokensLeft: 20 })
            expect(scope.budget.resources?.io).toMatchObject({
              reserved: 7,
              remaining: 2,
              committed: 1,
            })
            const sibling = driverChild(
              testAgentProfile('sibling'),
              { name: 'sibling', act: (_task, childScope) => processWork(childScope, 'sibling') },
              context.journal,
            )
            expect(
              scope.spawn(sibling, 'work during blocked retirement', { budget: ceiling(10) }).ok,
            ).toBe(true)
            expect(await scope.next()).toMatchObject({ kind: 'done', out: 'sibling' })
            await writeFile(join(directory, 'retire'), 'continue')
            await waiting
            await writeFile(join(directory, 'reentry'), completed ? 'resume' : 'pending')
            expect(await scope.next()).toMatchObject(
              completed
                ? { kind: 'done', out: 'completed manager' }
                : { kind: 'down', retainedExecution: 'pending' },
            )
            expect(scope.workerCapacity.working).toBe(0)
            closedHold = scope.budget.reservedTokens
            expect(scope.budget).toMatchObject({ reservedTokens: 70, tokensLeft: 10 })
            expect(scope.budget.resources?.io).toMatchObject({
              reserved: 7,
              remaining: completed ? 1 : 0,
              committed: completed ? 2 : 3,
              known: completed,
            })
            expect(
              scope.spawn(
                () => {
                  throw new Error('unbacked factory constructed')
                },
                'cannot borrow outstanding native liability',
                { budget: ceiling(20) },
              ),
            ).toMatchObject({ ok: false, reason: 'budget-exhausted' })
            if (!completed) legacyForest = await loadSpawnForest(context.journal, common.runId)
            complete = true
            return 'finished'
          },
        },
        'task',
        { ...common, retainedAtSettlement: 'release', teardownConfirmMs: 0 },
      )
      expect(closedHold, JSON.stringify(result)).toBe(70)
      expect(complete, JSON.stringify(result)).toBe(true)
      const events = (await context.journal.loadTree(common.runId))!
      expect(
        events.findLast((event) => event.kind === 'settled' && event.id === 'retained-seat:s0'),
      ).toMatchObject(
        completed
          ? { status: 'done' }
          : { retainedExecution: refused ? 'release-unconfirmed' : 'released' },
      )
      expect(
        events.findLast((event) => event.kind === 'reconciled' && event.id === 'retained-seat:s0'),
      ).toMatchObject({ reservation: { maxTokens: 70, resources: { io: { limit: 7 } } } })
      let restored = false
      await createSupervisor().run(
        {
          name: 'root',
          async act(_task, scope) {
            expect(scope.budget).toMatchObject({
              reservedTokens: 0,
              tokensLeft: 10,
              tokensKnown: false,
            })
            expect(scope.budget.resources?.io).toMatchObject({
              remaining: completed ? 1 : 0,
              known: false,
            })
            restored = true
            return 'cold'
          },
        },
        'task',
        { ...common, resume: true, retainedAtSettlement: 'keep' },
      )
      expect(restored).toBe(true)
      if (legacyForest) await assertLegacyDebt(directory, legacyForest, common, ceiling)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

async function assertLegacyDebt(
  directory: string,
  forest: Awaited<ReturnType<typeof loadSpawnForest>>,
  common: SupervisorOpts,
  ceiling: (amount: number) => Budget,
) {
  const legacy = createFileRunContext(join(directory, 'legacy'), { withDriver: true })
  await cp(join(directory, 'run', 'blobs'), join(directory, 'legacy', 'blobs'), {
    recursive: true,
  })
  for (const tree of forest.trees) {
    await legacy.journal.beginTree(tree.root, tree.events[0]!.at)
    for (const event of tree.events) {
      if (event.kind === 'admission-granted' || event.kind === 'admission-queued') continue
      let record: SpawnEvent = event
      if (event.kind === 'spawned') {
        const { attemptId: _attempt, ...old } = event
        record = old
      }
      if (event.kind === 'reconciled') {
        const { reservation: _hold, ...old } = event
        record = old
      }
      await legacy.journal.appendEvent(tree.root, record)
    }
  }
  let executed = false,
    parentObserved = false
  const recover = registerRetainedExecutorPreparation(
    () => {
      throw new Error('no leaf reconstruction')
    },
    ({ profile: original }) => ({
      spec: (
        driverChild(
          original,
          {
            name: 'native-seat-manager',
            async act() {
              executed = true
              throw new Error('legacy unbacked execution')
            },
          },
          legacy.journal,
        ) as unknown as { executorSpec: AgentSpec }
      ).executorSpec,
      factory: driverExecutorFactory,
    }),
  )
  const replay = await createSupervisor().run(
    {
      name: 'root',
      async act(_task, scope) {
        expect(scope.budget).toMatchObject({ reservedTokens: 80, tokensLeft: 0 })
        expect(scope.budget.resources?.io).toMatchObject({
          reserved: 8,
          remaining: 0,
          known: false,
        })
        expect(
          scope.spawn(
            () => {
              throw new Error('legacy debt lent to fresh work')
            },
            'new work',
            { budget: ceiling(10) },
          ),
        ).toMatchObject({ ok: false, reason: 'budget-exhausted' })
        parentObserved = true
        return 'legacy debt remains backed'
      },
    },
    'task',
    {
      ...common,
      ...legacy,
      resume: true,
      recoverExecutor: recover,
      retainedAtSettlement: 'keep',
    },
  )
  expect(parentObserved, JSON.stringify(replay)).toBe(true)
  expect(executed).toBe(false)
}
