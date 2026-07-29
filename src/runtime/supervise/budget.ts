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
 *  `iterationsLeft` is the remaining iteration capacity. `tokensKnown`/`usdKnown` are false when
 *  any prior or current execution lacks measured telemetry; the numeric remainder may still be a
 *  safe admission bound when an in-doubt child has already been charged at its full reservation.
 *  `usdCapped` distinguishes a real `usdLeft <= 0` exhaustion from an uncapped pool (which always
 *  reads `usdLeft: 0`) — the in-loop guard needs it to bound a usd-capped driver. */
export type BudgetReadout = Readonly<{
  tokensLeft: number
  tokensKnown: boolean
  usdLeft: number
  usdCapped: boolean
  usdKnown: boolean
  iterationsLeft: number
  deadlineMs: number
  reservedTokens: number
}>

/** State recovered from a prior process before new work is admitted. `committed` is measured spend
 * already present in the durable journal. Each `uncertainReservation` is a child that was recorded
 * as started but never recorded as settled: its full declared ceiling is charged conservatively,
 * while the public readout remains explicitly unknown. */
export interface BudgetPoolRestore {
  readonly committed?: Spend
  readonly uncertainReservations?: ReadonlyArray<Budget>
  /** Original absolute deadline from the first process. It may never slide on restart. */
  readonly absoluteDeadlineMs?: number
}

/** Reject malformed ceilings before they can mint capacity through negative reservations. */
export function assertValidBudget(budget: Budget, label = 'budget'): void {
  const safeInteger = (value: number, field: string) => {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label}.${field} must be a non-negative safe integer`)
    }
  }
  const finiteNonNegative = (value: number, field: string) => {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label}.${field} must be a non-negative finite number`)
    }
  }
  safeInteger(budget.maxIterations, 'maxIterations')
  safeInteger(budget.maxTokens, 'maxTokens')
  if (budget.maxUsd !== undefined) finiteNonNegative(budget.maxUsd, 'maxUsd')
  if (budget.deadlineMs !== undefined) finiteNonNegative(budget.deadlineMs, 'deadlineMs')
}

function assertValidSpend(spend: Spend, label: string): void {
  if (!Number.isSafeInteger(spend.iterations) || spend.iterations < 0) {
    throw new Error(`${label}.iterations must be a non-negative safe integer`)
  }
  for (const [field, value] of Object.entries(spend.tokens)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label}.tokens.${field} must be a non-negative safe integer`)
    }
  }
  for (const [field, value] of [
    ['usd', spend.usd],
    ['ms', spend.ms],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label}.${field} must be a non-negative finite number`)
    }
  }
}

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
 * absolute deadline for a fresh pool is fixed at construction (`now() + budget.deadlineMs`). A
 * restored pool instead retains `restore.absoluteDeadlineMs`, so restart never slides the original
 * wall-clock limit. The readout is an absolute instant, not a shrinking remainder.
 */
export function createBudgetPool(
  root: Budget,
  now: () => number = Date.now,
  restore: BudgetPoolRestore = {},
): BudgetPool {
  assertValidBudget(root, 'root budget')
  if (
    restore.absoluteDeadlineMs !== undefined &&
    (!Number.isFinite(restore.absoluteDeadlineMs) || restore.absoluteDeadlineMs < 0)
  ) {
    throw new Error('budget restore.absoluteDeadlineMs must be a non-negative finite number')
  }
  // free + reserved + committed ≡ root totals, per channel, always.
  let freeTokens = root.maxTokens
  let reservedTokens = 0
  let committedTokens = 0
  let tokensKnown = true

  const usdCapped = root.maxUsd !== undefined
  let freeUsd = root.maxUsd ?? 0
  let reservedUsd = 0
  let committedUsd = 0
  let usdKnown = true

  // `Known` describes the final telemetry. `AdmissionSafe` describes whether the remaining
  // numeric capacity is still a sound upper bound. A killed child makes telemetry unknown but its
  // declared reservation can still be charged in full, leaving the rest safe to use. An executor
  // that reports wholly unbounded usage consumes the remaining channel and makes it unsafe.
  let tokensAdmissionSafe = true
  let usdAdmissionSafe = true

  let freeIterations = root.maxIterations
  let reservedIterations = 0
  let committedIterations = 0

  const absoluteDeadlineMs =
    restore.absoluteDeadlineMs ?? (root.deadlineMs !== undefined ? now() + root.deadlineMs : 0)

  let nextTicketId = 0
  const open = new Set<number>()

  function reserve(
    b: Budget,
  ): { ok: true; ticket: ReservationTicket } | { ok: false; reason: 'budget-exhausted' } {
    assertValidBudget(b, 'reservation budget')
    if (!tokensAdmissionSafe || (usdCapped && !usdAdmissionSafe)) {
      return { ok: false, reason: 'budget-exhausted' }
    }
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

    assertValidSpend(spent, `budget pool ticket ${ticket.id} spend`)
    const { tokens: rTokens, usd: rUsd, iterations: rIterations } = ticket.reserved
    const unknownTokens = spent.tokensKnown === false
    const unknownUsd = spent.usdKnown === false
    const unknownCappedUsd = usdCapped && unknownUsd
    if (unknownUsd) usdKnown = false

    const spentTokens = totalTokens(spent.tokens)
    // Release the reservation and record ACTUAL spend. External providers can report an
    // overshoot after it has happened; free capacity goes negative so later admission stops.
    // Telemetry is never clamped to make the bookkeeping look within budget.
    open.delete(ticket.id)
    reservedTokens -= rTokens
    if (unknownTokens) {
      tokensKnown = false
      tokensAdmissionSafe = false
      committedTokens += rTokens + freeTokens
      freeTokens = 0
    } else {
      committedTokens += spentTokens
      freeTokens += rTokens - spentTokens
    }

    reservedIterations -= rIterations
    committedIterations += spent.iterations
    freeIterations += rIterations - spent.iterations

    if (unknownCappedUsd) {
      // The work already ran, but its dollar cost cannot be compared with the declared ceiling.
      // Close the ticket and consume all currently-free dollar capacity so no later work can treat
      // the unknown amount as $0. The durable Spend keeps `usdKnown:false`; this is only the live
      // pool's fail-closed upper bound.
      reservedUsd -= rUsd
      usdKnown = false
      usdAdmissionSafe = false
      committedUsd += rUsd + freeUsd
      freeUsd = 0
    } else if (usdCapped) {
      reservedUsd -= rUsd
      committedUsd += spent.usd
      freeUsd += rUsd - spent.usd
    } else {
      // Uncapped (or a zero-ceiling child under a capped root): record the observed spend
      // without touching the reservation channel — usd is accounted, not conserved here.
      committedUsd += spent.usd
    }
    if (unknownTokens || unknownCappedUsd) {
      throw new Error(
        `budget pool: ticket ${ticket.id} reported unknown ${[
          ...(unknownTokens ? ['token usage'] : []),
          ...(unknownCappedUsd ? ['dollar cost'] : []),
        ].join(' and ')} under a capped budget`,
      )
    }
  }

  function observe(spend: Spend): void {
    assertValidSpend(spend, 'observed spend')
    const unknownTokens = spend.tokensKnown === false
    const unknownCappedUsd = usdCapped && spend.usdKnown === false
    const tokens = totalTokens(spend.tokens)
    // Direct free → committed debit (no reservation ticket). `free` may go negative on overspend —
    // that is honest; the readout then reports exhaustion and the in-loop guard halts the driver.
    // The DURABLE record of this spend is the journal's `metered` event (the twin written by
    // `Scope.meter`); this debit exists only to make the live `readout()` reflect driver inference.
    freeTokens -= tokens
    committedTokens += tokens
    if (unknownTokens) {
      tokensKnown = false
      tokensAdmissionSafe = false
      if (freeTokens > 0) {
        committedTokens += freeTokens
        freeTokens = 0
      }
    }
    freeIterations -= spend.iterations
    committedIterations += spend.iterations
    if (unknownCappedUsd) {
      usdKnown = false
      usdAdmissionSafe = false
      committedUsd += spend.usd
      freeUsd -= spend.usd
      if (freeUsd > 0) {
        committedUsd += freeUsd
        freeUsd = 0
      }
    } else {
      if (spend.usdKnown === false) usdKnown = false
      committedUsd += spend.usd
      if (usdCapped) freeUsd -= spend.usd
    }
    if (unknownTokens || unknownCappedUsd) {
      throw new Error(
        `budget pool: cannot observe unknown ${[
          ...(unknownTokens ? ['token usage'] : []),
          ...(unknownCappedUsd ? ['dollar cost'] : []),
        ].join(' and ')} under a capped budget`,
      )
    }
  }

  function readout(): BudgetReadout {
    return {
      // This is safe remaining capacity, not a claim that prior telemetry was measured. A resumed
      // in-doubt child has already been charged at its full ceiling, so unrelated capacity can
      // remain usable while `tokensKnown:false` keeps the report honest.
      tokensLeft: freeTokens,
      tokensKnown,
      usdLeft: usdCapped ? freeUsd : 0,
      usdCapped,
      usdKnown,
      iterationsLeft: freeIterations,
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

  // Reconstruct the conserved balances before exposing the pool. Measured prior spend is debited
  // exactly once. A started-without-terminal child is charged at its entire reservation: this
  // never mints capacity on restart, but unlike treating unknown as zero it can leave unrelated
  // capacity usable. The false known flags remain visible in every later report.
  if (restore.committed !== undefined) {
    // `observe` deliberately throws only after consuming unknown capped telemetry, but it also
    // rejects malformed spend before mutation. Validate first so the narrow catch below cannot
    // turn a corrupt durable record into a zero-cost restart.
    assertValidSpend(restore.committed, 'budget restore committed')
    try {
      observe(restore.committed)
    } catch {
      // `observe` has already consumed the unsafe channel before it reports the unknown telemetry.
    }
  }
  for (const [index, uncertain] of (restore.uncertainReservations ?? []).entries()) {
    assertValidBudget(uncertain, `budget restore uncertainReservations[${index}]`)
    tokensKnown = false
    usdKnown = false
    freeTokens -= uncertain.maxTokens
    committedTokens += uncertain.maxTokens
    freeIterations -= uncertain.maxIterations
    committedIterations += uncertain.maxIterations
    if (usdCapped) {
      if (uncertain.maxUsd === undefined) {
        // No child dollar ceiling existed, so the root's remaining dollar capacity is not safe.
        committedUsd += freeUsd
        freeUsd = 0
        usdAdmissionSafe = false
      } else {
        freeUsd -= uncertain.maxUsd
        committedUsd += uncertain.maxUsd
      }
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
