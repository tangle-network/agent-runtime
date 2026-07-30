/**
 * `SupervisorFinalizer` — the pluggable last step of a driver run: how the settled-worker ledger
 * becomes the run's output. `bestDelivered` (the default) returns the single highest-scoring
 * DELIVERED child's output; `collectDelivered` returns every verified distinct output with its
 * provenance — the shape a panel of disagreeing evaluators, a Pareto set, or a competing-hypotheses
 * record needs. A custom finalizer plugs in through `DriverAgentOptions.finalizer` /
 * `SuperviseOptions.finalizer`.
 *
 * THE INVARIANT the seam enforces, not merely documents: a finalizer operates on structurally
 * DELIVERED outputs only — children that settled `done` AND passed their completion oracle
 * (`valid === true`). `runFinalizer` materializes exactly those into `ctx.delivered`, and the
 * `ctx.blobs` reader it hands over refuses any `outRef` that is not a delivered child's result
 * (fail loud). An undelivered or invalid child is visible in `ctx.allSettled` as METADATA — a
 * finalizer can record the disagreement — but its prose is unreachable and it can never become
 * (or be folded into) the output. Returning `undefined` means "nothing deliverable": the
 * supervisor types it a no-winner, never a best-effort coercion.
 *
 * @experimental
 */

import { ValidationError } from '../../errors'
import type { ResultBlobStore, Scope, TreeView } from './types'

/** One settled worker as the finalizer sees it — the ledger row (structural fields only). */
export interface FinalizerSettled {
  readonly id: string
  readonly status: 'done' | 'down'
  readonly score?: number
  readonly valid?: boolean
  readonly outRef?: string
  readonly reason?: string
}

/** One DELIVERED child, materialized: settled `done`, oracle-passed, output rehydrated. `out` is
 *  `undefined` only when the child settled without an `outRef` (no artifact to rehydrate). */
export interface DeliveredOutput {
  readonly id: string
  readonly score?: number
  readonly outRef?: string
  readonly out?: unknown
}

/** What a finalizer gets to decide with. `delivered` is the ONLY output material; `allSettled`
 *  and `tree` are metadata (record a disagreement, count the downs); `blobs` re-reads delivered
 *  artifacts only; `budget` is the conserved-pool readout at finalize time. */
export interface FinalizeContext {
  readonly delivered: ReadonlyArray<DeliveredOutput>
  readonly allSettled: ReadonlyArray<FinalizerSettled>
  readonly tree: TreeView
  readonly blobs: Pick<ResultBlobStore, 'get'>
  readonly budget: Scope<unknown>['budget']
}

/** The finalization seam: ledger in, output (or `undefined` = nothing deliverable) out. */
export type SupervisorFinalizer = (
  ctx: FinalizeContext,
) => Promise<unknown | undefined> | unknown | undefined

/**
 * The tree that describes the WHOLE run: this process's live nodes plus, on a resumed run, the
 * committed nodes of the prior process(es). Node ids are assigned by the journal and unique across
 * processes, so the union needs no reconciliation. `inFlight`/`waiting` stay the LIVE counts — a
 * prior process's in-flight node died with it and is not in flight now.
 *
 * Without this, a resumed run reports spend for work whose nodes are missing from its own tree.
 * On a run that never resumed there is nothing to merge and the live view is returned unchanged.
 */
export function runTree(scope: Pick<Scope<unknown>, 'view' | 'resume'>): TreeView {
  const live = scope.view
  const prior = scope.resume?.view
  if (prior === undefined) return live
  const liveIds = new Set(live.nodes.map((n) => n.id))
  const carried = prior.nodes.filter((n) => !liveIds.has(n.id))
  if (carried.length === 0) return live
  return { ...live, nodes: [...carried, ...live.nodes] }
}

/** The single argmax both built-in finalizers share. Ranking requires measured scores; an unknown
 * score is not silently converted into a zero. */
export function pickBestDelivered<T extends { readonly score?: number }>(
  delivered: ReadonlyArray<T>,
): T | undefined {
  let best: T | undefined
  for (const candidate of delivered) {
    if (best === undefined) {
      best = candidate
      continue
    }
    if (candidate.score === undefined || best.score === undefined) {
      throw new ValidationError('finalizer: cannot rank delivered outputs with an unknown score')
    }
    if (candidate.score > best.score) best = candidate
  }
  return best
}

/** Keep-best under the completion oracle — the DEFAULT finalizer and the exact behavior every
 *  existing caller had: the highest-scoring delivered child's output, `undefined` when nothing
 *  delivered (or the best delivered child carries no artifact). */
export const bestDelivered: SupervisorFinalizer = (ctx) => pickBestDelivered(ctx.delivered)?.out

/**
 * Every verified distinct output, highest score first — the shape for competing hypotheses, a
 * Pareto front, or a recorded evaluator split (three judges 2:1 → both outputs survive, with
 * provenance, instead of the minority report being erased). Distinct by `outRef` (content
 * address), so identical outputs collapse to one entry. `undefined` when nothing delivered —
 * an empty collection is a no-winner, not a winner wrapping `[]`.
 */
export const collectDelivered: SupervisorFinalizer = (ctx) => {
  const seen = new Set<string>()
  const distinct = [...ctx.delivered]
    .sort((a, b) => {
      if (a.score === undefined || b.score === undefined) {
        throw new ValidationError('finalizer: cannot rank delivered outputs with an unknown score')
      }
      return b.score - a.score
    })
    .filter((w) => {
      if (w.outRef === undefined || seen.has(w.outRef)) return false
      seen.add(w.outRef)
      return true
    })
    .map((w) => ({ id: w.id, score: w.score, outRef: w.outRef, out: w.out }))
  return distinct.length > 0 ? distinct : undefined
}

/**
 * Run a finalizer over a settled-worker ledger under the delivered-only invariant: filter the
 * ledger to structurally delivered children, materialize their outputs, and hand the finalizer a
 * blob reader that throws on any ref outside that set. This is the one call site both driver arms
 * (the in-process tool-loop and the MCP-mounted harness) finalize through.
 */
export async function runFinalizer(
  finalizer: SupervisorFinalizer,
  args: {
    readonly settled: ReadonlyArray<FinalizerSettled>
    readonly blobs: ResultBlobStore
    readonly tree: TreeView
    readonly budget: Scope<unknown>['budget']
  },
): Promise<unknown | undefined> {
  const deliveredRows = args.settled.filter((w) => w.status === 'done' && w.valid === true)
  const deliveredRefs = new Set<string>()
  for (const w of deliveredRows) if (w.outRef !== undefined) deliveredRefs.add(w.outRef)
  const delivered: DeliveredOutput[] = await Promise.all(
    deliveredRows.map(async (w) => ({
      id: w.id,
      ...(w.score !== undefined ? { score: w.score } : {}),
      ...(w.outRef !== undefined ? { outRef: w.outRef, out: await args.blobs.get(w.outRef) } : {}),
    })),
  )
  const guardedBlobs: Pick<ResultBlobStore, 'get'> = {
    get: (outRef: string) => {
      if (!deliveredRefs.has(outRef)) {
        throw new ValidationError(
          `finalizer: outRef '${outRef}' is not a DELIVERED child's result — a finalizer may ` +
            'only operate on outputs that settled done and passed their completion oracle',
        )
      }
      return args.blobs.get(outRef)
    },
  }
  return finalizer({
    delivered,
    allSettled: args.settled,
    tree: args.tree,
    blobs: guardedBlobs,
    budget: args.budget,
  })
}
