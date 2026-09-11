/**
 * A dollar no receipt proves is a PRICE, and must say so (#1175).
 *
 * Measured on 2026-09-10 across five settled pursuits: every Tangle Sandbox child settled with its
 * dollars recorded as an unproven figure and nothing naming them an estimate, so the pursuit
 * report read about $177 of provider spend against the router's own `usage_daily` of $4.52.
 * `usd - usdEstimated` is what names the money a provider is known to have billed; with the
 * estimate channel empty that subtraction returns the whole figure, and the projection can only
 * call the cost `unknown`.
 *
 * Nothing is promoted: an unproven dollar keeps `usdKnown: false`, so a dollar-capped run admits
 * and spends exactly what it did before. Only the reading changes.
 */

import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { type ObserverRecord, observerRecordDigest } from '../../src/durable/observer-journal'
import { projectPursuit } from '../../src/durable/observer-projection'
import { spendFromUsageEvents } from '../../src/runtime/supervise/budget'
import { createInbox } from '../../src/runtime/supervise/inbox'
import { createSteerableSandboxSession } from '../../src/runtime/supervise/sandbox-session'
import type { Spend, UsageEvent } from '../../src/runtime/supervise/types'
import type { SandboxClient } from '../../src/runtime/types'
import { testAgentProfile } from '../kernel/test-agent-profile'

/** The cost block a settled node shows, read back through the pursuit projection. */
function projectedCost(spent: Spend) {
  const sign = (
    sequence: number,
    input: Omit<
      ObserverRecord,
      'schemaVersion' | 'pursuitId' | 'sequence' | 'observedAt' | 'digest'
    >,
    previousDigest?: string,
  ): ObserverRecord => {
    const record = {
      schemaVersion: 1 as const,
      pursuitId: 'pursuit:cost',
      sequence,
      observedAt: sequence * 10,
      ...(previousDigest ? { previousDigest } : {}),
      ...input,
    }
    return { ...record, digest: observerRecordDigest(record) }
  }
  const spawned = sign(1, {
    kind: 'event',
    event: {
      id: 'spawn:child',
      pursuitId: 'pursuit:cost',
      runId: 'run:cost',
      target: 'agent.spawn',
      phase: 'after',
      timestamp: 1,
      parentId: 'run:cost',
      payload: { childId: 'run:cost:s0', label: 'extract', runtime: 'sandbox' },
    },
  })
  const settled = sign(
    2,
    {
      kind: 'event',
      event: {
        id: 'settle:child',
        pursuitId: 'pursuit:cost',
        runId: 'run:cost',
        target: 'agent.child',
        phase: 'after',
        timestamp: 2,
        parentId: 'run:cost',
        payload: { childId: 'run:cost:s0', status: 'done', spent },
      },
    },
    spawned.digest,
  )
  return projectPursuit([spawned, settled]).nodes[0]?.cost
}

/** The cost event a sandbox-shaped worker emits for a dollar figure with no receipt behind it. */
const unproven: UsageEvent = {
  kind: 'cost',
  usd: 0.37,
  usdKnown: false,
  usdEstimated: 0.37,
  provenance: 'uncaptured',
}

/** The cost event a worker emits when a provider receipt covers the amount. */
const reported: UsageEvent = {
  kind: 'cost',
  usd: 0.045,
  usdKnown: true,
  provenance: 'provider-receipt',
}

describe('dollars a receipt does not prove', () => {
  it('fold onto the estimate channel, so the projection reads the cost as estimated', () => {
    const spent = spendFromUsageEvents([{ kind: 'iteration' }, unproven])

    expect(spent.usd).toBe(0.37)
    expect(spent.usdEstimated).toBe(spent.usd)
    // The whole figure is a price, so nothing here is known to have been billed.
    expect(spent.usd - (spent.usdEstimated ?? 0)).toBe(0)
    const cost = projectedCost(spent)
    expect(cost?.provenance).toBe('estimated')
    expect(cost?.usdEstimated).toBe(cost?.usd)
    // A price is still not a receipt: a dollar-capped run refuses it exactly as before.
    expect(cost?.usdKnown).toBe(false)
  })

  it('leave a reported cost unchanged — a measured channel names no estimate', () => {
    const spent = spendFromUsageEvents([{ kind: 'iteration' }, reported])

    expect(spent.usd).toBe(0.045)
    expect(spent.usdEstimated).toBeUndefined()
    expect(projectedCost(spent)).toEqual({ usd: 0.045, usdKnown: true, provenance: 'reported' })
  })

  it('stay separable from a receipt when one turn billed and another only priced', () => {
    const spent = spendFromUsageEvents([reported, unproven])

    // `usd - usdEstimated` still recovers the billed part of a mixed settlement.
    expect(spent.usd).toBeCloseTo(0.415, 10)
    expect(spent.usdEstimated).toBe(0.37)
    expect(spent.usd - (spent.usdEstimated ?? 0)).toBeCloseTo(0.045, 10)
    expect(projectedCost(spent)?.provenance).toBe('partial')
  })

  it('report unknown dollars, not an estimate, when nothing priced the work at all', () => {
    const spent = spendFromUsageEvents([
      { kind: 'iteration' },
      { kind: 'cost', usd: 0, usdKnown: false, provenance: 'uncaptured' },
    ])

    expect(spent.usdEstimated).toBeUndefined()
    expect(projectedCost(spent)?.provenance).toBe('unknown')
  })
})

/** A box whose terminal frame states a dollar figure — the shape a cloud child really settles on. */
function boxClient(frames: ReadonlyArray<SandboxEvent>): SandboxClient {
  return {
    async create(_options?: CreateSandboxOptions): Promise<SandboxInstance> {
      return {
        id: 'box-1',
        async *streamPrompt(): AsyncGenerator<SandboxEvent> {
          for (const frame of frames) yield frame
        },
        async delete() {},
      } as unknown as SandboxInstance
    },
  }
}

async function runSandboxChild(costUsd: number | undefined) {
  const session = createSteerableSandboxSession({
    controller: new AbortController(),
    profile: testAgentProfile('extract', { harness: 'opencode' }),
    harness: 'opencode',
    sandboxClient: boxClient([
      {
        type: 'result',
        data: {
          finalText: 'extracted',
          usage: { inputTokens: 2_000, outputTokens: 400 },
          ...(costUsd === undefined ? {} : { costUsd }),
        },
      } as unknown as SandboxEvent,
    ]),
    inbox: createInbox(),
    taskToPrompt: (task) => String(task),
    contentRef: (prefix) => `${prefix}:ref`,
  })
  const events: UsageEvent[] = []
  for await (const event of session.stream('extract', new AbortController().signal)) {
    events.push(event)
  }
  return { events, spent: session.artifact()?.spent }
}

describe('a sandbox child whose box states a dollar figure', () => {
  it('settles with that figure named on the estimate channel, never as billed spend', async () => {
    const { events, spent } = await runSandboxChild(0.37)

    const cost = events.find((event) => event.kind === 'cost' && event.usd > 0)
    expect(cost).toMatchObject({ usd: 0.37, usdKnown: false, usdEstimated: 0.37 })
    expect(spent?.usd).toBe(0.37)
    expect(spent?.usdEstimated).toBe(0.37)
    // The box reported no billing receipt, so nothing here is known to have been charged.
    expect(spent?.usdKnown).toBe(false)
    expect(projectedCost(spent as Spend)?.provenance).toBe('estimated')
  })

  it('claims no estimate when the box stated no dollars at all', async () => {
    const { spent } = await runSandboxChild(undefined)

    expect(spent?.usd).toBe(0)
    expect(spent?.usdEstimated).toBeUndefined()
    // A box that priced nothing leaves the dollar channel unknown, not estimated at zero.
    expect(spent?.usdKnown).toBe(false)
    expect(projectedCost(spent as Spend)?.provenance).toBe('unknown')
  })
})
