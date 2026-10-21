/**
 * The conserved budget reservation pool — the invariant the whole instrument rests on (critique
 * M5/B3). One root `Budget` becomes a pool of standard quantities (tokens, usd, iterations) and
 * caller-named resources plus an absolute deadline. Children reserve atomically at spawn and
 * reconcile at settle:
 *
 *   total ≡ free + reserved + committed          (for every known quantity)
 *
 * `reserve` moves a child's whole ceiling `free` → `reserved` and fails closed when `free` can't
 * cover it (never read-then-spawn overcommit, so `Σk(treatment) ≡ Σk(blind)` by construction).
 * `reconcile` releases the reservation, commits ACTUAL spend, and refunds the remainder to `free`.
 * Tokens and usd are separate channels; iterations are conserved alongside them.
 *
 * The token unit is `chargedTokens`: every token counted ONCE, when it first enters the context
 * (`input − cacheRead + output`, which is `freshInput + cacheWrite + output` under a complete
 * split). A cached prefix was already charged when written; charging a cache read again made a
 * declared cap bite about 56x early on a real fleet (cache is 98% of the rolled-up prompt total).
 * No price weight enters the token channel; money is budgeted on `maxUsd`. The unit is additive,
 * so a rolled-up report agrees with the pool. Prompt tokens the provider never classified are
 * charged in full and `readout().cacheBreakdownKnown` reads false (an upper bound on newly-
 * presented work). The pool trusts reported usage: it is an accounting unit, not a trust boundary.
 *
 * Named resources require explicit units, ceilings, and complete executor measurements; missing
 * or unknown enforced measurements close admission for that resource. The pool trusts those
 * receipts and meters no external system. `Spend.boxMinutes` is evidence only, with no implicit
 * resource ceiling; never present estimated box lifetime as a measured resource receipt.
 *
 * Pure and deterministic: the run's start instant is supplied; no I/O, wall-clock or RNG read. A
 * ticket is single-use (fail-loud on double or unknown reconcile). Reconciling an OPEN ticket
 * always closes it: a fail-loud condition settles the reservation first and throws afterwards, so
 * no error path strands a reservation past `assertNoOpenTickets`. Measured spend above a
 * reservation is not fail-loud: the pool commits it, returns a `BudgetViolation`, and refuses
 * later reservations from the reduced free balance. A child that declared no `maxUsd` reserved no
 * dollars, so its real dollars are committed as observed spend against the root, not as an
 * overspend of a $0 ceiling. Unknowable dollar cost under a dollar limit closes the known
 * token/iteration work, marks the dollar channel unusable and refuses later reservations. An
 * unknowable TOKEN count records the work, debits what is known, and marks
 * `readout().tokensKnown` false (a ceiling, not a measurement); tokens are always capped, so one
 * unreported turn must not end the run.
 *
 * A reservation the free balance cannot cover now can WAIT (`reserve(b, holder, { wait: true })`)
 * when it would fit once open reservations return. It holds nothing while waiting, so
 * conservation is untouched; waiters are granted in asking order and refused once no open
 * reservation is left to return any.
 *
 * A pool can be RESTORED from a prior process's durable record: measured committed spend is
 * debited once, and each child journaled as started but never settled is charged at its full
 * declared ceiling. Restart never mints capacity, unknown flags stay visible, and the original
 * absolute deadline never slides.
 *
 * @experimental
 */

import { ValidationError } from '../../errors'
import {
  type BudgetLedger,
  ledgerClassifyOverspend,
  ledgerObserve,
  ledgerRestore,
  ledgerSettle,
  ledgerShortfalls,
  ledgerTake,
  ledgerValidateUnits,
  openBudgetLedger,
} from './budget-ledger'
import { assertValidBudget, assertValidSpend } from './spend-validation'
import type { Budget, BudgetViolation, Spend, UsageEvent } from './types'
import { foldUsage } from './usage-metering'

/** A reconciliation whose spend the pool cannot verify, thrown after the reservation settled.
 *  `budgetViolation` carries any measured overspend on the same settlement. */
export class BudgetReconcileFault extends Error {
  readonly budgetViolation?: BudgetViolation

  constructor(message: string, budgetViolation?: BudgetViolation) {
    super(message)
    this.name = 'BudgetReconcileFault'
    if (budgetViolation !== undefined) this.budgetViolation = budgetViolation
  }
}

/** Opaque, single-use reservation handle returned by `reserve` and consumed by
 *  `reconcile`. Carries the reserved ceilings so reconciliation needs no lookup. */
export interface ReservationTicket {
  readonly id: number
  readonly reserved: {
    readonly resources?: Budget['resources']
    readonly tokens: number
    readonly usd: number
    readonly iterations: number
    /**
     * Whether the child's `Budget` declared `maxUsd`. `reserved.usd` is `0` for both an undeclared
     * ceiling (real dollars are committed as OBSERVED spend) and a declared `$0` (a breach is
     * fail-loud). An absent flag is read as `true`, the fail-closed reading.
     */
    readonly usdBudgeted?: boolean
  }
}

/** Where in the spawn lifecycle a reservation was last seen. `admitted` is the window between
 *  `reserve` and the hand-off to the child's execution, which the spawning code owns; `executing`
 *  means the child owns the ticket and only its settlement can close it. */
export type ReservationStage = 'admitted' | 'executing'

/** Who holds a reservation, recorded at `reserve` and refined through `attribute`, so a ticket
 *  stranded at the join barrier names its work. Only `stage` is required. */
export interface ReservationHolder {
  /** The caller's assignment identity (`SpawnOpts.assignmentId`, else its `key`). */
  readonly assignment?: string
  /** The spawn label — the name an operator recognizes in a journal. */
  readonly label?: string
  /** The spawned node's id, once admission minted one. */
  readonly childId?: string
  readonly stage: ReservationStage
}

/** One reservation still open at the join barrier — a pool leak, with the holder to chase. */
export interface LeakedReservation extends ReservationHolder {
  readonly ticketId: number
}

/** Post-reservation pool readout — the shape `Scope.budget` exposes. `deadlineMs` is the ABSOLUTE
 *  wall-clock deadline (0 when none). `usdCapped` distinguishes a real `usdLeft <= 0` exhaustion
 *  from an uncapped pool (which always reads `usdLeft: 0`). */
export type BudgetReadout = Readonly<{
  resources?: Readonly<
    Record<
      string,
      {
        unit: string
        limit: number
        remaining: number
        reserved: number
        committed: number
        known: boolean
      }
    >
  >
  tokensLeft: number
  /** False once the pool recorded work with UNREPORTED tokens (`tokensKnown: false`): `tokensLeft`
   *  is then a ceiling, and real consumption is at least the debited amount. */
  tokensKnown: boolean
  /** False once the pool charged a REPORTED spend whose prompt-cache split it could not read: the
   *  unclassified prompt tokens were charged in full, so the debit is an upper bound. Separate from
   *  `tokensKnown` (counts arrived, composition did not); a restored uncertain reservation leaves
   *  it alone, since a declared ceiling has no composition to misread. */
  cacheBreakdownKnown: boolean
  usdLeft: number
  usdCapped: boolean
  /** False once any recorded work reported an unknown dollar cost; the dollar totals are then a
   *  lower bound on real spend, not a measurement. */
  usdKnown: boolean
  iterationsLeft: number
  deadlineMs: number
  reservedTokens: number
}>

/** The part of each channel a reservation must leave free: a manager's own share of its slice,
 *  which its children may not reserve. */
export interface ReservationFloor {
  readonly tokens: number
  readonly iterations: number
  readonly usd?: number
}

/** How a caller asks for a reservation. */
export interface ReserveOptions {
  /** Wait for budget instead of failing, when the reservations still open would return enough.
   *  The reservation then holds nothing until it is granted. */
  readonly wait?: boolean
  /** Leave this much of each channel free after the reservation. */
  readonly keep?: ReservationFloor
}

/**
 * A waiting reservation that can never be granted: every open reservation settled and the free
 * balance still cannot cover it. `shortfalls` are the channels that did not fit at that moment.
 */
export class ReservationWaitRefused extends Error {
  readonly reason = 'budget-exhausted' as const
  readonly shortfalls: readonly ReservationShortfall[]

  constructor(shortfalls: readonly ReservationShortfall[]) {
    super(
      `budget-exhausted: nothing left running could return enough budget for this worker (${shortfalls
        .map(
          (shortfall) =>
            `${shortfall.channel} requested ${shortfall.requested}, free ${shortfall.free}`,
        )
        .join('; ')})`,
    )
    this.name = 'ReservationWaitRefused'
    this.shortfalls = shortfalls
  }
}

/** Why a reservation was refused. `usd-unbudgeted`: the root declared no dollar ceiling, so the
 * fix is to budget the root, not to ask for less. */
export type ReservationRejection = 'budget-exhausted' | 'usd-unbudgeted'

/** One channel a `budget-exhausted` reservation could not fit. A refusal lists every such channel
 * so shrinking one request is not met by a second refusal (a director whose 100-iteration child
 * was refused spent a probe worker to learn the pool admitted 3). `free` is a snapshot, and a
 * driver's metered turns draw from the same pool, so only `iterations` can be requested at exactly
 * `free`. `closedByUnknownSpend`: unmeasured usage ran under that enforced limit, so the channel
 * refuses every reservation for the rest of the run. */
export interface ReservationShortfall {
  readonly channel: 'tokens' | 'iterations' | 'usd' | `resource:${string}`
  readonly requested: number
  readonly free: number
  /** What open reservations hold on this channel, when they hold any. A request of at most
   *  `free + held` can wait for them to settle; a larger one never fits. */
  readonly held?: number
  readonly closedByUnknownSpend?: true
}

/** State recovered from a prior process before new work is admitted. `committed` is measured spend
 * already present in the durable journal. Each `uncertainReservation` is a child that was recorded
 * as started but never recorded as settled: its full declared ceiling is charged conservatively,
 * while the public readout remains explicitly unknown. */
export interface BudgetPoolRestore {
  readonly committed?: Spend
  readonly uncertainReservations?: ReadonlyArray<Budget>
}

export interface BudgetPool {
  /**
   * Atomically reserve a child's full ceiling from the free balance; fails closed
   * ({ ok: false }) when the pool can't cover standard or named channels.
   *
   * With `wait`, a request that could fit once open reservations return is admitted as a WAITING
   * ticket: `granted` resolves when reserved and rejects with `ReservationWaitRefused` once
   * nothing open could return enough. A waiting ticket reserves nothing; reconciling it withdraws
   * it. New waiting requests queue behind existing waiters, so asking order is grant order.
   */
  reserve(
    b: Budget,
    holder?: ReservationHolder,
    options?: ReserveOptions,
  ):
    | { ok: true; ticket: ReservationTicket; granted?: Promise<void> }
    | { ok: false; reason: ReservationRejection; shortfalls?: readonly ReservationShortfall[] }
  /** Name (or rename) who holds an open reservation, merging into what `reserve` recorded. A
   *  settled or unknown ticket is ignored: attribution is leak EVIDENCE, never a lifecycle guard. */
  attribute(ticket: ReservationTicket, holder: ReservationHolder): void
  /**
   * Release a reservation: commit the actual `spent`, refund the remainder. Throws on an unknown
   * or already-reconciled ticket (a double refund would break conservation). Returns the
   * overspend, after committing it; throws, also after committing, when the spend cannot be
   * verified (unknown dollars under a cap, unknown or overflowing enforced-resource usage).
   */
  reconcile(ticket: ReservationTicket, spent: Spend): BudgetViolation | undefined
  /** Fold a normalized `UsageEvent` stream (or array) into a `Spend`; `ms` is left zero. */
  spendFrom(events: AsyncIterable<UsageEvent> | UsageEvent[]): Promise<Spend>
  /** The current readout, reflecting all outstanding reservations. */
  readout(): BudgetReadout
  /**
   * Record OBSERVED spend outside reserve/reconcile — the driver's OWN inference. A direct
   * `free → committed` debit preserving the invariant; `free` may go negative on overspend.
   * Unknown enforced resource usage is recorded before throwing; partial increments defer
   * completeness checks until the terminal spend. Unknown dollars under a cap are refused, unless
   * `alreadySpent` says the work finished with no caller left to refuse (that closes dollar
   * admission instead). The DURABLE record is the journal's `metered` event (`Scope.meter`).
   */
  observe(spend: Spend, options?: { partial?: boolean; alreadySpent?: boolean }): void
  /** Fail loud if any reservation is still open — the leak detector, called at the join barrier. */
  assertNoOpenTickets(): void
  /** Every reservation still open, with its holder; lets a failed run REPORT a leak. */
  openReservations(): ReadonlyArray<LeakedReservation>
}

/**
 * Create a conserved reservation pool from a root `Budget`. `runStartedAtMs` is the WALL-CLOCK
 * instant the root was recorded; the deadline is `runStartedAtMs + root.deadlineMs` (`0` when
 * none), an absolute instant. A resumed pool passes the ORIGINAL instant.
 */
export function createBudgetPool(
  root: Budget,
  runStartedAtMs: number,
  restore: BudgetPoolRestore = {},
): BudgetPool {
  assertValidBudget(root, 'root budget')
  if (!Number.isFinite(runStartedAtMs) || runStartedAtMs < 0) {
    throw new Error('budget runStartedAtMs must be a non-negative finite number')
  }
  // free + reserved + committed ≡ root totals, per channel, always.
  const ledger = openBudgetLedger(root, runStartedAtMs)
  let nextTicketId = 0
  const open = new Map<number, ReservationHolder>()
  /** Tickets admitted to wait for budget, in the order they asked. Each is also in `open`. */
  const waiting: WaitingReservation[] = []
  /** Open tickets that hold nothing: waiting, or refused and not yet reconciled. */
  const holdingNothing = new Set<number>()

  /** Grant waiting tickets in the order they asked while the head fits. When the head does not
   *  fit and no reservation is held that could return budget, nothing can ever cover it: refuse
   *  it, and go on with the next. */
  function grantWaiting(): void {
    while (waiting.length > 0) {
      const head = waiting[0]!
      const shortfalls = ledgerShortfalls(ledger, head.budget, head.keep)
      if (shortfalls.length === 0) {
        waiting.shift()
        ledgerTake(ledger, head.budget)
        holdingNothing.delete(head.ticket.id)
        head.grant()
        continue
      }
      if (open.size > holdingNothing.size) return
      waiting.shift()
      head.refuse(new ReservationWaitRefused(shortfalls))
    }
  }

  /** Admit `b` to wait: it holds nothing until settlements return enough, in the order asked. */
  function admitToWait(
    b: Budget,
    holder: ReservationHolder,
    keep: ReservationFloor | undefined,
  ): { ok: true; ticket: ReservationTicket; granted: Promise<void> } {
    const id = nextTicketId++
    open.set(id, holder)
    const ticket = ticketFor(id, b)
    let grant!: () => void
    let refuse!: (error: ReservationWaitRefused) => void
    const granted = new Promise<void>((resolve, reject) => {
      grant = resolve
      refuse = reject
    })
    // A refusal the caller never reads (a withdrawn waiter) must not be an unhandled rejection.
    granted.catch(() => undefined)
    holdingNothing.add(id)
    waiting.push({ ticket, budget: b, keep, grant, refuse })
    return { ok: true, ticket, granted }
  }

  function reserve(
    b: Budget,
    holder: ReservationHolder = { stage: 'admitted' },
    options: ReserveOptions = {},
  ):
    | { ok: true; ticket: ReservationTicket; granted?: Promise<void> }
    | { ok: false; reason: ReservationRejection; shortfalls?: readonly ReservationShortfall[] } {
    assertValidBudget(b, 'reservation budget')
    assertResourceDeclarations(ledger, b)
    const wantUsd = b.maxUsd ?? 0
    const keep = options.keep
    // Fail-closed admission: every requested channel must fit the free balance. Every channel
    // that does not fit is reported, so a caller that shrinks one request is not refused again
    // on a second channel it was never told about.
    const shortfalls = ledgerShortfalls(ledger, b, keep)
    // A dollar request against a root with no dollar ceiling is unsatisfiable at ANY amount: budget
    // the root, don't retry smaller (a driver once walked its child budget down to $0.01, 68k
    // tokens). An exhausted channel above still takes precedence.
    if (shortfalls.length === 0 && wantUsd > 0 && !ledger.usdCapped) {
      return { ok: false, reason: 'usd-unbudgeted' }
    }
    const queueAhead = options.wait === true && waiting.length > 0
    if (shortfalls.length === 0 && !queueAhead) {
      ledgerTake(ledger, b)
      const id = nextTicketId++
      open.set(id, holder)
      return { ok: true, ticket: ticketFor(id, b) }
    }
    if (options.wait !== true || !fitsAfterRefunds(shortfalls)) {
      return { ok: false, reason: 'budget-exhausted', shortfalls }
    }
    return admitToWait(b, holder, keep)
  }

  function attribute(ticket: ReservationTicket, holder: ReservationHolder): void {
    const current = open.get(ticket.id)
    if (current === undefined) return
    open.set(ticket.id, { ...current, ...holder })
  }

  function reconcile(ticket: ReservationTicket, spent: Spend): BudgetViolation | undefined {
    if (!open.has(ticket.id)) {
      throw new Error(`budget pool: reconcile of unknown or already-settled ticket ${ticket.id}`)
    }
    assertValidSpend(spent, `budget pool ticket ${ticket.id} spend`)
    ledgerValidateUnits(ledger, spent)
    // A ticket still waiting, or refused while waiting, reserved nothing: it settles against a
    // zero reservation, and a waiting one leaves the queue.
    const heldNothing = holdingNothing.delete(ticket.id)
    if (heldNothing) {
      const index = waiting.findIndex((entry) => entry.ticket.id === ticket.id)
      if (index >= 0) waiting.splice(index, 1)
    }
    const held = heldNothing
      ? { tokens: 0, usd: 0, iterations: 0, resources: undefined }
      : ticket.reserved

    // Two outcomes are DECIDED here and reported at the END, after settlement: a throw before it
    // strands the ticket (`Scope.runChild` marks the child reconciled first, so nothing retries)
    // and `assertNoOpenTickets` fails the run. A FAULT (unverifiable spend) throws; an OVERSPEND
    // is returned, with `free` allowed negative (agent-runtime#1206). Unknown dollars are a fault
    // even beside an overspend.
    const usdBudgeted = ticket.reserved.usdBudgeted !== false
    const { overspent, unknownUnderCap } = ledgerClassifyOverspend(ledger, held, usdBudgeted, spent)
    let fault = unknownUnderCap
      ? `ticket ${ticket.id} reported unknown dollar cost under a dollar-capped budget`
      : undefined

    // Settlement: unconditional, and the only place the ticket closes.
    open.delete(ticket.id)
    const resourceSettlement = ledgerSettle(ledger, held, spent, unknownUnderCap)
    fault ??= resourceSettlement.fault
    overspent.push(...resourceSettlement.overspent)
    // The refund may cover waiting tickets, and a settlement that leaves nothing held ends the
    // wait of any ticket that cannot fit.
    grantWaiting()
    // Frozen: the same record reaches the journal, the settlement, and every observer.
    const violation =
      overspent.length === 0
        ? undefined
        : Object.freeze({
            overspent: Object.freeze(overspent.map((entry) => Object.freeze(entry))),
          })
    if (fault !== undefined) throw new BudgetReconcileFault(`budget pool: ${fault}`, violation)
    return violation
  }

  function observe(
    spend: Spend,
    options: { partial?: boolean; alreadySpent?: boolean } = {},
  ): void {
    assertValidSpend(spend, 'observed spend')
    ledgerValidateUnits(ledger, spend)
    // Unknown dollars under a cap are REFUSED before any balance mutates: an observation has no
    // ticket to strand, so the honest reading is a fail-loud `driver-failed`. Work already finished
    // with no caller left (a Runtime-owned analyst lens) closes dollar admission instead.
    const unknownUnderCap = ledger.usdCapped && spend.usdKnown === false
    if (unknownUnderCap && options.alreadySpent !== true) {
      // Typed so a driver retry can tell this contract failure from a recoverable accident.
      throw new ValidationError(
        'budget pool: cannot observe unknown dollar cost under a dollar-capped budget',
      )
    }
    const settlement = ledgerObserve(ledger, spend, unknownUnderCap, !options.partial)
    const violation = settlement.fault ?? settlement.rootExceeded
    if (violation) throw new ValidationError(`budget pool: ${violation}`)
  }

  function readout(): BudgetReadout {
    return {
      ...(ledger.resources.size
        ? {
            resources: Object.fromEntries(
              [...ledger.resources].map(([name, value]) => [name, { ...value }]),
            ),
          }
        : {}),
      tokensLeft: ledger.freeTokens,
      tokensKnown: !ledger.tokensTainted,
      cacheBreakdownKnown: !ledger.cacheBreakdownTainted,
      usdLeft: ledger.usdCapped ? (ledger.usdTainted ? 0 : ledger.freeUsd) : 0,
      usdCapped: ledger.usdCapped,
      usdKnown: ledger.usdMeasured && !ledger.usdTainted,
      iterationsLeft: ledger.freeIterations,
      deadlineMs: ledger.absoluteDeadlineMs,
      reservedTokens: ledger.reservedTokens,
    }
  }

  function openReservations(): ReadonlyArray<LeakedReservation> {
    return [...open].map(([ticketId, holder]) => Object.freeze({ ticketId, ...holder }))
  }

  function assertNoOpenTickets(): void {
    if (open.size > 0) {
      throw new Error(
        `budget pool: ${open.size} reservation(s) still open at join barrier (${openReservations().map(describeLeakedReservation).join('; ')}) — conserved-pool invariant violated`,
      )
    }
  }

  ledgerRestore(ledger, root, restore)

  return {
    reserve,
    attribute,
    reconcile,
    spendFrom: foldUsage,
    readout,
    observe,
    assertNoOpenTickets,
    openReservations,
  }
}

interface WaitingReservation {
  readonly ticket: ReservationTicket
  readonly budget: Budget
  readonly keep: ReservationFloor | undefined
  readonly grant: () => void
  readonly refuse: (error: ReservationWaitRefused) => void
}

/** A reservation must name a limit for exactly the resources the root declared, in its units. */
function assertResourceDeclarations(ledger: BudgetLedger, b: Budget): void {
  for (const [name, state] of ledger.resources) {
    const wanted = b.resources?.[name]
    if (!wanted) throw new ValidationError(`resource ${name}: child must declare its limit`)
    if (wanted.unit !== state.unit) throw new ValidationError(`resource ${name}: unit mismatch`)
  }
  for (const name of Object.keys(b.resources ?? {})) {
    if (!ledger.resources.has(name))
      throw new ValidationError(`resource ${name}: root must declare its limit`)
  }
}

/** Whether every short channel would fit once the open reservations return what they hold. */
function fitsAfterRefunds(shortfalls: readonly ReservationShortfall[]): boolean {
  return shortfalls.every(
    (shortfall) =>
      shortfall.closedByUnknownSpend !== true &&
      shortfall.requested <= shortfall.free + (shortfall.held ?? 0),
  )
}

function ticketFor(id: number, b: Budget): ReservationTicket {
  return {
    id,
    reserved: {
      ...(b.resources === undefined
        ? {}
        : {
            resources: Object.fromEntries(
              Object.entries(b.resources).map(([name, value]) => [name, { ...value }]),
            ),
          }),
      tokens: b.maxTokens,
      usd: b.maxUsd ?? 0,
      iterations: b.maxIterations,
      usdBudgeted: b.maxUsd !== undefined,
    },
  }
}

/** Name one leaked reservation by its holder. */
function describeLeakedReservation(leak: LeakedReservation): string {
  const parts = [`ticket ${leak.ticketId}`]
  if (leak.childId !== undefined) parts.push(`child ${leak.childId}`)
  if (leak.label !== undefined) parts.push(`label ${leak.label}`)
  if (leak.assignment !== undefined) parts.push(`assignment ${leak.assignment}`)
  parts.push(`stage ${leak.stage}`)
  return parts.join(', ')
}
