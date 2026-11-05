import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import { materializeTreeView } from '../../src/durable/spawn-journal/tree-view'
import { runSettledCommand } from '../../src/mcp/worktree-harness'
import {
  createExecutorRegistry,
  createSupervisor,
  FileResultBlobStore,
  FileSpawnJournal,
  type Scope,
} from '../../src/runtime'
import {
  driverChild,
  driverExecutorFactory,
  withDriverExecutor,
} from '../../src/runtime/supervise/driver-executor'
import { registerRetainedExecutorPreparation } from '../../src/runtime/supervise/retained-executor'
import type { Agent, AgentSpec, ExecutorFactory } from '../../src/runtime/supervise/types'
import { testAgentProfile } from '../kernel/test-agent-profile'

it.each(['unfunded', 'slot-queued', 'cancel-queued'] as const)(
  'admits real process children against current funds and their grant deadline (%s)',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'child-admission-'))
    const path = join(directory, 'spawn-journal.jsonl')
    const journal = new FileSpawnJournal(path)
    const blobs = new FileResultBlobStore(join(directory, 'blobs'))
    const runId = `admission-${mode}`
    let factories = 0
    let completed = false
    const processChild = (name: string, delay: number) =>
      driverChild(
        testAgentProfile(name),
        {
          name,
          async act(_task, scope) {
            const result = await runSettledCommand({
              command: process.execPath,
              args: [
                '-e',
                `require('node:fs').writeFileSync(${JSON.stringify(join(directory, name))}, 'started'); setTimeout(() => process.stdout.write(${JSON.stringify(name)}), ${delay})`,
              ],
              cwd: directory,
              signal: scope.signal,
              timeoutMs: 5000,
            })
            if (result.exitCode !== 0) throw new Error(result.stderr)
            return result.stdout
          },
        },
        journal,
      )
    try {
      await createSupervisor().run(
        {
          name: 'parent',
          async act(_task, scope: Scope<unknown>) {
            const first = scope.spawn(processChild('first', 300), null, {
              key: 'first',
              budget: { maxTokens: 80, maxIterations: 3 },
            })
            expect(first.ok).toBe(true)
            const second = scope.spawn(
              () => {
                factories++
                return processChild('second', 30)
              },
              null,
              {
                key: 'second',
                budget: {
                  maxTokens: mode === 'unfunded' ? 60 : 10,
                  maxIterations: 3,
                  deadlineMs: 200,
                },
              },
            )
            if (mode === 'unfunded') {
              expect(second).toMatchObject({ ok: false, reason: 'budget-exhausted' })
              expect(factories).toBe(0)
            } else {
              expect(second.ok).toBe(true)
              if (!second.ok) throw new Error('funded child refused')
              expect(second.handle.status).toBe('queued')
              if (mode === 'cancel-queued') second.handle.abort('cancel before grant')
            }
            for (let settled = await scope.next(); settled; settled = await scope.next()) {
              expect(settled.kind).toBe(
                mode === 'cancel-queued' && settled.handle.id.endsWith(':s1') ? 'down' : 'done',
              )
            }
            completed = true
          },
        },
        null,
        {
          runId,
          journal,
          blobs,
          budget: { maxTokens: 100, maxIterations: 10, deadlineMs: 5000 },
          workerSlots: 1,
          deadlineCheckIn: false,
          executors: withDriverExecutor(createExecutorRegistry()),
        },
      )
      expect(completed).toBe(true)
      const events = (await new FileSpawnJournal(path).loadTree(runId))!
      expect(events.filter((event) => event.kind === 'spawned')).toHaveLength(
        mode === 'unfunded' ? 2 : 3,
      )
      if (mode === 'cancel-queued') {
        const id = events.find((event) => event.kind === 'spawned' && event.key === 'second')!.id
        expect(events.some((event) => event.kind === 'admission-queued' && event.id === id)).toBe(
          true,
        )
        expect(events.some((event) => event.kind === 'admission-granted' && event.id === id)).toBe(
          false,
        )
        expect(events.some((event) => event.kind === 'teardown-confirmed' && event.id === id)).toBe(
          true,
        )
        await expect(readFile(join(directory, 'second'))).rejects.toMatchObject({ code: 'ENOENT' })
      }
      if (mode === 'slot-queued') {
        const id = events.find((event) => event.kind === 'spawned' && event.key === 'second')!.id
        const queued = events.find((event) => event.kind === 'admission-queued' && event.id === id)
        const grant = events.find((event) => event.kind === 'admission-granted' && event.id === id)
        expect(queued).toMatchObject({ gate: 'slot' })
        expect(grant).toBeDefined()
        if (grant?.kind !== 'admission-granted') throw new Error('grant missing')
        expect(Date.parse(grant.at) - Date.parse(queued!.at)).toBeGreaterThan(200)
        expect(Date.parse(grant.deadlineAt!) - Date.parse(grant.deadlineArmedAt)).toBe(200)
        expect(materializeTreeView(events).nodes.find((node) => node.id === id)?.status).toBe(
          'done',
        )
        expect(await readFile(path, 'utf8')).toContain('admission-granted')
        const lines = (await readFile(path, 'utf8')).trim().split('\n')
        const boundary = lines.findIndex(
          (line) => line.includes('admission-granted') && line.includes(`"id":"${id}"`),
        )
        const copy = join(directory, 'grant-prefix.jsonl')
        await writeFile(copy, `${lines.slice(0, boundary + 1).join('\n')}\n`)
        await expect(
          new FileSpawnJournal(copy).appendEvent(runId, {
            ...grant,
            attemptId: `${grant.attemptId}-extended`,
            seq: grant.seq + 1,
            deadlineAt: new Date(Date.parse(grant.deadlineAt!) + 1).toISOString(),
          }),
        ).rejects.toThrow('admission deadline changed')
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

it('recovers an actual spawn-group crash prefix with its first full grant clock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pregrant-crash-'))
  const original = join(directory, 'original.jsonl')
  const recovered = join(directory, 'recovered.jsonl')
  let journal = new FileSpawnJournal(original)
  const blobs = new FileResultBlobStore(join(directory, 'blobs'))
  let phase = 'original'
  let recoveryFactory: ExecutorFactory<unknown>
  const child = (): Agent<unknown, unknown> =>
    driverChild(
      testAgentProfile('process'),
      {
        name: 'process',
        async act(_task, scope) {
          const result = await runSettledCommand({
            command: process.execPath,
            args: [
              '-e',
              `require('node:fs').writeFileSync(${JSON.stringify(join(directory, 'executed-'))} + ${JSON.stringify(phase)}, 'started')`,
            ],
            cwd: directory,
            signal: scope.signal,
            timeoutMs: 5000,
          })
          if (result.exitCode !== 0) throw new Error(result.stderr)
          return phase
        },
      },
      journal,
      undefined,
      undefined,
      recoveryFactory,
    )
  recoveryFactory = registerRetainedExecutorPreparation(
    () => {
      throw new Error('no leaf should execute')
    },
    () => ({
      spec: (child() as Agent<unknown, unknown> & { executorSpec: AgentSpec }).executorSpec,
      factory: driverExecutorFactory,
    }),
  )
  const common = {
    runId: 'pregrant-root',
    blobs,
    budget: { maxTokens: 100, maxIterations: 10, deadlineMs: 5000 },
    workerSlots: 1,
    deadlineCheckIn: false as const,
    executors: withDriverExecutor(createExecutorRegistry()),
    rootIdentity: {
      profileDigest: canonicalCandidateDigest({ name: 'root' }),
      taskDigest: canonicalCandidateDigest('task'),
    },
  }
  try {
    const initial = await createSupervisor().run(
      {
        name: 'root',
        async act(_task, scope) {
          expect(
            scope.spawn(child(), 'same task', {
              key: 'child',
              budget: { maxTokens: 20, maxIterations: 3, deadlineMs: 150 },
            }).ok,
          ).toBe(true)
          expect((await scope.next())?.kind).toBe('done')
          return 'initial'
        },
      },
      'task',
      { ...common, journal },
    )
    expect(initial.kind, JSON.stringify(initial)).toBe('winner')
    const lines = (await readFile(original, 'utf8')).trim().split('\n')
    const boundary = lines.findIndex(
      (line) => line.includes('"parent":"pregrant-root"') && line.includes('"kind":"spawned"'),
    )
    expect(boundary).toBeGreaterThanOrEqual(0)
    await writeFile(recovered, `${lines.slice(0, boundary + 1).join('\n')}\n`)
    journal = new FileSpawnJournal(recovered)
    const prefix = (await journal.loadTree(common.runId))!
    const spawned = prefix.find(
      (event) => event.kind === 'spawned' && event.parent === common.runId,
    )!
    expect(
      prefix.some((event) => event.kind === 'execution-input' && event.id === spawned.id),
    ).toBe(true)
    expect(
      prefix.some((event) => event.kind === 'admission-granted' && event.id === spawned.id),
    ).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 200))
    phase = 'recovered'
    let observed: unknown
    await createSupervisor().run(
      {
        name: 'root',
        async act(_task, scope) {
          observed = await scope.next()
        },
      },
      'task',
      { ...common, journal, resume: true, recoverExecutor: recoveryFactory },
    )
    expect(observed, JSON.stringify(observed)).toMatchObject({ kind: 'done', out: 'recovered' })
    expect(await readFile(join(directory, 'executed-recovered'), 'utf8')).toBe('started')
    const events = (await journal.loadTree(common.runId))!
    const grant = events.find(
      (event) => event.kind === 'admission-granted' && event.id === spawned.id,
    )
    expect(grant?.kind).toBe('admission-granted')
    if (grant?.kind !== 'admission-granted') throw new Error('recovered grant missing')
    expect(Date.parse(grant.deadlineArmedAt) - Date.parse(spawned.at)).toBeGreaterThan(150)
    expect(Date.parse(grant.deadlineAt!) - Date.parse(grant.deadlineArmedAt)).toBe(150)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
