import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import { runSettledCommand } from '../../src/mcp/worktree-harness'
import { createFileRunContext, createSupervisor, type Scope, type Spend } from '../../src/runtime'
import { driverChild } from '../../src/runtime/supervise/driver-executor'
import { ManagerDriveSession } from '../../src/runtime/supervise/manager-drive-session'
import { SeatPauseError } from '../../src/runtime/supervise/seat-chain'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { testAgentProfile } from '../kernel/test-agent-profile'

const measured: Spend = {
  iterations: 1,
  tokens: { input: 10, output: 0 },
  usd: 1,
  ms: 0,
  resources: { io: { unit: 'bytes', amount: 1, known: true } },
}

it.each(['reset', 'cancel', 'nested', 'overrun'] as const)(
  'preserves a seat-paused manager’s grant while other real processes run (%s)',
  async (mode) => {
    const nested = mode === 'nested' || mode === 'overrun'
    const overrun = mode === 'overrun'
    const directory = await mkdtemp(join(tmpdir(), 'seat-pause-'))
    const context = createFileRunContext(directory, { withDriver: true })
    // In memory: rewriting a file here let `select` parse its truncated, empty bytes.
    let available = false
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
    let paused!: () => void
    const waiting = new Promise<void>((resolve) => {
      paused = resolve
    })
    let finished = false
    let observedWorking: number | undefined
    let observedReserved: number | undefined
    const processWork = async (name: string, scope: Scope<unknown>, gate?: string) => {
      const result = await runSettledCommand({
        command: process.execPath,
        args: [
          '-e',
          `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(join(directory, name))}, 'executed'); ${gate === undefined ? '' : `const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(gate)})) clearInterval(timer) }, 10)`}`,
        ],
        cwd: directory,
        timeoutMs: 5000,
        signal: scope.signal,
      })
      if (result.exitCode !== 0) throw new Error(result.stderr)
      await scope.meter(measured)
      return name
    }
    const manager = driverChild(
      profile,
      {
        name: 'seat-manager',
        async act(task, scope) {
          await processWork('before-pause', scope)
          if (nested) {
            const child = driverChild(
              testAgentProfile('nested-process'),
              {
                name: 'nested-process',
                act: (_task, childScope) =>
                  processWork('nested', childScope, join(directory, 'release-nested')),
              },
              context.journal,
            )
            expect(
              scope.spawn(child, 'finish while parent waits', {
                budget: ceiling(overrun ? 60 : 30),
              }).ok,
            ).toBe(true)
            if (overrun)
              await scope.meter({
                ...measured,
                iterations: 0,
                tokens: { input: 40, output: 0 },
                usd: 4,
                resources: { io: { unit: 'bytes', amount: 0, known: true } },
              })
          }
          const session = new ManagerDriveSession(
            { backend: 'provider', provider },
            'seat-execution',
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
                rootId: 'seat-root',
                select: async () => {
                  if (!available) throw new SeatPauseError(new Date(Date.now() + 200).toISOString())
                  return { seat: 'local-seat', backend: { backend: 'provider', provider } }
                },
                onPause: async (_id, _at, phase) => {
                  if (phase === 'paused') paused()
                },
                onSegment: async () => {},
              },
              'seat-execution',
              Date.now,
            )
            return await processWork('after-reset', scope)
          } finally {
            await session.closeSeatSegment('completed')
          }
        },
      },
      context.journal,
    )
    const ceiling = (tokens: number) => ({
      maxTokens: tokens,
      maxIterations: tokens / 10,
      maxUsd: tokens / 10,
      resources: { io: { unit: 'bytes', limit: tokens / 10 } },
    })
    try {
      const result = await createSupervisor().run(
        {
          name: 'root',
          async act(_task, scope) {
            const admitted = scope.spawn(manager, 'wait for a seat', {
              key: 'manager',
              budget: ceiling(80),
            })
            expect(admitted.ok).toBe(true)
            if (!admitted.ok) throw new Error('manager refused')
            await waiting
            observedWorking = scope.workerCapacity.working
            observedReserved = scope.budget.reservedTokens
            expect(admitted.handle.status).toBe('queued')
            expect(scope.workerCapacity.working).toBe(nested ? 1 : 0)
            expect(scope.budget).toMatchObject({
              reservedTokens: overrun ? 60 : nested ? 30 : 0,
              tokensLeft: overrun ? 90 : nested ? 60 : 90,
              usdLeft: overrun ? 9 : nested ? 6 : 9,
            })
            expect(scope.budget.resources?.io).toMatchObject({
              reserved: overrun ? 6 : nested ? 3 : 0,
              committed: 1,
              remaining: overrun ? 13 : nested ? 6 : 9,
            })
            const sibling = driverChild(
              testAgentProfile('sibling'),
              {
                name: 'sibling',
                act: (_task, childScope) => processWork('sibling', childScope),
              },
              context.journal,
            )
            expect(
              scope.spawn(sibling, 'use released capacity', { key: 'sibling', budget: ceiling(60) })
                .ok,
            ).toBe(true)
            if (nested) {
              await expect
                .poll(() => readFile(join(directory, 'nested'), 'utf8').catch(() => undefined))
                .toBe('executed')
              await expect(readFile(join(directory, 'sibling'))).rejects.toMatchObject({
                code: 'ENOENT',
              })
              expect(scope.workerCapacity).toMatchObject({ working: 1, queued: 1 })
              if (overrun) {
                available = true
                await expect
                  .poll(() =>
                    readFile(join(directory, 'after-reset'), 'utf8').catch(() => undefined),
                  )
                  .toBe('executed')
                expect(scope.budget.reservedTokens).toBe(120)
              }
              await writeFile(join(directory, 'release-nested'), 'finish')
            }
            if (overrun) {
              const settlements = [await scope.next(), await scope.next()]
              expect(settlements.map((item) => item?.kind)).toEqual(['done', 'done'])
              expect(scope.budget).toMatchObject({ reservedTokens: 0, tokensLeft: 120 })
              expect(scope.budget.resources?.io).toMatchObject({
                reserved: 0,
                committed: 4,
                remaining: 16,
              })
              expect(scope.workerCapacity.working).toBe(0)
              finished = true
              return
            }
            const first = await scope.next()
            expect(first).toMatchObject({ kind: 'done', out: 'sibling' })
            expect(scope.budget.tokensLeft).toBe(overrun ? 130 : nested ? 70 : 80)
            if (mode === 'cancel') admitted.handle.abort('cancel while seat waits')
            else available = true
            expect(await scope.next()).toMatchObject(
              mode === 'cancel' ? { kind: 'down' } : { kind: 'done', out: 'after-reset' },
            )
            expect(scope.workerCapacity.working).toBe(0)
            expect(scope.budget.reservedTokens).toBe(0)
            finished = true
          },
        },
        null,
        {
          ...context,
          runId: 'seat-root',
          rootIdentity: {
            profileDigest: canonicalCandidateDigest({ name: 'root' }),
            taskDigest: canonicalCandidateDigest(null),
          },
          budget: { ...ceiling(overrun ? 200 : 100), deadlineMs: 5000 },
          workerSlots: 1,
        },
      )
      expect(observedWorking, JSON.stringify(result)).toBe(nested ? 1 : 0)
      expect(observedReserved).toBe(overrun ? 60 : nested ? 30 : 0)
      expect(finished, JSON.stringify(result)).toBe(true)
      const calls = nested ? 4 : mode === 'cancel' ? 2 : 3
      expect(result.spentTotal).toMatchObject({
        iterations: calls,
        tokens: { input: calls * 10 + (overrun ? 40 : 0), output: 0 },
        usd: calls + (overrun ? 4 : 0),
      })
      expect(result.spentTotal.resources?.io).toEqual({
        unit: 'bytes',
        amount: calls,
        known: true,
      })
      expect(await readFile(join(directory, 'sibling'), 'utf8')).toBe('executed')
      if (mode === 'cancel')
        await expect(readFile(join(directory, 'after-reset'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
      else expect(await readFile(join(directory, 'after-reset'), 'utf8')).toBe('executed')
      const events = (await context.journal.loadTree('seat-root'))!
      expect(
        events.some((event) => event.kind === 'admission-queued' && event.gate === 'seat'),
      ).toBe(true)
      const grants = events.filter(
        (event) => event.kind === 'admission-granted' && event.id === 'seat-root:s0',
      )
      expect(grants).toHaveLength(mode === 'cancel' ? 1 : 2)
      if (mode !== 'cancel')
        expect(grants[1]).toMatchObject({
          deadlineArmedAt: grants[0]!.deadlineArmedAt,
          deadlineAt: grants[0]!.deadlineAt,
        })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)
