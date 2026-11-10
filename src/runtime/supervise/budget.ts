/**
 * Conserved budget accounting: total ≡ free + reserved + committed on each capped channel.
 * Reservation moves current free capacity to a single-use ticket; reconciliation commits
 * measured spend and refunds the remainder. It closes the ticket before reporting any fault.
 * Measured overspend reduces future capacity and returns a BudgetViolation.
 *
 * Tokens use chargedTokens (input − cacheRead + output). Missing cache classification charges
 * the full prompt and marks the split unknown. Prices never weight this channel. Named resources
 * require explicit units and complete measurements; the pool trusts receipts, not external state.
 * Unknown enforced resource or dollar usage closes that channel's admission. Unknown tokens
 * preserve observed counts as a lower bound without ending the run. An uncapped child dollar
 * channel reports actual dollars without treating them as an overspend of zero.
 *
 * Recovery preserves durable cost and outstanding backing, queuing only missing funding until
 * actual settlements provide it. Fresh spawns reserve current funds. Restore debits each liability once,
 * preserves unknown markers, and keeps the original deadline. No I/O or ambient clock is read.
 * @experimental
 */

import { ValidationError } from '../../errors'
import { chargedTokens, unreportedSpend, zeroSpend } from '../util'
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
import { withBudgetResources } from './resources'
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
  /** Child ceilings, including caps enforced without a corresponding root reservation.
   * Absent on historical tickets, whose reserved amounts remain their ceilings. */
  readonly limits?: Pick<Budget, 'maxTokens' | 'maxIterations'>
  readonly reserved: {
    readonly resources?: Budget['resources']
    readonly tokens: number
    readonly usd: number
    readonly iterations: number
    /** Distinguishes an undeclared USD ceiling (observed cost) from a declared zero cap.
     * Historical absent flags default to capped. */
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

/** `Scope.budget`: absolute deadline (0 when absent), current backing and committed cost.
 * An uncapped USD channel reads 0; `usdCapped` distinguishes it from exhaustion. */
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
  /** Explicit false means uncapped; older readouts without this flag were capped. */
  tokensCapped?: boolean
  /** Committed token charge, including conservative unknown-work debits on restore. */
  committedTokens?: number
  /** False means observed token counts are a lower bound and remaining capacity is a ceiling. */
  tokensKnown: boolean
  /** False means reported tokens lacked a cache split and were charged in full.
   * This differs from unreported counts; uncertain restored ceilings do not taint the split. */
  cacheBreakdownKnown: boolean
  usdLeft: number
  usdCapped: boolean
  /** False means recorded dollars are a lower bound rather than a complete measurement. */
  usdKnown: boolean
  iterationsLeft: number
  iterationsCapped?: boolean
  deadlineMs: number
  reservedTokens: number
}>

/** A manager's own share of each channel of its slice. Its children may not reserve the part of
 *  it the manager's own observed work has not yet spent. */
export interface ReservationFloor {
  readonly tokens: number
  readonly iterations: number
  readonly usd?: number
}

/** How a caller asks for a reservation. */
export interface ReserveOptions {
  /** Queue an existing invocation until actual settlements fund it; hold nothing meanwhile. */
  readonly wait?: boolean
  /** Leave this owner share free after the reservation, less what `observe` already charged. */
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

/** Every unfunded channel in one refusal. `free` is a live snapshot, not a future refund.
 * Unknown enforced usage closes that channel to new reservations for the rest of the run. */
export interface ReservationShortfall {
  readonly channel: 'tokens' | 'iterations' | 'usd' | `resource:${string}`
  readonly requested: number
  readonly free: number
  /** What open reservations hold now; this is not a prediction of future refunds. */
  readonly held?: number
  readonly closedByUnknownSpend?: true
}

/** Durable spend, unknown-work ceilings and remaining backing restored before new admission. */
export interface BudgetPoolRestore {
  readonly committed?: Spend
  /** The part of `committed` the owner's own work spent, charged against its kept share. */
  readonly owner?: Spend
  readonly uncertainReservations?: ReadonlyArray<Budget>
  /** Precisely journaled remaining liabilities, separate from historical unmeasured ceilings. */
  readonly heldReservations?: ReadonlyArray<Budget>
}

export interface BudgetPool {
  /** Reserve a complete ceiling from current funds. `wait` holds nothing while funded
   * tickets remain open; `granted` resolves after actual refunds, or rejects when none
   * can fund it. Unfunded reservations retain asking order and reconcile withdraws them. */
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
  /** Close the ticket, commit actual cost and refund unused capacity. Unknown/double
   * tickets throw. Overspend is returned after commit; unverifiable capped usage throws.
   * Scope-owned custody backing survives execution until its acknowledged release. */
  reconcile(ticket: ReservationTicket, spent: Spend): BudgetViolation | undefined
  /** Fold a normalized `UsageEvent` stream (or array) into a `Spend`; `ms` is left zero. */
  spendFrom(events: AsyncIterable<UsageEvent> | UsageEvent[]): Promise<Spend>
  /** The current readout, reflecting all outstanding reservations. */
  readout(): BudgetReadout
  /** Debit observed owner work; overspend may leave free capacity negative. Unknown
   * resources are recorded before throwing; partial observations defer completeness.
   * Unknown capped dollars are refused unless `alreadySpent` requires recording them
   * and closing admission. `Scope.meter` supplies the corresponding durable record. */
  observe(spend: Spend, options?: { partial?: boolean; alreadySpent?: boolean }): void
  /** Reject open execution tickets at join; confirmed custody liabilities may remain backed. */
  assertNoOpenTickets(): void
  /** Every reservation still open, with its holder; lets a failed run REPORT a leak. */
  openReservations(): ReadonlyArray<LeakedReservation>
}

/** Private lease operations; public pools retain their existing interface. */
export const budgetRecoverySeeds = new WeakMap<
  BudgetPoolRestore,
  ReadonlyArray<{ id: string; spent: Spend; held: Budget; closed?: true }>
>()
export const budgetLeases = new WeakMap<BudgetPool, ReservationLeases>()
export const budgetLeaseUpdates = new WeakMap<BudgetPool, () => Promise<void>>()
export async function refreshBudgetLease(pool: BudgetPool): Promise<void> {
  await budgetLeaseUpdates.get(pool)?.()
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
  const leases = new ReservationLeases(
    ledger,
    root,
    open,
    holdingNothing,
    waiting,
    grantWaiting,
    recover,
    budgetRecoverySeeds.get(restore),
  )

  /** Grant waiting tickets in the order they asked while the head fits. When the head does not
   *  fit and no reservation is held that could return budget, nothing can ever cover it: refuse
   *  it, and go on with the next. */
  function grantWaiting(): void {
    while (waiting.length > 0) {
      const head = waiting[0]!
      if (head.refresh) head.budget = head.refresh()
      const shortfalls = ledgerShortfalls(ledger, head.budget, head.keep).filter(
        (entry) => !head.refresh || entry.closedByUnknownSpend || entry.requested > 0,
      )
      if (shortfalls.length === 0) {
        waiting.shift()
        ledgerTake(ledger, head.budget)
        holdingNothing.delete(head.ticket.id)
        head.acquired?.()
        head.grant()
        continue
      }
      if (
        leases.hasRefundSource(head.ticket.id) &&
        !shortfalls.some((entry) => entry.closedByUnknownSpend)
      )
        return
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
    const ticket = ticketFor(id, b, ledger)
    leases.remember(ticket, keep)
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

  function recover(
    budget: Budget,
    holder: ReservationHolder,
    nodeId: string,
    keep?: ReservationFloor,
  ): ReturnType<BudgetPool['reserve']> {
    const seed = leases.seeds.get(nodeId)
    if (!seed) return reserve(budget, holder, { wait: true, keep })
    if (seed.closed) throw new ValidationError('closed custody backing cannot authorize execution')
    leases.seeds.delete(nodeId)
    const ticket = ticketFor(nextTicketId++, budget, ledger)
    open.set(ticket.id, holder)
    leases.remember(ticket, keep)
    leases.restore(ticket, budget, seed.spent, seed.held)
    const granted = leases.resume(ticket)
    return { ok: true, ticket, ...(leases.isPaused(ticket) ? { granted } : {}) }
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
    if (leases.blocked) return { ok: false, reason: 'budget-exhausted' }
    const wantUsd = b.maxUsd ?? 0
    const keep = options.keep
    // Report all current shortfalls in one refusal.
    const shortfalls = ledgerShortfalls(ledger, b, keep)
    // An uncapped root cannot fund a capped USD allocation.
    if (shortfalls.length === 0 && wantUsd > 0 && !ledger.usdCapped) {
      return { ok: false, reason: 'usd-unbudgeted' }
    }
    const queueAhead = options.wait === true && waiting.length > 0
    if (shortfalls.length === 0 && !queueAhead) {
      ledgerTake(ledger, b)
      const id = nextTicketId++
      open.set(id, holder)
      const ticket = ticketFor(id, b, ledger)
      leases.remember(ticket, keep)
      return { ok: true, ticket }
    }
    if (
      options.wait !== true ||
      shortfalls.some((shortfall) => shortfall.closedByUnknownSpend) ||
      !leases.hasRefundSource()
    ) {
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
    // Withdraw unfunded requests; a restored lease can still own its prior backing.
    const heldNothing = holdingNothing.delete(ticket.id)
    const index = waiting.findIndex((entry) => entry.ticket.id === ticket.id)
    if (index >= 0) waiting.splice(index, 1)
    const adjustment = leases.settle(ticket, spent)
    const held =
      adjustment?.held ??
      (heldNothing ? { tokens: 0, usd: 0, iterations: 0, resources: undefined } : ticket.reserved)
    const charge = adjustment?.charge ?? spent

    // Commit before reporting faults or overspend so no error can strand the ticket.
    const usdBudgeted = ticket.reserved.usdBudgeted !== false
    const { overspent, unknownUnderCap } = ledgerClassifyOverspend(
      ledger,
      heldNothing && adjustment === undefined ? held : ticket.reserved,
      usdBudgeted,
      spent,
      heldNothing && adjustment === undefined ? { maxTokens: 0, maxIterations: 0 } : ticket.limits,
    )
    let fault = unknownUnderCap
      ? `ticket ${ticket.id} reported unknown dollar cost under a dollar-capped budget`
      : undefined

    // Settlement: unconditional, and the only place the ticket closes.
    open.delete(ticket.id)
    const resourceSettlement = ledgerSettle(ledger, held, charge, unknownUnderCap)
    fault ??= resourceSettlement.fault
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
    // Refuse unknown capped dollars unless finished work must close admission.
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
      tokensCapped: ledger.tokensCapped,
      committedTokens: ledger.committedTokens,
      tokensKnown: !ledger.tokensTainted,
      cacheBreakdownKnown: !ledger.cacheBreakdownTainted,
      usdLeft: ledger.usdCapped ? (ledger.usdTainted ? 0 : ledger.freeUsd) : 0,
      usdCapped: ledger.usdCapped,
      usdKnown: ledger.usdMeasured && !ledger.usdTainted,
      iterationsLeft: ledger.freeIterations,
      iterationsCapped: ledger.iterationsCapped,
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

  for (const seed of leases.seeds.values()) ledgerTake(ledger, seed.held)
  ledgerRestore(ledger, root, restore)
  for (const seed of leases.seeds.values())
    if (!seed.closed) ledgerRestore(ledger, root, { committed: seed.spent })

  const pool: BudgetPool = {
    reserve,
    attribute,
    reconcile,
    spendFrom: foldUsage,
    readout,
    observe,
    assertNoOpenTickets,
    openReservations,
  }
  budgetLeases.set(pool, leases)
  return pool
}

interface WaitingReservation {
  readonly ticket: ReservationTicket
  budget: Budget
  readonly keep: ReservationFloor | undefined
  readonly grant: () => void
  readonly refuse: (error: ReservationWaitRefused) => void
  readonly refresh?: () => Budget
  readonly acquired?: () => void
}

type HeldBudget = ReservationTicket['reserved']
interface RebasedReservation {
  readonly ceiling: Budget
  spent: Spend
  held: Budget
  paused: boolean
  closed?: boolean
  liabilities: Budget
}

class ReservationLeases {
  blocked = false
  private readonly rebased = new Map<number, RebasedReservation>()
  private readonly kept = new Map<number, ReservationFloor | undefined>()
  private readonly tickets = new Map<number, ReservationTicket>()
  readonly seeds: Map<string, { spent: Spend; held: Budget; closed?: true }>
  constructor(
    private readonly ledger: BudgetLedger,
    private readonly root: Budget,
    private readonly open: Map<number, ReservationHolder>,
    private readonly empty: Set<number>,
    private readonly waiting: WaitingReservation[],
    private readonly pump: () => void,
    readonly recover: (
      budget: Budget,
      holder: ReservationHolder,
      nodeId: string,
      keep?: ReservationFloor,
    ) => ReturnType<BudgetPool['reserve']>,
    seeds: ReadonlyArray<{ id: string; spent: Spend; held: Budget; closed?: true }> = [],
  ) {
    this.seeds = new Map(seeds.map(({ id, ...seed }) => [id, seed]))
  }

  restore(ticket: ReservationTicket, ceiling: Budget, spent: Spend, held: Budget): void {
    this.rebased.set(ticket.id, { ceiling, spent, held, liabilities: held, paused: true })
    if (!hasAllocation(heldAmounts(held, this.ledger))) this.empty.add(ticket.id)
  }

  remember(ticket: ReservationTicket, keep: ReservationFloor | undefined): void {
    this.tickets.set(ticket.id, ticket)
    this.kept.set(ticket.id, keep && { ...keep })
  }

  hasRefundSource(except?: number): boolean {
    for (const [id, ticket] of this.tickets) {
      if (id === except || !this.open.has(id) || this.empty.has(id)) continue
      const state = this.rebased.get(id)
      if (hasAllocation(state ? heldAmounts(state.held, this.ledger) : ticket.reserved)) return true
    }
    return [...this.seeds.values()].some(
      (seed) => !seed.closed && hasAllocation(heldAmounts(seed.held, this.ledger)),
    )
  }

  liabilities(spent: Spend): Budget {
    const l = this.ledger
    const keep = (
      cap: number | undefined,
      reserved: number,
      committed: number,
      reported: number,
      unknown = false,
    ) =>
      cap === undefined
        ? undefined
        : Math.max(
            reserved + Math.max(0, committed - reported),
            unknown ? Math.max(0, cap - reported) : 0,
          )
    return {
      ...(this.root.maxTokens === undefined
        ? {}
        : {
            maxTokens: keep(
              this.root.maxTokens,
              l.reservedTokens,
              l.committedTokens,
              // Unknown tokens are a lower bound, not a pin: settled work holds none of the cap.
              chargedTokens(spent.tokens),
            ),
          }),
      ...(this.root.maxIterations === undefined
        ? {}
        : {
            maxIterations: keep(
              this.root.maxIterations,
              l.reservedIterations,
              l.committedIterations,
              spent.iterations,
            ),
          }),
      ...(this.root.maxUsd === undefined
        ? {}
        : {
            maxUsd: keep(
              this.root.maxUsd,
              l.reservedUsd,
              l.committedUsd,
              spent.usd,
              l.usdTainted || !l.usdMeasured,
            ),
          }),
      ...(this.root.resources === undefined
        ? {}
        : {
            resources: Object.fromEntries(
              [...l.resources].map(([name, value]) => [
                name,
                {
                  unit: value.unit,
                  limit: keep(
                    value.limit,
                    value.reserved,
                    value.committed,
                    spent.resources?.[name]?.amount ?? 0,
                    !value.known,
                  )!,
                },
              ]),
            ),
          }),
    }
  }

  rebase(
    ticket: ReservationTicket,
    ceiling: Budget,
    spent: Spend,
    liabilities: Budget,
    pause = false,
  ): void {
    const old = this.rebased.get(ticket.id)
    if (!this.open.has(ticket.id) && !old?.closed) return
    const state: RebasedReservation = old ?? {
      ceiling,
      spent: zeroSpend(),
      held: ceiling,
      paused: true,
      liabilities,
    }
    state.paused ||= pause
    const next = this.plannedHold(ticket, ceiling, spent, liabilities, pause)
    const held = heldAmounts(state.held, this.ledger)
    const delta = withBudgetResources(unreportedSpend(spent, state.spent), ceiling, true)
    ledgerSettle(this.ledger, held, delta, this.ledger.usdCapped && delta.usdKnown === false)
    ledgerTake(this.ledger, next)
    state.spent = spent
    state.held = next
    state.liabilities = liabilities
    this.rebased.set(ticket.id, state)
    if (hasAllocation(heldAmounts(next, this.ledger))) this.empty.delete(ticket.id)
    else this.empty.add(ticket.id)
    this.pump()
  }

  plannedHold(
    ticket: ReservationTicket,
    ceiling: Budget,
    spent: Spend,
    liabilities: Budget,
    pause: boolean,
  ): Budget {
    return pause || (this.rebased.get(ticket.id)?.paused ?? true)
      ? liabilities
      : maximumBudget(remainingBudget(ceiling, spent), liabilities)
  }

  resume(ticket: ReservationTicket): Promise<void> {
    const state = this.rebased.get(ticket.id)
    if (!state?.paused) return Promise.resolve()
    if (!this.open.has(ticket.id))
      return Promise.reject(new ValidationError('closed admission cannot resume'))
    const refresh = () => differenceBudget(remainingBudget(state.ceiling, state.spent), state.held)
    const acquired = () => {
      state.paused = false
      state.held = maximumBudget(remainingBudget(state.ceiling, state.spent), state.held)
    }
    const budget = refresh()
    const keep = this.kept.get(ticket.id)
    const shortfalls = ledgerShortfalls(this.ledger, budget, keep).filter(
      (entry) => entry.closedByUnknownSpend || entry.requested > 0,
    )
    if (
      shortfalls.length === 0 &&
      (this.waiting.length === 0 || !hasAllocation(heldAmounts(budget, this.ledger)))
    ) {
      ledgerTake(this.ledger, budget)
      this.empty.delete(ticket.id)
      acquired()
      return Promise.resolve()
    }
    if (shortfalls.some((entry) => entry.closedByUnknownSpend) || !this.hasRefundSource(ticket.id))
      return Promise.reject(new ReservationWaitRefused(shortfalls))
    const granted = new Promise<void>((grant, refuse) => {
      this.waiting.push({ ticket, budget, keep, refresh, acquired, grant, refuse })
    })
    granted.catch(() => undefined)
    return granted
  }

  reservation(ticket: ReservationTicket): Budget | undefined {
    return this.rebased.get(ticket.id)?.held
  }

  isPaused(ticket: ReservationTicket): boolean {
    return this.rebased.get(ticket.id)?.paused === true
  }
  isBacked(ticket: ReservationTicket): boolean {
    return this.open.has(ticket.id) || this.rebased.get(ticket.id)?.closed === true
  }

  observeTerminal(ticket: ReservationTicket, spent: Spend): void {
    const state = this.rebased.get(ticket.id)
    if (state && !state.closed)
      state.liabilities = completedLeafBacking(state.held, spent, state.spent)
  }

  acknowledgeTeardown(ticket: ReservationTicket): void {
    const state = this.rebased.get(ticket.id)
    if (!state?.closed) return
    const next = completedLeafBacking(state.held, state.spent, state.spent, true)
    const refund = differenceBudget(state.held, next)
    ledgerSettle(
      this.ledger,
      heldAmounts(refund, this.ledger),
      withBudgetResources(zeroSpend(), state.ceiling, true),
      false,
    )
    state.held = state.liabilities = next
    if (!hasAllocation(heldAmounts(next, this.ledger))) this.rebased.delete(ticket.id)
    this.pump()
  }

  settle(ticket: ReservationTicket, spent: Spend): { held: HeldBudget; charge: Spend } | undefined {
    const state = this.rebased.get(ticket.id)
    this.kept.delete(ticket.id)
    this.tickets.delete(ticket.id)
    if (!state) return undefined
    const charge = unreportedSpend(spent, state.spent)
    const held = differenceBudget(state.held, state.liabilities)
    if (hasAllocation(heldAmounts(state.liabilities, this.ledger))) {
      state.closed = true
      state.paused = true
      state.spent = spent
      state.held = state.liabilities
      return { held: heldAmounts(held, this.ledger), charge }
    }
    this.rebased.delete(ticket.id)
    return { held: heldAmounts(state.held, this.ledger), charge }
  }
}

/** A real leaf result ends model work; named physical backing awaits its cleanup ACK.
 * Unknown past usage remains backed even after the resource itself has been released. */
export function completedLeafBacking(
  held: Budget,
  spent: Spend,
  prior: Spend,
  cleanupConfirmed = false,
): Budget {
  const delta = unreportedSpend(spent, prior)
  return {
    ...held,
    ...(held.maxTokens === undefined ||
    spent.tokensKnown === false ||
    spent.tokens.tokensKnown === false
      ? {}
      : { maxTokens: 0 }),
    ...(held.maxIterations === undefined ? {} : { maxIterations: 0 }),
    ...(held.maxUsd === undefined || spent.usdKnown === false ? {} : { maxUsd: 0 }),
    ...(held.resources === undefined
      ? {}
      : {
          resources: Object.fromEntries(
            Object.entries(held.resources).map(([name, value]) => [
              name,
              {
                ...value,
                limit:
                  spent.resources?.[name]?.known !== true
                    ? value.limit
                    : cleanupConfirmed
                      ? 0
                      : Math.max(0, value.limit - (delta.resources?.[name]?.amount ?? 0)),
              },
            ]),
          ),
        }),
  }
}

function heldAmounts(budget: Budget, ledger: BudgetLedger): HeldBudget {
  return {
    tokens: ledger.tokensCapped ? (budget.maxTokens ?? 0) : 0,
    iterations: ledger.iterationsCapped ? (budget.maxIterations ?? 0) : 0,
    usd: budget.maxUsd ?? 0,
    ...(budget.resources ? { resources: budget.resources } : {}),
  }
}

function remainingBudget(budget: Budget, spent: Spend): Budget {
  return differenceBudget(budget, {
    maxTokens: chargedTokens(spent.tokens),
    maxIterations: spent.iterations,
    maxUsd: spent.usd,
    resources: Object.fromEntries(
      Object.entries(spent.resources ?? {}).map(([name, value]) => [
        name,
        { unit: value.unit, limit: value.amount },
      ]),
    ),
  })
}

function maximumBudget(grant: Budget, backing: Budget): Budget {
  return {
    ...grant,
    ...(grant.maxTokens === undefined
      ? {}
      : { maxTokens: Math.max(grant.maxTokens, backing.maxTokens ?? 0) }),
    ...(grant.maxIterations === undefined
      ? {}
      : { maxIterations: Math.max(grant.maxIterations, backing.maxIterations ?? 0) }),
    ...(grant.maxUsd === undefined ? {} : { maxUsd: Math.max(grant.maxUsd, backing.maxUsd ?? 0) }),
    ...(grant.resources === undefined
      ? {}
      : {
          resources: Object.fromEntries(
            Object.entries(grant.resources).map(([name, value]) => [
              name,
              {
                unit: value.unit,
                limit: Math.max(value.limit, backing.resources?.[name]?.limit ?? 0),
              },
            ]),
          ),
        }),
  }
}

function differenceBudget(total: Budget, prior: Budget): Budget {
  return {
    ...(total.maxTokens === undefined
      ? {}
      : { maxTokens: Math.max(0, total.maxTokens - (prior.maxTokens ?? 0)) }),
    ...(total.maxIterations === undefined
      ? {}
      : { maxIterations: Math.max(0, total.maxIterations - (prior.maxIterations ?? 0)) }),
    ...(total.maxUsd === undefined
      ? {}
      : { maxUsd: Math.max(0, total.maxUsd - (prior.maxUsd ?? 0)) }),
    ...(total.resources === undefined
      ? {}
      : {
          resources: Object.fromEntries(
            Object.entries(total.resources).map(([name, value]) => [
              name,
              {
                unit: value.unit,
                limit: Math.max(0, value.limit - (prior.resources?.[name]?.limit ?? 0)),
              },
            ]),
          ),
        }),
  }
}
function hasAllocation(budget: HeldBudget): boolean {
  return (
    budget.tokens > 0 ||
    budget.iterations > 0 ||
    budget.usd > 0 ||
    Object.values(budget.resources ?? {}).some((value) => value.limit > 0)
  )
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

function ticketFor(id: number, b: Budget, ledger: BudgetLedger): ReservationTicket {
  return {
    id,
    limits: {
      ...(b.maxTokens === undefined ? {} : { maxTokens: b.maxTokens }),
      ...(b.maxIterations === undefined ? {} : { maxIterations: b.maxIterations }),
    },
    reserved: {
      ...(b.resources === undefined
        ? {}
        : {
            resources: Object.fromEntries(
              Object.entries(b.resources).map(([name, value]) => [name, { ...value }]),
            ),
          }),
      tokens: ledger.tokensCapped ? (b.maxTokens ?? 0) : 0,
      usd: b.maxUsd ?? 0,
      iterations: ledger.iterationsCapped ? (b.maxIterations ?? 0) : 0,
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
