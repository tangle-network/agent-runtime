import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import { runSettledCommand } from '../../src/mcp/worktree-harness'
import { providerAsExecutor } from '../../src/runtime/environment-provider/provider-executor-admission'
import { driverChild } from '../../src/runtime/supervise/driver-executor'
import { ManagerDriveSession } from '../../src/runtime/supervise/manager-drive-session'
import { retainedExecutorSeamKey } from '../../src/runtime/supervise/retained-executor'
import { prepareScopeRetainedOwnerTask } from '../../src/runtime/supervise/retained-owner-invocation'
import {
  bindScopeRetainedOwnerProvider,
  scopeRetainedOwnerContext,
} from '../../src/runtime/supervise/retained-owner-state'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { SeatPauseError } from '../../src/runtime/supervise/seat-chain'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Scope, UsageEvent } from '../../src/runtime/supervise/types'
import { isAsyncIterable } from '../../src/runtime/util'
import { nativeSeatProvider } from '../helpers/native-seat-provider'
import { testAgentProfile } from '../kernel/test-agent-profile'

it.each(['resume', 'cancel', 'refuse'] as const)(
  'admits a second native turn only after the same paused grant regains funds and its slot (%s)',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'seat-native-reentry-'))
    const context = createFileRunContext(join(directory, 'run'), { withDriver: true })
    const runId = 'native-seat-reentry'
    const provider = nativeSeatProvider(directory)
    const profile = testAgentProfile('native-manager', {
      harness: 'opencode',
      model: { provider: 'fixture', default: 'fixture/native' },
      seats: [
        {
          harness: 'opencode',
          provider: 'fixture',
          model: 'fixture/native',
          selector: { kind: 'all-eligible' },
        },
      ],
    })
    const ceiling = (tokens: number) => ({ maxTokens: tokens, maxIterations: 10, deadlineMs: 8000 })
    const parentEvents = async () => (await context.journal.loadTree(runId))!
    const managerEvents = async () => (await context.journal.loadTree(`${runId}/${runId}:s0`)) ?? []
    const dispatches = async () =>
      (await readFile(join(directory, 'dispatches.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    let paused!: () => void
    const waiting = new Promise<void>((resolve) => {
      paused = resolve
    })
    let managerId = ''
    const processWork = async (scope: Scope<unknown>, name: string, tokens: number) => {
      const program = `const fs=require('node:fs'); fs.writeFileSync(${JSON.stringify(join(directory, `${name}-started`))},'started'); const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(join(directory, `${name}-release`))}))clearInterval(timer)},10)`
      const result = await runSettledCommand({
        command: process.execPath,
        args: ['-e', program],
        cwd: directory,
        signal: scope.signal,
        timeoutMs: 5000,
      })
      if (result.exitCode !== 0) throw new Error(result.stderr)
      if (tokens > 0)
        await scope.meter({ iterations: 1, tokens: { input: tokens, output: 0 }, usd: 0, ms: 0 })
      return name
    }
    const manager = driverChild(
      profile,
      {
        name: 'native-manager',
        async act(task, scope) {
          bindScopeRetainedOwnerProvider(scope, provider)
          const nativeTurn = async (label: string) => {
            const input = await prepareScopeRetainedOwnerTask(scope, label)
            const retained = scopeRetainedOwnerContext(scope)!
            const executor = providerAsExecutor(provider)(
              { profile, harness: 'opencode' },
              { signal: scope.signal, seams: { [retainedExecutorSeamKey]: retained } },
            )
            const execution = executor.execute(input, scope.signal)
            if (!isAsyncIterable<UsageEvent>(execution)) throw new Error('provider did not stream')
            for await (const _event of execution) {
            }
            const spent = executor.resultArtifact().spent
            expect(spent.tokens).toMatchObject({ input: 5, output: 0 })
            await scope.meter(spent)
          }
          await nativeTurn('first native turn')
          const session = new ManagerDriveSession({ backend: 'provider', provider }, 'native-owner')
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
                  if (
                    !(await readFile(join(directory, 'seat-ready'), 'utf8').catch(() => undefined))
                  )
                    throw new SeatPauseError(new Date(Date.now() + 200).toISOString())
                  return { seat: 'local-seat', backend: { backend: 'provider', provider } }
                },
                onPause: async (_id, _at, phase) => {
                  if (phase === 'paused') paused()
                },
                onSegment: async () => {},
              },
              'native-owner',
              Date.now,
            )
            await nativeTurn('second native turn')
            return 'two native turns'
          } finally {
            await session.closeSeatSegment('completed')
          }
        },
      },
      context.journal,
    )
    try {
      const result = await createSupervisor().run(
        {
          name: 'root',
          async act(_task, scope) {
            const admitted = scope.spawn(manager, 'native work', {
              key: 'manager',
              budget: ceiling(80),
            })
            if (!admitted.ok) throw new Error('manager refused')
            managerId = admitted.handle.id
            await waiting
            expect(await dispatches()).toHaveLength(1)
            expect(scope.workerCapacity.working).toBe(0)
            expect(scope.budget).toMatchObject({
              reservedTokens: 0,
              committedTokens: 5,
              tokensLeft: 95,
            })
            const payer = driverChild(
              testAgentProfile('payer'),
              {
                name: 'payer',
                act: (_task, childScope) =>
                  processWork(childScope, 'payer', mode === 'refuse' ? 90 : 10),
              },
              context.journal,
            )
            const blocker = driverChild(
              testAgentProfile('slot-blocker'),
              {
                name: 'slot-blocker',
                act: (_task, childScope) => processWork(childScope, 'slot', 0),
              },
              context.journal,
            )
            expect(scope.spawn(payer, 'hold funding', { budget: ceiling(90) }).ok).toBe(true)
            await expect
              .poll(() => readFile(join(directory, 'payer-started'), 'utf8').catch(() => undefined))
              .toBe('started')
            expect(scope.spawn(blocker, 'hold next worker slot', { budget: ceiling(0) }).ok).toBe(
              true,
            )
            await writeFile(join(directory, 'seat-ready'), 'available')
            await expect
              .poll(async () =>
                (await parentEvents()).some(
                  (event) =>
                    event.id === managerId &&
                    event.kind === 'admission-queued' &&
                    event.gate === 'budget',
                ),
              )
              .toBe(true)
            expect(
              (await managerEvents()).filter((event) => event.kind === 'execution-input'),
            ).toHaveLength(1)
            expect(await dispatches()).toHaveLength(1)
            expect(scope.workerCapacity).toMatchObject({ working: 1, queued: 1 })
            if (mode === 'cancel') admitted.handle.abort()
            await writeFile(join(directory, 'payer-release'), 'finish')
            await expect
              .poll(() => readFile(join(directory, 'slot-started'), 'utf8').catch(() => undefined))
              .toBe('started')
            if (mode === 'resume') {
              await expect
                .poll(async () =>
                  (await parentEvents()).some(
                    (event) =>
                      event.id === managerId &&
                      event.kind === 'admission-queued' &&
                      event.gate === 'slot',
                  ),
                )
                .toBe(true)
              expect(scope.budget.reservedTokens).toBe(75)
              expect(scope.workerCapacity).toMatchObject({ working: 1, queued: 1 })
              expect(
                (await managerEvents()).filter((event) => event.kind === 'execution-input'),
              ).toHaveLength(1)
              expect(await dispatches()).toHaveLength(1)
            }
            await writeFile(join(directory, 'slot-release'), 'finish')
            const settled = []
            for (;;) {
              const item = await scope.next()
              if (!item) break
              settled.push(item)
            }
            expect(settled.find((item) => item.handle.id === managerId)?.kind).toBe(
              mode === 'resume' ? 'done' : 'down',
            )
            return 'finished'
          },
        },
        'task',
        {
          ...context,
          runId,
          budget: { maxTokens: 100, maxIterations: 100, deadlineMs: 10000 },
          workerSlots: 1,
          deadlineCheckIn: false,
          rootIdentity: {
            profileDigest: canonicalCandidateDigest({ name: 'root' }),
            taskDigest: canonicalCandidateDigest('task'),
          },
        },
      )
      expect(result.kind, JSON.stringify(result)).toBe('winner')
      const expectedTurns = mode === 'resume' ? 2 : 1
      const events = await managerEvents()
      expect(events.filter((event) => event.kind === 'execution-input')).toHaveLength(expectedTurns)
      const results = events.filter((event) => event.kind === 'execution-result')
      expect(results).toHaveLength(expectedTurns)
      expect(results.map((event) => event.spent.tokens.input)).toEqual(Array(expectedTurns).fill(5))
      const controls = await dispatches()
      expect(controls).toHaveLength(expectedTurns)
      expect(
        events.flatMap((event) =>
          event.kind === 'execution-admitted' && event.admission.phase === 'dispatched'
            ? [event.admission.controlRef]
            : [],
        ),
      ).toEqual(controls)
      expect(new Set(controls.map((control) => control.executionId)).size).toBe(expectedTurns)
      if (mode === 'resume') {
        expect(controls[1]).toMatchObject({
          environmentId: controls[0].environmentId,
          sessionId: controls[0].sessionId,
        })
        const grants = (await parentEvents()).filter(
          (event) => event.kind === 'admission-granted' && event.id === managerId,
        )
        expect(grants).toHaveLength(2)
        expect(grants[1]).toMatchObject({
          attemptId: grants[0]!.attemptId,
          deadlineArmedAt: grants[0]!.deadlineArmedAt,
          deadlineAt: grants[0]!.deadlineAt,
        })
      }
      const receipts = (await readFile(join(directory, 'native-receipts.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(receipts).toHaveLength(expectedTurns)
      expect(receipts.every((receipt) => receipt.pid !== process.pid)).toBe(true)
      expect(receipts.map((receipt) => receipt.control)).toEqual(controls)
      expect(result.spentTotal.tokens.input).toBe(expectedTurns * 5 + (mode === 'refuse' ? 90 : 10))
    } finally {
      await Promise.all(
        ['payer', 'slot'].map((name) => writeFile(join(directory, `${name}-release`), 'cleanup')),
      )
      await rm(directory, { recursive: true, force: true })
    }
  },
)
