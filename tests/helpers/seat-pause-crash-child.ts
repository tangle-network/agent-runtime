import assert from 'node:assert/strict'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { runSettledCommand } from '../../src/mcp/worktree-harness'
import { driverChild, driverExecutorFactory } from '../../src/runtime/supervise/driver-executor'
import { ManagerDriveSession } from '../../src/runtime/supervise/manager-drive-session'
import { registerRetainedExecutorPreparation } from '../../src/runtime/supervise/retained-executor'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { SeatPauseError } from '../../src/runtime/supervise/seat-chain'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, AgentSpec, ExecutorFactory, Scope } from '../../src/runtime/supervise/types'
import { testAgentProfile } from '../kernel/test-agent-profile'
import { durableRetainedProvider } from './durable-retained-provider'

const [directory, phase, scenario] = process.argv.slice(2)
const overrun = scenario === 'overrun'
if (!directory || !['kill', 'resume', 'cold'].includes(phase))
  throw new Error('expected directory and phase')
const runId = 'seat-crash'
const context = createFileRunContext(join(directory, 'run'), { withDriver: true })
const provider = durableRetainedProvider(join(directory, 'provider.json'))
const profile = testAgentProfile('seat-manager', {
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
const journal = {
  beginTree: context.journal.beginTree.bind(context.journal),
  loadTree: context.journal.loadTree.bind(context.journal),
  async appendEvent(root: string, event: Parameters<typeof context.journal.appendEvent>[1]) {
    await context.journal.appendEvent(root, event)
    if (phase === 'kill' && root === runId && event.kind === 'reconciled' && event.reservation)
      process.kill(process.pid, 'SIGKILL')
  },
}
const ceiling = {
  maxTokens: 80,
  maxIterations: 8,
  maxUsd: 8,
  resources: { io: { unit: 'bytes', limit: 8 } },
  deadlineMs: 15_000,
}
async function work(scope: Scope<unknown>, name: string) {
  const result = await runSettledCommand({
    command: process.execPath,
    args: [
      '-e',
      `require('node:fs').appendFileSync(${JSON.stringify(join(directory, 'processes'))}, ${JSON.stringify(`${name}\n`)})`,
    ],
    cwd: directory,
    signal: scope.signal,
    timeoutMs: 5000,
  })
  assert.equal(result.exitCode, 0)
  await writeFile(join(directory, name), 'executed')
  await scope.meter({
    iterations: 1,
    tokens: { input: 10, output: 0 },
    usd: 1,
    ms: 0,
    resources: { io: { unit: 'bytes', amount: 1, known: true } },
  })
}
async function waitForFile(name: string, scope?: Scope<unknown>) {
  const answer = await runSettledCommand({
    command: process.execPath,
    args: [
      '-e',
      `const fs=require('node:fs'); const end=Date.now()+10000; const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(join(directory, name))}))clearInterval(t);else if(Date.now()>end)process.exit(2)},10)`,
    ],
    cwd: directory,
    signal: scope?.signal,
    timeoutMs: 11000,
  })
  assert.equal(answer.exitCode, 0, answer.stderr)
}
let recoveryFactory: ExecutorFactory<unknown>
const descendant = (): Agent<unknown, unknown> =>
  driverChild(
    testAgentProfile('nested-process'),
    {
      name: 'nested-process',
      async act(_task, scope) {
        if (await readFile(join(directory, 'native-pid'), 'utf8').catch(() => undefined))
          await waitForFile('nested-done', scope)
        else {
          const answer = await runSettledCommand({
            command: process.execPath,
            args: [
              '-e',
              `const fs=require('node:fs'); fs.appendFileSync(${JSON.stringify(join(directory, 'processes'))},${JSON.stringify('nested\n')}); fs.writeFileSync(${JSON.stringify(join(directory, 'native-pid'))},String(process.pid)); const end=Date.now()+12000; const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(join(directory, 'release-nested'))})){fs.writeFileSync(${JSON.stringify(join(directory, 'nested-done'))},'done');clearInterval(t)}else if(Date.now()>end)process.exit(2)},10)`,
            ],
            cwd: directory,
            signal: scope.signal,
            timeoutMs: 13000,
          })
          assert.equal(answer.exitCode, 0, answer.stderr)
        }
        await scope.meter({
          iterations: 1,
          tokens: { input: 10, output: 0 },
          usd: 1,
          ms: 0,
          resources: { io: { unit: 'bytes', amount: 1, known: true } },
        })
        return 'nested'
      },
    },
    journal,
    undefined,
    undefined,
    recoveryFactory,
  )

const manager = (): Agent<unknown, unknown> =>
  driverChild(
    profile,
    {
      name: 'manager',
      async act(task, scope) {
        if ((scope.budget.committedTokens ?? 0) === 0) {
          await work(scope, 'before')
          if (overrun) {
            assert.equal(
              scope.spawn(descendant(), 'finish original work', {
                key: 'nested',
                budget: {
                  ...ceiling,
                  maxTokens: 60,
                  maxIterations: 6,
                  maxUsd: 6,
                  resources: { io: { unit: 'bytes', limit: 6 } },
                },
              }).ok,
              true,
            )
            await waitForFile('native-pid', scope)
            await scope.meter({
              iterations: 0,
              tokens: { input: 40, output: 0 },
              usd: 4,
              ms: 0,
              resources: { io: { unit: 'bytes', amount: 0, known: true } },
            })
          }
        }
        const session = new ManagerDriveSession({ backend: 'provider', provider }, 'seat-execution')
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
              journal,
              rootId: runId,
              select: async () => {
                if (phase === 'kill')
                  throw new SeatPauseError(new Date(Date.now() + 1000).toISOString())
                if (overrun) await waitForFile('resume', scope)
                return { seat: 'local-seat', backend: { backend: 'provider', provider } }
              },
              onSegment: async () => {},
            },
            'seat-execution',
            Date.now,
          )
          await work(scope, 'after')
          return 'finished'
        } finally {
          await session.closeSeatSegment('completed')
        }
      },
    },
    journal,
    undefined,
    undefined,
    recoveryFactory,
  )
recoveryFactory = registerRetainedExecutorPreparation(
  () => {
    throw new Error('no leaf admitted')
  },
  ({ profile: original }) => ({
    spec: (
      (original.name === 'nested-process' ? descendant() : manager()) as Agent<unknown, unknown> & {
        executorSpec: AgentSpec
      }
    ).executorSpec,
    factory: driverExecutorFactory,
  }),
)
const result = await createSupervisor().run(
  {
    name: 'root',
    async act(_task, scope) {
      try {
        if (phase === 'kill')
          assert.equal(scope.spawn(manager(), 'task', { key: 'manager', budget: ceiling }).ok, true)
        if (phase === 'cold') {
          assert.equal(scope.budget.tokensLeft, 90)
          assert.equal(scope.budget.reservedTokens, 0)
          assert.equal(scope.budget.resources?.io.remaining, overrun ? 13 : 9)
          assert.equal(scope.budget.tokensKnown, !overrun)
          return 'cold'
        }
        if (overrun && phase === 'resume') {
          assert.equal(scope.budget.tokensLeft, 90)
          assert.equal(scope.budget.reservedTokens, 60)
          assert.equal(scope.budget.resources?.io.reserved, 7)
          assert.deepEqual(
            scope.spawn(
              () => {
                throw new Error('existing liability lent to new work')
              },
              'unfunded',
              { budget: { ...ceiling, maxTokens: 100 } },
            ),
            {
              ok: false,
              reason: 'budget-exhausted',
              shortfalls: [{ channel: 'tokens', requested: 100, free: 90, held: 60 }],
            },
          )
          await writeFile(join(directory, 'resume'), 'reenter')
          await waitForFile('after')
          await writeFile(join(directory, 'release-nested'), 'finish')
        }
        const settlement = await scope.next()
        assert.equal(settlement?.kind, 'done')
        assert.equal(scope.budget.reservedTokens, 0)
        assert.equal(scope.budget.tokensLeft, overrun ? 130 : 80)
        assert.equal(scope.budget.resources?.io.remaining, overrun ? 17 : 8)
        await appendFile(join(directory, 'root-finished'), 'finished')
        return 'resumed'
      } catch (error) {
        console.error('seat crash root protocol failed', error)
        throw error
      }
    },
  },
  'task',
  {
    ...context,
    journal,
    runId,
    budget: {
      maxTokens: overrun ? 200 : 100,
      maxIterations: overrun ? 20 : 10,
      maxUsd: overrun ? 20 : 10,
      resources: { io: { unit: 'bytes', limit: overrun ? 20 : 10 } },
      deadlineMs: 20_000,
    },
    workerSlots: 1,
    deadlineCheckIn: false,
    rootIdentity: {
      profileDigest: canonicalCandidateDigest({ name: 'root' }),
      taskDigest: canonicalCandidateDigest('task'),
    },
    ...(phase === 'kill'
      ? {}
      : { resume: true, ...(phase === 'cold' ? {} : { recoverExecutor: recoveryFactory }) }),
    retainedAtSettlement: 'keep',
  },
)
assert.equal(result.kind, 'winner', JSON.stringify(result))
process.stdout.write(
  `${JSON.stringify({ result, processes: await readFile(join(directory, 'processes'), 'utf8') })}\n`,
)
