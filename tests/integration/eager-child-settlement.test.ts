import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { replaySpawnTree } from '../../src/durable/spawn-journal/replay'
import { runSettledCommand } from '../../src/mcp/worktree-harness'
import {
  createExecutorRegistry,
  createSupervisor,
  FileResultBlobStore,
  FileSpawnJournal,
  loadSpawnForest,
  type Scope,
} from '../../src/runtime'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import { testAgentProfile } from '../kernel/test-agent-profile'

it.each(['done', 'down'] as const)(
  'commits a real process child %s before its manager reads the settlement',
  async (kind) => {
    const directory = await mkdtemp(join(tmpdir(), 'eager-settlement-'))
    const journalPath = join(directory, 'spawn-journal.jsonl')
    const journal = new FileSpawnJournal(journalPath)
    const blobs = new FileResultBlobStore(join(directory, 'blobs'))
    const root = `eager-${kind}`
    let publishScope!: (scope: Scope<unknown>) => void
    const ready = new Promise<Scope<unknown>>((resolve) => {
      publishScope = resolve
    })
    let finishManager!: () => void
    const heldManager = new Promise<void>((resolve) => {
      finishManager = resolve
    })
    const child = driverChild(
      testAgentProfile('process-child'),
      {
        name: 'process-child',
        async act(_task, scope) {
          const result = await runSettledCommand({
            command: process.execPath,
            args: [
              '-e',
              kind === 'done'
                ? 'process.stdout.write("checked local result")'
                : 'process.stderr.write("immutable local failure"); process.exitCode = 7',
            ],
            cwd: directory,
            timeoutMs: 5000,
            signal: scope.signal,
          })
          await scope.meter({
            iterations: 1,
            tokens: { input: 0, output: 0 },
            tokensKnown: true,
            usd: 0,
            usdKnown: true,
            ms: 0,
          })
          if (result.exitCode !== 0) throw new Error(result.stderr)
          return result.stdout
        },
      },
      journal,
    )
    const running = createSupervisor<unknown, unknown>().run(
      {
        name: 'manager',
        async act(_task, scope) {
          const spawned = scope.spawn(child, null, {
            label: 'process-child',
            key: 'one-process',
            budget: { maxTokens: 100, maxIterations: 3 },
          })
          if (!spawned.ok) throw new Error(`spawn refused: ${spawned.reason}`)
          publishScope(scope)
          await heldManager
          let output: unknown
          for (let settlement = await scope.next(); settlement; settlement = await scope.next()) {
            if (settlement.kind === 'done') output = settlement.out
          }
          return output
        },
      },
      null,
      {
        runId: root,
        journal,
        blobs,
        budget: { maxTokens: 1000, maxIterations: 10 },
        workerSlots: 1,
        executors: withDriverExecutor(createExecutorRegistry()),
      },
    )
    try {
      const scope = await ready
      await expect
        .poll(
          () =>
            scope.observeTree().nodes.find((node) => node.label === 'process-child')
              ?.settlementPending?.kind,
          { timeout: 5000 },
        )
        .toBe(kind)
      expect(scope.workerCapacity.working).toBe(0)
      const id = scope.observeTree().nodes.find((entry) => entry.label === 'process-child')!.id
      const coldJournal = new FileSpawnJournal(journalPath)
      await expect
        .poll(
          async () =>
            ((await coldJournal.loadTree(root)) ?? []).filter(
              (event) => event.kind === 'settled' && event.id === id,
            ).length,
          { timeout: 2000 },
        )
        .toBe(1)
      const node = scope.observeTree().nodes.find((entry) => entry.id === id)!
      const events = (await coldJournal.loadTree(root)) ?? []
      const terminal = events.filter((event) => event.kind === 'settled' && event.id === node.id)
      expect(terminal).toHaveLength(1)
      expect(terminal[0]).toMatchObject({ status: kind, seq: 0 })
      expect(node).toMatchObject({
        status: kind === 'done' ? 'done' : 'failed',
        settlementPending: { kind },
      })
      if (kind === 'down') expect(node.failure).toBeDefined()
      expect(scope.budget.reservedTokens).toBe(0)
      const replayed = await replaySpawnTree(coldJournal, blobs, root)
      expect(replayed).toHaveLength(1)
      expect(replayed[0]).toMatchObject({ kind, seq: 0 })
      const delivered = await Promise.all([scope.next(), scope.next()])
      expect(delivered.filter(Boolean)).toHaveLength(1)
      expect(delivered.find(Boolean)).toMatchObject({ kind, seq: 0 })
      expect(await scope.nextResolved()).toBeNull()
      expect(scope.observeTree().nodes.find((entry) => entry.id === node.id)).not.toHaveProperty(
        'settlementPending',
      )
      expect(
        ((await coldJournal.loadTree(root)) ?? []).filter(
          (event) => event.kind === 'settled' && event.id === node.id,
        ),
      ).toEqual(terminal)
    } finally {
      finishManager()
      await running
      await rm(directory, { recursive: true, force: true })
    }
  },
)

it('lets an admitted process finish after its manager returns', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manager-child-join-'))
  const journal = new FileSpawnJournal(join(directory, 'spawn-journal.jsonl'))
  const blobs = new FileResultBlobStore(join(directory, 'blobs'))
  const root = 'manager-child-join'
  const worker = driverChild(
    testAgentProfile('working-process'),
    {
      name: 'working-process',
      async act(_task, scope) {
        const result = await runSettledCommand({
          command: process.execPath,
          args: [
            '-e',
            'const fs=require("node:fs");fs.writeFileSync("entered", "yes");' +
              'setTimeout(()=>{fs.writeFileSync("finished", "checked output");},500)',
          ],
          cwd: directory,
          timeoutMs: 5000,
          signal: scope.signal,
        })
        if (result.exitCode !== 0) throw new Error(result.stderr)
        return 'checked output'
      },
    },
    journal,
  )
  const manager = driverChild(
    testAgentProfile('returning-manager'),
    {
      name: 'returning-manager',
      async act(_task, scope) {
        const spawned = scope.spawn(worker, null, {
          label: 'working-process',
          budget: { maxTokens: 10, maxIterations: 1 },
        })
        if (!spawned.ok) throw new Error(`worker refused: ${spawned.reason}`)
        await expect.poll(() => existsSync(join(directory, 'entered'))).toBe(true)
        return 'manager returned while its child was working'
      },
    },
    journal,
  )
  try {
    await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          const spawned = scope.spawn(manager, null, {
            label: 'returning-manager',
            budget: { maxTokens: 100, maxIterations: 3 },
          })
          if (!spawned.ok) throw new Error(`manager refused: ${spawned.reason}`)
          const settled = await scope.next()
          expect(settled?.kind).toBe('done')
          return settled?.kind === 'done' ? settled.out : null
        },
      },
      null,
      {
        runId: root,
        journal,
        blobs,
        workerSlots: 1,
        budget: { maxTokens: 1000, maxIterations: 10 },
        executors: withDriverExecutor(createExecutorRegistry()),
      },
    )
    expect(await readFile(join(directory, 'finished'), 'utf8')).toBe('checked output')
    const forest = await loadSpawnForest(journal, root)
    expect(forest.nodes.find((node) => node.label === 'working-process')).toMatchObject({
      status: 'done',
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
