/**
 *
 * The conserved budget reservation pool — the invariant the whole instrument
 * rests on (critique M5/B3). One root `Budget` becomes a conserved pool of three
 * quantities (tokens, usd, iterations) plus an absolute deadline. Children reserve
 * atomically at spawn and reconcile at settle:
 *
 *   total ≡ free + reserved + committed          (invariant, always)
 *
 * `reserve` moves a child's whole ceiling from `free` → `reserved` and fails closed
 * when `free` can't cover it (never read-then-spawn overcommit, so `Σk(treatment) ≡
 * Σk(blind)` by construction). `reconcile` releases the reservation, commits ACTUAL
 * spend, and refunds the unspent remainder to `free`. Tokens and usd are separate
 * channels (`LoopTokenUsage` has no `usd`); iterations are conserved alongside them.
 *
 * Pure and deterministic: `now()` is injected, there is no I/O, and no wall-clock or
 * RNG read. A `reserve`/`reconcile` ticket is single-use (fail-loud on double or
 * unknown reconcile) so a child can never refund twice.
 *
 * @experimental
 */

import { addTokenUsage, zeroTokenUsage } from '../util'
import type { Budget, LoopTokenUsage, Spend, UsageEvent } from './types'

export type { Budget, Spend, UsageEvent }

/** Opaque, single-use reservation handle returned by `reserve` and consumed by
 *  `reconcile`. Carries the reserved ceilings so reconciliation needs no lookup. */
export interface ReservationTicket {
  readonly id: number
  readonly reserved: {
    readonly tokens: number
    readonly usd: number
    readonly iterations: number
  }
}

/** Post-reservation pool readout — the shape `Scope.budget` exposes. `tokensLeft`,
 *  `usdLeft`, and `reservedTokens` reflect committed-but-unsettled reservations;
 *  `deadlineMs` is the ABSOLUTE wall-clock deadline (0 when the root set none).
 *  `usdCapped` distinguishes a real `usdLeft <= 0` exhaustion from an uncapped pool (which always
 *  reads `usdLeft: 0`) — the in-loop guard needs it to bound a usd-capped driver. */
export type BudgetReadout = Readonly<{
  tokensLeft: number
  usdLeft: number
  usdCapped: boolean
  deadlineMs: number
  reservedTokens: number
}>

export interface BudgetPool {
  /**
   * Atomically reserve a child's full ceiling from the free balance. Fails closed
   * ({ ok: false }) when the pool can't cover tokens, usd, or iterations — the
   * caller inspects `ok` before `ticket`.
   */
  reserve(
    b: Budget,
  ): { ok: true; ticket: ReservationTicket } | { ok: false; reason: 'budget-exhausted' }
  /**
   * Release a reservation: commit the actual `spent`, refund the unspent remainder
   * to the free pool. Throws on an unknown or already-reconciled ticket (fail loud —
   * a double refund would silently break conservation).
   */
  reconcile(ticket: ReservationTicket, spent: Spend): void
  /** Fold a normalized `UsageEvent` stream (or array) into a `Spend`. Tokens via
   *  `addTokenUsage`, usd on its own channel, iterations from `'iteration'` events.
   *  `ms` is left zero — wall-clock duration is the caller's to record, not the pool's. */
  spendFrom(events: AsyncIterable<UsageEvent> | UsageEvent[]): Promise<Spend>
  /** The current readout, reflecting all outstanding reservations. */
  readout(): BudgetReadout
  /**
   * Record OBSERVED spend that did NOT go through reserve/reconcile — the driver's OWN inference
   * (its chat turns), which is real compute but not a spawned child. A direct `free → committed`
   * debit, so `total ≡ free + reserved + committed` is preserved: equal-k counts the driver's
   * tokens and the in-loop budget guard (`readout().tokensLeft`) sees them. `free` may go negative
   * when a run overspends — that is honest (the readout then signals exhaustion). It never throws:
   * the spend already happened, so accounting records reality; the in-loop guard prevents MORE.
   * The DURABLE record is the journal's `metered` event (written by `Scope.meter`); this debit
   * only makes the live `readout()` reflect driver inference for the in-loop guard.
   */
  observe(spend: Spend): void
  /** Fail loud if any reservation is still open — the conserved-pool leak detector. Called at the
   *  supervisor's join barrier: once every child has settled, no ticket may remain (a leaked
   *  reservation would silently break `total ≡ free + reserved + committed`). */
  assertNoOpenTickets(): void
}

/** Fold a normalized `UsageEvent` array into a `Spend`. Tokens and usd are separate
 *  channels; iterations come from `'iteration'` events. Pure; `ms` stays zero (the
 *  pool does not read wall-clock). */
export function spendFromUsageEvents(events: UsageEvent[]): Spend {
  const tokens = zeroTokenUsage()
  let usd = 0
  let iterations = 0
  for (const ev of events) {
    if (ev.kind === 'tokens') {
      addTokenUsage(tokens, { input: ev.input, output: ev.output })
    } else if (ev.kind === 'cost') {
      usd += ev.usd
    } else {
      iterations += 1
    }
  }
  return { iterations, tokens, usd, ms: 0 }
}

async function foldUsage(events: AsyncIterable<UsageEvent> | UsageEvent[]): Promise<Spend> {
  if (Array.isArray(events)) return spendFromUsageEvents(events)
  const tokens = zeroTokenUsage()
  let usd = 0
  let iterations = 0
  for await (const ev of events) {
    if (ev.kind === 'tokens') {
      addTokenUsage(tokens, { input: ev.input, output: ev.output })
    } else if (ev.kind === 'cost') {
      usd += ev.usd
    } else {
      iterations += 1
    }
  }
  return { iterations, tokens, usd, ms: 0 }
}

function totalTokens(usage: LoopTokenUsage): number {
  return usage.input + usage.output
}

/**
 * Create a conserved reservation pool from a root `Budget`. `now()` is injected so the
 * deadline readout is deterministic; defaults to `Date.now` for non-test callers. The
 * absolute deadline is fixed at construction (`now() + budget.deadlineMs`) so the
 * readout's `deadlineMs` is a stable wall-clock instant, not a shrinking remainder.
 */
export function createBudgetPool(root: Budget, now: () => number = Date.now): BudgetPool {
  // free + reserved + committed ≡ root totals, per channel, always.
  let freeTokens = root.maxTokens
  let reservedTokens = 0
  let committedTokens = 0

  const usdCapped = root.maxUsd !== undefined
  let freeUsd = root.maxUsd ?? 0
  let reservedUsd = 0
  let committedUsd = 0

  let freeIterations = root.maxIterations
  let reservedIterations = 0
  let committedIterations = 0

  const absoluteDeadlineMs = root.deadlineMs !== undefined ? now() + root.deadlineMs : 0

  let nextTicketId = 0
  const open = new Set<number>()

  function reserve(
    b: Budget,
  ): { ok: true; ticket: ReservationTicket } | { ok: false; reason: 'budget-exhausted' } {
    const wantTokens = b.maxTokens
    const wantUsd = b.maxUsd ?? 0
    const wantIterations = b.maxIterations
    // Fail-closed admission: every requested channel must fit the free balance. A
    // usd request against an uncapped root is unsatisfiable (the root declared no $).
    if (wantTokens > freeTokens) return { ok: false, reason: 'budget-exhausted' }
    if (wantIterations > freeIterations) return { ok: false, reason: 'budget-exhausted' }
    if (wantUsd > 0 && (!usdCapped || wantUsd > freeUsd)) {
      return { ok: false, reason: 'budget-exhausted' }
    }

    freeTokens -= wantTokens
    reservedTokens += wantTokens
    freeIterations -= wantIterations
    reservedIterations += wantIterations
    if (wantUsd > 0) {
      freeUsd -= wantUsd
      reservedUsd += wantUsd
    }

    const id = nextTicketId++
    open.add(id)
    return {
      ok: true,
      ticket: { id, reserved: { tokens: wantTokens, usd: wantUsd, iterations: wantIterations } },
    }
  }

  function reconcile(ticket: ReservationTicket, spent: Spend): void {
    if (!open.has(ticket.id)) {
      throw new Error(`budget pool: reconcile of unknown or already-settled ticket ${ticket.id}`)
    }
    open.delete(ticket.id)

    const { tokens: rTokens, usd: rUsd, iterations: rIterations } = ticket.reserved
    if (usdCapped && spent.usdKnown === false) {
      throw new Error(
        `budget pool: ticket ${ticket.id} reported unknown dollar cost under a dollar-capped budget`,
      )
    }

    // Clamp actual spend to the reservation: a child must never commit more than it
    // reserved (that would overdraw the conserved pool). Over-spend is a fail-loud bug.
    const spentTokens = totalTokens(spent.tokens)
    if (spentTokens > rTokens) {
      throw new Error(
        `budget pool: ticket ${ticket.id} spent ${spentTokens} tokens > reserved ${rTokens}`,
      )
    }
    if (spent.iterations > rIterations) {
      throw new Error(
        `budget pool: ticket ${ticket.id} spent ${spent.iterations} iterations > reserved ${rIterations}`,
      )
    }
    // USD is conserved ONLY when the root declared a ceiling. `maxUsd` is optional: when no
    // root ceiling exists, usd is an OBSERVED quantity (committed for accounting), never a
    // budgeted constraint — so an unset ceiling must not behave as a hard $0 limit that
    // fail-closes a real priced spend. The over-spend clamp applies only to a capped pool.
    if (usdCapped && spent.usd > rUsd) {
      throw new Error(`budget pool: ticket ${ticket.id} spent $${spent.usd} > reserved $${rUsd}`)
    }

    // Release the whole reservation, then commit actual spend; the difference is the
    // refund that flows back to `free`.
    reservedTokens -= rTokens
    committedTokens += spentTokens
    freeTokens += rTokens - spentTokens

    reservedIterations -= rIterations
    committedIterations += spent.iterations
    freeIterations += rIterations - spent.iterations

    if (usdCapped && rUsd > 0) {
      reservedUsd -= rUsd
      committedUsd += spent.usd
      freeUsd += rUsd - spent.usd
    } else {
      // Uncapped (or a zero-ceiling child under a capped root): record the observed spend
      // without touching the reservation channel — usd is accounted, not conserved here.
      committedUsd += spent.usd
    }
  }

  function observe(spend: Spend): void {
    if (usdCapped && spend.usdKnown === false) {
      throw new Error(
        'budget pool: cannot observe unknown dollar cost under a dollar-capped budget',
      )
    }
    const tokens = totalTokens(spend.tokens)
    // Direct free → committed debit (no reservation ticket). `free` may go negative on overspend —
    // that is honest; the readout then reports exhaustion and the in-loop guard halts the driver.
    // The DURABLE record of this spend is the journal's `metered` event (the twin written by
    // `Scope.meter`); this debit exists only to make the live `readout()` reflect driver inference.
    freeTokens -= tokens
    committedTokens += tokens
    freeIterations -= spend.iterations
    committedIterations += spend.iterations
    committedUsd += spend.usd
    if (usdCapped) freeUsd -= spend.usd
  }

  function readout(): BudgetReadout {
    return {
      tokensLeft: freeTokens,
      usdLeft: usdCapped ? freeUsd : 0,
      usdCapped,
      deadlineMs: absoluteDeadlineMs,
      reservedTokens,
    }
  }

  function assertNoOpenTickets(): void {
    if (open.size > 0) {
      throw new Error(
        `budget pool: ${open.size} reservation(s) still open at join barrier (leaked ticket ids: ${[...open].join(', ')}) — conserved-pool invariant violated`,
      )
    }
  }

  return {
    reserve,
    reconcile,
    spendFrom: foldUsage,
    readout,
    observe,
    assertNoOpenTickets,
  }
}
