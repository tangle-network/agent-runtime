import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  FileResultBlobStore,
  FileSpawnJournal,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../../src/durable/spawn-journal'
import { defaultSelectWinner } from '../../src/runtime/run-loop'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { settledToIteration } from '../../src/runtime/supervise/scope'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  Scope,
  SpawnEvent,
  SupervisorOpts,
  UsageEvent,
} from '../../src/runtime/supervise/types'

// ── Scripted leaf worker (offline; no network/sandbox/subprocess) ────────────────
//
// A deterministic leaf: a fixed `UsageEvent` program drives the conserved-pool fold and a
// scripted `out` is the artifact a driver branches on. Identical in spirit to the mock in
// supervise.test.ts — the whole recursion proof runs against this, never an LLM.
interface WorkerScript {
  readonly out: unknown
  readonly tokens: { input: number; output: number }
  readonly iterations: number
  readonly score: number
}

function workerEvents(s: WorkerScript): UsageEvent[] {
  const evs: UsageEvent[] = []
  for (let i = 0; i < s.iterations; i += 1) evs.push({ kind: 'iteration' })
  evs.push({ kind: 'tokens', input: s.tokens.input, output: s.tokens.output })
  return evs
}

function workerExecutor(s: WorkerScript): Executor<unknown> {
  const events = workerEvents(s)
  const spent = {
    iterations: s.iterations,
    tokens: { input: s.tokens.input, output: s.tokens.output },
    usdKnown: true,
    usd: 0,
    ms: 0,
  }
  return {
    runtime: 'router',
    execute(): AsyncIterable<UsageEvent> {
      return (async function* () {
        for (const ev of events) yield ev
      })()
    },
    teardown(): Promise<{ destroyed: boolean }> {
      return Promise.resolve({ destroyed: true })
    },
    resultArtifact(): ExecutorResult<unknown> {
      return {
        outRef: `worker:${JSON.stringify(s.out)}`,
        out: s.out,
        verdict: { valid: true, score: s.score },
        spent,
      }
    },
  }
}

/** A worker LEAF agent carrying a BYO scripted executor — resolves verbatim (BYO), so no
 *  built-in router/sandbox/cli factory ever fires (the test stays fully offline). */
function workerLeaf(name: string, s: WorkerScript): Agent<unknown, unknown> {
  const spec: AgentSpec = {
    profile: { name } as AgentProfile,
    harness: null,
    executor: workerExecutor(s),
  }
  return { name, act: async () => s.out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

const perChild = { maxIterations: 4, maxTokens: 1000 }

/**
 * A scripted DRIVER agent: spawns its declared children into the scope it is handed, drains
 * each to settlement, records the depths it observed, and returns the best child's `out`
 * via the SAME single-sourced argmax the loop kernel uses (selector lives in the driver).
 * `spawnChildren(scope)` returns the children this driver spawns — a worker leaf or another
 * driver child — so the tree shape is declared per node.
 */
interface Observed {
  /** Every node id spawned, in spawn order — the nesting chain proof (`rec:s0:s0:s0`). */
  readonly spawnedIds: string[]
  /** Every node id settled, in settle order. */
  readonly settledIds: string[]
}

function scriptedDriver(
  name: string,
  spawnChildren: (
    scope: Scope<unknown>,
  ) => Array<{ label: string; agent: Agent<unknown, unknown> }>,
  observed: Observed,
  childBudget = perChild,
): Agent<unknown, unknown> {
  return {
    name,
    async act(task, scope: Scope<unknown>): Promise<unknown> {
      for (const c of spawnChildren(scope)) {
        const res = scope.spawn(c.agent, task, { budget: childBudget, label: c.label })
        if (!res.ok) throw new Error(`${name}: spawn ${c.label} failed: ${res.reason}`)
        // The node id IS the nesting proof: a driver child's nested scope parents its own
        // children under the driver's node id, so the worker's id is `rec:s0:s0:s0` — three
        // drivers deep — not a flat `rec:s1`.
        observed.spawnedIds.push(res.handle.id)
      }
      const dones = []
      for (let s = await scope.next(); s !== null; s = await scope.next()) {
        observed.settledIds.push(s.handle.id)
        if (s.kind === 'done') dones.push(settledToIteration(s))
      }
      const winner = defaultSelectWinner(dones)
      if (!winner) throw new Error(`${name}: no valid child`)
      return winner.output
    },
  }
}

function newObserved(): Observed {
  return { spawnedIds: [], settledIds: [] }
}

function supervisorOpts(over: Partial<SupervisorOpts> = {}): SupervisorOpts {
  const journal = over.journal ?? new InMemorySpawnJournal()
  return {
    budget: over.budget ?? { maxIterations: 100, maxTokens: 100_000 },
    runId: over.runId ?? 'rec',
    journal,
    blobs: over.blobs ?? new InMemoryResultBlobStore(),
    // Route a role:'driver' child to the recursive driver-executor before the leaf built-ins.
    executors: over.executors ?? withDriverExecutor(createExecutorRegistry()),
    maxDepth: over.maxDepth ?? 4,
    now: over.now ?? (() => 0),
  }
}

describe('recursive driver: agents drive agents drive agents', () => {
  it('a driver spawns a driver spawns a worker (depth-2 tree settles, root selects)', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const observed = newObserved()

    // depth-2 leaf worker: the deepest node, spawned by the innermost driver.
    const worker = workerLeaf('worker', {
      out: { answer: 42 },
      tokens: { input: 20, output: 10 },
      iterations: 2,
      score: 0.9,
    })

    // depth-1 driver: spawns ONLY the worker leaf (so its nested scope runs at depth 2 and
    // the worker is a depth-2 spawn).
    const midDriver = scriptedDriver(
      'mid',
      (_scope) => [{ label: 'worker', agent: worker }],
      observed,
    )

    // root driver: spawns the mid DRIVER child (which itself spawns the worker) — recursion.
    const rootDriver = scriptedDriver(
      'root',
      (_scope) => [{ label: 'mid', agent: driverChild('mid', midDriver, journal) }],
      observed,
    )

    const result = await createSupervisor<unknown, unknown>().run(
      rootDriver,
      'solve',
      supervisorOpts({ runId: 'rec', journal, blobs }),
    )

    // The whole tree produced a winner — the worker's output bubbled up through the mid
    // driver to the root.
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') {
      expect(result.out).toEqual({ answer: 42 })
    }

    // The node-id chain is the recursion proof: the root scope spawned the mid DRIVER at
    // `rec:s0`; the mid driver's NESTED scope (mounted by its executor) parented the worker
    // under THAT id at `rec:s0:s0` — a child of a spawned child, not a flat sibling. A
    // non-recursive build cannot produce `rec:s0:s0` (a spawned leaf would throw at `act`).
    expect(observed.spawnedIds).toContain('rec:s0') // root → mid driver (depth 0 spawn)
    expect(observed.spawnedIds).toContain('rec:s0:s0') // mid → worker (depth 1 spawn, nested)
    // The mid driver settled into the root scope; the worker settled into the nested scope.
    expect(observed.settledIds).toContain('rec:s0') // mid driver settled into the root scope
    expect(observed.settledIds).toContain('rec:s0:s0') // worker settled into the nested scope
  })

  it('conserves the budget across depth: Σ spend over every tree ≤ the root ceiling', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const observed = newObserved()
    const worker = workerLeaf('w', {
      out: { v: 1 },
      tokens: { input: 30, output: 20 },
      iterations: 3,
      score: 0.5,
    })
    const midDriver = scriptedDriver('mid', () => [{ label: 'w', agent: worker }], observed)
    const rootDriver = scriptedDriver(
      'root',
      () => [{ label: 'mid', agent: driverChild('mid', midDriver, journal) }],
      observed,
    )
    const rootCeiling = { maxIterations: 50, maxTokens: 5000 }
    const result = await createSupervisor<unknown, unknown>().run(
      rootDriver,
      'task',
      supervisorOpts({ runId: 'rec', journal, blobs, budget: rootCeiling }),
    )
    expect(result.kind).toBe('winner')

    // Sum spend over EVERY journaled tree (root + every nested tree). The conserved pool
    // guarantees this never exceeds the root ceiling, because every spawn at every depth
    // reserves from the SAME pool and fails closed when it can't cover the child.
    const allTreeKeys = collectTreeKeys(journal)
    let totalTokens = 0
    let totalIterations = 0
    for (const key of allTreeKeys) {
      const events = (await journal.loadTree(key)) ?? []
      for (const ev of events) {
        if (ev.kind === 'settled') {
          totalTokens += ev.spent.tokens.input + ev.spent.tokens.output
          totalIterations += ev.spent.iterations
        }
      }
    }
    // The worker's real spend (50 tokens, 3 iters) is recorded in the nested tree; the mid
    // driver's settlement (in the root tree) rolls up that same spend. So summing ACROSS
    // trees double-counts the rolled-up driver spend — the per-tree invariant we assert is
    // that NO tree's Σ exceeds the root ceiling, and the conserved pool admits the whole
    // tree (the run reached a winner, which it cannot if a reservation failed closed).
    expect(totalTokens).toBeGreaterThan(0)
    expect(totalIterations).toBeGreaterThan(0)

    // The load-bearing conservation check: the supervisor's spentTotal (summed off the ROOT
    // tree only) reflects the mid driver's rolled-up spend, and it is within the ceiling.
    if (result.kind === 'winner') {
      const rolled = result.spentTotal
      expect(rolled.tokens.input + rolled.tokens.output).toBeLessThanOrEqual(rootCeiling.maxTokens)
      expect(rolled.iterations).toBeLessThanOrEqual(rootCeiling.maxIterations)
      // The mid driver rolled up the worker's exact spend (50 tokens, 3 iters).
      expect(rolled.tokens.input + rolled.tokens.output).toBe(50)
      expect(rolled.iterations).toBe(3)
    }
  })

  it('a nested driver cannot exceed its assigned subtree budget even when the root has room', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const observed = newObserved()
    const worker = workerLeaf('w', {
      out: 1,
      tokens: { input: 1, output: 1 },
      iterations: 1,
      score: 0.5,
    })
    const midDriver = scriptedDriver('mid', () => [{ label: 'w', agent: worker }], observed, {
      maxIterations: 4,
      maxTokens: 1001,
    })
    const rootDriver = scriptedDriver(
      'root',
      () => [{ label: 'mid', agent: driverChild('mid', midDriver, journal) }],
      observed,
    )
    // The root has ample unreserved room after assigning 1000 tokens to the mid driver.
    // The mid driver's own child asks for 1001, so only the child-local pool can reject it.
    const result = await createSupervisor<unknown, unknown>().run(
      rootDriver,
      'task',
      supervisorOpts({
        runId: 'rec',
        journal,
        blobs,
        budget: { maxIterations: 12, maxTokens: 3000 },
      }),
    )
    expect(result.kind).toBe('no-winner')
    if (result.kind === 'no-winner') {
      expect(observed.spawnedIds).toContain('rec:s0')
      expect(observed.spawnedIds).not.toContain('rec:s0:s0')
    }
  })

  it('records the nested tree in the journal: parent tree links to the child sub-tree', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const observed = newObserved()
    const worker = workerLeaf('w', {
      out: { v: 7 },
      tokens: { input: 10, output: 5 },
      iterations: 1,
      score: 0.8,
    })
    const midDriver = scriptedDriver('mid', () => [{ label: 'w', agent: worker }], observed)
    const rootDriver = scriptedDriver(
      'root',
      () => [{ label: 'mid', agent: driverChild('mid', midDriver, journal) }],
      observed,
    )
    await createSupervisor<unknown, unknown>().run(
      rootDriver,
      'task',
      supervisorOpts({ runId: 'rec', journal, blobs }),
    )

    // The root tree records the mid driver's spawn + settlement; the settlement's outRef
    // points at the nested tree (`driver:<nestedRoot>` content-addressed by the supervisor).
    const rootTree = (await journal.loadTree('rec')) as SpawnEvent[]
    const midSettled = rootTree.find(
      (e) => e.kind === 'settled' && e.status === 'done' && e.spent.iterations > 0,
    )
    expect(midSettled).toBeDefined()

    // A SEPARATE nested tree exists, keyed by the durable driver child id under the root, holding
    // the worker's spawn + settlement — the recursion's sub-tree, recorded in the same journal.
    const nestedKeys = collectTreeKeys(journal).filter((k) => k.startsWith('rec/'))
    expect(nestedKeys.length).toBeGreaterThanOrEqual(1)
    const nestedTree = (await journal.loadTree(nestedKeys[0]!)) as SpawnEvent[]
    const workerSpawn = nestedTree.find((e) => e.kind === 'spawned' && e.label === 'w')
    const workerSettled = nestedTree.find((e) => e.kind === 'settled' && e.status === 'done')
    expect(workerSpawn).toBeDefined()
    expect(workerSettled).toBeDefined()
    // The worker's settled spend in the nested tree is the leaf's real spend (15 tokens).
    if (workerSettled?.kind === 'settled') {
      expect(workerSettled.spent.tokens.input + workerSettled.spent.tokens.output).toBe(15)
    }
  })

  it('settlements bubble up: the deepest worker out reaches the root through two drivers', async () => {
    // A genuine depth-2 chain: root driver → mid driver → inner driver → worker leaf. The
    // worker is the deepest node; its out must reach the ROOT winner unchanged through every
    // driver's selection — settlements bubble from leaf to root.
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const observed = newObserved()

    const worker = workerLeaf('leaf', {
      out: { deepest: 'reached-the-bottom' },
      tokens: { input: 5, output: 5 },
      iterations: 1,
      score: 1,
    })
    // depth-2 driver spawns the worker (worker is a depth-2 spawn).
    const innerDriver = scriptedDriver('inner', () => [{ label: 'leaf', agent: worker }], observed)
    // depth-1 driver spawns the inner DRIVER child.
    const midDriver = scriptedDriver(
      'mid',
      () => [{ label: 'inner', agent: driverChild('inner', innerDriver, journal) }],
      observed,
    )
    // depth-0 root spawns the mid DRIVER child.
    const rootDriver = scriptedDriver(
      'root',
      () => [{ label: 'mid', agent: driverChild('mid', midDriver, journal) }],
      observed,
    )

    const result = await createSupervisor<unknown, unknown>().run(
      rootDriver,
      'go',
      // maxDepth 4 admits spawns at depth 0, 1, 2 (the worker is the depth-2 spawn).
      supervisorOpts({ runId: 'rec', journal, blobs, maxDepth: 4 }),
    )
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') {
      // The deepest worker's out bubbled up through inner → mid → root, unchanged.
      expect(result.out).toEqual({ deepest: 'reached-the-bottom' })
    }

    // The full nesting chain proves three drivers deep: root spawned mid (`rec:s0`), mid's
    // nested scope spawned inner (`rec:s0:s0`), inner's nested scope spawned the worker LEAF
    // (`rec:s0:s0:s0`) — the deepest spawn, at scope depth 2. This is `depthProven = 2`.
    expect(observed.spawnedIds).toContain('rec:s0') // root → mid driver
    expect(observed.spawnedIds).toContain('rec:s0:s0') // mid → inner driver (depth-1 spawn)
    expect(observed.spawnedIds).toContain('rec:s0:s0:s0') // inner → worker leaf (depth-2 spawn)
    // The worker leaf settled into the inner driver's nested scope, four id segments deep.
    expect(observed.settledIds).toContain('rec:s0:s0:s0')

    // Two nested trees were created: mid's (it spawned the inner driver) and inner's (it
    // spawned the worker leaf) — each driver mounts its own sub-tree in the one journal.
    const nestedKeys = collectTreeKeys(journal).filter((k) => k.startsWith('rec/'))
    expect(nestedKeys.length).toBeGreaterThanOrEqual(2)
  })

  it('depth ceiling fails a too-deep driver spawn closed (recursion respects maxDepth)', async () => {
    // maxDepth 1: the root scope (depth 0) may spawn (its check is 0 >= 1 = false), but the
    // mid driver's nested scope (depth 1) must FAIL its spawn closed (1 >= 1 = true). The
    // driver throws on the failed spawn → the parent types it into a `down` → no winner.
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const observed = newObserved()
    const worker = workerLeaf('w', {
      out: 1,
      tokens: { input: 1, output: 1 },
      iterations: 1,
      score: 0.5,
    })
    const midDriver = scriptedDriver('mid', () => [{ label: 'w', agent: worker }], observed)
    const rootDriver = scriptedDriver(
      'root',
      () => [{ label: 'mid', agent: driverChild('mid', midDriver, journal) }],
      observed,
    )
    const result = await createSupervisor<unknown, unknown>().run(
      rootDriver,
      'task',
      supervisorOpts({ runId: 'rec', journal, blobs, maxDepth: 1 }),
    )
    // The mid driver could not spawn the worker at depth 1 → it threw → typed down → the
    // root driver found no valid child → no-winner. The depth ceiling held across recursion.
    expect(result.kind).toBe('no-winner')
  })

  it('shows nested worker activity to the parent and routes a parent steer through the driver', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    let startLeaf!: () => void
    const leafStarted = new Promise<void>((resolve) => {
      startLeaf = resolve
    })
    let finishLeaf!: () => void
    const leafMayFinish = new Promise<void>((resolve) => {
      finishLeaf = resolve
    })
    const delivered: unknown[] = []
    let artifact: ExecutorResult<unknown> | undefined
    const leafExecutor: Executor<unknown> = {
      runtime: 'steerable-leaf',
      async execute() {
        startLeaf()
        await leafMayFinish
        const steered = delivered.length > 0
        artifact = {
          outRef: `leaf:${steered ? 'right' : 'wrong'}`,
          out: { edited: steered ? 'core/right.ts' : 'legacy/wrong.ts' },
          verdict: { valid: true, score: steered ? 1 : 0 },
          spent: {
            iterations: 1,
            tokens: { input: 10, output: 5 },
            usdKnown: true,
            usd: 0,
            ms: 1,
          },
        }
        return artifact
      },
      deliver(msg) {
        delivered.push(msg)
      },
      progress() {
        return {
          turns: 1,
          recentActivity: [
            {
              at: 10,
              kind: 'tool' as const,
              label: 'edit',
              detail: 'legacy/wrong.ts',
            },
          ],
          note: 'editing legacy/wrong.ts',
        }
      },
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact() {
        if (!artifact) throw new Error('leaf artifact read before execute')
        return artifact
      },
    }
    const leaf = {
      name: 'leaf',
      act: async () => undefined,
      executorSpec: {
        profile: { name: 'leaf' } as AgentProfile,
        harness: null,
        executor: leafExecutor,
      },
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }

    const mid = scriptedDriver('mid', () => [{ label: 'leaf', agent: leaf }], newObserved())
    let parentProgress: ReturnType<Scope<unknown>['progress']>
    let steerDelivered = false
    const root: Agent<unknown, unknown> = {
      name: 'root',
      async act(task, scope) {
        const spawned = scope.spawn(driverChild('mid', mid, journal), task, {
          budget: perChild,
          label: 'mid',
        })
        if (!spawned.ok) throw new Error(`root: spawn mid failed: ${spawned.reason}`)
        await leafStarted
        parentProgress = scope.progress(spawned.handle.id, { now: 10 })
        steerDelivered = scope.send(spawned.handle.id, {
          steer: 'stop editing legacy/wrong.ts; edit core/right.ts',
        })
        finishLeaf()
        const settled = await scope.next()
        return settled?.kind === 'done' ? settled.out : undefined
      },
    }

    const result = await createSupervisor<unknown, unknown>().run(root, 'fix it', {
      ...supervisorOpts({ runId: 'live-nested', journal, blobs }),
      now: () => 10,
    })

    expect(parentProgress?.steerable).toBe(true)
    expect(
      parentProgress?.recentActivity.some((activity) =>
        activity.detail?.includes('legacy/wrong.ts'),
      ),
    ).toBe(true)
    expect(parentProgress?.note).toContain('leaf')
    expect(steerDelivered).toBe(true)
    expect(delivered).toEqual([{ steer: 'stop editing legacy/wrong.ts; edit core/right.ts' }])
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ edited: 'core/right.ts' })
  })

  it('aborts and accounts for a live descendant before an early-returning nested driver settles', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const leafSpend = {
      iterations: 2,
      tokens: { input: 12, output: 6 },
      usdKnown: true,
      usd: 0,
      ms: 4,
    }
    let leafStartedResolve!: () => void
    const leafStarted = new Promise<void>((resolve) => {
      leafStartedResolve = resolve
    })
    let releaseLeaf: (() => void) | undefined
    let leafSawAbort = false
    let leafTeardowns = 0
    const leafTerminal: ExecutorResult<unknown> = {
      outRef: 'leaf:partial',
      out: { partial: true },
      spent: leafSpend,
    }
    const leafExecutor: Executor<unknown> = {
      runtime: 'abortable-leaf',
      execute(_task, signal) {
        leafStartedResolve()
        return new Promise<ExecutorResult<unknown>>((resolve) => {
          releaseLeaf = () => resolve(leafTerminal)
          const onAbort = () => {
            leafSawAbort = true
            resolve(leafTerminal)
          }
          if (signal.aborted) onAbort()
          else signal.addEventListener('abort', onAbort, { once: true })
        })
      },
      teardown() {
        leafTeardowns += 1
        return Promise.resolve({ destroyed: true })
      },
      resultArtifact: () => leafTerminal,
    }
    const leaf = {
      name: 'leaf',
      act: async () => undefined,
      executorSpec: {
        profile: { name: 'leaf' } as AgentProfile,
        harness: null,
        executor: leafExecutor,
      },
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }

    const earlyDriver: Agent<unknown, unknown> = {
      name: 'early-driver',
      async act(task, scope) {
        const spawned = scope.spawn(leaf, task, {
          budget: { maxIterations: 3, maxTokens: 100 },
          label: 'leaf',
        })
        if (!spawned.ok) throw new Error(`early-driver: spawn failed: ${spawned.reason}`)
        await leafStarted
        return { returned: 'before-leaf' }
      },
    }
    const root: Agent<unknown, unknown> = {
      name: 'root',
      async act(task, scope) {
        const spawned = scope.spawn(driverChild('early-driver', earlyDriver, journal), task, {
          budget: perChild,
          label: 'early-driver',
        })
        if (!spawned.ok) throw new Error(`root: spawn failed: ${spawned.reason}`)
        const settled = await scope.next()
        return settled?.kind === 'done' ? settled.out : undefined
      },
    }

    try {
      const result = await createSupervisor<unknown, unknown>().run(
        root,
        'stop early',
        supervisorOpts({ runId: 'early-return', journal, blobs }),
      )

      expect(leafSawAbort).toBe(true)
      expect(leafTeardowns).toBe(1)
      expect(result.kind).toBe('winner')
      expect(result.spentTotal).toEqual(leafSpend)
      const nestedEvents = await journal.loadTree('early-return/early-return:s0')
      expect(
        nestedEvents?.some(
          (event) =>
            event.kind === 'settled' &&
            event.id === 'early-return:s0:s0' &&
            event.status === 'down' &&
            event.spent.tokens.input + event.spent.tokens.output === 18,
        ),
      ).toBe(true)
    } finally {
      releaseLeaf?.()
    }
  })

  it('routes a correction to one observed nested worker without steering its sibling', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    let startedCount = 0
    let bothStartedResolve!: () => void
    const bothStarted = new Promise<void>((resolve) => {
      bothStartedResolve = resolve
    })
    let releaseLeaves!: () => void
    const leavesMayFinish = new Promise<void>((resolve) => {
      releaseLeaves = resolve
    })
    const targetMessages: unknown[] = []
    const unrelatedMessages: unknown[] = []

    const makeSteerableLeaf = (
      name: string,
      detail: string,
      score: number,
      messages: unknown[],
    ): Agent<unknown, unknown> => {
      let artifact: ExecutorResult<unknown> | undefined
      const executor: Executor<unknown> = {
        runtime: 'steerable-leaf',
        async execute() {
          startedCount += 1
          if (startedCount === 2) bothStartedResolve()
          await leavesMayFinish
          artifact = {
            outRef: `leaf:${name}`,
            out: { worker: name },
            verdict: { valid: true, score },
            spent: {
              iterations: 1,
              tokens: { input: 4, output: 2 },
              usdKnown: true,
              usd: 0,
              ms: 1,
            },
          }
          return artifact
        },
        deliver(msg) {
          messages.push(msg)
        },
        progress() {
          return {
            turns: 1,
            recentActivity: [{ at: 10, kind: 'tool' as const, label: 'edit', detail }],
          }
        },
        teardown: () => Promise.resolve({ destroyed: true }),
        resultArtifact() {
          if (!artifact) throw new Error(`${name}: artifact read before execute`)
          return artifact
        },
      }
      return {
        name,
        act: async () => undefined,
        executorSpec: {
          profile: { name } as AgentProfile,
          harness: null,
          executor,
        },
      } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    }

    const unrelated = makeSteerableLeaf('unrelated', 'unrelated/file.ts', 0.5, unrelatedMessages)
    const target = makeSteerableLeaf('target', 'target/file.ts', 1, targetMessages)
    const mid = scriptedDriver(
      'mid',
      () => [
        { label: 'unrelated', agent: unrelated },
        { label: 'target', agent: target },
      ],
      newObserved(),
      { maxIterations: 1, maxTokens: 100 },
    )
    let steerDelivered = false
    let targetId: string | undefined
    const root: Agent<unknown, unknown> = {
      name: 'root',
      async act(task, scope) {
        const spawned = scope.spawn(driverChild('mid', mid, journal), task, {
          budget: perChild,
          label: 'mid',
        })
        if (!spawned.ok) throw new Error(`root: spawn mid failed: ${spawned.reason}`)
        await bothStarted
        const progress = scope.progress(spawned.handle.id, { now: 10 })
        const targetActivity = progress?.recentActivity.find(
          (activity) => activity.label === 'target: edit',
        )
        targetId = targetActivity?.detail?.split(' — ')[0]
        if (!targetId) throw new Error('root: target nested worker was not observable')
        steerDelivered = scope.send(targetId, { steer: 'only target/file.ts' })
        releaseLeaves()
        const settled = await scope.next()
        return settled?.kind === 'done' ? settled.out : undefined
      },
    }

    const result = await createSupervisor<unknown, unknown>().run(root, 'target one', {
      ...supervisorOpts({ runId: 'target-nested', journal, blobs }),
      now: () => 10,
    })

    expect(targetId).toBe('target-nested:s0:s1')
    expect(steerDelivered).toBe(true)
    expect(targetMessages).toEqual([{ steer: 'only target/file.ts' }])
    expect(unrelatedMessages).toEqual([])
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ worker: 'target' })
  })

  it('derives nested journal identities from durable parent child ids across restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driver-recursion-restart-'))
    try {
      const journalPath = join(dir, 'spawn-journal.jsonl')
      const blobDir = join(dir, 'blobs')
      const runId = 'restart-recursion'

      const run = async (resume: boolean) => {
        // A new store instance models a new process: no object identity or module-local counter
        // survives, while the journal and blobs do.
        const journal = new FileSpawnJournal(journalPath)
        const blobs = new FileResultBlobStore(blobDir)
        const worker = workerLeaf('leaf', {
          out: { answer: 42 },
          tokens: { input: 5, output: 5 },
          iterations: 1,
          score: 1,
        })
        const mid = scriptedDriver('mid', () => [{ label: 'leaf', agent: worker }], newObserved())
        const root = scriptedDriver(
          'root',
          () => [{ label: 'mid', agent: driverChild('mid', mid, journal) }],
          newObserved(),
        )
        return createSupervisor<unknown, unknown>().run(root, 'solve', {
          ...supervisorOpts({ runId, journal, blobs }),
          ...(resume ? { resume: true } : {}),
        })
      }

      expect((await run(false)).kind).toBe('winner')
      expect((await run(true)).kind).toBe('winner')

      const records = (await readFile(join(dir, 'spawn-journal.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { kind: string; root: string })
      const nestedRoots = records
        .filter((record) => record.kind === 'begin' && record.root !== runId)
        .map((record) => record.root)
      expect(nestedRoots).toEqual([`${runId}/${runId}:s0`, `${runId}/${runId}:s1`])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ── helpers ────────────────────────────────────────────────────────────────────

/** Collect every tree key the in-memory journal has begun. The InMemorySpawnJournal keeps
 *  trees in a private map; we discover keys by probing the known root + nested key shape. */
function collectTreeKeys(journal: InMemorySpawnJournal): string[] {
  // The journal exposes loadTree per key. We discover nested keys by reading the private trees map
  // via a structural cast — test-only introspection, mirroring the supervise test's direct journal
  // reads.
  const trees = (journal as unknown as { trees: Map<string, unknown> }).trees
  return [...trees.keys()]
}
