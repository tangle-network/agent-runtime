/**
 * Crash-orphan ledger reconciliation: a synthetic durable ledger with one
 * orphaned pending call (crashed process — call opened, no receipt) and one
 * resolved call. Reconciliation must settle ONLY the orphan, as a $0
 * failure receipt tagged 'process-crash-orphan', after which the ledger's
 * fail-closed admission guard passes new paid work again — the exact resume
 * path improve() rides.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CostReceipt, PendingCostCallView } from '@tangle-network/agent-eval'
import { createRunCostLedger, fsCampaignStorage } from '@tangle-network/agent-eval/campaign'
import {
  CRASH_ORPHAN_REASON,
  reconcileCrashOrphanCalls,
  reconcileCrashOrphansOnDisk,
  type OrphanReconcilableLedger,
} from './ledger-orphans.mts'

const ATTRIBUTION = { channel: 'agent', phase: 'search.baseline', model: 'm' }

/** A durable event line in the exact shape cost-ledger.jsonl persists. */
const line = (record: Record<string, unknown>): string =>
  `${JSON.stringify({ version: 1, record })}\n`

/** Write a synthetic ledger: one settled pair + one crash-orphaned pending. */
function writeCrashedLedger(dir: string): void {
  const settledPending = {
    status: 'pending',
    callId: 'settled-1',
    ...ATTRIBUTION,
    actor: 'worker:astropy#r0',
    timestamp: 1_000,
  }
  const settledReceipt = {
    ...settledPending,
    status: 'settled',
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 0.01,
    costUnknown: false,
    actualCostUsd: 0.01,
  }
  const orphanPending = {
    status: 'pending',
    callId: 'orphan-1',
    ...ATTRIBUTION,
    actor: 'worker:xarray#r0',
    timestamp: 2_000,
    tags: { cellId: 'pydata__xarray-4687:0' },
  }
  writeFileSync(
    join(dir, 'cost-ledger.jsonl'),
    line(settledPending) + line(settledReceipt) + line(orphanPending),
  )
}

const openLedger = (dir: string) =>
  createRunCostLedger({ storage: fsCampaignStorage(), runDir: dir })

describe('reconcileCrashOrphansOnDisk', () => {
  it('settles only the orphan, and the admission guard passes afterwards', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-orphans-'))
    writeCrashedLedger(dir)

    // The bug being fixed: with the orphan unresolved, ALL new paid work is refused.
    const blocked = await openLedger(dir).runPaidCall({
      ...ATTRIBUTION,
      actor: 'worker:next',
      execute: async () => 'ok',
      receipt: () => ({ model: 'm', inputTokens: 1, outputTokens: 1, actualCostUsd: 0 }),
    })
    expect(blocked.succeeded).toBe(false)
    if (!blocked.succeeded) {
      expect(blocked.error.message).toContain('unresolved call(s) must be reconciled')
    }

    const receipts = reconcileCrashOrphansOnDisk(dir)
    expect(receipts.map((r) => r.callId)).toEqual(['orphan-1'])
    expect(receipts[0]).toMatchObject({
      status: 'settled',
      error: CRASH_ORPHAN_REASON,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costUnknown: false,
    })

    // Durable: a fresh ledger instance sees zero unresolved calls, the
    // settled call untouched, and admits new paid work again.
    const reopened = openLedger(dir)
    const summary = reopened.summary()
    expect(summary.unresolvedCalls).toBe(0)
    expect(summary.pendingCalls).toBe(0)
    expect(summary.accountingComplete).toBe(true)
    const settled = reopened.list().find((r) => r.callId === 'settled-1')
    expect(settled?.costUsd).toBe(0.01)
    expect(settled?.error).toBeUndefined()
    const admitted = await reopened.runPaidCall({
      ...ATTRIBUTION,
      actor: 'worker:next',
      execute: async () => 'ok',
      receipt: () => ({ model: 'm', inputTokens: 1, outputTokens: 1, actualCostUsd: 0 }),
    })
    expect(admitted.succeeded).toBe(true)

    // The durable log carries the orphan's failure receipt verbatim.
    const persisted = readFileSync(join(dir, 'cost-ledger.jsonl'), 'utf8')
    expect(persisted).toContain(CRASH_ORPHAN_REASON)
  })

  it('is idempotent — a second startup pass finds nothing to settle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-orphans-'))
    writeCrashedLedger(dir)
    expect(reconcileCrashOrphansOnDisk(dir)).toHaveLength(1)
    expect(reconcileCrashOrphansOnDisk(dir)).toHaveLength(0)
  })

  it('is a no-op on a fresh run dir with no ledger file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-orphans-'))
    expect(reconcileCrashOrphansOnDisk(dir)).toEqual([])
  })
})

describe('reconcileCrashOrphanCalls', () => {
  it("never settles a live in-process call — only 'interrupted' pendings", () => {
    const base = { ...ATTRIBUTION, status: 'pending' as const, timestamp: 1 }
    const pendings: PendingCostCallView[] = [
      { ...base, callId: 'live-1', actor: 'a', state: 'active' },
      { ...base, callId: 'late-1', actor: 'b', state: 'late' },
      { ...base, callId: 'orphan-1', actor: 'c', state: 'interrupted' },
    ]
    const settled: string[] = []
    const ledger: OrphanReconcilableLedger = {
      listPending: () => pendings,
      reconcile: (callId) => {
        settled.push(callId)
        return { callId } as CostReceipt
      },
    }
    reconcileCrashOrphanCalls(ledger)
    expect(settled).toEqual(['orphan-1'])
  })
})
