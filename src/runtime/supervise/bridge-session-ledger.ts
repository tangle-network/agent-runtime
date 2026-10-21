import { ValidationError } from '../../errors'
import {
  addHarnessUsage,
  type CodexRolloutStoreReader,
  type CodexRolloutStoreRef,
  type CodexStoreDelta,
  createCodexRolloutStoreReader,
  harnessUsageIsEmpty,
} from '../codex-rollout-store'
import { addTokenUsage, promptCacheTokenClasses, zeroTokenUsage } from '../util'
import type { BridgeHarnessStore } from './bridge-config'
import type { BridgeObservation } from './bridge-executor'
import type { BridgeInferenceUsage, BridgeStreamChunk } from './bridge-protocol'
import { priceUnreceiptedWork } from './cost-estimate'
import { contentRef } from './executor-outcome'
import type {
  ExecutorResult,
  ExecutorToolCall,
  Spend,
  TokenUsageProvenance,
  UsageEvent,
} from './types'

type TokensEvent = Extract<UsageEvent, { kind: 'tokens' }>

/** One turn's own accounting, kept apart from the run-wide totals. */
interface BridgeTurnTally {
  text: string
  sawTokenUsage: boolean
  tokensKnown: boolean
  sawCostStatus: boolean
  usdKnown: boolean
  knownCostSubtotal: number
  costProvenance: 'provider-receipt' | 'billing-receipt' | undefined
  estimatedCostSubtotal: number
  // This turn's own token totals, kept apart from the run-wide `tokens` so an unreceipted turn
  // is priced on what IT presented rather than on the running sum of every turn before it.
  inputTokens: number
  outputTokens: number
}

function newTurnTally(): BridgeTurnTally {
  return {
    text: '',
    sawTokenUsage: false,
    tokensKnown: true,
    sawCostStatus: false,
    usdKnown: true,
    knownCostSubtotal: 0,
    costProvenance: undefined,
    estimatedCostSubtotal: 0,
    inputTokens: 0,
    outputTokens: 0,
  }
}

/**
 * Open the harness store named on the seam, or nothing when the caller named none.
 *
 * A harness with no reader is REFUSED loudly rather than read with codex's decoder. Silently
 * ignoring it would hand back the same `{0, 0}` the store was configured to fix, with no signal
 * that the configuration did nothing.
 */
export function openBridgeHarnessStore(
  store: BridgeHarnessStore | undefined,
): CodexRolloutStoreReader | undefined {
  if (store === undefined) return undefined
  if (store.harness !== 'codex') {
    throw new ValidationError(
      `bridgeExecutor: harnessStore.harness ${JSON.stringify(store.harness)} has no store reader; only "codex" is readable today`,
    )
  }
  const ref: CodexRolloutStoreRef = {
    root: store.root,
    ...(store.workspaceRoot === undefined ? {} : { workspaceRoot: store.workspaceRoot }),
  }
  return createCodexRolloutStoreReader(ref)
}

/**
 * Read one turn's worth of the harness store.
 *
 * A read that fails is noted on the live activity log and returns nothing: the store is additional
 * evidence, and a filesystem error on it must never end a turn whose work already happened.
 */
export async function readHarnessStoreDelta(
  reader: CodexRolloutStoreReader,
  observation: BridgeObservation,
): Promise<CodexStoreDelta | undefined> {
  try {
    return await reader.read()
  } catch (err) {
    observation.activity.push({
      at: Date.now(),
      kind: 'note',
      label: 'harness-store-unreadable',
      detail: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}

/**
 * The tokens one cli-bridge turn's own materialization receipt states, or the reason it states
 * none.
 *
 * cli-bridge runs every harness against a scoped-loopback endpoint that it owns, counts the model
 * traffic that passes through it, and publishes that count for the turn as
 * `inference.observation.usage`. The count is harness-agnostic BY CONSTRUCTION: the proxy reads
 * provider requests, not a CLI's own event vocabulary. A harness that emits no OpenAI-shaped
 * `usage` frame therefore still has a readable receipt, which is why this runtime holds NO
 * per-harness bridge decoder — the bridge normalizes usage at the source and the runtime keeps one
 * reader. (`harness-usage.ts` holds the decoder registry for the OTHER transport, the sandbox
 * stream, where the runtime does read a harness's own event.)
 *
 * A receipt states a turn's tokens only when it names BOTH totals. Anything less leaves the turn
 * unknown with the reason named, never a zero that would read as a measured free turn.
 *
 * The counters beside the two totals CLASSIFY the prompt total; none of them adds to it. The
 * receipt carries no reasoning counter at all, so the codex hazard of adding a reasoning count to
 * an output total that already contains it cannot arise on this path.
 */
function readBridgeReceiptTokens(
  usage: BridgeInferenceUsage | undefined,
): { event: TokensEvent } | { reason: string } {
  if (usage === undefined) {
    return { reason: 'usage-unreadable: the turn receipt carried no bridge inference observation' }
  }
  const input = usage.inputTokens
  const output = usage.outputTokens
  if (input === undefined || output === undefined) {
    const missing = [
      ...(input === undefined ? ['prompt'] : []),
      ...(output === undefined ? ['completion'] : []),
    ].join(' and ')
    return { reason: `usage-unreadable: the turn receipt named no ${missing} total` }
  }
  const fresh = usage.freshInputTokens
  // One reader of the cache-class convention, shared with every other usage path.
  const classes = promptCacheTokenClasses(input, {
    ...(usage.cacheReadInputTokens === undefined ? {} : { readTokens: usage.cacheReadInputTokens }),
    ...(usage.cacheWriteInputTokens === undefined
      ? {}
      : { writeTokens: usage.cacheWriteInputTokens }),
  })
  // The receipt may state its own fresh count. It is carried when the cache counters did not
  // already imply the partition — one class named out of three classifies PART of the prompt
  // total, so the split stays incomplete. A fresh count that CONTRADICTS the implied partition
  // keeps both measured counters and declares the remainder unclassified rather than picking a
  // winner between two numbers the same receipt reported.
  const declaredFresh =
    classes.freshInput === undefined && fresh !== undefined && fresh <= input
      ? { freshInput: fresh, cacheBreakdownKnown: false as const }
      : {}
  const contradiction =
    classes.freshInput !== undefined && fresh !== undefined && fresh !== classes.freshInput
      ? { cacheBreakdownKnown: false as const }
      : {}
  return {
    event: {
      kind: 'tokens',
      input,
      output,
      ...classes,
      ...declaredFresh,
      ...contradiction,
    },
  }
}

/**
 * The accounting of one cli-bridge session across its turns: what each turn's stream, receipt,
 * and harness store proved, what stayed unknown and why, and the artifact the session settles as.
 */
export class BridgeSessionLedger {
  readonly tokens = zeroTokenUsage()
  tokensKnown = true
  // Why the token channel is a floor rather than a total, when it is. Named on the artifact under
  // the same key `sumSandboxUsage` uses, so one reader answers "what could not be read" on both
  // the sandbox stream and the bridge stream.
  tokensUnknownReason: string | undefined
  usd = 0
  usdKnown = true
  // The part of `usd` this runtime priced from the catalog. `usd - estimatedUsdCharged` is what a
  // provider is known to have billed.
  estimatedUsdCharged = 0
  estimatedUsd = 0
  sawEstimatedUsd = false
  turns = 0
  transportAttempts = 0
  lastText = ''
  observedModel: string | undefined
  observedSystemFingerprint: string | undefined
  readonly toolCalls: ExecutorToolCall[] = []
  // Keyed by the `PromptCacheUsage` vocabulary, not the SSE parse shape. Every consumer of an
  // artifact's `promptCache` reads `readTokens` / `writeTokens` — `profile-chat-client.ts`,
  // `improvement/agentic-generator.ts`, and `readPromptCache` — so a private dialect here reaches
  // them as no cache report at all, and the cost receipt then charges a re-read prefix in full.
  readonly promptCache: { freshInput?: number; readTokens?: number; writeTokens?: number } = {}
  // Which evidence the counted tokens came from. `undefined` until the first count lands, so a
  // settlement with no tokens at all states no provenance rather than claiming a stream receipt.
  tokensProvenance: TokenUsageProvenance | undefined
  /** The current turn's own accounting. */
  turn: BridgeTurnTally = newTurnTally()

  beginTurn(): void {
    this.turn = newTurnTally()
  }

  private creditPromptCache(event: TokensEvent): void {
    const { promptCache } = this
    if (event.freshInput !== undefined) {
      promptCache.freshInput = (promptCache.freshInput ?? 0) + event.freshInput
    }
    if (event.cacheRead !== undefined) {
      promptCache.readTokens = (promptCache.readTokens ?? 0) + event.cacheRead
    }
    if (event.cacheWrite !== undefined) {
      promptCache.writeTokens = (promptCache.writeTokens ?? 0) + event.cacheWrite
    }
  }

  private creditProvenance(source: TokenUsageProvenance): void {
    this.tokensProvenance =
      this.tokensProvenance === undefined || this.tokensProvenance === source ? source : 'mixed'
  }

  /** Count tokens for this turn from `source`, in the run-wide totals too. */
  private creditTurnTokens(event: TokensEvent, source: TokenUsageProvenance): void {
    this.turn.sawTokenUsage = true
    this.creditProvenance(source)
    this.turn.inputTokens += event.input
    this.turn.outputTokens += event.output
    addTokenUsage(this.tokens, event)
  }

  /** A usage frame the stream carried. */
  *creditStreamUsage(usage: NonNullable<BridgeStreamChunk['usage']>): Generator<UsageEvent> {
    const usageEvent: TokensEvent = {
      kind: 'tokens',
      input: usage.input,
      output: usage.output,
      ...(usage.known ? {} : { tokensKnown: false }),
      ...(usage.promptCache?.freshInput !== undefined
        ? { freshInput: usage.promptCache.freshInput }
        : {}),
      ...(usage.promptCache?.readInput !== undefined
        ? { cacheRead: usage.promptCache.readInput }
        : {}),
      ...(usage.promptCache?.writeInput !== undefined
        ? { cacheWrite: usage.promptCache.writeInput }
        : {}),
    }
    this.turn.sawTokenUsage = true
    this.creditProvenance('stream-receipt')
    if (!usage.known) this.turn.tokensKnown = false
    this.turn.inputTokens += usage.input
    this.turn.outputTokens += usage.output
    addTokenUsage(this.tokens, usageEvent)
    yield usageEvent
    this.creditPromptCache(usageEvent)
  }

  /** The cost status, billed cost, and estimated cost a stream chunk carried. */
  *creditStreamCost(chunk: BridgeStreamChunk): Generator<UsageEvent> {
    const { turn } = this
    if (chunk.costProvenance !== undefined) turn.costProvenance = chunk.costProvenance
    if (chunk.costKnown !== undefined) {
      turn.sawCostStatus = true
      if (!chunk.costKnown) turn.usdKnown = false
      // A trusted total is the complete charge for the turn. It supersedes earlier
      // incremental chunks that correctly reported that their subtotal was incomplete.
      if (chunk.costKnown && chunk.costScope === 'total') turn.usdKnown = true
    }
    if (typeof chunk.cost === 'number') {
      const increment =
        chunk.costScope === 'total' ? chunk.cost - turn.knownCostSubtotal : chunk.cost
      if (increment < 0) {
        throw new ValidationError('bridgeExecutor: total billed cost decreased within a turn')
      }
      turn.knownCostSubtotal += increment
      if (increment > 0) {
        this.usd += increment
        yield {
          kind: 'cost',
          usdKnown: true,
          usd: increment,
          provenance: turn.costProvenance ?? 'provider-receipt',
        }
      }
    }
    if (typeof chunk.estimatedCost === 'number') {
      const increment =
        chunk.costScope === 'total'
          ? chunk.estimatedCost - turn.estimatedCostSubtotal
          : chunk.estimatedCost
      if (increment < 0) {
        throw new ValidationError('bridgeExecutor: total estimated cost decreased within a turn')
      }
      turn.estimatedCostSubtotal += increment
      this.estimatedUsd += increment
      this.sawEstimatedUsd = true
    }
  }

  /**
   * Close the turn's accounting after its stream: the receipt, the harness store, and a price for
   * what no receipt billed. Every channel nothing proved stays unknown, never zero.
   */
  async *settleTurn(
    receiptUsage: BridgeInferenceUsage | undefined,
    harnessStore: CodexRolloutStoreReader | undefined,
    observation: BridgeObservation,
    providerModel: string,
  ): AsyncGenerator<UsageEvent> {
    // A turn whose stream carried no usage frame is not a free turn: cli-bridge's own
    // scoped-loopback accounting FOR THIS TURN rides the turn's materialization receipt. It is
    // read here, after the stream, so the canonical usage frames always win and a turn that
    // reported both is charged once — the same precedence `SandboxUsageLedger` holds for sandbox
    // streams (`sandbox-events.ts`).
    if (!this.turn.sawTokenUsage) {
      const receipt = readBridgeReceiptTokens(receiptUsage)
      if ('event' in receipt) {
        this.creditTurnTokens(receipt.event, 'stream-receipt')
        yield receipt.event
        this.creditPromptCache(receipt.event)
      } else {
        // The FIRST reason is kept: it names the receipt this session could not read, and a later
        // turn failing the same way does not make the answer any more unknown.
        this.tokensUnknownReason ??= receipt.reason
      }
    }
    if (harnessStore) yield* this.creditHarnessStore(harnessStore, observation)
    const { turn } = this
    if (!turn.sawTokenUsage || !turn.tokensKnown) this.tokensKnown = false
    if (!turn.sawCostStatus || !turn.usdKnown) {
      this.usdKnown = false
      yield this.priceUnreceiptedTurn(providerModel)
    }
  }

  // The harness's own store closes what the transport did not carry. It is read on EVERY turn,
  // not only an unmetered one, because the two sources cover different work: a stream receipt
  // reports the seat's turn, and a harness-native child spends in its own rollout with its own
  // counter that the parent's receipt never includes. So a turn with a receipt still credits the
  // native children, and a turn without one credits both — never the same tokens twice.
  private async *creditHarnessStore(
    harnessStore: CodexRolloutStoreReader,
    observation: BridgeObservation,
  ): AsyncGenerator<UsageEvent> {
    const delta = await readHarnessStoreDelta(harnessStore, observation)
    if (!delta) return
    const charged = this.turn.sawTokenUsage
      ? delta.native
      : addHarnessUsage(delta.seat, delta.native)
    if (!harnessUsageIsEmpty(charged)) {
      const event: TokensEvent = {
        kind: 'tokens',
        input: charged.input,
        output: charged.output,
        ...promptCacheTokenClasses(charged.input, {
          ...(charged.cachedInput === undefined ? {} : { readTokens: charged.cachedInput }),
          ...(charged.cacheWriteInput === undefined
            ? {}
            : { writeTokens: charged.cacheWriteInput }),
        }),
        provenance: 'harness-store',
      }
      this.creditTurnTokens(event, 'harness-store')
      this.creditPromptCache(event)
      yield event
    }
    // A fork this reader cannot attribute is named, never charged and never silently zero.
    if (delta.unresolved.length > 0) {
      this.turn.tokensKnown = false
      this.tokensUnknownReason ??= `harness-store: ${delta.unresolved.length} forked rollout(s) could not be attributed to a turn; ${delta.unresolved[0]?.reason ?? 'no reason recorded'}`
    }
  }

  // Missing billing proof is not a free turn. Price what the turn presented, so the dollar
  // channel carries a number instead of a zero that reads as a measured free turn. The event
  // is always `usdKnown: false`, and the priced part rides `usdEstimated`.
  //
  // Only a turn that billed NOTHING is priced. A turn holding a partial receipt already put
  // real dollars on the channel, and a whole-turn catalog price on top would charge the same
  // tokens twice.
  private priceUnreceiptedTurn(providerModel: string): UsageEvent {
    const { turn } = this
    const priced =
      turn.knownCostSubtotal === 0
        ? priceUnreceiptedWork({
            inputTokens: turn.inputTokens,
            outputTokens: turn.outputTokens,
            model: this.observedModel ?? providerModel,
          })
        : {
            kind: 'cost' as const,
            usd: 0,
            usdKnown: false as const,
            provenance: 'uncaptured' as const,
          }
    if (priced.usdKnown === false && priced.usdEstimated !== undefined) {
      this.estimatedUsdCharged += priced.usdEstimated
    }
    this.usd += priced.usd
    return priced
  }

  /** The artifact the session settles as. */
  artifact(sessionId: string, startedAt: number): ExecutorResult<unknown> {
    const spent: Spend = {
      iterations: this.turns,
      tokens: this.tokens,
      ...(this.tokensKnown ? {} : { tokensKnown: false }),
      usd: this.usd,
      ...(this.usdKnown ? {} : { usdKnown: false }),
      ...(this.estimatedUsdCharged > 0 ? { usdEstimated: this.estimatedUsdCharged } : {}),
      ms: Date.now() - startedAt,
      // Only a provenance OTHER than the live stream is stated, so a bridge run that read no harness
      // store settles byte-identically to every run before this channel existed.
      ...(this.tokensProvenance === undefined || this.tokensProvenance === 'stream-receipt'
        ? {}
        : { tokensProvenance: this.tokensProvenance }),
    }
    const { observedModel, observedSystemFingerprint, promptCache, tokensUnknownReason } = this
    const out = {
      content: this.lastText,
      ...(observedModel !== undefined ? { model: observedModel } : {}),
      ...(observedSystemFingerprint ? { system_fingerprint: observedSystemFingerprint } : {}),
      toolCalls: this.toolCalls,
      transportAttempts: this.transportAttempts,
      ...(Object.keys(promptCache).length > 0 ? { promptCache } : {}),
      ...(this.sawEstimatedUsd ? { estimatedCostUsd: this.estimatedUsd } : {}),
      ...(this.tokensKnown || tokensUnknownReason === undefined ? {} : { tokensUnknownReason }),
    } as unknown
    return {
      outRef: contentRef('bridge', {
        model: observedModel ?? null,
        session: sessionId,
        content: this.lastText,
      }),
      out,
      spent,
    }
  }
}
