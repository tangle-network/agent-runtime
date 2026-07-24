/**
 * Phase 3 stub — Nautilus Trader certification adapter (NOT IMPLEMENTED).
 *
 * Per the quant-arena v2 decision memo, the final certification tier runs a
 * winning strategy's decision record through Nautilus Trader's event-driven
 * engine (real OMS semantics: order lifecycle, partial fills, latency
 * models) as an independent confirmation of the vectorbt score before
 * anything is promoted. Phases 1-2 (this PR) end at the vectorbt worker;
 * this seam exists so the campaign plumbing has a stable name to call.
 *
 * TODO(phase-3, quant-arena v2 memo): implement as a python worker sibling
 * of python/vbt-worker.py (same JSONL protocol shape, own pinned uv env),
 * translating the OMS `Order` stream from driver.ts — not raw weights —
 * into Nautilus order submissions, and reconciling final equity against the
 * vectorbt curve within a documented tolerance.
 */

import type { Order } from './types.ts'

export interface NautilusCertification {
  finalEquity: number
  ordersAccepted: number
  ordersRejected: number
}

export function certifyWithNautilus(_orders: Order[]): Promise<NautilusCertification> {
  throw new Error(
    'quant-arena: Nautilus certification is Phase 3 of the v2 memo and is not implemented yet — ' +
      'the vectorbt worker (vbt-client.ts) is the current official scorer.',
  )
}
