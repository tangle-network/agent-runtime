/**
 *
 * The conserved budget reservation pool — the invariant the whole instrument
 * rests on (critique M5/B3). One root `Budget` becomes a conserved pool of standard
 * quantities (tokens, usd, iterations) and caller-named resources plus an absolute deadline. Children reserve
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
 * The token unit is `chargedTokens`: every token counted ONCE, when it first enters the context
 * (`input − cacheRead + output`, which is `freshInput + cacheWrite + output` under a complete
 * split). A cached prefix is re-presented content that was already charged when it was written, so
 * charging a cache read again would charge the same tokens twice — on a real fleet cache is 98% of
 * the rolled-up prompt total, which made a declared cap bite about 56x early. No price weight
 * enters the token channel; money is budgeted separately on `maxUsd`. The unit is additive, so a
 * child's settlement charges what its turns charged and a rolled-up report agrees with the pool.
 * Prompt tokens the provider never classified are charged in full, and
 * `readout().cacheBreakdownKnown` then reads false, so the balance reads as an upper bound on
 * newly-presented work rather than a measurement. The pool trusts a reported cache read the same way
 * it trusts a reported `input`: the token channel is an accounting unit, not a trust boundary
 * against a provider that misreports its own usage.
 *
 * Named resources require explicit units, ceilings, and complete executor measurements.
 * Missing or unknown enforced measurements close admission for that resource.
 * The pool trusts those receipts; it does not independently meter external systems.
 * `Spend.boxMinutes` remains evidence only and has no implicit resource ceiling.
 * Callers must not present estimated box lifetime as a measured resource receipt.
 *
 * Pure and deterministic: the run's start instant is supplied, there is no I/O, and no
 * wall-clock or RNG read. A `reserve`/`reconcile` ticket is single-use (fail-loud on double or
 * unknown reconcile) so a child can never refund twice. Reconciling an OPEN ticket always
 * closes it: a fail-loud condition settles the reservation first and throws afterwards, so no
 * error path can strand a reservation past the join barrier's `assertNoOpenTickets`.
 * Measured spend above a reservation is not a fail-loud condition. The pool commits it, returns
 * it as a `BudgetViolation`, and refuses later reservations from the reduced free balance; the
 * work it paid for is not discarded.
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
 * A reservation the free balance cannot cover now can WAIT instead of failing (`reserve(b, holder,
 * { wait: true })`) when it would fit once the reservations still open return. It holds nothing
 * while it waits, so conservation is untouched. Waiting reservations are granted in the order they
 * asked, as settlements return budget, and are refused once no open reservation is left to return
 * any: then nothing could ever cover them.
 *
 * A pool can be RESTORED from a prior process's durable record (same-host restart): measured
 * committed spend is debited exactly once, and each child journaled as started but never settled
 * is charged at its full declared ceiling — restart never mints capacity, and the unknown flags
 * stay visible in every later readout. The original absolute deadline never slides.
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

/**
 * A reconciliation whose spend the pool cannot verify. It is thrown after the reservation has
 * settled. `budgetViolation` carries any measured overspend on the same settlement, so a child
 * that fails closed on the fault still records how far its known channels exceeded the
 * reservation.
 */
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

/** Where in the spawn lifecycle a reservation was last seen. `admitted` is the window between
 *  `reserve` and the hand-off to the child's execution, which the spawning code owns; `executing`
 *  means the child owns the ticket and only its settlement can close it. */
export type ReservationStage = 'admitted' | 'executing'

/** Who holds a reservation. Recorded at `reserve` and refined through `attribute` once admission
 *  mints a node id, so a ticket stranded at the join barrier names the work that holds it instead
 *  of a bare counter. Every field except `stage` is optional: a pool used directly (no `Scope`)
 *  names nothing, and an unattributable leak must still be reportable. */
export interface ReservationHolder {
  /** The manager-scoped assignment identity the caller declared (`SpawnOpts.assignmentId`, else
   *  its `key`), when it declared one. */
  readonly assignment?: string
  /** The spawn label — the name an operator recognizes in a journal. */
  readonly label?: string
  /** The spawned node's id, once admission minted one. Absent for a reservation that escaped
   *  before its child had an identity. */
  readonly childId?: string
  readonly stage: ReservationStage
}

/** One reservation still open when a run reached its join barrier — a conserved-pool leak,
 *  reported with the holder that can be chased rather than only its ticket id. */
export interface LeakedReservation extends ReservationHolder {
  readonly ticketId: number
}

/** Post-reservation pool readout — the shape `Scope.budget` exposes. `tokensLeft`,
 *  `usdLeft`, and `reservedTokens` reflect committed-but-unsettled reservations;
 *  `deadlineMs` is the ABSOLUTE wall-clock deadline (0 when the root set none).
 *  `iterationsLeft` is the remaining iteration capacity.
 *  `usdCapped` distinguishes a real `usdLeft <= 0` exhaustion from an uncapped pool (which always
 *  reads `usdLeft: 0`) — the in-loop guard needs it to bound a usd-capped driver. */
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
  /**
   * False once the pool has recorded work whose token count was UNREPORTED (a `Spend` with
   * `tokensKnown: false`). `tokensLeft` is then a ceiling on what remains, not a measurement: real
   * consumption is at least the debited amount and possibly more. Reading `tokensLeft` without this
   * flag would present an under-count as an exact balance.
   */
  tokensKnown: boolean
  /**
   * False once the pool has charged a REPORTED spend whose prompt-cache split it could not read.
   * The prompt tokens that carried no class were charged in full, and a cached prefix reaches the
   * pool again on every turn that reads it, so the debited amount is an upper bound on
   * newly-presented work rather than a measurement. It is a separate fact from `tokensKnown`: the
   * counts arrived, but their composition did not. A restored uncertain reservation leaves this
   * flag alone — it charges a declared ceiling, which has no composition to misread, and
   * `tokensKnown` already reports that the balance is not a measurement.
   */
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

/** Why a reservation was refused. `budget-exhausted` means the pool ran out of a channel it
 * budgets; `usd-unbudgeted` means the root declared no dollar ceiling, so a dollar request is
 * unsatisfiable at any amount and the fix is to budget the root, not to ask for less. */
export type ReservationRejection = 'budget-exhausted' | 'usd-unbudgeted'

/** One budget channel a `budget-exhausted` reservation could not fit, with the amounts that
 * decided it. A refusal lists every channel that did not fit (`shortfalls`), so shrinking one
 * request is not answered by a second refusal on a channel the caller was never told about
 * (observed live: a director whose 100-iteration child was refused spent a probe worker to learn
 * the pool still admitted 3). `free` is a snapshot: live reservations return to it as their
 * workers settle, and a driver's own metered turns draw tokens and dollars from the same pool
 * before its next request arrives, so only `iterations` can be requested at exactly `free`.
 * `closedByUnknownSpend` means work with unmeasured usage ran under that enforced limit; the
 * channel then refuses every reservation for the rest of the run. */
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
   * Atomically reserve a child's full ceiling from the free balance. Fails closed
   * ({ ok: false }) when the pool can't cover standard or named channels — the
   * caller inspects `ok` before `ticket`.
   *
   * With `wait`, a request the free balance cannot cover now, but could once the open reservations
   * return, is admitted as a WAITING ticket: `granted` resolves when the pool reserves it, and
   * rejects with `ReservationWaitRefused` once nothing open could return enough. A waiting
   * ticket reserves nothing; reconciling it withdraws it. While any ticket waits, a new waiting
   * request queues behind it even when it would fit, so the order of asking is the order of grant.
   */
  reserve(
    b: Budget,
    holder?: ReservationHolder,
    options?: ReserveOptions,
  ):
    | { ok: true; ticket: ReservationTicket; granted?: Promise<void> }
    | { ok: false; reason: ReservationRejection; shortfalls?: readonly ReservationShortfall[] }
  /**
   * Name (or rename) who holds an open reservation. Merges into what `reserve` recorded, so a
   * caller states only what it just learned — the node id admission minted, or the stage the
   * ticket moved to. A settled or unknown ticket is ignored: attribution is leak EVIDENCE, never
   * a lifecycle guard, and must not be able to fail a run that is otherwise healthy.
   */
  attribute(ticket: ReservationTicket, holder: ReservationHolder): void
  /**
   * Release a reservation: commit the actual `spent`, refund the unspent remainder
   * to the free pool. Throws on an unknown or already-reconciled ticket (fail loud —
   * a double refund would silently break conservation).
   *
   * Returns the overspend when measured spend exceeded the reservation, after committing it.
   * Throws, also after committing, when the spend cannot be verified: unknown dollar cost under
   * a dollar cap, or unknown or overflowing usage of an enforced resource.
   */
  reconcile(ticket: ReservationTicket, spent: Spend): BudgetViolation | undefined
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
   * when a run overspends. Unknown enforced resource usage is recorded before throwing.
   * Partial increments defer completeness checks until the invocation reports its terminal spend.
   * Unknown dollars under a dollar cap are refused, unless `alreadySpent` says the work finished
   * with no caller left to refuse; that observation closes dollar admission instead.
   * The DURABLE record is the journal's `metered` event (written by `Scope.meter`); this debit
   * only makes the live `readout()` reflect driver inference for the in-loop guard.
   */
  observe(spend: Spend, options?: { partial?: boolean; alreadySpent?: boolean }): void
  /** Fail loud if any reservation is still open — the conserved-pool leak detector. Called at the
   *  supervisor's join barrier: once every child has settled, no ticket may remain (a leaked
   *  reservation would silently break `total ≡ free + reserved + committed`). */
  assertNoOpenTickets(): void
  /** Every reservation still open, with its holder. Empty on a healthy pool. Read at the join
   *  barrier so a run that failed can REPORT a leak it must not also be destroyed by. */
  openReservations(): ReadonlyArray<LeakedReservation>
}

/**
 * Create a conserved reservation pool from a root `Budget`. `runStartedAtMs` is the WALL-CLOCK
 * instant the run's root was recorded, and it is the only input the deadline is derived from:
 * `runStartedAtMs + root.deadlineMs`, or `0` when the root declares no deadline. The pool holds no
 * clock, so a caller cannot hand it a run-relative one and get a duration back where an instant is
 * expected. A resumed pool passes the ORIGINAL root instant, so restart never slides the limit.
 * The readout is an absolute instant, not a shrinking remainder.
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
    // The caller may withdraw a waiting ticket before it awaits `granted`; a refusal it never
    // reads must not surface as an unhandled rejection.
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
    // A dollar request against a root that declared no dollar ceiling can never be satisfied at
    // ANY amount, which is a different fact from an exhausted balance and calls for a different
    // fix: budget the root, do not retry smaller. Reporting both as `budget-exhausted` invites a
    // caller to shrink its request forever — observed live, a driver walked its child budget down
    // to $0.01 and spent 68k tokens before asking for help. An exhausted channel above still
    // takes precedence, as it did before shortfalls were reported.
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

    // Two outcomes are DECIDED here and reported at the very END, after the reservation has
    // been settled. A throw placed before settlement is how a ticket escapes the pool:
    // `Scope.runChild` marks the child reconciled before calling, so nothing retries, the
    // ticket stays open forever, and `assertNoOpenTickets` fails the whole run at the join
    // barrier. Everything between here and the report is unconditional arithmetic.
    //
    // A FAULT is spend the pool cannot verify, and it throws. An OVERSPEND is measured spend
    // above the reservation, and it is returned: the settlement commits the actual spend either
    // way and lets `free` go negative (agent-runtime#1206). Unknown dollars are a fault even
    // beside an overspend, so the child still fails closed.
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
    // Unknown dollars under a dollar cap are REFUSED before any balance mutates: unlike a
    // reconciled child (whose reservation must settle), an observation has no ticket to strand,
    // so the honest reading is a fail-loud refusal the caller surfaces — `driver-failed` carrying
    // this reason — rather than an invented figure or a silently consumed cap. Work that already
    // finished with no caller left to refuse it (a Runtime-owned analyst lens) closes dollar
    // admission instead, as a reconciled child's unknown dollars do: refusing it would discard
    // what that work produced and still leave its dollars unaccounted.
    const unknownUnderCap = ledger.usdCapped && spend.usdKnown === false
    if (unknownUnderCap && options.alreadySpent !== true) {
      // A typed refusal, not a bare invariant guard: this is a contract failure the caller sees on
      // the `driver-failed` arm, and a driver retry must be able to tell it apart from a foreign
      // accident it could recover from.
      throw new ValidationError(
        'budget pool: cannot observe unknown dollar cost under a dollar-capped budget',
      )
    }
    // The DURABLE record of this spend is the journal's `metered` event (the twin written by
    // `Scope.meter`); this debit exists only to make the live `readout()` reflect driver inference.
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

/** Name one leaked reservation by its holder, so the invariant message points at the work that
 *  holds the ticket rather than at a counter an operator cannot chase. */
function describeLeakedReservation(leak: LeakedReservation): string {
  const parts = [`ticket ${leak.ticketId}`]
  if (leak.childId !== undefined) parts.push(`child ${leak.childId}`)
  if (leak.label !== undefined) parts.push(`label ${leak.label}`)
  if (leak.assignment !== undefined) parts.push(`assignment ${leak.assignment}`)
  parts.push(`stage ${leak.stage}`)
  return parts.join(', ')
}
