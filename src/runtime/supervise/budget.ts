/**
 *
 * The conserved budget reservation pool — the invariant the whole instrument
 * rests on (critique M5/B3). One root `Budget` becomes a conserved pool of three
 * quantities (tokens, usd, iterations) plus an absolute deadline. Children reserve
 * atomically at spawn and reconcile at settle:
 *
 *   total ≡ free + reserved + committed          (for every known quantity)
 *
 * `reserve` moves a child's whole ceiling from `free` → `reserved` and fails closed
 * when `free` can't cover it (never read-then-spawn overcommit, so `Σk(treatment) ≡
 * Σk(blind)` by construction). `reconcile` releases the reservation, commits ACTUAL
 * spend, and refunds the unspent remainder to `free`. Tokens and usd are separate
 * channels (`LoopTokenUsage` has no `usd`); iterations are conserved alongside them.
 *
 * Pure and deterministic: `now()` is injected, there is no I/O, and no wall-clock or
 * RNG read. A `reserve`/`reconcile` ticket is single-use (fail-loud on double or
 * unknown reconcile) so a child can never refund twice. Reconciling an OPEN ticket always
 * closes it: a fail-loud condition settles the reservation first and throws afterwards, so no
 * error path can strand a reservation past the join barrier's `assertNoOpenTickets`.
 * A child that declared no `maxUsd` reserved no dollar allocation, so its real dollars are
 * committed as observed spend and debited from the root's balance rather than treated as an
 * overspend of a $0 ceiling it never asked for. If dollar cost is unknowable under a
 * dollar limit, reconciliation closes the known token/iteration work, marks the dollar channel
 * unusable, and refuses later reservations; inventing a numeric dollar total would be worse.
 * If a TOKEN count is unknowable (a provider that reported no usage for work that ran), the pool
 * records the work, debits what it knows, and marks `readout().tokensKnown` false — the balance is
 * then a ceiling, not a measurement. It does not close admission the way the dollar channel does:
 * tokens are always capped, so one unreported turn must not end the run.
 *
 * A pool can be RESTORED from a prior process's durable record (same-host restart): measured
 * committed spend is debited exactly once, and each child journaled as started but never settled
 * is charged at its full declared ceiling — restart never mints capacity, and the unknown flags
 * stay visible in every later readout. The original absolute deadline never slides.
 *
 * @experimental
 */

import { ValidationError } from '../../errors'
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
    /**
     * Whether the child's `Budget` actually declared `maxUsd`. `reserved.usd` is `0` for BOTH a
     * child that named no dollar ceiling and one that named `$0`, and the two settle differently:
     * an undeclared ceiling cannot be exceeded, so the child's real dollars are committed as
     * OBSERVED spend, while a declared ceiling of `$0` is a limit whose breach is fail-loud.
     * Optional so an externally constructed ticket stays valid; an absent flag is read as
     * `true` — the strict, fail-closed reading.
     */
    readonly usdBudgeted?: boolean
  }
}

/** Post-reservation pool readout — the shape `Scope.budget` exposes. `tokensLeft`,
 *  `usdLeft`, and `reservedTokens` reflect committed-but-unsettled reservations;
 *  `deadlineMs` is the ABSOLUTE wall-clock deadline (0 when the root set none).
 *  `iterationsLeft` is the remaining iteration capacity.
 *  `usdCapped` distinguishes a real `usdLeft <= 0` exhaustion from an uncapped pool (which always
 *  reads `usdLeft: 0`) — the in-loop guard needs it to bound a usd-capped driver. */
export type BudgetReadout = Readonly<{
  tokensLeft: number
  /**
   * False once the pool has recorded work whose token count was UNREPORTED (a `Spend` with
   * `tokensKnown: false`). `tokensLeft` is then a ceiling on what remains, not a measurement: real
   * consumption is at least the debited amount and possibly more. Reading `tokensLeft` without this
   * flag would present an under-count as an exact balance.
   */
  tokensKnown: boolean
  usdLeft: number
  usdCapped: boolean
  /** False once any recorded work reported an unknown dollar cost; the dollar totals are then a
   *  lower bound on real spend, not a measurement. */
  usdKnown: boolean
  iterationsLeft: number
  deadlineMs: number
  reservedTokens: number
}>
/** Why a reservation was refused. `budget-exhausted` means the pool ran out of a channel it
 * budgets; `usd-unbudgeted` means the root declared no dollar ceiling, so a dollar request is
 * unsatisfiable at any amount and the fix is to budget the root, not to ask for less. */
export type ReservationRejection = 'budget-exhausted' | 'usd-unbudgeted'

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
  for (const [field, value] of [
    ['input', spend.tokens.input],
    ['output', spend.tokens.output],
    ['freshInput', spend.tokens.freshInput],
    ['cacheRead', spend.tokens.cacheRead],
    ['cacheWrite', spend.tokens.cacheWrite],
  ] as const) {
    if (value === undefined) continue
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label}.tokens.${field} must be a non-negative safe integer`)
    }
  }
  for (const [field, value] of [
    ['tokensKnown', spend.tokens.tokensKnown],
    ['cacheBreakdownKnown', spend.tokens.cacheBreakdownKnown],
  ] as const) {
    if (value !== undefined && value !== false) {
      throw new Error(`${label}.tokens.${field} must be false when present`)
    }
  }
  const { freshInput, cacheRead, cacheWrite } = spend.tokens
  if (
    freshInput !== undefined &&
    cacheRead !== undefined &&
    cacheWrite !== undefined &&
    freshInput + cacheRead + cacheWrite !== spend.tokens.input
  ) {
    throw new Error(`${label}.tokens cache classes must sum to input`)
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
  ): { ok: true; ticket: ReservationTicket } | { ok: false; reason: ReservationRejection }
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
  let tokensKnown = true
  let usd = 0
  let usdKnown = true
  let iterations = 0
  for (const ev of events) {
    if (ev.kind === 'tokens') {
      addTokenUsage(tokens, ev)
      if (ev.tokensKnown === false) tokensKnown = false
    } else if (ev.kind === 'cost') {
      usd += ev.usd
      if (ev.usdKnown === false) usdKnown = false
    } else {
      iterations += 1
    }
  }
  return {
    iterations,
    tokens,
    ...(tokensKnown ? {} : { tokensKnown: false }),
    usd,
    ...(usdKnown ? {} : { usdKnown: false }),
    ms: 0,
  }
}

async function foldUsage(events: AsyncIterable<UsageEvent> | UsageEvent[]): Promise<Spend> {
  if (Array.isArray(events)) return spendFromUsageEvents(events)
  const tokens = zeroTokenUsage()
  let tokensKnown = true
  let usd = 0
  let usdKnown = true
  let iterations = 0
  for await (const ev of events) {
    if (ev.kind === 'tokens') {
      addTokenUsage(tokens, ev)
      if (ev.tokensKnown === false) tokensKnown = false
    } else if (ev.kind === 'cost') {
      usd += ev.usd
      if (ev.usdKnown === false) usdKnown = false
    } else {
      iterations += 1
    }
  }
  return {
    iterations,
    tokens,
    ...(tokensKnown ? {} : { tokensKnown: false }),
    usd,
    ...(usdKnown ? {} : { usdKnown: false }),
    ms: 0,
  }
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
  // Set once the pool records work with an unreported token count, and never cleared. Unlike
  // `usdTainted` it does NOT close admission: the token channel is always capped, so refusing every
  // later reservation would turn one provider that skipped a usage report into a dead run. The pool
  // keeps enforcing the cap on what it knows and reports, via `readout().tokensKnown`, that the
  // balance is an under-count rather than a measurement.
  let tokensTainted = false

  const usdCapped = root.maxUsd !== undefined
  let freeUsd = root.maxUsd ?? 0
  let reservedUsd = 0
  let committedUsd = 0
  // Closes dollar admission: set when unknown dollar cost lands under a dollar-capped root.
  let usdTainted = false
  // Reporting only: set whenever ANY recorded work carried `usdKnown: false`, capped or not, so
  // the readout never presents a lower bound as a measured dollar total.
  let usdMeasured = true

  let freeIterations = root.maxIterations
  let reservedIterations = 0
  let committedIterations = 0

  const absoluteDeadlineMs =
    restore.absoluteDeadlineMs ?? (root.deadlineMs !== undefined ? now() + root.deadlineMs : 0)

  let nextTicketId = 0
  const open = new Set<number>()

  function reserve(
    b: Budget,
  ): { ok: true; ticket: ReservationTicket } | { ok: false; reason: ReservationRejection } {
    assertValidBudget(b, 'reservation budget')
    const wantTokens = b.maxTokens
    const wantUsd = b.maxUsd ?? 0
    const wantIterations = b.maxIterations
    if (usdCapped && usdTainted) return { ok: false, reason: 'budget-exhausted' }
    // Fail-closed admission: every requested channel must fit the free balance. A
    // usd request against an uncapped root is unsatisfiable (the root declared no $).
    if (wantTokens > freeTokens) return { ok: false, reason: 'budget-exhausted' }
    if (wantIterations > freeIterations) return { ok: false, reason: 'budget-exhausted' }
    // A dollar request against a root that declared no dollar ceiling can never be satisfied at
    // ANY amount, which is a different fact from an exhausted balance and calls for a different
    // fix: budget the root, do not retry smaller. Reporting both as `budget-exhausted` invites a
    // caller to shrink its request forever — observed live, a driver walked its child budget down
    // to $0.01 and spent 68k tokens before asking for help.
    if (wantUsd > 0 && !usdCapped) return { ok: false, reason: 'usd-unbudgeted' }
    if (wantUsd > freeUsd) return { ok: false, reason: 'budget-exhausted' }

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
      ticket: {
        id,
        reserved: {
          tokens: wantTokens,
          usd: wantUsd,
          iterations: wantIterations,
          usdBudgeted: b.maxUsd !== undefined,
        },
      },
    }
  }

  function reconcile(ticket: ReservationTicket, spent: Spend): void {
    if (!open.has(ticket.id)) {
      throw new Error(`budget pool: reconcile of unknown or already-settled ticket ${ticket.id}`)
    }
    assertValidSpend(spent, `budget pool ticket ${ticket.id} spend`)
    const { tokens: rTokens, usd: rUsd, iterations: rIterations } = ticket.reserved
    const unknownUnderCap = usdCapped && spent.usdKnown === false
    const spentTokens = totalTokens(spent.tokens)
    // A child whose `Budget` named no `maxUsd` reserved NO dollar allocation, so it has no
    // dollar ceiling to exceed: under a capped root its real dollars are OBSERVED spend, and
    // the settlement below commits them and debits them from `free` (the same treatment
    // `observe` gives driver inference). Only a child that DECLARED a ceiling can overspend
    // one. Conflating the two made a successful priced child fail its own reconcile.
    const usdBudgeted = ticket.reserved.usdBudgeted !== false

    // Fail-loud conditions are DECIDED here and thrown at the very END, after the reservation
    // has been settled. A throw placed before settlement is how a ticket escapes the pool:
    // `Scope.runChild` marks the child reconciled before calling, so nothing retries, the
    // ticket stays open forever, and `assertNoOpenTickets` fails the whole run at the join
    // barrier — on the SUCCESS path. Everything between here and the throw is unconditional
    // pure arithmetic that cannot skip the settlement.
    let violation: string | undefined
    if (spentTokens > rTokens) {
      // A child must never commit more than it reserved (that would overdraw the conserved
      // pool). The settlement still commits the ACTUAL spend and lets `free` go negative,
      // which keeps `total ≡ free + reserved + committed` exact and reports the overdraw
      // through the readout instead of stranding the reservation.
      violation = `ticket ${ticket.id} spent ${spentTokens} tokens > reserved ${rTokens}`
    } else if (spent.iterations > rIterations) {
      violation = `ticket ${ticket.id} spent ${spent.iterations} iterations > reserved ${rIterations}`
    } else if (usdCapped && usdBudgeted && spent.usd > rUsd) {
      // USD is conserved ONLY when the root declared a ceiling AND the child declared one to
      // be measured against. `maxUsd` is optional on both: when either is unset, usd is an
      // OBSERVED quantity (committed for accounting), never a budgeted constraint — an unset
      // ceiling must not behave as a hard $0 limit that fail-closes a real priced spend.
      violation = `ticket ${ticket.id} spent $${spent.usd} > reserved $${rUsd}`
    } else if (unknownUnderCap) {
      // The known channels still settle, then the dollar channel is permanently tainted and
      // admission closes.
      violation = `ticket ${ticket.id} reported unknown dollar cost under a dollar-capped budget`
    }

    // ── Settlement: unconditional, and the only place the ticket closes ───────────────
    open.delete(ticket.id)

    // Release the whole reservation, then commit actual spend; the difference is the
    // refund that flows back to `free`.
    if (spent.tokensKnown === false) tokensTainted = true
    if (spent.usdKnown === false) usdMeasured = false
    reservedTokens -= rTokens
    committedTokens += spentTokens
    freeTokens += rTokens - spentTokens

    reservedIterations -= rIterations
    committedIterations += spent.iterations
    freeIterations += rIterations - spent.iterations

    if (usdCapped) {
      reservedUsd -= rUsd
      committedUsd += spent.usd
      if (unknownUnderCap) {
        usdTainted = true
        freeUsd = 0
      } else {
        // `rUsd` is 0 for a child that declared no ceiling, so this debits its observed
        // dollars straight out of the capped root's free balance — the root's `usdLeft`
        // shrinks by what the child really spent and admission closes when it runs out.
        freeUsd += rUsd - spent.usd
      }
    } else {
      // With no root dollar limit, record observed spend without a reservation channel.
      committedUsd += spent.usd
    }

    if (violation !== undefined) throw new Error(`budget pool: ${violation}`)
  }

  function observe(spend: Spend): void {
    assertValidSpend(spend, 'observed spend')
    // Unknown dollars under a dollar cap are REFUSED before any balance mutates: unlike a
    // reconciled child (whose reservation must settle), an observation has no ticket to strand,
    // so the honest reading is a fail-loud refusal the caller surfaces — `driver-failed` carrying
    // this reason — rather than an invented figure or a silently consumed cap.
    if (usdCapped && spend.usdKnown === false) {
      // A typed refusal, not a bare invariant guard: this is a contract failure the caller sees on
      // the `driver-failed` arm, and a driver retry must be able to tell it apart from a foreign
      // accident it could recover from.
      throw new ValidationError(
        'budget pool: cannot observe unknown dollar cost under a dollar-capped budget',
      )
    }
    // Work whose token count was never reported still debits what IS known (usually nothing) and
    // marks the balance incomplete. The alternative — refusing to record it — is the "free turn"
    // the pool must never see.
    if (spend.tokensKnown === false) tokensTainted = true
    if (spend.usdKnown === false) usdMeasured = false
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
      tokensKnown: !tokensTainted,
      usdLeft: usdCapped ? (usdTainted ? 0 : freeUsd) : 0,
      usdCapped,
      usdKnown: usdMeasured && !usdTainted,
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
  // capacity usable. The false known flags remain visible in every later report. Restore uses
  // direct arithmetic rather than `observe`, because the prior process's spend ALREADY happened:
  // refusing to record it would be the zero-cost restart the pool must never allow.
  if (restore.committed !== undefined) {
    assertValidSpend(restore.committed, 'budget restore committed')
    const committed = restore.committed
    if (committed.tokensKnown === false) tokensTainted = true
    if (committed.usdKnown === false) usdMeasured = false
    const tokens = totalTokens(committed.tokens)
    freeTokens -= tokens
    committedTokens += tokens
    freeIterations -= committed.iterations
    committedIterations += committed.iterations
    committedUsd += committed.usd
    if (usdCapped) {
      freeUsd -= committed.usd
      if (committed.usdKnown === false) {
        // The prior process spent dollars it could not measure under a dollar cap: the remaining
        // balance is not a sound bound, so consume it and close dollar admission.
        usdTainted = true
        if (freeUsd > 0) committedUsd += freeUsd
        freeUsd = 0
      }
    }
  }
  for (const [index, uncertain] of (restore.uncertainReservations ?? []).entries()) {
    assertValidBudget(uncertain, `budget restore uncertainReservations[${index}]`)
    // The child ran (or may have run) without a settle record: its telemetry is unknown, so the
    // pool charges the full declared ceiling and reports the balance as a ceiling, never a
    // measurement.
    tokensTainted = true
    usdMeasured = false
    freeTokens -= uncertain.maxTokens
    committedTokens += uncertain.maxTokens
    freeIterations -= uncertain.maxIterations
    committedIterations += uncertain.maxIterations
    if (usdCapped) {
      if (uncertain.maxUsd === undefined) {
        // No child dollar ceiling existed, so the root's remaining dollar capacity is not safe.
        usdTainted = true
        committedUsd += freeUsd > 0 ? freeUsd : 0
        freeUsd = 0
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
