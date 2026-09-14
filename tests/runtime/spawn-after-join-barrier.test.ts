/**
 * A spawn admitted AFTER the join barrier has drained must be refused, not funded.
 *
 * Measured shape (mech-interp-foundations-fourier-e-20260914c, agent-runtime 0.223.0): a run of 63
 * settled children and $6.10 of completed work died at its final stage with
 * `budget pool: 1 reservation(s) still open at join barrier (ticket 62, child …:s62, label
 * distill:all, … stage executing) — conserved-pool invariant violated`. Nothing had leaked. The
 * root driver had returned, the barrier had already drained and released, and 309 ms later a
 * background node-tool invocation still holding the root's coordination verbs called
 * `scope.spawn` again. That child was admitted, reserved conserved budget, built a sandbox, ran
 * 12.4 s of provider work, and journaled its own settlement 19 s after `failure.json` was
 * written — into a run that no longer existed. The ticket the barrier reported was 147 ms old.
 *
 * The barrier is reproduced through the supervise path at the instant it actually ran: the
 * `teardown-unconfirmed` append happens inside the barrier, after `drainLiveChildren` and
 * `releaseRetainedEnvironments` and before `pool.openReservations()`, so a journal decorator that
 * spawns there lands in exactly the window the live run landed in.
 */

import { describe, expect, it } from 'vitest'
import type { SpawnEvent, SpawnJournal } from '../../src/durable/spawn-journal'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  Scope,
  SpawnRejection,
  Spend,
} from '../../src/runtime/supervise/types'
import { testAgentProfile } from '../kernel/test-agent-profile'

const CHILD_BUDGET = { maxIterations: 5, maxTokens: 10_000 }

/** A leaf that completes, but whose executor never acknowledges its own teardown. The node stays
 *  in `scope.workerCapacity.unconfirmed`, so the barrier journals one `teardown-unconfirmed`
 *  event for it — the same record `:s54` left in the live run, and this test's clock. */
function unconfirmedLeaf(): Agent<unknown, string> & { executorSpec: AgentSpec } {
  return leaf('prior-art', async () => ({ destroyed: false }))
}

/** The late child: records whether its executor was ever entered, so the test can tell a refused
 *  spawn from one that was admitted and paid for. */
function lateLeaf(onExecute: () => void): Agent<unknown, string> & { executorSpec: AgentSpec } {
  return leaf('distill', async () => ({ destroyed: true }), onExecute)
}

function leaf(
  name: string,
  teardown: () => Promise<{ destroyed: boolean }>,
  onExecute?: () => void,
): Agent<unknown, string> & { executorSpec: AgentSpec } {
  const artifact: ExecutorResult<string> = {
    outRef: `${name}:1`,
    out: name,
    spent: { iterations: 1, tokens: { input: 10, output: 5 }, usd: 0, ms: 0 } satisfies Spend,
  }
  const executor: Executor<string> = {
    runtime: 'router',
    execute: async (): Promise<ExecutorResult<string>> => {
      onExecute?.()
      return artifact
    },
    teardown,
    resultArtifact: (): ExecutorResult<string> => artifact,
  }
  return {
    name,
    act: async () => name,
    executorSpec: {
      profile: testAgentProfile(name),
      harness: null,
      executor: executor as Executor<unknown>,
    },
  } as Agent<unknown, string> & { executorSpec: AgentSpec }
}

/** Spawn `late` synchronously from inside the barrier, at the `teardown-unconfirmed` append. */
function journalThatSpawnsInsideTheBarrier(
  inner: SpawnJournal,
  spawnLate: () => { ok: true } | { ok: false; reason: SpawnRejection },
  record: (outcome: { ok: true } | { ok: false; reason: SpawnRejection }) => void,
): SpawnJournal {
  let fired = false
  return {
    loadTree: (root) => inner.loadTree(root),
    beginTree: (root, at) => inner.beginTree(root, at),
    appendEvent: (root: string, ev: SpawnEvent) => {
      // Set the guard BEFORE spawning: the spawn appends its own `spawned` event through this
      // same decorator, so an unguarded call would recurse.
      if (ev.kind === 'teardown-unconfirmed' && !fired) {
        fired = true
        record(spawnLate())
      }
      return inner.appendEvent(root, ev)
    },
  }
}

interface LateSpawnRun {
  readonly outcome: { kind: string } | { thrown: unknown }
  readonly lateSpawn: { ok: true } | { ok: false; reason: SpawnRejection } | undefined
  readonly lateExecuted: () => boolean
}

async function runWithALateSpawn(): Promise<LateSpawnRun> {
  let captured: Scope<string | undefined> | undefined
  let lateSpawn: { ok: true } | { ok: false; reason: SpawnRejection } | undefined
  let lateExecuted = false
  const inner = new InMemorySpawnJournal()
  const journal = journalThatSpawnsInsideTheBarrier(
    inner,
    () => {
      const scope = captured
      if (scope === undefined) throw new Error('scope was never captured')
      const res = scope.spawn(
        lateLeaf(() => {
          lateExecuted = true
        }) as unknown as Agent<unknown, string | undefined>,
        'distill',
        { budget: CHILD_BUDGET, label: 'distill:all', assignmentId: 'distill-all' },
      )
      return res.ok ? { ok: true } : { ok: false, reason: res.reason }
    },
    (outcome) => {
      lateSpawn = outcome
    },
  )

  const act = async (task: unknown, scope: Scope<string | undefined>) => {
    captured = scope
    // The driver joins the child it spawned and then returns. The background invocation that
    // still holds its verbs is modelled by the journal decorator, not by anything `act` awaits.
    scope.spawn(unconfirmedLeaf() as unknown as Agent<unknown, string | undefined>, task, {
      budget: CHILD_BUDGET,
      label: 'prior-art:s54',
    })
    await scope.next()
    return 'winner'
  }

  let outcome: { kind: string } | { thrown: unknown }
  try {
    outcome = await createSupervisor<unknown, string | undefined>().run(
      { name: 'root', act } as Agent<unknown, string | undefined>,
      'task',
      {
        budget: { maxIterations: 50, maxTokens: 100_000 },
        runId: 'spawn-after-join-barrier',
        journal,
        blobs: new InMemoryResultBlobStore(),
        executors: createExecutorRegistry(),
      },
    )
  } catch (thrown) {
    outcome = { thrown }
  }
  // Let any detached `runChild` the barrier admitted reach its executor before reading the flag.
  for (let tick = 0; tick < 50 && !lateExecuted; tick++) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  return { outcome, lateSpawn, lateExecuted: () => lateExecuted }
}

describe('a spawn issued after the join barrier has drained', () => {
  it('is refused instead of being admitted into a run that has already settled', async () => {
    const run = await runWithALateSpawn()

    expect(run.lateSpawn).toEqual({ ok: false, reason: 'scope-settled' })
  })

  it('never reaches an executor, so the settled run pays for no phantom work', async () => {
    const run = await runWithALateSpawn()

    expect(run.lateExecuted()).toBe(false)
  })

  it('leaves the conserved pool clean, so the run returns the winner it earned', async () => {
    const run = await runWithALateSpawn()

    if ('thrown' in run.outcome) {
      throw new Error(`run rejected: ${String((run.outcome.thrown as Error)?.message)}`)
    }
    expect(run.outcome.kind).toBe('winner')
  })

  it('still admits and joins a child spawned before the driver returned', async () => {
    let spawned: { ok: boolean } | undefined
    const result = await createSupervisor<unknown, string | undefined>().run(
      {
        name: 'root',
        // Return WITHOUT joining: the barrier must still drain this child, so the seal cannot be
        // closing the door before `act` settles.
        act: async (task: unknown, scope: Scope<string | undefined>) => {
          spawned = scope.spawn(
            leaf('extract', async () => ({ destroyed: true })) as unknown as Agent<
              unknown,
              string | undefined
            >,
            task,
            { budget: CHILD_BUDGET, label: 'extract:one' },
          )
          return 'winner'
        },
      } as Agent<unknown, string | undefined>,
      'task',
      {
        budget: { maxIterations: 50, maxTokens: 100_000 },
        runId: 'spawn-before-return',
        journal: new InMemorySpawnJournal(),
        blobs: new InMemoryResultBlobStore(),
        executors: createExecutorRegistry(),
      },
    )

    expect(spawned?.ok).toBe(true)
    expect(result.kind).toBe('winner')
    expect(result.tree.nodes.map((node) => node.label)).toEqual(['extract:one'])
  })

  it('keeps the invariant armed for a ticket that genuinely leaked', async () => {
    // The #1181 shape, unchanged by the seal: a terminal spend the pool must refuse strands the
    // ticket inside `reconcile`, and the winner arm must still fail loud rather than hand back a
    // `spentTotal` it cannot account for.
    const artifact: ExecutorResult<string> = {
      outRef: 'leak:1',
      out: 'extracted',
      spent: { iterations: 1, tokens: { input: -1, output: 5 }, usd: 0, ms: 0 } as Spend,
    }
    const executor: Executor<string> = {
      runtime: 'router',
      execute: async () => artifact,
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => artifact,
    }
    const leaking = {
      name: 'extract',
      act: async () => 'extracted',
      executorSpec: {
        profile: testAgentProfile('extract'),
        harness: null,
        executor: executor as Executor<unknown>,
      },
    } as Agent<unknown, string> & { executorSpec: AgentSpec }

    await expect(
      createSupervisor<unknown, string | undefined>().run(
        {
          name: 'root',
          act: async (task: unknown, scope: Scope<string | undefined>) => {
            scope.spawn(leaking as unknown as Agent<unknown, string | undefined>, task, {
              budget: CHILD_BUDGET,
              label: 'extract:leak',
            })
            await scope.next()
            return 'winner'
          },
        } as Agent<unknown, string | undefined>,
        'task',
        {
          budget: { maxIterations: 50, maxTokens: 100_000 },
          runId: 'still-loud-on-a-real-leak',
          journal: new InMemorySpawnJournal(),
          blobs: new InMemoryResultBlobStore(),
          executors: createExecutorRegistry(),
        },
      ),
    ).rejects.toThrow(/conserved-pool invariant violated/)
  })
})
