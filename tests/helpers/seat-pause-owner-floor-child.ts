import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
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
import { zeroSpend } from '../../src/runtime/util'
import { testAgentProfile } from '../kernel/test-agent-profile'
import { durableRetainedProvider } from './durable-retained-provider'

const [directory, phase] = process.argv.slice(2)
if (!directory || (phase !== 'kill' && phase !== 'resume'))
  throw new Error('directory and phase required')
const runId = 'seat-owner-floor'
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
const ceiling = (maxTokens: number) => ({ maxTokens, deadlineMs: 15_000 })
const file = (name: string) => join(directory, name)
const exists = async (name: string) =>
  (await readFile(file(name), 'utf8').catch(() => undefined)) !== undefined
async function until(check: () => Promise<boolean>, label: string) {
  const end = Date.now() + 3000
  while (!(await check())) {
    assert.ok(Date.now() < end, label)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
async function native(name: string, scope: Scope<unknown>, gated = false) {
  const answer = await runSettledCommand({
    command: process.execPath,
    args: [
      '-e',
      `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(file('native.jsonl'))},JSON.stringify({name:${JSON.stringify(name)},pid:process.pid})+'\\n');${gated ? `fs.writeFileSync(${JSON.stringify(file('sibling-pid'))},String(process.pid));const end=Date.now()+18000;const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(file('release-sibling'))})){fs.writeFileSync(${JSON.stringify(file('sibling-done'))},'zero-token result');clearInterval(timer)}else if(Date.now()>end)process.exit(2)},10)` : ''}`,
    ],
    cwd: directory,
    signal: scope.signal,
    timeoutMs: gated ? 19000 : 5000,
  })
  assert.equal(answer.exitCode, 0, answer.stderr)
}
let recover: ExecutorFactory<unknown>
const sibling = (): Agent<unknown, unknown> =>
  driverChild(
    testAgentProfile('sibling'),
    {
      name: 'sibling',
      async act(_task, scope) {
        if (phase === 'kill') await native('sibling', scope, true)
        else {
          const pid = Number(await readFile(file('sibling-pid'), 'utf8'))
          process.kill(pid, 0)
          await writeFile(file('sibling-recovered'), String(pid))
          await until(
            () => exists('sibling-done'),
            'original sibling native process did not finish',
          )
        }
        await scope.meter(zeroSpend())
        return 'sibling zero-token result'
      },
    },
    context.journal,
    undefined,
    undefined,
    recover,
  )
const manager = (): Agent<unknown, unknown> =>
  driverChild(
    profile,
    {
      name: 'seat-manager',
      async act(task, scope) {
        if (phase === 'kill') {
          await native('prefix', scope)
          await scope.meter({ ...zeroSpend(), tokens: { input: 10, output: 0 } })
        } else {
          await writeFile(file('manager-recovered'), 'executor admitted')
          assert.equal(scope.budget.committedTokens, 10)
        }
        const session = new ManagerDriveSession({ backend: 'provider', provider }, 'seat-owner')
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
              rootId: runId,
              select: async () => {
                if (phase === 'kill')
                  throw new SeatPauseError(new Date(Date.now() + 1000).toISOString())
                return { seat: 'local-seat', backend: { backend: 'provider', provider } }
              },
              onPause: async (_id, _at, state) => {
                if (state === 'paused') await writeFile(file('paused'), 'ACKed')
              },
              onSegment: async () => {},
            },
            'seat-owner',
            Date.now,
          )
          assert.equal(await readFile(file('sibling-done'), 'utf8'), 'zero-token result')
          await native('manager-after', scope)
          await scope.meter({ ...zeroSpend(), tokens: { input: 10, output: 0 } })
          return 'manager resumed'
        } finally {
          await session.closeSeatSegment('completed')
        }
      },
    },
    context.journal,
    undefined,
    undefined,
    recover,
  )
recover = registerRetainedExecutorPreparation(
  () => {
    throw new Error('unexpected leaf recovery')
  },
  ({ profile: original }) => ({
    spec: (
      (original.name === 'sibling' ? sibling() : manager()) as Agent<unknown, unknown> & {
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
      if (phase === 'kill') {
        assert.equal(
          scope.spawn(manager(), 'original manager task', { key: 'manager', budget: ceiling(80) })
            .ok,
          true,
        )
        await until(() => exists('paused'), 'manager did not ACK its pause')
        assert.equal(scope.budget.committedTokens, 10)
        assert.equal(scope.budget.reservedTokens, 0)
        assert.equal(
          scope.spawn(sibling(), 'original sibling task', { key: 'sibling', budget: ceiling(10) })
            .ok,
          true,
        )
        await until(() => exists('sibling-pid'), 'sibling process did not start')
        assert.deepEqual(
          { free: scope.budget.tokensLeft, held: scope.budget.reservedTokens },
          { free: 80, held: 10 },
        )
        process.kill(process.pid, 'SIGKILL')
        return
      }
      await writeFile(file('restored-budget.json'), JSON.stringify(scope.budget))
      assert.equal(scope.budget.committedTokens, 10)
      assert.equal(
        scope.budget.reservedTokens,
        10,
        'original sibling backing must exist at parent entry',
      )
      assert.equal(scope.budget.tokensLeft, 80)
      await until(
        async () =>
          ((await context.journal.loadTree(runId)) ?? []).some(
            (event) =>
              event.id === `${runId}:s0` &&
              event.kind === 'admission-queued' &&
              event.gate === 'budget',
          ),
        'manager did not wait for its top-up',
      )
      assert.equal(scope.view.nodes.find((node) => node.id === `${runId}:s0`)?.status, 'queued')
      assert.equal(
        await exists('manager-recovered'),
        false,
        'owner floor must block executor reentry',
      )
      await until(
        () => exists('sibling-recovered'),
        'zero-top-up sibling must reattach ahead of cash waiter',
      )
      assert.equal(
        await readFile(file('sibling-recovered'), 'utf8'),
        await readFile(file('sibling-pid'), 'utf8'),
      )
      assert.equal(scope.budget.reservedTokens, 10)
      assert.equal(scope.budget.tokensLeft, 80)
      assert.deepEqual(
        scope.spawn(
          () => {
            throw new Error('owner floor lent to fresh work')
          },
          'unfunded',
          { budget: ceiling(61) },
        ),
        {
          ok: false,
          reason: 'budget-exhausted',
          shortfalls: [{ channel: 'tokens', requested: 61, free: 60, held: 10 }],
        },
      )
      await writeFile(file('release-sibling'), 'finish original execution')
      assert.equal((await scope.next())?.kind, 'done')
      assert.equal((await scope.next())?.kind, 'done')
      assert.equal(await scope.next(), null)
      assert.equal(scope.budget.reservedTokens, 0)
      assert.equal(scope.budget.committedTokens, 20)
      assert.equal(scope.budget.tokensLeft, 80)
      await writeFile(file('final-budget.json'), JSON.stringify(scope.budget))
      return 'restored backing funded the manager exactly once'
    },
  },
  'task',
  {
    ...context,
    runId,
    budget: { maxTokens: 100, deadlineMs: 20_000 },
    workerSlots: 1,
    reservationPolicy: { ownerShare: 0.2 },
    deadlineCheckIn: false,
    rootIdentity: {
      profileDigest: canonicalCandidateDigest({ name: 'root' }),
      taskDigest: canonicalCandidateDigest('task'),
    },
    retainedAtSettlement: 'keep',
    ...(phase === 'resume' ? { resume: true, recoverExecutor: recover } : {}),
  },
)
assert.equal(result.kind, 'winner', JSON.stringify(result))
assert.equal(result.spentTotal.tokens.input, 20)
process.stdout.write(`${JSON.stringify({ result })}\n`)
