/**
 * Crash-orphan reconciliation for the improve-run CostLedger.
 *
 * A killed outer-loop process leaves its in-flight paid call as a durable
 * 'pending' record with no receipt. On resume the ledger's fail-closed
 * admission guard ("N unresolved call(s) must be reconciled before new paid
 * work") then refuses EVERY new paid call, so a single crash permanently
 * blocks the run. This module settles those orphans at startup through the
 * ledger's dedicated crash-recovery verb, `CostLedger.reconcile()`.
 *
 * Safety contract — never settle a live run's call:
 *  - The caller must hold the outDir single-instance pid lock
 *    (`acquireInstanceLock` in outer-loop.mts) before invoking this, so no
 *    concurrent outer-loop shares the ledger file. Every pending record
 *    restored from disk is therefore from a dead process.
 *  - Belt and braces, only `state: 'interrupted'` pendings are touched:
 *    restored-from-persistence calls this process's ledger instance never
 *    started. An 'active'/'late' pending belongs to an in-flight
 *    `runPaidCall` and settles through its own path.
 *  - The ledger's persistence append is compare-and-swap on the file
 *    revision, so even an unexpected concurrent writer makes reconciliation
 *    fail loud (`CostCallConflictError`) instead of corrupting the log.
 *
 * The orphan settles as a FAILED receipt with zero usage and a fully-known
 * $0 actual cost (`actualCostUsd: 0`), reason 'process-crash-orphan'. A
 * `costUnknown`/`usageUnknown` receipt would be marginally more honest about
 * the crashed call's true spend, but an unknown-cost receipt marks the
 * ledger's accounting incomplete forever, which blocks all paid work in
 * capped runs — the same permanent lockout this module exists to fix.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CostReceipt, PendingCostCallView } from '@tangle-network/agent-eval'
import { createRunCostLedger, fsCampaignStorage } from '@tangle-network/agent-eval/campaign'

export const CRASH_ORPHAN_REASON = 'process-crash-orphan'

/** The two ledger verbs reconciliation needs, structural for testability. */
export interface OrphanReconcilableLedger {
  listPending(): PendingCostCallView[]
  reconcile(
    callId: string,
    observed: {
      model: string
      inputTokens: number
      outputTokens: number
      actualCostUsd?: number
    },
    options?: { error?: string },
  ): CostReceipt
}

/** Settle every crash-orphaned ('interrupted') pending call as a $0 failure. */
export function reconcileCrashOrphanCalls(ledger: OrphanReconcilableLedger): CostReceipt[] {
  return ledger
    .listPending()
    .filter((pending) => pending.state === 'interrupted')
    .map((pending) =>
      ledger.reconcile(
        pending.callId,
        { model: pending.model, inputTokens: 0, outputTokens: 0, actualCostUsd: 0 },
        { error: CRASH_ORPHAN_REASON },
      ),
    )
}

/**
 * Open the durable ledger under `improveRunDir` and settle crash orphans.
 * No-op (empty result) when no ledger file exists yet — a fresh run.
 * PRECONDITION: the caller holds the outDir instance lock (see module doc).
 */
export function reconcileCrashOrphansOnDisk(improveRunDir: string): CostReceipt[] {
  if (!existsSync(join(improveRunDir, 'cost-ledger.jsonl'))) return []
  const ledger = createRunCostLedger({ storage: fsCampaignStorage(), runDir: improveRunDir })
  return reconcileCrashOrphanCalls(ledger)
}
