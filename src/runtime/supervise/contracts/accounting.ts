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

/** Explicit ceilings on a spawn or root. An omitted channel is uncapped and reserves nothing. */
export interface Budget {
  readonly maxIterations?: number
  readonly maxTokens?: number
  readonly maxUsd?: number
  readonly deadlineMs?: number
  readonly resources?: Readonly<Record<string, ResourceLimit>>
}

/** Conserved spend from the `UsageEvent` stream. Tokens and dollars stay separate.
 *  `boxMinutes` is reported only: the pool does not reserve against it. */
export interface Spend {
  resources?: Readonly<Record<string, ResourceSpend>>
  iterations: number
  tokens: LoopTokenUsage
  /** False marks work that happened with an unreported count. `tokens` is then a floor, not the total. */
  tokensKnown?: boolean
  /** Dollar accounting is known unless explicitly false. A false value must not be treated as $0
   *  when enforcing a dollar-denominated comparison or limit. */
  usdKnown?: boolean
  usd: number
  /** The priced part of `usd`, present only with `usdKnown: false`. `usd - usdEstimated` was billed. */
  usdEstimated?: number
  ms: number
  /** Platform box minutes. Absent when unmeasured or when no box ran. Never `0` for unknown. */
  boxMinutes?: number
  /** False: a box ran and `boxMinutes`, if present, is a floor. */
  boxMinutesKnown?: boolean
  /** `observed` is the platform's number. `estimated` is derived and not reserved against.
   *  `uncaptured` means a box ran and comes without `boxMinutes`. */
  boxMinutesProvenance?: 'observed' | 'estimated' | 'uncaptured'
  /** Where `tokens` came from. Absent means the live stream. A store read still has `tokensKnown: true`. */
  tokensProvenance?: TokenUsageProvenance
  /** Tokens the live stream had reported when a broken stream's exact result arrived. `tokens` stays the recorded total. */
  streamedTokens?: LoopTokenUsage
  /** Recorded total minus `streamedTokens`, for each counter that grew. Absent when the exact result did not exceed the stream. */
  unobservedTokens?: LoopTokenUsage
  /** False when `iterations` is only the provider-invocation floor: the exact result exceeded the stream, so this count does not name the model calls. */
  iterationsKnown?: false
}

/** The accounting channels a usage gap leaves incomplete. */
export type SpendChannel = 'tokens' | 'usd' | `resource:${string}`

/** A node with missing usage. Recorded subtotals are lower bounds; never-settled
 * work has no terminal receipt and unreported work has an incomplete one. */
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

/** Measured spend past the reservation. The child stays done or down; unverifiable spend fails closed. */
export interface BudgetViolation {
  /** Every overspent channel, in the order tokens, iterations, usd, then resources. Never empty. */
  readonly overspent: ReadonlyArray<BudgetOverspend>
}
