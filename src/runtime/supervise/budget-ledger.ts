/**
 * The balances of one conserved budget pool, and the arithmetic that moves them. `createBudgetPool`
 * (`./budget`) owns tickets, the wait queue and the public contract; this module owns the numbers:
 * `total ≡ free + reserved + committed` per channel, the taint flags that say a balance is a
 * ceiling rather than a measurement, and the named-resource states.
 */

import { chargedTokens, hasCompleteCacheBreakdown, zeroTokenUsage } from '../util'
import type { BudgetPoolRestore, ReservationFloor, ReservationShortfall } from './budget'
import { withBudgetResources } from './resources'
import { assertValidBudget, assertValidSpend } from './spend-validation'
import type { Budget, BudgetOverspend, Spend } from './types'

interface ResourceBalance {
  unit: string
  limit: number
  remaining: number
  reserved: number
  committed: number
  known: boolean
}

export interface BudgetLedger {
  readonly usdCapped: boolean
  readonly absoluteDeadlineMs: number
  readonly resources: Map<string, ResourceBalance>
  freeTokens: number
  reservedTokens: number
  committedTokens: number
  // Set once the pool records work with an unreported token count, never cleared. Unlike
  // `usdTainted` it does NOT close admission (the token channel is always capped; refusing every
  // later reservation would turn one skipped usage report into a dead run): the cap is enforced on
  // what is known and `readout().tokensKnown` reports an under-count.
  tokensTainted: boolean
  // Set once the pool charges a spend whose cache split it could not read, never cleared: it was
  // charged at its rolled-up prompt total, an upper bound on newly-presented tokens. Same treatment
  // as `tokensTainted`. A restored uncertain reservation does NOT set it (a declared ceiling has no
  // cache composition to misread; `tokensTainted` already reports it).
  cacheBreakdownTainted: boolean
  freeUsd: number
  reservedUsd: number
  committedUsd: number
  // Closes dollar admission: set when unknown dollar cost lands under a dollar-capped root.
  usdTainted: boolean
  // Reporting only: set whenever ANY recorded work carried `usdKnown: false`, capped or not, so
  // the readout never presents a lower bound as a measured dollar total.
  usdMeasured: boolean
  freeIterations: number
  reservedIterations: number
  committedIterations: number
}

export interface ResourceSettlement {
  fault?: string
  overspent: BudgetOverspend[]
  rootExceeded?: string
}

export function openBudgetLedger(root: Budget, runStartedAtMs: number): BudgetLedger {
  return {
    usdCapped: root.maxUsd !== undefined,
    absoluteDeadlineMs: root.deadlineMs === undefined ? 0 : runStartedAtMs + root.deadlineMs,
    resources: new Map(
      Object.entries(root.resources ?? {}).map(
        ([name, value]) =>
          [
            name,
            { ...value, remaining: value.limit, reserved: 0, committed: 0, known: true },
          ] as const,
      ),
    ),
    freeTokens: root.maxTokens,
    reservedTokens: 0,
    committedTokens: 0,
    tokensTainted: false,
    cacheBreakdownTainted: false,
    freeUsd: root.maxUsd ?? 0,
    reservedUsd: 0,
    committedUsd: 0,
    usdTainted: false,
    usdMeasured: true,
    freeIterations: root.maxIterations,
    reservedIterations: 0,
    committedIterations: 0,
  }
}

export function ledgerValidateUnits(l: BudgetLedger, spend: Spend): void {
  for (const [name, value] of Object.entries(spend.resources ?? {})) {
    const limit = l.resources.get(name)
    if (limit && limit.unit !== value.unit) throw new Error(`resource ${name}: unit mismatch`)
  }
}

/** Record that `spend` carried an unreported or unclassified channel. */
function noteUnknowns(l: BudgetLedger, spend: Spend): void {
  if (spend.tokensKnown === false) l.tokensTainted = true
  if (!hasCompleteCacheBreakdown(spend.tokens)) l.cacheBreakdownTainted = true
  if (spend.usdKnown === false) l.usdMeasured = false
}

/**
 * Commit named-resource spend and classify it. `allocations` is the settling reservation's own
 * allocations, or `undefined` for spend holding no reservation (`observe`, restore). Unverifiable
 * usage is a `fault` (the remaining balance is consumed so admission closes); measured usage above
 * an allocation is `overspent`; without allocations, usage leaving a root limit overdrawn is
 * `rootExceeded`. A reservation within its own allocation is never charged with a root overdraw:
 * a negative balance at its settlement was caused, and reported, by earlier spend.
 */
export function ledgerCommitResources(
  l: BudgetLedger,
  spend: Spend,
  allocations?: Budget['resources'],
  requireAll = true,
): ResourceSettlement {
  let fault: string | undefined
  let rootExceeded: string | undefined
  const overspent: BudgetOverspend[] = []
  for (const [name, state] of l.resources) {
    const value = spend.resources?.[name]
    if (!requireAll && value === undefined) continue
    const allocation = allocations?.[name]?.limit ?? 0
    const amount = value?.amount ?? 0
    state.reserved -= allocation
    const committed = state.committed + amount
    const overflow = !Number.isSafeInteger(committed)
    state.committed = Math.min(committed, Number.MAX_SAFE_INTEGER)
    // Subtract reserved capacity first so every intermediate balance stays a safe integer.
    state.remaining = state.limit - state.reserved - state.committed
    if (value?.known !== true || overflow) {
      state.known = false
      // The remaining balance cannot fund another invocation without a complete receipt.
      // Consume free capacity conservatively; later known refunds do not reopen admission.
      const retained = Math.max(0, state.remaining)
      state.committed += retained
      state.remaining -= retained
      fault ??= overflow
        ? `resource ${name}: amount overflow under an enforced limit`
        : `resource ${name}: unknown usage under an enforced limit`
    } else if (allocations !== undefined) {
      if (amount > allocation) {
        overspent.push({ channel: `resource:${name}`, reserved: allocation, spent: amount })
      }
    } else if (state.remaining < 0) {
      rootExceeded ??= `resource ${name}: exceeded root limit ${state.limit}`
    }
  }
  return { ...(fault ? { fault } : {}), overspent, ...(rootExceeded ? { rootExceeded } : {}) }
}

/** Every channel `b` does not fit, measured against the free balance less `keep`. */
export function ledgerShortfalls(
  l: BudgetLedger,
  b: Budget,
  keep: ReservationFloor | undefined,
): ReservationShortfall[] {
  const wantTokens = b.maxTokens
  const wantUsd = b.maxUsd ?? 0
  const wantIterations = b.maxIterations
  const shortfalls: ReservationShortfall[] = []
  const short = (
    channel: ReservationShortfall['channel'],
    requested: number,
    free: number,
    held: number,
    closedByUnknownSpend = false,
  ): void => {
    shortfalls.push({
      channel,
      requested,
      free: closedByUnknownSpend ? 0 : Math.max(0, free),
      ...(closedByUnknownSpend || held <= 0 ? {} : { held }),
      ...(closedByUnknownSpend ? { closedByUnknownSpend: true as const } : {}),
    })
  }
  for (const [name, state] of l.resources) {
    const limit = b.resources![name]!.limit
    if (!state.known) short(`resource:${name}`, limit, 0, 0, true)
    else if (limit > state.remaining)
      short(`resource:${name}`, limit, state.remaining, state.reserved)
  }
  if (l.usdCapped && l.usdTainted) short('usd', wantUsd, 0, 0, true)
  const tokensFree = l.freeTokens - (keep?.tokens ?? 0)
  const iterationsFree = l.freeIterations - (keep?.iterations ?? 0)
  if (wantTokens > tokensFree) short('tokens', wantTokens, tokensFree, l.reservedTokens)
  if (wantIterations > iterationsFree)
    short('iterations', wantIterations, iterationsFree, l.reservedIterations)
  const usdFree = l.freeUsd - (keep?.usd ?? 0)
  if (l.usdCapped && !l.usdTainted && wantUsd > usdFree)
    short('usd', wantUsd, usdFree, l.reservedUsd)
  return shortfalls
}

/** Move `b` from free to reserved. The caller has checked that it fits. */
export function ledgerTake(l: BudgetLedger, b: Budget): void {
  for (const [name, state] of l.resources) {
    const amount = b.resources![name]!.limit
    state.remaining -= amount
    state.reserved += amount
  }
  l.freeTokens -= b.maxTokens
  l.reservedTokens += b.maxTokens
  l.freeIterations -= b.maxIterations
  l.reservedIterations += b.maxIterations
  const wantUsd = b.maxUsd ?? 0
  if (wantUsd > 0) {
    l.freeUsd -= wantUsd
    l.reservedUsd += wantUsd
  }
}

/**
 * The overspends a settlement of `spent` against `held` decides, before any balance moves. An
 * OVERSPEND is measured spend above the reservation; unknown dollars under a dollar cap (a fault
 * the caller reports) are flagged `unknownUnderCap`. `usdBudgeted` is whether the child declared a
 * dollar ceiling: without `maxUsd` it reserved NO dollars, so under a capped root its dollars are
 * OBSERVED spend, committed and debited from `free` like `observe`d inference.
 */
export function ledgerClassifyOverspend(
  l: BudgetLedger,
  held: { tokens: number; usd: number; iterations: number },
  usdBudgeted: boolean,
  spent: Spend,
): { overspent: BudgetOverspend[]; unknownUnderCap: boolean } {
  const unknownUnderCap = l.usdCapped && spent.usdKnown === false
  const spentTokens = chargedTokens(spent.tokens)
  const overspent: BudgetOverspend[] = []
  if (spentTokens > held.tokens) {
    overspent.push({ channel: 'tokens', reserved: held.tokens, spent: spentTokens })
  }
  if (spent.iterations > held.iterations) {
    overspent.push({ channel: 'iterations', reserved: held.iterations, spent: spent.iterations })
  }
  // Unmeasured dollars may not be compared against a reservation as if billed (a catalog-priced
  // turn could exceed the ceiling and report an overspend the child never made): the known
  // channels settle, then the dollar channel is tainted and admission closes.
  // USD is conserved ONLY when the root AND the child declared a ceiling (`maxUsd` is optional on
  // both); otherwise it is an OBSERVED quantity, and an unset ceiling must not act as a hard $0.
  if (!unknownUnderCap && l.usdCapped && usdBudgeted && spent.usd > held.usd) {
    overspent.push({ channel: 'usd', reserved: held.usd, spent: spent.usd })
  }
  return { overspent, unknownUnderCap }
}

/**
 * Release the whole reservation `held`, then commit actual spend; the difference is the refund
 * that flows back to `free`. Unconditional arithmetic: nothing here throws on spend it can read.
 */
export function ledgerSettle(
  l: BudgetLedger,
  held: { tokens: number; usd: number; iterations: number; resources?: Budget['resources'] },
  spent: Spend,
  unknownUnderCap: boolean,
): ResourceSettlement {
  noteUnknowns(l, spent)
  const spentTokens = chargedTokens(spent.tokens)
  l.reservedTokens -= held.tokens
  l.committedTokens += spentTokens
  l.freeTokens += held.tokens - spentTokens

  l.reservedIterations -= held.iterations
  l.committedIterations += spent.iterations
  l.freeIterations += held.iterations - spent.iterations

  if (l.usdCapped) {
    l.reservedUsd -= held.usd
    l.committedUsd += spent.usd
    if (unknownUnderCap) {
      l.usdTainted = true
      l.freeUsd = 0
    } else {
      // `held.usd` is 0 for a child that declared no ceiling, so this debits its observed
      // dollars straight out of the capped root's free balance — the root's `usdLeft`
      // shrinks by what the child really spent and admission closes when it runs out.
      l.freeUsd += held.usd - spent.usd
    }
  } else {
    // With no root dollar limit, record observed spend without a reservation channel.
    l.committedUsd += spent.usd
  }
  return ledgerCommitResources(l, spent, held.resources ?? {})
}

/**
 * Direct free → committed debit (no ticket). `free` may go negative on overspend: the readout then
 * reports exhaustion and the in-loop guard halts the driver. Work with an unreported token count
 * still debits what IS known and marks the balance incomplete; refusing to record it is the "free
 * turn" the pool must never see.
 */
export function ledgerObserve(
  l: BudgetLedger,
  spend: Spend,
  unknownUnderCap: boolean,
  requireAllResources: boolean,
): ResourceSettlement {
  noteUnknowns(l, spend)
  const tokens = chargedTokens(spend.tokens)
  l.freeTokens -= tokens
  l.committedTokens += tokens
  l.freeIterations -= spend.iterations
  l.committedIterations += spend.iterations
  l.committedUsd += spend.usd
  if (l.usdCapped) l.freeUsd -= spend.usd
  if (unknownUnderCap) l.usdTainted = true
  return ledgerCommitResources(l, spend, undefined, requireAllResources)
}

/**
 * Reconstruct the balances from a prior process's durable record. Measured prior spend is debited
 * exactly once; a started-without-terminal child is charged at its entire reservation, so restart
 * never mints capacity and the false known flags stay visible. Direct arithmetic, not `observe`:
 * the prior spend ALREADY happened, and refusing to record it would be a zero-cost restart.
 */
export function ledgerRestore(l: BudgetLedger, root: Budget, restore: BudgetPoolRestore): void {
  if (restore.committed !== undefined) {
    const committed = restore.committed
    assertValidSpend(committed, 'budget restore committed')
    ledgerValidateUnits(l, committed)
    ledgerCommitResources(l, committed)
    noteUnknowns(l, committed)
    const tokens = chargedTokens(committed.tokens)
    l.freeTokens -= tokens
    l.committedTokens += tokens
    l.freeIterations -= committed.iterations
    l.committedIterations += committed.iterations
    l.committedUsd += committed.usd
    if (l.usdCapped) {
      l.freeUsd -= committed.usd
      if (committed.usdKnown === false) {
        // The prior process spent dollars it could not measure under a dollar cap: the remaining
        // balance is not a sound bound, so consume it and close dollar admission.
        l.usdTainted = true
        if (l.freeUsd > 0) l.committedUsd += l.freeUsd
        l.freeUsd = 0
      }
    }
  }
  for (const [index, uncertain] of (restore.uncertainReservations ?? []).entries()) {
    assertValidBudget(uncertain, `budget restore uncertainReservations[${index}]`)
    // The child ran (or may have run) without a settle record: its telemetry is unknown, so the
    // pool charges the full declared ceiling and reports the balance as a ceiling, never a
    // measurement.
    ledgerCommitResources(
      l,
      withBudgetResources({ iterations: 0, tokens: zeroTokenUsage(), usd: 0, ms: 0 }, root),
    )
    l.tokensTainted = true
    l.usdMeasured = false
    l.freeTokens -= uncertain.maxTokens
    l.committedTokens += uncertain.maxTokens
    l.freeIterations -= uncertain.maxIterations
    l.committedIterations += uncertain.maxIterations
    if (!l.usdCapped) continue
    if (uncertain.maxUsd === undefined) {
      // No child dollar ceiling existed, so the root's remaining dollar capacity is not safe.
      l.usdTainted = true
      l.committedUsd += l.freeUsd > 0 ? l.freeUsd : 0
      l.freeUsd = 0
    } else {
      l.freeUsd -= uncertain.maxUsd
      l.committedUsd += uncertain.maxUsd
    }
  }
}
