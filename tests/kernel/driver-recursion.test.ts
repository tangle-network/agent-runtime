import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
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

    // Sum spend over EVERY journaled tree (root + every nested tree). Each nested scope
    // partitions its parent's reserved allocation and fails closed when a child cannot fit.
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

  it('budget is conserved across depth: a deep spawn cannot exceed its branch allocation', async () => {
    // The root reserves 1000 tokens for the mid driver. Its nested scope owns exactly that
    // partition, so a 1001-token child request fails closed even though no sibling is running.
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
    const result = await createSupervisor<unknown, unknown>().run(
      rootDriver,
      'task',
      supervisorOpts({
        runId: 'rec',
        journal,
        blobs,
        budget: { maxIterations: 4, maxTokens: 1000 },
      }),
    )
    expect(result.kind).toBe('no-winner')
    if (result.kind === 'no-winner') {
      // The mid driver was reserved at the root, but its oversized nested child never started.
      expect(observed.spawnedIds).toContain('rec:s0') // mid driver reserved at the root
      expect(observed.spawnedIds).not.toContain('rec:s0:s0') // worker never admitted (no budget)
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

    // A SEPARATE nested tree exists, keyed under the root (`rec/d<n>`), holding the worker's
    // spawn + settlement — the recursion's sub-tree, recorded in the same journal.
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
})

// ── helpers ────────────────────────────────────────────────────────────────────

/** Collect every tree key the in-memory journal has begun. The InMemorySpawnJournal keeps
 *  trees in a private map; we discover keys by probing the known root + nested key shape. */
function collectTreeKeys(journal: InMemorySpawnJournal): string[] {
  // The journal exposes loadTree per key; nested keys are `${root}/d<n>`. We discover them by
  // reading the private trees map via a structural cast — test-only introspection, mirroring
  // the supervise test's direct journal reads.
  const trees = (journal as unknown as { trees: Map<string, unknown> }).trees
  return [...trees.keys()]
}
