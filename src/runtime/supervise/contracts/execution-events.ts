import type { ChildTaskEvent, InteractionRequest } from '@tangle-network/agent-interface'

/**
 * Normalized usage event — the single channel every executor reports through, so the
 * conserved pool meters all runtimes identically. `tokens` carries `LoopTokenUsage`'s
 * `{ input, output }` plus an optional provider cache split; `usd` is a SEPARATE channel (never
 * folded into tokens).
 *
 * Either channel can explicitly say its numeric subtotal is incomplete. A missing provider receipt
 * therefore remains unknown through live metering and terminal reconciliation instead of becoming
 * a fabricated zero.
 */
/**
 * One tool call retained in an executor artifact. Every Runtime-owned executor reports this exact
 * shape, so `streamAgentTurn` projects terminal tool activity through one reader instead of a
 * per-backend parser. `arguments` holds the captured argument value; an empty object means the
 * source reported the call without its arguments.
 */
export interface ExecutorToolCall {
  readonly id?: string
  readonly name: string
  readonly arguments: unknown
}

/**
 * Live output observed while an executor runs, in Runtime's own vocabulary. It carries what the
 * backend produced — text, reasoning, tool activity, an interaction request — and never carries
 * accounting: tokens and dollars stay on the `tokens`/`cost` channels, so a progress event can
 * never meter a budget.
 */
export type ExecutorProgressEvent =
  | { readonly kind: 'text_delta'; readonly text: string }
  | { readonly kind: 'reasoning_delta'; readonly text: string }
  | {
      readonly kind: 'tool_call'
      readonly toolName: string
      readonly toolCallId?: string
      readonly args?: unknown
    }
  | {
      readonly kind: 'tool_result'
      readonly toolName: string
      readonly toolCallId?: string
      readonly result?: unknown
    }
  | { readonly kind: 'interaction'; readonly request: InteractionRequest }
  | {
      /**
       * One update of a provider-native child task — a subagent or delegated task the runner
       * started inside this run. It is the Interface event verbatim, so a client rebuilds the
       * child tree from provider identity (`childId`, `parentChildId`, `sourceEventId`) instead
       * of inferring children from tool names or transcript order.
       */
      readonly kind: 'child_task'
      readonly event: ChildTaskEvent
    }
  | {
      /**
       * The turn's execution is still the provider's, and the node waits on its exact result: its
       * stream ended short of a terminal frame, or brought no new evidence for a while. `since`
       * (ISO time) is when the wait began. A stream's silence never ends a node; the wait ends on
       * the provider's result or the turn's named abort. This row lets the run page and the keeper
       * show the wait; the keeper re-drives a root that streams nothing for its hung window.
       */
      readonly kind: 'awaiting-result'
      readonly since: string
    }

/**
 * How a token count was obtained.
 *
 * `'stream-receipt'` — the executor's live event stream carried the provider's counters.
 * `'harness-store'` — the harness's own on-disk session store was read after the turn. Measured
 *   motive (discovery#80): a cli-bridge codex seat metered zero on 9 of 9 turns while 27,320,482
 *   tokens sat in its rollout, so the store is the only receipt that path produces.
 * `'mixed'` — a settlement whose turns came from more than one of the above.
 */
export type TokenUsageProvenance = 'stream-receipt' | 'harness-store' | 'mixed'

export type UsageEvent =
  | {
      kind: 'tokens'
      /** Entire executor token total. Omit for additive observations. Cumulative totals may refine cache classes. */
      mode?: 'cumulative'
      /** Known token subtotal. When false, these counts are only the observed/estimated floor. */
      tokensKnown?: false
      input: number
      output: number
      /** Newly processed prompt tokens. Present only with a complete cache split. */
      freshInput?: number
      /** Prompt tokens the provider reported reading from cache. */
      cacheRead?: number
      /** Prompt tokens the provider reported writing to cache. */
      cacheWrite?: number
      /**
       * False when this observation cannot classify all positive prompt tokens — including a
       * provider that reports a read with no write counter. The measured counters are still
       * carried; the marker says the remaining prompt tokens are unclassified, so a charge over
       * them is an upper bound. A counter the provider did not report is absent, never zero.
       */
      cacheBreakdownKnown?: false
      /**
       * Where these counters came from.
       *
       * ABSENT — the executor's own live stream carried the receipt. This is the default and the
       * only value that existed before harness stores were readable.
       * `'harness-store'` — the harness's OWN on-disk session store was read after the turn. The
       * counters are the provider's, not this runtime's estimate, so they may claim
       * `tokensKnown: true`; the marker states that the evidence is a file the harness wrote rather
       * than an event the transport forwarded.
       *
       * The distinction is load-bearing on a transport that forwards no usage: crediting a store
       * read as if it were a stream receipt would hide that the stream is still silent.
       */
      provenance?: TokenUsageProvenance
    }
  | {
      kind: 'cost'
      /** A provider or billing receipt covers this amount in full. */
      usdKnown: true
      usd: number
      /** Which receipt proves it. A number without one of these cannot claim `usdKnown: true`. */
      provenance: 'provider-receipt' | 'billing-receipt'
    }
  | {
      kind: 'cost'
      /** No receipt covers this work, so `usd` is an observed floor, never the total charge. */
      usdKnown: false
      usd: number
      /**
       * The part of `usd` that is a PRICE rather than a charge: a model catalog's own number, or
       * a figure a provider stated with no billing receipt behind it. Either way it approximates
       * what a provider would bill and never measures what it did, so `usd - usdEstimated` stays
       * the amount a provider is known to have billed.
       *
       * Absence means nothing here was priced, NOT that `usd` is a receipt.
       */
      usdEstimated?: number
      /**
       * Why the amount is not measured: a local catalog price, or nothing captured at all —
       * including a provider that reported a number with no receipt behind it.
       */
      provenance: 'catalog-estimate' | 'uncaptured'
    }
  | {
      /** Observed output, not accounting. Meters ignore it; the turn projection publishes it. */
      kind: 'progress'
      progress: ExecutorProgressEvent
    }
  | { kind: 'resource'; name: string; unit: string; amount: number; known: boolean }
  | { kind: 'iteration' }
