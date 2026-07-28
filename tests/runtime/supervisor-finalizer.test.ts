/**
 * The `SupervisorFinalizer` seam: how a settled-worker ledger becomes the run's output.
 *
 * Two things are proven here. First that the seam is backward compatible — the default and the
 * explicit `bestDelivered` produce the output every existing caller already observed, identical to
 * the pre-existing `finalizeBestDelivered` helper. Second, and the reason the seam is safe to open
 * at all: the delivered-only INVARIANT. A finalizer decides among outputs that settled `done` AND
 * passed their completion oracle; an undelivered or invalid child is visible to it as metadata and
 * its prose is unreachable — no matter what the finalizer wants.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { contentAddress, InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import { ValidationError } from '../../src/errors'
import { finalizeBestDelivered } from '../../src/runtime/supervise/coordination-driver'
import {
  bestDelivered,
  collectDelivered,
  type FinalizeContext,
  type FinalizerSettled,
  runFinalizer,
  type SupervisorFinalizer,
} from '../../src/runtime/supervise/finalizer'
import { supervise } from '../../src/runtime/supervise/supervise'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  Scope,
  TreeView,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { scriptedBrain } from '../kernel/scripted-brain'

const budget: Budget = { maxIterations: 100, maxTokens: 100_000 }

const emptyTree: TreeView = { root: 'r', nodes: [], inFlight: 0, waiting: 0 }
const poolReadout: Scope<unknown>['budget'] = {
  tokensLeft: budget.maxTokens,
  usdLeft: 0,
  usdCapped: false,
  deadlineMs: 0,
  reservedTokens: 0,
}

interface LedgerRow {
  readonly id: string
  readonly status: 'done' | 'down'
  readonly valid?: boolean
  readonly score?: number
  readonly reason?: string
  readonly payload?: unknown
}

/** A ledger + blob store pair. The store is content-addressed, so each row's `outRef` is derived
 *  from its payload — and every payload is really present, delivered or not. The store does not
 *  know about validity, which is exactly why the seam has to enforce it. */
async function ledgerFixture(rows: readonly LedgerRow[]) {
  const blobs = new InMemoryResultBlobStore()
  const settled: FinalizerSettled[] = []
  for (const r of rows) {
    const outRef = r.payload === undefined ? undefined : contentAddress(r.payload)
    if (outRef !== undefined) await blobs.put(outRef, r.payload)
    settled.push({
      id: r.id,
      status: r.status,
      ...(r.score !== undefined ? { score: r.score } : {}),
      ...(r.valid !== undefined ? { valid: r.valid } : {}),
      ...(r.reason !== undefined ? { reason: r.reason } : {}),
      ...(outRef !== undefined ? { outRef } : {}),
    })
  }
  const refOf = (id: string): string => {
    const ref = settled.find((s) => s.id === id)?.outRef
    if (ref === undefined) throw new Error(`fixture: row '${id}' has no outRef`)
    return ref
  }
  return { blobs, rows: settled, refOf }
}

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>

function runWith(finalizer: SupervisorFinalizer, fx: Fixture) {
  return runFinalizer(finalizer, {
    settled: fx.rows,
    blobs: fx.blobs,
    tree: emptyTree,
    budget: poolReadout,
  })
}

/** Three delivered rows and two ineligible ones — the ledger every case below decides over. */
const mixedRows: readonly LedgerRow[] = [
  { id: 'a', status: 'done', valid: true, score: 0.4, payload: 'payload:a' },
  { id: 'b', status: 'done', valid: true, score: 0.8, payload: 'payload:b' },
  { id: 'c', status: 'done', valid: true, score: 0.2, payload: 'payload:c' },
  // Highest score in the ledger, but never passed its completion oracle.
  { id: 'd', status: 'done', valid: false, score: 0.99, payload: 'payload:d' },
  { id: 'e', status: 'down', reason: 'executor crashed', payload: 'payload:e' },
]

describe('SupervisorFinalizer — bestDelivered is the unchanged default', () => {
  it('the default and an explicit bestDelivered agree with the pre-existing finalize helper', async () => {
    const fx = await ledgerFixture(mixedRows)
    const viaSeam = await runWith(bestDelivered, fx)
    const viaLegacy = await finalizeBestDelivered(fx.rows, fx.blobs)
    // The highest-scoring DELIVERED child — not `d`, whose score is higher but unchecked.
    expect(viaSeam).toBe('payload:b')
    expect(viaSeam).toEqual(viaLegacy)
  })

  it('returns undefined — a no-winner, never a coerced best-effort — when nothing delivered', async () => {
    const fx = await ledgerFixture([
      { id: 'd', status: 'done', valid: false, score: 0.99, payload: 'payload:d' },
      { id: 'e', status: 'down', reason: 'crashed', payload: 'payload:e' },
    ])
    expect(await runWith(bestDelivered, fx)).toBeUndefined()
    expect(await runWith(collectDelivered, fx)).toBeUndefined()
  })
})

describe('SupervisorFinalizer — collectDelivered is the second implementation', () => {
  it('returns every verified output with provenance, highest score first', async () => {
    const fx = await ledgerFixture(mixedRows)
    const out = (await runWith(collectDelivered, fx)) as Array<{
      id: string
      score?: number
      outRef?: string
      out: unknown
    }>
    expect(out.map((o) => o.id)).toEqual(['b', 'a', 'c'])
    expect(out.map((o) => o.out)).toEqual(['payload:b', 'payload:a', 'payload:c'])
    // The ineligible children are absent from the OUTPUT even though the seam let the finalizer
    // see them in `allSettled` — a recorded disagreement never becomes a rescued answer.
    expect(out.map((o) => o.id)).not.toContain('d')
    expect(out.map((o) => o.id)).not.toContain('e')
  })

  it('collapses identical outputs by content address, so a 2:1 split records two positions', async () => {
    // Three evaluators, two distinct answers: the majority's answer is delivered twice under one
    // content address, the minority once. Keep-best would erase the minority report; this does not.
    const fx = await ledgerFixture([
      { id: 'j1', status: 'done', valid: true, score: 0.7, payload: 'MAJORITY' },
      { id: 'j2', status: 'done', valid: true, score: 0.7, payload: 'MAJORITY' },
      { id: 'j3', status: 'done', valid: true, score: 0.6, payload: 'MINORITY' },
    ])
    const out = (await runWith(collectDelivered, fx)) as Array<{ id: string; out: unknown }>
    expect(out).toHaveLength(2)
    expect(out.map((o) => o.out)).toEqual(['MAJORITY', 'MINORITY'])
    // Keep-best on the same ledger returns exactly one position — the seam is what buys the other.
    expect(await runWith(bestDelivered, fx)).toBe('MAJORITY')
  })
})

describe('SupervisorFinalizer — the delivered-only invariant holds against a hostile finalizer', () => {
  it('never puts an undelivered or invalid child in `delivered`, only in `allSettled` metadata', async () => {
    const fx = await ledgerFixture(mixedRows)
    let seen: FinalizeContext | undefined
    await runWith((ctx) => {
      seen = ctx
      return undefined
    }, fx)
    expect(seen?.delivered.map((d) => d.id)).toEqual(['a', 'b', 'c'])
    // The record of what happened stays complete — a finalizer can COUNT the failures it may not use.
    expect(seen?.allSettled.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(seen?.allSettled.find((s) => s.id === 'd')?.valid).toBe(false)
    expect(seen?.allSettled.find((s) => s.id === 'e')?.reason).toBe('executor crashed')
  })

  it('refuses to rehydrate an INVALID child even when the finalizer asks for it by ref', async () => {
    const fx = await ledgerFixture(mixedRows)
    // A finalizer that wants the unchecked-but-high-scoring worker's prose. The payload is really
    // in the blob store; the seam is what makes it unreachable.
    expect(await fx.blobs.get(fx.refOf('d'))).toBe('payload:d')
    await expect(runWith((ctx) => ctx.blobs.get(fx.refOf('d')), fx)).rejects.toThrow(
      ValidationError,
    )
    await expect(runWith((ctx) => ctx.blobs.get(fx.refOf('d')), fx)).rejects.toThrow(
      /not a DELIVERED/,
    )
  })

  it('refuses a DOWN child by ref too, and refuses a ref that is in no ledger row at all', async () => {
    const fx = await ledgerFixture(mixedRows)
    await expect(runWith((ctx) => ctx.blobs.get(fx.refOf('e')), fx)).rejects.toThrow(
      ValidationError,
    )
    await expect(
      runWith((ctx) => ctx.blobs.get(contentAddress('never-settled')), fx),
    ).rejects.toThrow(ValidationError)
  })

  it('a delivered ref stays readable — the guard is a filter, not a wall', async () => {
    const fx = await ledgerFixture(mixedRows)
    expect(await runWith((ctx) => ctx.blobs.get(fx.refOf('a')), fx)).toBe('payload:a')
  })
})

/** A leaf that settles with a chosen verdict — the e2e lets `valid: false` reach a real ledger. */
function leaf(name: string, out: unknown, score: number, valid: boolean): Agent<unknown, unknown> {
  const ex: Executor<unknown> = {
    runtime: 'router',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `w:${name}`,
      out,
      verdict: { valid, score },
      spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor: ex }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

/** Two workers, then pull both settlements, then close. */
const twoWorkerScript = () =>
  scriptedBrain([
    {
      toolCalls: [
        {
          name: 'spawn_agent',
          arguments: { profile: { name: 'good' }, task: 'go', label: 'good' },
        },
        {
          name: 'spawn_agent',
          arguments: { profile: { name: 'unchecked' }, task: 'go', label: 'unchecked' },
        },
      ],
    },
    { toolCalls: [{ name: 'await_event', arguments: {} }] },
    { toolCalls: [{ name: 'await_event', arguments: {} }] },
    { content: 'done' },
  ])

const makeWorker = (profile: unknown) => {
  const name = String((profile as { name?: unknown } | undefined)?.name ?? '')
  // `unchecked` scores higher but never passes its oracle — the whole point of the fixture.
  return name === 'good'
    ? leaf('good', 'GOOD', 0.4, true)
    : leaf('unchecked', 'UNCHECKED-PROSE', 0.99, false)
}

describe('SupervisorFinalizer — end to end through supervise()', () => {
  it('the default keeps the delivered answer over a higher-scoring unchecked one', async () => {
    const result = await supervise({ name: 'root', harness: null }, 'task', {
      budget,
      perWorker: { maxIterations: 5, maxTokens: 10_000 },
      makeWorkerAgent: makeWorker,
      brain: twoWorkerScript(),
    })
    expect(result.kind).toBe('winner')
    expect(result.kind === 'winner' ? result.out : null).toBe('GOOD')
  })

  it('an opted-in collectDelivered changes the SHAPE without ever widening eligibility', async () => {
    const result = await supervise({ name: 'root', harness: null }, 'task', {
      budget,
      perWorker: { maxIterations: 5, maxTokens: 10_000 },
      makeWorkerAgent: makeWorker,
      brain: twoWorkerScript(),
      finalizer: collectDelivered,
    })
    expect(result.kind).toBe('winner')
    const out = result.kind === 'winner' ? (result.out as Array<{ out: unknown }>) : []
    // The unchecked worker really settled in this run, and it is still not in the output.
    expect(out.map((o) => o.out)).toEqual(['GOOD'])
  })

  it('a run whose only high scorer is unchecked is a no-winner, not a rescued output', async () => {
    const result = await supervise({ name: 'root', harness: null }, 'task', {
      budget,
      perWorker: { maxIterations: 5, maxTokens: 10_000 },
      makeWorkerAgent: () => leaf('unchecked', 'UNCHECKED-PROSE', 0.99, false),
      brain: twoWorkerScript(),
    })
    expect(result.kind).toBe('no-winner')
  })
})
