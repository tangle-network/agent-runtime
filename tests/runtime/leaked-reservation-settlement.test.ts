/**
 * A reservation stranded at the join barrier must not destroy the run that stranded it (#1181).
 *
 * Measured shape: one live pursuit ended with `budget pool: 1 reservation(s) still open at join
 * barrier (leaked ticket ids: 11)`, a `failure.json` reporting `nodes: 0`, and no `result.json` —
 * while its spawn journal held thirteen spawns. The invariant is right; replacing settlement with
 * an exception is what threw the tree away.
 *
 * The leak is induced through the production path that produces it: a child whose terminal spend
 * cannot be validated. `reconcile` refuses the spend before the ticket closes, `Scope.runChild`
 * has already marked the child reconciled, and nothing retries — so the ticket is still open when
 * the supervisor joins.
 */

import { describe, expect, it } from 'vitest'
import { settleRecordJson } from '../../src/durable/settle-record'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  Scope,
  Spend,
} from '../../src/runtime/supervise/types'
import { testAgentProfile } from '../kernel/test-agent-profile'

/** A leaf that runs, then reports a terminal spend the conserved pool must refuse: `tokens.input`
 *  is negative, an impossible count. `reconcile` validates before it closes the ticket, so the
 *  refusal strands the reservation while `runChild` has already marked the child reconciled —
 *  nothing retries, and the ticket is still open when the supervisor joins. */
function leakingLeaf(): Agent<unknown, string> & { executorSpec: AgentSpec } {
  const artifact: ExecutorResult<string> = {
    outRef: 'leak:1',
    out: 'extracted',
    spent: { iterations: 1, tokens: { input: -1, output: 5 }, usd: 0, ms: 0 } as Spend,
  }
  const executor: Executor<string> = {
    runtime: 'router',
    execute: async (): Promise<ExecutorResult<string>> => artifact,
    teardown: async () => ({ destroyed: true }),
    resultArtifact: (): ExecutorResult<string> => artifact,
  }
  const spec: AgentSpec = {
    profile: testAgentProfile('extract'),
    harness: null,
    executor: executor as Executor<unknown>,
  }
  return {
    name: 'extract',
    act: async () => 'extracted',
    executorSpec: spec,
  } as Agent<unknown, string> & { executorSpec: AgentSpec }
}

async function runRoot(act: (task: unknown, scope: Scope<string>) => Promise<string | undefined>) {
  return await createSupervisor<unknown, string | undefined>().run(
    { name: 'root', act } as Agent<unknown, string | undefined>,
    'task',
    {
      budget: { maxIterations: 50, maxTokens: 100_000 },
      runId: 'leaked-reservation',
      journal: new InMemorySpawnJournal(),
      blobs: new InMemoryResultBlobStore(),
      executors: createExecutorRegistry(),
      now: () => 0,
    },
  )
}

/** Spawn the leaking child and drive it to settlement, so the barrier meets an open ticket. */
async function spawnLeakingChild(task: unknown, scope: Scope<string | undefined>): Promise<void> {
  scope.spawn(leakingLeaf() as unknown as Agent<unknown, string | undefined>, task, {
    budget: { maxIterations: 5, maxTokens: 10_000 },
    label: 'extract:arXiv-2507.01226',
    assignmentId: 'extract-ghrist',
  })
  await scope.next()
}

describe('a reservation leaked at the join barrier', () => {
  it('still settles the run, with its tree and the leak named as an integrity finding', async () => {
    const result = await runRoot(async (task, scope) => {
      await spawnLeakingChild(task, scope)
      return undefined
    })

    // Before the fix this rejected, and the caller wrote a failure with `nodes: 0`.
    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    // The tree the run actually built survives the leak.
    expect(result.tree.nodes.length).toBe(1)
    expect(result.tree.nodes[0]?.label).toBe('extract:arXiv-2507.01226')
    expect(result.spentTotal).toBeDefined()
    // The leak is reported, not swallowed.
    expect(result.leakedReservations?.length).toBe(1)
  })

  it('names the holder — assignment, child id and stage — not only a ticket id', async () => {
    const result = await runRoot(async (task, scope) => {
      await spawnLeakingChild(task, scope)
      return undefined
    })

    if (result.kind !== 'no-winner') throw new Error(`expected no-winner, got ${result.kind}`)
    const leak = result.leakedReservations?.[0]
    expect(leak?.assignment).toBe('extract-ghrist')
    expect(leak?.label).toBe('extract:arXiv-2507.01226')
    // The child that held the ticket, so a journal reader can find the node that never settled.
    expect(leak?.childId).toBe(result.tree.nodes[0]?.id)
    // `executing` says the ticket escaped from the child's own run, not from admission.
    expect(leak?.stage).toBe('executing')
    expect(typeof leak?.ticketId).toBe('number')
  })

  it('survives into the durable settle record, which is what an autopsy reads', async () => {
    const result = await runRoot(async (task, scope) => {
      await spawnLeakingChild(task, scope)
      return undefined
    })

    // `result.json` holds the whole settled result, so the finding outlives the process that made
    // it. The leak was the reason #1181 left a `failure.json` with `nodes: 0` and no settle record
    // at all; the evidence is worth nothing if it only exists in memory.
    const recorded = JSON.parse(settleRecordJson(result)) as {
      leakedReservations?: ReadonlyArray<{ childId?: string; assignment?: string }>
    }
    expect(recorded.leakedReservations).toHaveLength(1)
    expect(recorded.leakedReservations?.[0]?.assignment).toBe('extract-ghrist')
  })

  it('still fails loud on the success path, where a corrupt total would travel as a winner', async () => {
    await expect(
      runRoot(async (task, scope) => {
        await spawnLeakingChild(task, scope)
        return 'winner'
      }),
    ).rejects.toThrow(/conserved-pool invariant violated/)
  })

  it('names the holder in the invariant message too, so the success failure is attributable', () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 1_000 }, 0)
    const reservation = pool.reserve(
      { maxIterations: 1, maxTokens: 100 },
      { assignment: 'extract-ghrist', label: 'extract:arXiv-2010.11525', stage: 'admitted' },
    )
    if (!reservation.ok) throw new Error(`reservation refused: ${reservation.reason}`)
    pool.attribute(reservation.ticket, { childId: 'root:s0', stage: 'executing' })

    expect(() => pool.assertNoOpenTickets()).toThrow(
      /child root:s0, label extract:arXiv-2010\.11525, assignment extract-ghrist, stage executing/,
    )
  })

  it('reports nothing open once every ticket has settled', () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 1_000 }, 0)
    const reservation = pool.reserve({ maxIterations: 1, maxTokens: 100 })
    if (!reservation.ok) throw new Error(`reservation refused: ${reservation.reason}`)
    pool.reconcile(reservation.ticket, {
      iterations: 1,
      tokens: { input: 1, output: 1 },
      usd: 0,
      ms: 0,
    })

    expect(pool.openReservations()).toEqual([])
    expect(() => pool.assertNoOpenTickets()).not.toThrow()
  })
})
