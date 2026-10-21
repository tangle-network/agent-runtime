import type { SandboxEvent } from '@tangle-network/sandbox'
import { canonicalSandboxUsageMode, createSandboxUsageLedger } from '../sandbox-events'
import { priceUnreceiptedWork } from '../supervise/cost-estimate'
import { concreteProfileModel } from '../supervise/model-policy'
import type { Spend, UsageEvent } from '../supervise/types'
import { addSpend, addTokenUsage, cloneTokenUsage, zeroTokenUsage } from '../util'
import type { StreamProviderExecutorArgs } from './provider-invocation'

type UsageLedger = ReturnType<typeof createSandboxUsageLedger>
type UsageReceipt = ReturnType<UsageLedger['observe']>

/** What one provider invocation has spent, and what of that spend a receipt proves. */
export class ProviderUsageAccount {
  private readonly ledger: UsageLedger
  private readonly worker: string
  private tokens = zeroTokenUsage()
  private usd = 0
  private usdEstimated = 0
  private sawCompleteTokenReceipt = false
  private sawIncompleteTokenReceipt = false
  private sawCostReceipt = false
  private sawUnknownCostReceipt = false
  private sawCostEstimate = false
  private pendingUnpricedWork = false
  private pendingEstimate: number | undefined
  /** The model id a usage receipt reported, when it reported one. Only a catalog can price a run
   *  the provider never billed, and only a model id can address a catalog. */
  private observedModel: string | undefined

  constructor(
    private readonly args: StreamProviderExecutorArgs,
    private readonly turnModel: string | undefined,
  ) {
    this.ledger = createSandboxUsageLedger(args.profile.harness)
    this.worker = args.profile.name ?? 'agent'
  }

  /** Whether this invocation itself spent anything. */
  get madeProgress(): boolean {
    return this.tokens.input > 0 || this.tokens.output > 0 || this.usd > 0
  }

  /** A retained result whose stream broke before it could report dollars leaves them unknown. */
  markCostUnknown(): void {
    this.sawUnknownCostReceipt = true
  }

  *observe(event: SandboxEvent): Iterable<UsageEvent> {
    yield* this.credit(this.ledger.observe(event, this.worker), event)
  }

  *settleTurn(): Iterable<UsageEvent> {
    yield* this.credit(this.ledger.settleTurn(this.worker))
  }

  /**
   * Interim missing prices and catalog estimates may be covered by a later cumulative bill.
   * Only unresolved work becomes unknown at settlement; do not add a quote to that bill.
   */
  *settleUnpricedWork(): Iterable<UsageEvent> {
    if (!this.pendingUnpricedWork) return
    // A provider that reports tokens and no dollars used to settle a bare `$0`, so a sandbox-
    // rooted run that certainly spent money reported a dollar total of zero with no estimate at
    // all. The catalog answers what the provider WOULD bill, so the amount rides `usdEstimated`
    // and `usdKnown` stays false below: a price is not a receipt and must never become one.
    //
    // Priced only when NO dollars reached the channel for this execution. `tokens` is the
    // execution's cumulative total, not the unresolved remainder, so pricing it alongside any
    // receipt — billed or already marked unknown — would charge the same tokens twice. A
    // partially billed execution therefore keeps its unresolved part unknown, which is true.
    const estimated = this.pendingEstimate ?? (this.usd === 0 ? this.catalogPrice() : undefined)
    const estimate = estimated ?? 0
    this.sawUnknownCostReceipt = true
    this.usd += estimate
    if (estimated !== undefined) {
      this.sawCostEstimate = true
      this.usdEstimated += estimate
    }
    yield {
      kind: 'cost',
      usd: estimate,
      usdKnown: false,
      ...(estimated === undefined ? {} : { usdEstimated: estimate }),
      provenance: estimated === undefined ? 'uncaptured' : 'catalog-estimate',
    }
  }

  /** This invocation's spend, and the execution's: a continuation adds its earlier invocations'. */
  spend(started: number): { spent: Spend; executionSpent: Spend } {
    const spent: Spend = {
      iterations: 1,
      tokens: this.tokens,
      // Distinct partial receipts cannot prove each other's missing counters.
      ...(this.sawCompleteTokenReceipt && !this.sawIncompleteTokenReceipt
        ? {}
        : { tokensKnown: false }),
      usd: this.usd,
      // A dollar total is known only when a canonical receipt arrived and none was marked
      // unknown. Bare provider numbers remain untrusted; Router billing receipts survive.
      usdKnown: this.sawCostReceipt && !this.sawUnknownCostReceipt,
      // Only unverified amounts are estimates; a mixed run must retain its billed subtotal.
      ...(this.sawCostEstimate ? { usdEstimated: this.usdEstimated } : {}),
      ms: Date.now() - started,
    }
    const { carried } = this.args
    const executionSpent: Spend =
      carried === undefined
        ? spent
        : {
            ...addSpend(carried, { ...spent, iterations: 0 }),
            ms: Date.now() - this.args.executionStartedAt,
          }
    return { spent, executionSpent }
  }

  /**
   * The catalog price of this execution's whole token total, under the first model id the catalog
   * knows. Undefined when none prices, so an unpriced model settles with no estimate at all rather
   * than a zero one — absence says "nothing could be priced", a zero would say "priced at nothing".
   *
   * Candidates run most specific first: the id a usage receipt reported, then the turn's own
   * model, then the profile's. A provider that selected its own default declares no profile model,
   * so a reported id is then the only one a catalog can match.
   */
  private catalogPrice(): number | undefined {
    const { tokens } = this
    for (const model of [
      this.observedModel,
      this.turnModel,
      concreteProfileModel(this.args.createProfile),
    ]) {
      if (model === undefined) continue
      const priced = priceUnreceiptedWork({
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        ...(tokens.cacheRead === undefined ? {} : { cacheReadTokens: tokens.cacheRead }),
        ...(tokens.cacheWrite === undefined ? {} : { cacheWriteTokens: tokens.cacheWrite }),
        model,
      })
      if (priced.usdKnown === false && priced.usdEstimated !== undefined) return priced.usdEstimated
    }
    return undefined
  }

  /** This invocation's cumulative tokens as the execution's: a continuation adds what its earlier
   *  invocations already reported. */
  private executionTokens(own: ReturnType<UsageLedger['tokenUsage']>) {
    const { carried } = this.args
    if (carried === undefined) return own
    const total = cloneTokenUsage(carried.tokens)
    addTokenUsage(total, own)
    return total
  }

  private *credit(receipt: UsageReceipt, event?: SandboxEvent): Iterable<UsageEvent> {
    if (receipt === undefined) return
    // A receipt that named no model is stamped with the worker's name, which is not a model id and
    // prices nothing. Only a different value is evidence of what the provider actually served.
    if (receipt.model !== this.worker) this.observedModel = receipt.model
    const hasTokens = receipt.tokensIn !== undefined || receipt.tokensOut !== undefined
    if (
      hasTokens &&
      receipt.tokensIn !== undefined &&
      receipt.tokensOut !== undefined &&
      receipt.tokensKnown !== false
    ) {
      this.sawCompleteTokenReceipt = true
    } else if (hasTokens || receipt.tokensKnown === false || receipt.tokensUnknownReason) {
      this.sawIncompleteTokenReceipt = true
    }
    const input = receipt.tokensIn ?? 0
    const output = receipt.tokensOut ?? 0
    if (input || output || receipt.tokensKnown === false || receipt.promptCache !== undefined) {
      this.tokens = this.ledger.tokenUsage()
      yield {
        kind: 'tokens',
        mode: 'cumulative',
        ...this.executionTokens(this.tokens),
        ...(receipt.tokensKnown === false ? { tokensKnown: false } : {}),
      }
    }
    const amount = receipt.costUsd
    if (amount !== undefined) {
      this.sawCostReceipt = true
      this.usd += amount
      if (receipt.usdKnown === false) {
        this.sawUnknownCostReceipt = true
        this.sawCostEstimate = true
        this.usdEstimated += amount
        yield {
          kind: 'cost',
          usdKnown: false,
          usd: amount,
          usdEstimated: amount,
          provenance: 'uncaptured',
        }
      } else {
        if (event && canonicalSandboxUsageMode(event) === 'cumulative') {
          // This receipt covers the bound execution's prior work, not just one new call.
          this.pendingUnpricedWork = false
          this.pendingEstimate = undefined
        }
        yield { kind: 'cost', usdKnown: true, usd: amount, provenance: 'provider-receipt' }
      }
    } else if (receipt.estimatedCostUsd !== undefined) {
      this.pendingUnpricedWork = true
      this.pendingEstimate = (this.pendingEstimate ?? 0) + receipt.estimatedCostUsd
    } else if (input > 0 || output > 0 || receipt.tokensKnown === false) {
      // A duplicate terminal token total credits zero and cannot invent more unpriced work.
      this.pendingUnpricedWork = true
    }
  }
}
