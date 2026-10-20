import type { LoopTokenUsage } from '../../types'
import type { TokenUsageProvenance } from './execution-events'
import type { NodeId } from './node-lifecycle'

/** Caller-defined resource ceiling in non-negative safe-integer units, consistent throughout a tree. */
export interface ResourceLimit {
  readonly unit: string
  readonly limit: number
}

/** Non-negative safe-integer subtotal. False means unknown, even when amount is zero.
 * Select sufficiently fine units, such as GPU-milliseconds. */
export interface ResourceSpend {
  readonly unit: string
  readonly amount: number
  readonly known: boolean
}

/** A budget envelope on a spawn or the root. All ceilings; the pool reserves against them. */
export interface Budget {
  readonly maxIterations: number
  readonly maxTokens: number
  readonly maxUsd?: number
  readonly deadlineMs?: number
  readonly resources?: Readonly<Record<string, ResourceLimit>>
}

/**
 * Conserved spend, reconciled from the normalized `UsageEvent` stream. Tokens and usd are separate
 * channels (never folded).
 *
 * `boxMinutes` is a REPORTED channel, not a conserved one: it is summed across a run and carried
 * in the journal, and the budget pool never reserves, commits, or refunds against it. `budget.ts`
 * holds the reason.
 */
export interface Spend {
  resources?: Readonly<Record<string, ResourceSpend>>
  iterations: number
  tokens: LoopTokenUsage
  /** Token accounting is known unless explicitly false. A false value marks work that HAPPENED with
   *  an unreported token count: `tokens` then carries the known subtotal (often `{0,0}`) and must
   *  not be read as the measured total. The twin of `usdKnown` on the token channel — an inference
   *  turn whose provider reported no usage is recorded with this flag rather than omitted, because
   *  omitting it makes the turn look free. */
  tokensKnown?: boolean
  /** Dollar accounting is known unless explicitly false. A false value must not be treated as $0
   *  when enforcing a dollar-denominated comparison or limit. */
  usdKnown?: boolean
  usd: number
  /** The part of `usd` that is a PRICE rather than a charge, because no provider receipt covered
   *  the work: a model catalog's own number, or a figure a provider stated but did not bill.
   *  `usd - usdEstimated` is what a provider is known to have billed. Present only with
   *  `usdKnown: false`; absence means nothing here was priced, not that `usd` is measured. */
  usdEstimated?: number
  ms: number
  /**
   * Platform box wall time in minutes — the third conserved channel, beside tokens and dollars.
   *
   * A run on a subscription seat has no marginal dollar per model call, so box time is the only
   * real resource it consumes. Before this channel existed such a run reported `$0` with nothing
   * beside it and was unaccountable by construction.
   *
   * ABSENT when nothing was measured. Never `0` for unknown: a zero would claim the box consumed
   * no platform time, which is a different fact from a box nobody metered. The field is absent
   * entirely on a run with no box (router, cli-bridge, inline), because "not applicable" is not
   * the same fact as "unmeasured" either.
   */
  boxMinutes?: number
  /** True when this record states its box time. `false` says a box RAN and its lifetime could not
   *  be paired, so `boxMinutes` — when present at all — is a floor, never the total. The twin of
   *  `tokensKnown` and `usdKnown` on the platform channel. */
  boxMinutesKnown?: boolean
  /**
   * How `boxMinutes` was obtained, in the vocabulary `agent-eval`'s cost ledger already uses
   * (`CostProvenance`, `cost-ledger.ts`).
   *
   * `'observed'` — the platform itself reported the minutes.
   * `'estimated'` — this runtime derived them from the box lifetime it watched. A derived number
   *   is not a platform receipt, and the conserved pool never reserves against it.
   * `'uncaptured'` — a box ran and nothing measured its time. Comes WITHOUT `boxMinutes`.
   */
  boxMinutesProvenance?: 'observed' | 'estimated' | 'uncaptured'
  /**
   * How the token counters in `tokens` were obtained, when this record states it.
   *
   * ABSENT means every count came from the executor's live stream, which is what every path
   * reported before harness stores were readable. `'harness-store'` says the harness's own file was
   * the receipt; `'mixed'` says both sources contributed to this settlement.
   *
   * This is a provenance fact, not a confidence one: a store read is the provider's own number and
   * carries `tokensKnown: true`. The twin of `boxMinutesProvenance` on the token channel.
   */
  tokensProvenance?: TokenUsageProvenance
}

/** The accounting channels a usage gap leaves incomplete. */
export type SpendChannel = 'tokens' | 'usd' | `resource:${string}`

/**
 * One journaled node whose usage accounting is incomplete — the named gap behind a `false`
 * `tokensKnown`/`usdKnown` on a terminal `spentTotal`. `never-settled`: the spawn is durable but
 * no terminal record landed, so the whole subtree is unaccounted on every channel and
 * `spentTotal` charges its budget ceiling instead of a fabricated zero. `unreported`: a settled
 * or metered record landed without a complete provider receipt, so the summed numbers are a
 * floor on the named channels, never the measured total.
 */
export interface SpendGap {
  readonly id: NodeId
  /** The spawn label, when the node's `spawned` event is in this journal tree. */
  readonly label?: string
  readonly kind: 'never-settled' | 'unreported'
  readonly channels: ReadonlyArray<SpendChannel>
}

/**
 * One channel on which a settled reservation's measured spend exceeded what it reserved.
 * `tokens` is in the pool's charged unit (`chargedTokens`), `usd` is measured dollars, and a
 * `resource:<name>` entry is in the unit that resource's budget declares.
 */
export interface BudgetOverspend {
  /** `deadline` is a child that settled after its time box: `reserved` is the time it was given
   *  and `spent` the time it took, both in ms. */
  readonly channel: SpendChannel | 'iterations' | 'deadline'
  readonly reserved: number
  readonly spent: number
}

/**
 * A settled reservation whose measured spend exceeded what it reserved.
 *
 * It records an accounting fact, not an outcome. A child that completed stays `done` with its
 * artifact, and a child that failed stays `down`. The pool commits the true spend, so its free
 * balance already carries the overspend and later reservations are refused on their own.
 * Spend the pool cannot verify (unknown dollars under a dollar cap, unknown or overflowing
 * resource usage) is not an overspend: it fails the child closed instead.
 */
export interface BudgetViolation {
  /** Every overspent channel, in the order tokens, iterations, usd, then resources. Never empty. */
  readonly overspent: ReadonlyArray<BudgetOverspend>
}
