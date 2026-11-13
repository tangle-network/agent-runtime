import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { FileObserverJournal } from '../../src/durable/observer-journal'
import { runSettledCommand } from '../../src/mcp/worktree-harness'
import { createExecutorRegistry, FileResultBlobStore, FileSpawnJournal } from '../../src/runtime'
import { type BudgetReadout, createBudgetPool } from '../../src/runtime/supervise/budget'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import { createScope } from '../../src/runtime/supervise/scope-construction'
import type { Agent, AgentSpec, Executor } from '../../src/runtime/supervise/types'
import { zeroSpend } from '../../src/runtime/util'
import { composeRuntimeHooks } from '../../src/runtime-hooks'
import { testAgentProfile } from '../kernel/test-agent-profile'

interface SettlementPayload {
  childId?: string
  budget?: BudgetReadout
  settledAt?: number
}

it.each([
  { name: 'known completion', known: true, fail: false },
  { name: 'known failure', known: true, fail: true },
  { name: 'unknown usage', known: false, fail: false },
])(
  'persists post-refresh budget at a nested $name boundary',
  async ({ known, fail }) => {
    const directory = await mkdtemp(join(tmpdir(), 'settlement-budget-'))
    const root = 'settlement-budget'
    const spawnPath = join(directory, 'spawn.jsonl')
    const observerPath = join(directory, 'observer.jsonl')
    const journal = new FileSpawnJournal(spawnPath)
    const observer = new FileObserverJournal(observerPath, root)
    // Independent construction cap, never inferred from the observation being checked.
    const cap = 1000
    const pool = createBudgetPool({ maxTokens: cap, maxIterations: 20 }, Date.now())
    const rootReservation = pool.reserve(
      { maxTokens: 50, maxIterations: 1 },
      { label: 'root inference', childId: root, stage: 'executing' },
    )
    if (!rootReservation.ok) throw new Error('root reservation refused')
    await journal.beginTree(root, new Date().toISOString())
    let directorId: string | undefined
    let parentAtLeaf: BudgetReadout | undefined
    let siblingEntered = false
    let leafDelivered = false
    let finishSibling!: () => void
    const siblingHeld = new Promise<void>((resolve) => {
      finishSibling = resolve
    })
    let finishDirector!: () => void
    const directorHeld = new Promise<void>((resolve) => {
      finishDirector = resolve
    })
    const scope = createScope<unknown>({
      parentId: root,
      root,
      pool,
      journal,
      blobs: new FileResultBlobStore(join(directory, 'blobs')),
      executors: withDriverExecutor(createExecutorRegistry()),
      seams: {},
      depth: 0,
      signal: new AbortController().signal,
      hooks: composeRuntimeHooks(observer.hooks(), {
        onEvent(event) {
          if (event.target === 'agent.child' && event.parentId === directorId) {
            // A second independent oracle for ordering: the outer lease must already
            // include this leaf when its inner settlement hook becomes observable.
            parentAtLeaf = pool.readout()
          }
        },
      }),
    })
    const sibling = driverChild(
      testAgentProfile('sibling'),
      {
        name: 'sibling',
        async act() {
          siblingEntered = true
          await siblingHeld
          return 'sibling complete'
        },
      },
      journal,
    )
    let nativeSpend = zeroSpend()
    const leafExecutor: Executor<string> = {
      runtime: 'native-command',
      async execute(_task, signal) {
        const result = await runSettledCommand({
          command: process.execPath,
          args: [
            '-e',
            fail
              ? 'process.stderr.write("native result rejected"); process.exitCode = 7'
              : 'process.stdout.write("native result")',
          ],
          cwd: directory,
          timeoutMs: 5000,
          signal,
        })
        nativeSpend = {
          ...zeroSpend(),
          tokens: { input: 10, output: 0, freshInput: 10, cacheRead: 0, cacheWrite: 0 },
          tokensKnown: known,
          usdKnown: known,
          iterations: 1,
        }
        if (result.exitCode !== 0) throw new Error(result.stderr)
        return { out: result.stdout, outRef: 'native-result', spent: nativeSpend }
      },
      accounting: () => ({ reported: nativeSpend, reservation: nativeSpend }),
      teardown: async () => ({ destroyed: true }),
    }
    const leaf: Agent<null, string> & { executorSpec: AgentSpec } = {
      name: 'process-leaf',
      async act() {
        throw new Error('native executor must run')
      },
      executorSpec: {
        profile: testAgentProfile('process-leaf'),
        harness: null,
        executor: leafExecutor,
      },
    }
    const director = driverChild(
      testAgentProfile('director'),
      {
        name: 'director',
        async act(_task, directorScope) {
          const spawned = directorScope.spawn(leaf, null, {
            label: 'process leaf',
            budget: { maxTokens: 100, maxIterations: 2 },
          })
          if (!spawned.ok) throw new Error(`leaf refused: ${spawned.reason}`)
          await directorScope.next()
          leafDelivered = true
          await directorHeld
          if (fail) throw new Error('director rejected the native result')
          return 'director complete'
        },
      },
      journal,
    )
    try {
      const runningSibling = scope.spawn(sibling, null, {
        label: 'sibling',
        budget: { maxTokens: 200, maxIterations: 3 },
      })
      if (!runningSibling.ok) throw new Error(`sibling refused: ${runningSibling.reason}`)
      const runningDirector = scope.spawn(director, null, {
        label: 'director',
        budget: { maxTokens: 300, maxIterations: 4 },
      })
      if (!runningDirector.ok) throw new Error(`director refused: ${runningDirector.reason}`)
      directorId = runningDirector.handle.id
      await expect.poll(() => siblingEntered && leafDelivered, { timeout: 10_000 }).toBe(true)
      expect(parentAtLeaf).toBeDefined()
      expect(parentAtLeaf?.tokensKnown).toBe(known)
      if (known) expect(parentAtLeaf?.committedTokens).toBe(10)

      finishDirector()
      const settled = await scope.next()
      expect(settled?.handle.id).toBe(directorId)
      await observer.read() // Acknowledge existing observer I/O before opening a cold reader.
      const reopened = await FileObserverJournal.open(observerPath)
      if (!reopened) throw new Error('observer journal did not persist')
      const rows = await reopened.read()
      const observation = rows.find(
        (row) =>
          row.event?.target === 'agent.child' &&
          row.event.parentId === root &&
          (row.event.payload as SettlementPayload | undefined)?.childId === directorId,
      )
      const event = observation?.event
      expect(event).toBeDefined()
      const payload = event?.payload as SettlementPayload | undefined
      const budget = payload?.budget
      expect(budget).toBeDefined()
      expect(budget?.tokensKnown).toBe(known)
      expect(budget?.usdKnown).toBe(known)
      expect(budget?.reservedTokens).toBe(250)
      expect(pool.openReservations().map((entry) => entry.label).sort()).toEqual([
        'root inference',
        'sibling',
      ])
      if (known) {
        expect(budget).toMatchObject({ tokensLeft: 740, committedTokens: 10 })
        expect(budget!.tokensLeft + budget!.reservedTokens + budget!.committedTokens!).toBe(cap)
      }
      const terminal = ((await new FileSpawnJournal(spawnPath).loadTree(root)) ?? []).find(
        (record) => record.kind === 'settled' && record.id === directorId,
      )
      expect(terminal).toBeDefined()
      expect(event?.runId).toBe(root)
      expect(event?.stepIndex).toBe(terminal?.seq)
      expect(event!.timestamp).toBeGreaterThanOrEqual(Date.parse(terminal!.at))
      expect(payload?.settledAt).toBe(Date.parse(terminal!.at))
      finishSibling()
      await scope.next()
      pool.reconcile(rootReservation.ticket, zeroSpend())
      const afterRefund = (await reopened.read()).find((row) => row.event?.id === event?.id)
      expect(afterRefund?.digest).toBe(observation?.digest)
      pool.assertNoOpenTickets()
    } finally {
      finishDirector()
      finishSibling()
      while (await scope.next()) {
        // Drain admitted execution on every assertion exit.
      }
      if (pool.openReservations().some((entry) => entry.ticketId === rootReservation.ticket.id)) {
        pool.reconcile(rootReservation.ticket, zeroSpend())
      }
      await rm(directory, { recursive: true, force: true })
    }
  },
  30_000,
)
