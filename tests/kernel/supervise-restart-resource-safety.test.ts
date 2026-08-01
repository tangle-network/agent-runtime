import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  NodeExecutionIdentity,
  Scope,
  SpawnEvent,
  SpawnJournal,
  Spend,
  UsageEvent,
} from '../../src/runtime/supervise/types'

const zeroSpend: Spend = {
  iterations: 0,
  tokens: { input: 0, output: 0 },
  usd: 0,
  ms: 0,
}

describe('supervision restart and resource safety', () => {
  it('snapshots the root task, budget, and identity before delayed journal intake', async () => {
    const base = new InMemorySpawnJournal()
    const beginEntered = deferred()
    const releaseBegin = deferred()
    const journal: SpawnJournal = {
      loadTree: (root) => base.loadTree(root),
      async beginTree(root, at) {
        beginEntered.resolve()
        await releaseBegin.promise
        return base.beginTree(root, at)
      },
      appendEvent: (root, event) => base.appendEvent(root, event),
    }
    const task = { instruction: 'AUTHORIZED' }
    const budget = { maxIterations: 1, maxTokens: 10 }
    const expectedIdentity = {
      profileDigest: canonicalCandidateDigest({ name: 'root-profile' }),
      taskDigest: canonicalCandidateDigest({ instruction: 'AUTHORIZED' }),
    }
    const rootIdentity = { ...expectedIdentity }
    let rootObservation:
      | { instruction: string; frozen: boolean; tokensLeft: number; tokensKnown: boolean }
      | undefined
    const running = createSupervisor<typeof task, string>().run(
      {
        name: 'root',
        act: async (authorizedTask, scope) => {
          rootObservation = {
            instruction: authorizedTask.instruction,
            frozen: Object.isFrozen(authorizedTask),
            tokensLeft: scope.budget.tokensLeft,
            tokensKnown: scope.budget.tokensKnown,
          }
          return authorizedTask.instruction
        },
      },
      task,
      {
        budget,
        rootIdentity,
        runId: 'immutable-root-input',
        journal,
        blobs: new InMemoryResultBlobStore(),
        executors: createExecutorRegistry(),
      },
    )

    await beginEntered.promise
    task.instruction = 'MUTATED'
    budget.maxTokens = 100
    rootIdentity.taskDigest = canonicalCandidateDigest({ instruction: 'MUTATED' })
    releaseBegin.resolve()

    const result = await running
    const events = (await base.loadTree('immutable-root-input')) ?? []
    const rootEvent = events.find((event) => event.kind === 'spawned' && event.parent === undefined)

    expect(result.kind).toBe('winner')
    if (result.kind !== 'winner') return
    expect(result.out).toBe('AUTHORIZED')
    expect(rootObservation).toEqual({
      instruction: 'AUTHORIZED',
      frozen: true,
      tokensLeft: 10,
      tokensKnown: true,
    })
    expect(rootEvent).toMatchObject({
      budget: { maxIterations: 1, maxTokens: 10 },
      identity: expectedIdentity,
    })
    expect(Object.isFrozen(rootEvent?.budget)).toBe(true)
    expect(rootEvent?.identity?.taskDigest).toBe(
      canonicalCandidateDigest({ instruction: 'AUTHORIZED' }),
    )
  })

  it('refuses malformed fresh root identities before journaling or acting', async () => {
    const validProfile = canonicalCandidateDigest({ name: 'root-profile' })
    const validTask = canonicalCandidateDigest({ instruction: 'AUTHORIZED' })
    const cases: ReadonlyArray<readonly [string, NodeExecutionIdentity]> = [
      ['profile digest', { profileDigest: 'sha256:invalid', taskDigest: validTask }],
      ['task digest', { profileDigest: validProfile, taskDigest: 'sha256:invalid' }],
      [
        'candidate digest',
        {
          profileDigest: validProfile,
          taskDigest: validTask,
          candidateDigest: 'sha256:invalid',
        },
      ],
      [
        'correlation',
        {
          profileDigest: validProfile,
          taskDigest: validTask,
          correlation: { worker: '' },
        },
      ],
      [
        'unknown field',
        {
          profileDigest: validProfile,
          taskDigest: validTask,
          injected: true,
        } as NodeExecutionIdentity,
      ],
    ]

    for (const [label, rootIdentity] of cases) {
      const base = new InMemorySpawnJournal()
      let loads = 0
      let begins = 0
      let appends = 0
      let acts = 0
      const journal: SpawnJournal = {
        async loadTree(root) {
          loads += 1
          return base.loadTree(root)
        },
        async beginTree(root, at) {
          begins += 1
          return base.beginTree(root, at)
        },
        async appendEvent(root, event) {
          appends += 1
          return base.appendEvent(root, event)
        },
      }

      await expect(
        createSupervisor<unknown, string>().run(
          {
            name: 'root',
            act: async () => {
              acts += 1
              return 'unsafe'
            },
          },
          'task',
          {
            budget: { maxIterations: 1, maxTokens: 10 },
            rootIdentity,
            runId: `malformed-root-${label}`,
            journal,
            blobs: new InMemoryResultBlobStore(),
            executors: createExecutorRegistry(),
          },
        ),
        label,
      ).rejects.toThrow(/requires an exact rootIdentity/)
      expect({ acts, loads, begins, appends }, label).toEqual({
        acts: 0,
        loads: 0,
        begins: 0,
        appends: 0,
      })
    }
  })

  it('classifies exhausted iterations without rejecting a valid zero-work winner', async () => {
    let factoryCalls = 0
    let spawnReason: string | undefined
    const exhausted = await createSupervisor<unknown, string | undefined>().run(
      {
        name: 'iteration-exhausted-root',
        act: async (task, scope) => {
          const spawned = scope.spawn(
            () => {
              factoryCalls += 1
              return resultLeaf('must-not-run', zeroSpend)
            },
            task,
            {
              budget: { maxIterations: 1, maxTokens: 1 },
              label: 'must-not-run',
            },
          )
          if (!spawned.ok) spawnReason = spawned.reason
          return undefined
        },
      },
      'task',
      {
        budget: { maxIterations: 0, maxTokens: 10 },
        runId: 'iteration-exhausted-root',
        journal: new InMemorySpawnJournal(),
        blobs: new InMemoryResultBlobStore(),
        executors: createExecutorRegistry(),
      },
    )

    expect(exhausted).toMatchObject({ kind: 'no-winner', reason: 'budget-exhausted' })
    expect(spawnReason).toBe('budget-exhausted')
    expect(factoryCalls).toBe(0)

    const valid = await createSupervisor<unknown, string>().run(
      { name: 'zero-work-root', act: async () => 'valid zero-work result' },
      'task',
      {
        budget: { maxIterations: 0, maxTokens: 10 },
        runId: 'valid-zero-work-root',
        journal: new InMemorySpawnJournal(),
        blobs: new InMemoryResultBlobStore(),
        executors: createExecutorRegistry(),
      },
    )
    expect(valid).toMatchObject({ kind: 'winner', out: 'valid zero-work result' })
  })

  it('executes the immutable task snapshot whose digest was authorized', async () => {
    let executorSaw: unknown
    let taskWasFrozen = false
    const leaf = leafFromExecutor('task-snapshot', () => ({
      runtime: 'router',
      async execute(task): Promise<ExecutorResult<string>> {
        executorSaw = (task as { instruction: string }).instruction
        taskWasFrozen = Object.isFrozen(task)
        return { outRef: 'internal', out: String(executorSaw), spent: zeroSpend }
      },
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => ({ outRef: 'internal', out: String(executorSaw), spent: zeroSpend }),
    }))
    const root: Agent<unknown, { digest?: string; out?: string }> = {
      name: 'root',
      async act(_task, scope) {
        const childTask = { instruction: 'AUTHORIZED' }
        const expectedDigest = canonicalCandidateDigest(childTask)
        const spawned = scope.spawn(leaf, childTask, {
          key: 'task-snapshot',
          budget: { maxIterations: 1, maxTokens: 2 },
          label: 'task-snapshot',
        })
        expect(spawned.ok).toBe(true)
        childTask.instruction = 'MUTATED'
        const settled = await scope.next()
        return {
          digest: spawned.ok ? spawned.handle.identity?.taskDigest : undefined,
          out: settled?.kind === 'done' ? settled.out : undefined,
        }
      },
    }

    const result = await createSupervisor<unknown, { digest?: string; out?: string }>().run(
      root,
      'task',
      {
        budget: { maxIterations: 1, maxTokens: 2 },
        runId: 'immutable-task-snapshot',
        journal: new InMemorySpawnJournal(),
        blobs: new InMemoryResultBlobStore(),
        executors: createExecutorRegistry(),
      },
    )

    expect(result.kind).toBe('winner')
    if (result.kind !== 'winner') return
    expect(result.out).toEqual({
      digest: canonicalCandidateDigest({ instruction: 'AUTHORIZED' }),
      out: 'AUTHORIZED',
    })
    expect(executorSaw).toBe('AUTHORIZED')
    expect(taskWasFrozen).toBe(true)
  })

  it('does not let a caller mutate a driver allocation after it was reserved', async () => {
    const journal = new InMemorySpawnJournal()
    let leafExecutions = 0
    const costlyLeaf = leafFromExecutor('costly-leaf', () => ({
      runtime: 'router',
      async execute(): Promise<ExecutorResult<string>> {
        leafExecutions += 1
        return {
          outRef: 'internal',
          out: 'costly',
          spent: { ...zeroSpend, tokens: { input: 50, output: 0 } },
        }
      },
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => ({
        outRef: 'internal',
        out: 'costly',
        spent: { ...zeroSpend, tokens: { input: 50, output: 0 } },
      }),
    }))
    const nested: Agent<unknown, string> = {
      name: 'nested',
      async act(task, scope): Promise<string> {
        const child = scope.spawn(costlyLeaf, task, {
          budget: { maxIterations: 1, maxTokens: 50 },
          label: 'costly-leaf',
        })
        if (!child.ok) return child.reason
        await scope.next()
        return 'accepted'
      },
    }
    const root: Agent<unknown, string> = {
      name: 'root',
      async act(task, scope): Promise<string> {
        const allocation = { maxIterations: 1, maxTokens: 10 }
        const manager = scope.spawn(
          driverChild(
            { name: 'nested-manager', harness: 'cli-base', metadata: { role: 'driver' } },
            nested,
            journal,
          ),
          task,
          { budget: allocation, label: 'nested-manager' },
        )
        expect(manager.ok).toBe(true)
        allocation.maxTokens = 100
        const settled = await scope.next()
        return settled?.kind === 'done' ? String(settled.out) : 'manager-down'
      },
    }

    const result = await createSupervisor<unknown, string>().run(root, 'task', {
      budget: { maxIterations: 1, maxTokens: 10 },
      maxDepth: 2,
      runId: 'immutable-driver-budget',
      journal,
      blobs: new InMemoryResultBlobStore(),
      executors: withDriverExecutor(createExecutorRegistry()),
    })

    expect(result.kind).toBe('winner')
    if (result.kind !== 'winner') return
    expect(result.out).toBe('budget-exhausted')
    expect(leafExecutions).toBe(0)
    expect(result.spentTotal.tokens).toEqual({ input: 0, output: 0 })
  })

  it('refuses a resumed root whose profile/task/candidate identity changed', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const executors = createExecutorRegistry()
    const budget = { maxIterations: 2, maxTokens: 100 }
    const firstIdentity = {
      profileDigest: `sha256:${'1'.repeat(64)}`,
      taskDigest: `sha256:${'2'.repeat(64)}`,
    }
    const secondIdentity = {
      profileDigest: `sha256:${'3'.repeat(64)}`,
      taskDigest: `sha256:${'4'.repeat(64)}`,
    }
    await createSupervisor<unknown, string>().run(
      { name: 'root-a', act: async () => 'A' },
      'task A',
      {
        budget,
        rootIdentity: firstIdentity,
        runId: 'resume-identity',
        journal,
        blobs,
        executors,
        resume: true,
      },
    )
    let secondActs = 0
    await expect(
      createSupervisor<unknown, string>().run(
        {
          name: 'root-b',
          act: async () => {
            secondActs += 1
            return 'B'
          },
        },
        'task B',
        {
          budget,
          rootIdentity: secondIdentity,
          runId: 'resume-identity',
          journal,
          blobs,
          executors,
          resume: true,
        },
      ),
    ).rejects.toThrow(/resume identity mismatch/)
    expect(secondActs).toBe(0)
  })

  it('refuses resume without an exact root identity before reading, mutating, or acting', async () => {
    const base = new InMemorySpawnJournal()
    let loads = 0
    let begins = 0
    let appends = 0
    const journal: SpawnJournal = {
      async loadTree(root) {
        loads += 1
        return base.loadTree(root)
      },
      async beginTree(root, at) {
        begins += 1
        return base.beginTree(root, at)
      },
      async appendEvent(root, event) {
        appends += 1
        return base.appendEvent(root, event)
      },
    }
    let acts = 0

    await expect(
      createSupervisor<unknown, string>().run(
        {
          name: 'unsafe-root',
          act: async () => {
            acts += 1
            return 'unsafe'
          },
        },
        'unsafe task',
        {
          budget: { maxIterations: 1, maxTokens: 10 },
          runId: 'missing-root-identity',
          journal,
          blobs: new InMemoryResultBlobStore(),
          executors: createExecutorRegistry(),
          resume: true,
        },
      ),
    ).rejects.toThrow(/requires an exact rootIdentity/)

    await expect(
      createSupervisor<unknown, string>().run(
        {
          name: 'partial-root',
          act: async () => {
            acts += 1
            return 'partial'
          },
        },
        'partial task',
        {
          budget: { maxIterations: 1, maxTokens: 10 },
          rootIdentity: { profileDigest: `sha256:${'4'.repeat(64)}` as const },
          runId: 'partial-root-identity',
          journal,
          blobs: new InMemoryResultBlobStore(),
          executors: createExecutorRegistry(),
          resume: true,
        },
      ),
    ).rejects.toThrow(/requires an exact rootIdentity/)

    expect({ acts, loads, begins, appends }).toEqual({ acts: 0, loads: 0, begins: 0, appends: 0 })
  })

  it('does not let an omitted identity bypass a changed root and task on the same run id', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const executors = createExecutorRegistry()
    const runId = 'omitted-resume-identity'
    const rootIdentity = {
      profileDigest: `sha256:${'5'.repeat(64)}` as const,
      taskDigest: `sha256:${'6'.repeat(64)}` as const,
    }
    let firstActs = 0
    await createSupervisor<unknown, string>().run(
      {
        name: 'root-a',
        act: async () => {
          firstActs += 1
          return 'A'
        },
      },
      'task A',
      {
        budget: { maxIterations: 1, maxTokens: 10 },
        rootIdentity,
        runId,
        journal,
        blobs,
        executors,
        resume: true,
      },
    )
    const before = await journal.loadTree(runId)
    let secondActs = 0

    await expect(
      createSupervisor<unknown, string>().run(
        {
          name: 'root-b',
          act: async () => {
            secondActs += 1
            return 'B'
          },
        },
        'task B',
        {
          budget: { maxIterations: 1, maxTokens: 10 },
          runId,
          journal,
          blobs,
          executors,
          resume: true,
        },
      ),
    ).rejects.toThrow(/requires an exact rootIdentity/)

    expect(firstActs).toBe(1)
    expect(secondActs).toBe(0)
    expect(await journal.loadTree(runId)).toEqual(before)
  })

  it('does not execute a child until its identity event is committed', async () => {
    const base = new InMemorySpawnJournal()
    const releaseCommit = deferred()
    const journal: SpawnJournal = {
      loadTree: (root) => base.loadTree(root),
      beginTree: (root, at) => base.beginTree(root, at),
      async appendEvent(root, event): Promise<void> {
        if (event.kind === 'spawned' && event.parent !== undefined) {
          await releaseCommit.promise
        }
        await base.appendEvent(root, event)
      },
    }
    let executions = 0
    let executionsBeforeCommit = -1
    const leaf = leafFromExecutor('commit-first', () => ({
      runtime: 'router',
      async execute(): Promise<ExecutorResult<string>> {
        executions += 1
        return { outRef: 'internal', out: 'done', spent: zeroSpend }
      },
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => ({ outRef: 'internal', out: 'done', spent: zeroSpend }),
    }))
    const result = await createSupervisor<unknown, string>().run(
      {
        name: 'root',
        async act(task, scope): Promise<string> {
          const spawned = scope.spawn(leaf, task, {
            budget: { maxIterations: 1, maxTokens: 10 },
            label: 'commit-first',
          })
          expect(spawned.ok).toBe(true)
          await Promise.resolve()
          executionsBeforeCommit = executions
          releaseCommit.resolve()
          await scope.next()
          return 'root result'
        },
      },
      'task',
      {
        budget: { maxIterations: 1, maxTokens: 10 },
        runId: 'commit-before-execute',
        journal,
        blobs: new InMemoryResultBlobStore(),
        executors: createExecutorRegistry(),
      },
    )
    expect(result.kind).toBe('winner')
    expect(executionsBeforeCommit).toBe(0)
    expect(executions).toBe(1)
  })

  it('restores prior spend and the original absolute deadline when a root resumes', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const executors = createExecutorRegistry()
    const runId = 'resume-root-limits'
    const rootIdentity = {
      profileDigest: `sha256:${'7'.repeat(64)}` as const,
      taskDigest: `sha256:${'8'.repeat(64)}` as const,
    }
    let nowMs = 1_000

    const firstRoot: Agent<unknown, string> = {
      name: 'first-root',
      async act(task, scope): Promise<string> {
        const spawned = scope.spawn(
          resultLeaf('prior-work', {
            iterations: 1,
            tokens: { input: 80, output: 0 },
            usd: 0,
            ms: 1,
          }),
          task,
          {
            budget: { maxIterations: 1, maxTokens: 100 },
            label: 'prior-work',
          },
        )
        expect(spawned.ok).toBe(true)
        expect((await scope.next())?.kind).toBe('done')
        return 'first result'
      },
    }

    const first = await createSupervisor<unknown, string>().run(firstRoot, 'task', {
      budget: { maxIterations: 2, maxTokens: 100, deadlineMs: 100 },
      rootIdentity,
      runId,
      journal,
      blobs,
      executors,
      now: () => nowMs,
    })
    expect(first.kind).toBe('winner')

    nowMs = 1_090
    let factoryCalls = 0
    let observed:
      | {
          tokensLeft: number
          tokensKnown: boolean
          deadlineMs: number
          attempt: ReturnType<Scope<string>['spawn']>
        }
      | undefined
    const resumedRoot: Agent<unknown, string> = {
      name: 'resumed-root',
      act(task, scope): Promise<string> {
        const before = scope.budget
        const attempt = scope.spawn(
          () => {
            factoryCalls += 1
            return resultLeaf('must-not-run', zeroSpend)
          },
          task,
          {
            budget: { maxIterations: 1, maxTokens: 21 },
            label: 'must-not-run',
          },
        )
        observed = {
          tokensLeft: before.tokensLeft,
          tokensKnown: before.tokensKnown,
          deadlineMs: before.deadlineMs,
          attempt,
        }
        return Promise.resolve('resumed result')
      },
    }

    const resumed = await createSupervisor<unknown, string>().run(resumedRoot, 'task', {
      budget: { maxIterations: 2, maxTokens: 100, deadlineMs: 100 },
      rootIdentity,
      runId,
      journal,
      blobs,
      executors,
      resume: true,
      now: () => nowMs,
    })

    expect(resumed.kind).toBe('winner')
    expect(observed).toMatchObject({
      tokensLeft: 20,
      tokensKnown: true,
      deadlineMs: 1_100,
      attempt: { ok: false, reason: 'budget-exhausted' },
    })
    expect(factoryCalls).toBe(0)
    expect(resumed.spentTotal).toMatchObject({
      iterations: 1,
      tokens: { input: 80, output: 0 },
    })
  })

  it('anchors a fresh deadline before delayed beginTree and preserves it exactly on resume', async () => {
    const base = new InMemorySpawnJournal()
    let nowMs = 4_000
    const journal: SpawnJournal = {
      loadTree: (root) => base.loadTree(root),
      async beginTree(root, at) {
        nowMs += 75
        await Promise.resolve()
        return base.beginTree(root, at)
      },
      appendEvent: (root, event) => base.appendEvent(root, event),
    }
    const budget = { maxIterations: 1, maxTokens: 10, deadlineMs: 100 }
    const rootIdentity = {
      profileDigest: `sha256:${'9'.repeat(64)}` as const,
      taskDigest: `sha256:${'a'.repeat(64)}` as const,
    }
    let firstDeadline = 0
    const first = await createSupervisor<unknown, string>().run(
      {
        name: 'root',
        act: async (_task, scope) => {
          firstDeadline = scope.budget.deadlineMs
          return 'first'
        },
      },
      'task',
      {
        budget,
        rootIdentity,
        runId: 'delayed-begin-deadline',
        journal,
        blobs: new InMemoryResultBlobStore(),
        executors: createExecutorRegistry(),
        now: () => nowMs,
      },
    )
    expect(first.kind).toBe('winner')
    expect(firstDeadline).toBe(4_100)

    nowMs = 4_090
    let resumedDeadline = 0
    const resumed = await createSupervisor<unknown, string>().run(
      {
        name: 'root',
        act: async (_task, scope) => {
          resumedDeadline = scope.budget.deadlineMs
          return 'resumed'
        },
      },
      'task',
      {
        budget,
        rootIdentity,
        runId: 'delayed-begin-deadline',
        journal,
        blobs: new InMemoryResultBlobStore(),
        executors: createExecutorRegistry(),
        resume: true,
        now: () => nowMs,
      },
    )

    expect(resumed.kind).toBe('winner')
    expect(resumedDeadline).toBe(firstDeadline)
    expect(resumedDeadline).toBe(4_100)
  })

  it('does not settle a nested driver or refund its allocation while a descendant is live', async () => {
    const baseJournal = new InMemorySpawnJournal()
    const records: Array<{ root: string; event: SpawnEvent }> = []
    const journal: SpawnJournal = {
      loadTree: (root) => baseJournal.loadTree(root),
      beginTree: (root, at) => baseJournal.beginTree(root, at),
      async appendEvent(root, event): Promise<void> {
        await baseJournal.appendEvent(root, event)
        records.push({ root, event })
      },
    }
    const runId = 'nested-join-barrier'
    const activity = { live: 0, peak: 0 }
    const descendantStarted = deferred()
    const descendantExited = deferred()
    let releaseDescendant: (() => void) | undefined

    const descendant = leafFromExecutor('descendant', () => {
      const artifact: ExecutorResult<string> = {
        outRef: 'internal:descendant',
        out: 'descendant result',
        spent: zeroSpend,
      }
      return {
        runtime: 'router',
        execute(_task, signal): Promise<ExecutorResult<string>> {
          enter(activity)
          descendantStarted.resolve()
          return new Promise((resolve) => {
            let finished = false
            const finish = () => {
              if (finished) return
              finished = true
              signal.removeEventListener('abort', finish)
              leave(activity)
              descendantExited.resolve()
              resolve(artifact)
            }
            releaseDescendant = finish
            if (signal.aborted) finish()
            else signal.addEventListener('abort', finish, { once: true })
          })
        },
        teardown: async () => ({ destroyed: true }),
        resultArtifact: () => artifact,
      }
    })
    const nestedDriver: Agent<unknown, string> = {
      name: 'nested-driver',
      async act(task, scope): Promise<string> {
        const spawned = scope.spawn(descendant, task, {
          budget: { maxIterations: 1, maxTokens: 100 },
          label: 'descendant',
        })
        expect(spawned.ok).toBe(true)
        await descendantStarted.promise
        return 'manager result'
      },
    }
    const second = trackedImmediateLeaf('second', activity)
    const root: Agent<unknown, unknown> = {
      name: 'root',
      async act(task, scope): Promise<unknown> {
        const manager = scope.spawn(
          driverChild(
            { name: 'manager', harness: 'cli-base', metadata: { role: 'driver' } },
            nestedDriver,
            journal,
          ),
          task,
          {
            budget: { maxIterations: 1, maxTokens: 100 },
            label: 'manager',
          },
        )
        expect(manager.ok).toBe(true)
        const managerSettled = await scope.next()
        const activeAfterManager = activity.live
        const nestedTerminalBeforeManager = records.some(
          ({ root: tree, event }) => tree !== runId && event.kind === 'settled',
        )
        const secondSpawn = scope.spawn(second, task, {
          budget: { maxIterations: 1, maxTokens: 100 },
          label: 'second',
        })
        const secondSettled = secondSpawn.ok ? await scope.next() : null
        return {
          managerKind: managerSettled?.kind,
          activeAfterManager,
          nestedTerminalBeforeManager,
          secondAccepted: secondSpawn.ok,
          secondKind: secondSettled?.kind,
        }
      },
    }

    const result = await createSupervisor<unknown, unknown>().run(root, 'task', {
      budget: { maxIterations: 1, maxTokens: 100 },
      maxLiveWorkers: 2,
      maxDepth: 3,
      runId,
      journal,
      blobs: new InMemoryResultBlobStore(),
      executors: withDriverExecutor(createExecutorRegistry()),
    })
    const liveAtReturn = activity.live
    releaseDescendant?.()
    await descendantExited.promise

    expect(result.kind).toBe('winner')
    if (result.kind !== 'winner') return
    expect(result.out).toEqual({
      managerKind: 'done',
      activeAfterManager: 0,
      nestedTerminalBeforeManager: true,
      secondAccepted: true,
      secondKind: 'done',
    })
    expect(activity.peak).toBe(1)
    expect(liveAtReturn).toBe(0)
    expect(result.tree.inFlight).toBe(0)
  })

  it('settles after its deadline even when an executor ignores AbortSignal', async () => {
    let teardownCalls = 0
    const ignoring = leafFromExecutor('ignores-abort', () => ({
      runtime: 'router',
      execute: () => new Promise<ExecutorResult<string>>(() => {}),
      async teardown(): Promise<{ destroyed: boolean }> {
        teardownCalls += 1
        return { destroyed: true }
      },
      resultArtifact(): ExecutorResult<string> {
        throw new Error('an executor that never settled has no result artifact')
      },
    }))
    const root: Agent<unknown, string> = {
      name: 'deadline-root',
      async act(task, scope): Promise<string> {
        const spawned = scope.spawn(ignoring, task, {
          budget: { maxIterations: 1, maxTokens: 10 },
          label: 'ignores-abort',
        })
        expect(spawned.ok).toBe(true)
        const settled = await scope.next()
        if (settled?.kind === 'down') throw new Error(settled.reason)
        return settled?.out ?? 'missing result'
      },
    }

    const running = createSupervisor<unknown, string>().run(root, 'task', {
      budget: { maxIterations: 1, maxTokens: 10, deadlineMs: 15 },
      runId: 'ignores-abort-deadline',
      journal: new InMemorySpawnJournal(),
      blobs: new InMemoryResultBlobStore(),
      executors: createExecutorRegistry(),
    })
    const outcome = await settleWithin(running, 250)

    expect(outcome.settled).toBe(true)
    if (!outcome.settled) return
    expect(outcome.value).toMatchObject({
      kind: 'no-winner',
      reason: 'budget-exhausted',
      tree: { inFlight: 0 },
    })
    expect(teardownCalls).toBe(1)
  })

  it('settles after its deadline even when executor teardown never acknowledges', async () => {
    let teardownCalls = 0
    const ignoring = leafFromExecutor('ignores-teardown', () => ({
      runtime: 'router',
      execute: () => new Promise<ExecutorResult<string>>(() => {}),
      teardown(): Promise<{ destroyed: boolean }> {
        teardownCalls += 1
        return new Promise(() => {})
      },
      resultArtifact(): ExecutorResult<string> {
        throw new Error('an executor that never settled has no result artifact')
      },
    }))
    const root: Agent<unknown, string> = {
      name: 'teardown-deadline-root',
      async act(task, scope): Promise<string> {
        const spawned = scope.spawn(ignoring, task, {
          budget: { maxIterations: 1, maxTokens: 10 },
          label: 'ignores-teardown',
        })
        expect(spawned.ok).toBe(true)
        const settled = await scope.next()
        if (settled?.kind === 'down') throw new Error(settled.reason)
        return settled?.out ?? 'missing result'
      },
    }

    const running = createSupervisor<unknown, string>().run(root, 'task', {
      budget: { maxIterations: 1, maxTokens: 10, deadlineMs: 15 },
      runId: 'ignores-teardown-deadline',
      journal: new InMemorySpawnJournal(),
      blobs: new InMemoryResultBlobStore(),
      executors: createExecutorRegistry(),
    })
    const outcome = await settleWithin(running, 750)

    expect(outcome.settled).toBe(true)
    if (!outcome.settled) return
    expect(outcome.value).toMatchObject({
      kind: 'no-winner',
      reason: 'budget-exhausted',
      tree: { inFlight: 0 },
    })
    expect(teardownCalls).toBe(1)
  })

  it('turns unknown accounting from a crashing nested driver into a terminal down node', async () => {
    const journal = new InMemorySpawnJournal()
    const metered = deferred()
    const nestedDriver: Agent<unknown, string> = {
      name: 'unknown-accounting-driver',
      async act(_task, scope): Promise<string> {
        try {
          await scope.meter({
            iterations: 1,
            tokens: { input: 0, output: 0 },
            tokensKnown: false,
            usd: 0,
            ms: 1,
          })
        } finally {
          metered.resolve()
        }
        throw new Error('nested driver crashed')
      },
    }
    const root: Agent<unknown, string> = {
      name: 'root',
      async act(task, scope): Promise<string> {
        const spawned = scope.spawn(
          driverChild(
            { name: 'unknown-manager', harness: 'cli-base', metadata: { role: 'driver' } },
            nestedDriver,
            journal,
          ),
          task,
          {
            budget: { maxIterations: 2, maxTokens: 10 },
            label: 'unknown-manager',
          },
        )
        expect(spawned.ok).toBe(true)
        await metered.promise
        return 'root result'
      },
    }
    const runId = 'unknown-nested-accounting'

    const result = await createSupervisor<unknown, string>().run(root, 'task', {
      budget: { maxIterations: 2, maxTokens: 10 },
      maxLiveWorkers: 1,
      maxDepth: 2,
      runId,
      journal,
      blobs: new InMemoryResultBlobStore(),
      executors: withDriverExecutor(createExecutorRegistry()),
    })
    const events = (await journal.loadTree(runId)) ?? []
    const manager = result.tree.nodes.find((node) => node.label === 'unknown-manager')

    expect(result.kind).toBe('winner')
    expect(result.tree.inFlight).toBe(0)
    expect(manager?.status).toBe('failed')
    expect(
      events.some(
        (event) => event.kind === 'settled' && event.id === manager?.id && event.status === 'down',
      ),
    ).toBe(true)
    expect(
      events.some(
        (event) =>
          event.kind === 'metered' && event.id === manager?.id && event.spend.tokensKnown === false,
      ),
    ).toBe(true)
    expect(result.spentTotal.tokensKnown).toBe(false)
  })

  it('fails closed after a streaming provider crashes without terminal accounting', async () => {
    let replacementExecutions = 0
    const crashed = leafFromExecutor('crashed-stream', () => ({
      runtime: 'router',
      async *execute(): AsyncIterable<UsageEvent> {
        yield { kind: 'iteration' }
        yield { kind: 'tokens', input: 1, output: 0 }
        yield { kind: 'cost', usd: 0.1 }
        throw new Error('network died')
      },
      teardown: async () => ({ destroyed: true }),
      resultArtifact(): ExecutorResult<string> {
        throw new Error('a crashed stream has no terminal artifact')
      },
    }))
    const replacement = leafFromExecutor('replacement', () => ({
      runtime: 'router',
      async execute(): Promise<ExecutorResult<string>> {
        replacementExecutions += 1
        return { outRef: 'internal', out: 'replacement', spent: zeroSpend }
      },
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => ({ outRef: 'internal', out: 'replacement', spent: zeroSpend }),
    }))

    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(task, scope): Promise<unknown> {
          const first = scope.spawn(crashed, task, {
            budget: { maxIterations: 1, maxTokens: 100, maxUsd: 1 },
            label: 'crashed-stream',
          })
          expect(first.ok).toBe(true)
          const down = await scope.next()
          const second = scope.spawn(replacement, task, {
            budget: { maxIterations: 1, maxTokens: 99, maxUsd: 1 },
            label: 'replacement',
          })
          return { downKind: down?.kind, second }
        },
      },
      'task',
      {
        budget: { maxIterations: 2, maxTokens: 199, maxUsd: 2 },
        runId: 'stream-crash-unknown-accounting',
        journal: new InMemorySpawnJournal(),
        blobs: new InMemoryResultBlobStore(),
        executors: createExecutorRegistry(),
      },
    )

    expect(result.kind).toBe('winner')
    if (result.kind !== 'winner') return
    expect(result.out).toEqual({
      downKind: 'down',
      second: { ok: false, reason: 'budget-exhausted' },
    })
    expect(replacementExecutions).toBe(0)
    expect(result.spentTotal).toMatchObject({
      iterations: 1,
      tokens: { input: 1, output: 0 },
      tokensKnown: false,
      usd: 0.1,
      usdKnown: false,
    })
  })

  it('admits a budget-exempt executor, reconciles it at zero, and refunds its reservation', async () => {
    let exemptExecutions = 0
    let exemptTeardowns = 0
    let measuredExecutions = 0
    const exempt = leafFromExecutor('subscription-cli', () => ({
      runtime: 'cli',
      budgetExempt: true,
      async execute(): Promise<ExecutorResult<string>> {
        exemptExecutions += 1
        return { outRef: 'internal', out: 'unmeasured', spent: zeroSpend }
      },
      async teardown(): Promise<{ destroyed: boolean }> {
        exemptTeardowns += 1
        return { destroyed: true }
      },
      resultArtifact(): ExecutorResult<string> {
        throw new Error('an unmetered executor must never produce a supervised artifact')
      },
    }))
    const measured = leafFromExecutor('measured', () => ({
      runtime: 'router',
      async execute(): Promise<ExecutorResult<string>> {
        measuredExecutions += 1
        return {
          outRef: 'internal',
          out: 'measured',
          spent: { ...zeroSpend, iterations: 1, tokens: { input: 1, output: 0 } },
        }
      },
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => ({
        outRef: 'internal',
        out: 'measured',
        spent: { ...zeroSpend, iterations: 1, tokens: { input: 1, output: 0 } },
      }),
    }))

    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(task, scope): Promise<unknown> {
          const first = scope.spawn(exempt, task, {
            budget: { maxIterations: 1, maxTokens: 10 },
            label: 'subscription-cli',
          })
          expect(first.ok).toBe(true)
          const exemptSettled = await scope.next()
          // The exempt worker reconciled at ZERO by contract, so its whole reservation refunded
          // and the measured worker's reservation still fits the same conserved pool.
          const second = scope.spawn(measured, task, {
            budget: { maxIterations: 1, maxTokens: 10 },
            label: 'measured',
          })
          expect(second.ok).toBe(true)
          const accepted = await scope.next()
          return {
            exempt: exemptSettled?.kind === 'done' ? exemptSettled.out : 'not settled',
            accepted: accepted?.kind === 'done' ? accepted.out : 'not accepted',
          }
        },
      },
      'task',
      {
        budget: { maxIterations: 1, maxTokens: 10 },
        runId: 'refuse-unmetered-executor',
        journal: new InMemorySpawnJournal(),
        blobs: new InMemoryResultBlobStore(),
        executors: createExecutorRegistry(),
      },
    )

    expect(result.kind).toBe('winner')
    if (result.kind !== 'winner') return
    expect(result.out).toEqual({
      exempt: 'unmeasured',
      accepted: 'measured',
    })
    expect(exemptExecutions).toBe(1)
    expect(exemptTeardowns).toBe(1)
    expect(measuredExecutions).toBe(1)
    expect(result.spentTotal).toMatchObject({
      iterations: 1,
      tokens: { input: 1, output: 0 },
      usd: 0,
    })
  })
})

function resultLeaf(name: string, spent: Spend): Agent<unknown, string> {
  return leafFromExecutor(name, () => {
    const artifact: ExecutorResult<string> = {
      outRef: `internal:${name}`,
      out: `${name} result`,
      spent,
    }
    return {
      runtime: 'router',
      execute: async () => artifact,
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => artifact,
    }
  })
}

function trackedImmediateLeaf(
  name: string,
  activity: { live: number; peak: number },
): Agent<unknown, string> {
  return leafFromExecutor(name, () => {
    const artifact: ExecutorResult<string> = {
      outRef: `internal:${name}`,
      out: `${name} result`,
      spent: zeroSpend,
    }
    return {
      runtime: 'router',
      async execute(): Promise<ExecutorResult<string>> {
        enter(activity)
        try {
          await Promise.resolve()
          return artifact
        } finally {
          leave(activity)
        }
      },
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => artifact,
    }
  })
}

function leafFromExecutor<Out>(
  name: string,
  makeExecutor: () => Executor<Out>,
): Agent<unknown, Out> {
  const executor = makeExecutor()
  const spec: AgentSpec = {
    profile: { name } as AgentProfile,
    harness: null,
    executor: executor as Executor<unknown>,
  }
  return { name, act: async () => undefined as Out, executorSpec: spec } as Agent<unknown, Out> & {
    executorSpec: AgentSpec
  }
}

function enter(activity: { live: number; peak: number }): void {
  activity.live += 1
  activity.peak = Math.max(activity.peak, activity.live)
}

function leave(activity: { live: number }): void {
  activity.live -= 1
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ settled: true; value: T } | { settled: false }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ settled: false }), timeoutMs)
    void promise.then(
      (value) => {
        clearTimeout(timer)
        resolve({ settled: true, value })
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
