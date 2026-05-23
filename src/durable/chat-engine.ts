/**
 * `ChatTurnEngine` — the framework-neutral chat-turn orchestrator every
 * product chat handler routes through. Owns the NDJSON `ChatStreamEvent`
 * line protocol, the `session.run.*` lifecycle vocabulary, and the persist
 * / post-process / trace-flush hook ordering.
 *
 * Execution durability is the substrate's concern: `box.streamPrompt({
 * executionId, lastEventId })` from `@tangle-network/sandbox` buffers the
 * stream by `executionId`, replays strictly after `lastEventId` on
 * reconnect, and never spawns a duplicate. `AgentExecutionHandle` is the
 * typed pointer products persist; this engine wraps a producer that
 * speaks that primitive.
 *
 * What the engine owns:
 *   - the `session.run.started` / `session.run.completed` / `session.run.failed`
 *     event envelope around the producer's events
 *   - NDJSON encoding into a `ReadableStream<Uint8Array>` (the body every
 *     product returns, React Router or Hono alike)
 *   - calling the product's persist / post-process hooks in the right order,
 *     after the stream drains, with the assembled final text
 *   - never throwing into the HTTP layer — a producer failure becomes an
 *     `error` + `session.run.failed` event pair, the stream still closes
 *
 * What the product supplies (`ChatTurnHooks`):
 *   - `produce`     — build the backend stream for this turn (sandbox / router
 *                     / tcloud / runtime — the engine does not care which)
 *   - `persistAssistantMessage` — write the assistant turn to the product DB
 *   - `onTurnComplete` (optional) — post-process (proposals, citations, …)
 *   - `onEvent` (optional)        — per-event side-channel (e.g. DO broadcast)
 *   - `transformFinalText` (optional) — pre-persist transform (e.g. PII redact)
 *   - `traceFlush` (optional)     — handed to waitUntil so OTLP export lands
 *
 * Framework neutrality: the engine takes already-resolved values (`identity`
 * tuple, a `waitUntil`), never a `Request` or a `Context`. The product's
 * thin route adapter does auth + parse + access-control, then calls
 * `engine.runTurn(...)` and returns `result.body` as its platform `Response`.
 */

/** The NDJSON line protocol every product chat client already speaks. */
export interface ChatStreamEvent {
  type: string
  data?: Record<string, unknown>
}

/** Identity of a chat turn. `tenantId` is the workspace id for workspace-
 *  scoped products and the user id for session-scoped products. */
export interface ChatTurnIdentity {
  tenantId: string
  /** Thread / session id. */
  sessionId: string
  userId: string
  /** Monotonic 0-based turn index within the session. */
  turnIndex: number
}

/** The live side of a turn — what the product's `produce` hook returns. */
export interface ChatTurnProducer<TEvent extends ChatStreamEvent = ChatStreamEvent> {
  /** The turn's event stream. Forwarded verbatim to the caller. */
  stream: AsyncGenerator<TEvent, void, unknown>
  /** The turn's final assistant text. Read once, after `stream` drains.
   *  When the producer cannot populate this synchronously after drain,
   *  return '' and use `ChatTurnHooks.accumulate` to assemble text from
   *  events instead. */
  finalText(): string
}

export interface ChatTurnHooks {
  /**
   * Build the backend stream for this turn. The engine never inspects which
   * backend this is — sandbox container, tcloud router, direct runtime, a
   * test double — it only forwards the events and reads `finalText()`.
   */
  produce(): ChatTurnProducer
  /**
   * Persist the completed assistant message to the product's own store.
   * Called once, after the stream drains, with the assembled (and
   * `transformFinalText`-transformed) text.
   */
  persistAssistantMessage(input: { identity: ChatTurnIdentity; finalText: string }): Promise<void>
  /**
   * Optional post-processing after persistence — proposal extraction,
   * citation validation, credit metering, etc. Product policy; the engine
   * has no shared logic here. Errors are swallowed + logged (post-process
   * must never fail the turn that already streamed successfully).
   */
  onTurnComplete?(input: { identity: ChatTurnIdentity; finalText: string }): Promise<void>
  /**
   * Optional per-event side channel (e.g. Durable Object broadcast). Runs
   * for every event the engine emits, lifecycle envelope included. Errors
   * are swallowed — a broadcast failure must not break the chat stream.
   */
  onEvent?(event: ChatStreamEvent): void | Promise<void>
  /**
   * Optional pre-persist transform of the final text (e.g. PII redaction).
   * Affects only what is persisted; the live stream is never altered.
   */
  transformFinalText?(text: string): string | Promise<string>
  /**
   * Optional live accumulator. When the producer's `finalText()` is only
   * valid after drain, this lets the engine also observe each event to
   * build the text — return the running text or `undefined` to ignore an
   * event. When omitted, `producer.finalText()` is the sole source.
   */
  accumulate?(event: ChatStreamEvent, current: string): string | undefined
  /**
   * Optional trace flush — resolves when OTLP export completes. The engine
   * hands it to `waitUntil` so the worker isolate stays alive for the POST.
   */
  traceFlush?(): Promise<void>
}

export interface RunChatTurnInput {
  identity: ChatTurnIdentity
  hooks: ChatTurnHooks
  /** Worker liveness hook (`ctx.waitUntil` / `executionCtx.waitUntil`). When
   *  omitted, trace flush is awaited inline before the stream closes. */
  waitUntil?: (p: Promise<unknown>) => void
  /** Optional structured logger for swallowed hook errors. */
  log?: (message: string, meta?: Record<string, unknown>) => void
}

export interface ChatTurnResult {
  /** NDJSON body — return this as the platform `Response` body. */
  body: ReadableStream<Uint8Array>
  /** Content type for the response. */
  contentType: 'application/x-ndjson'
}

const encoder = new TextEncoder()

function encodeLine(event: ChatStreamEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`)
}

/**
 * The engine. One instance is stateless and reusable across requests — all
 * per-turn state lives in `runTurn`'s closure.
 */
export class ChatTurnEngine {
  /**
   * Run one chat turn. Returns immediately with a `ReadableStream` body;
   * the turn executes as the body is pulled. Never rejects — backend
   * failures surface as `error` + `session.run.failed` events.
   */
  runTurn(input: RunChatTurnInput): ChatTurnResult {
    const log = input.log ?? (() => undefined)
    const { identity, hooks } = input

    const body = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const emit = async (event: ChatStreamEvent): Promise<void> => {
          controller.enqueue(encodeLine(event))
          if (hooks.onEvent) {
            try {
              await hooks.onEvent(event)
            } catch (err) {
              log('[chat-engine] onEvent hook threw', {
                error: err instanceof Error ? err.message : String(err),
              })
            }
          }
        }

        try {
          await emit({
            type: 'session.run.started',
            data: {
              sessionId: identity.sessionId,
              tenantId: identity.tenantId,
              turnIndex: identity.turnIndex,
            },
          })

          const producer = hooks.produce()
          let accumulated = ''
          for await (const event of producer.stream) {
            if (hooks.accumulate) {
              const next = hooks.accumulate(event, accumulated)
              if (typeof next === 'string') accumulated = next
            }
            await emit(event)
          }
          // Producer's own finalText wins when populated; otherwise the
          // live accumulator's value stands.
          const producerText = producer.finalText()
          const rawFinal = producerText || accumulated
          const finalText = hooks.transformFinalText
            ? await hooks.transformFinalText(rawFinal)
            : rawFinal

          try {
            await hooks.persistAssistantMessage({ identity, finalText })
          } catch (err) {
            log('[chat-engine] persistAssistantMessage threw', {
              error: err instanceof Error ? err.message : String(err),
            })
          }
          if (hooks.onTurnComplete) {
            try {
              await hooks.onTurnComplete({ identity, finalText })
            } catch (err) {
              log('[chat-engine] onTurnComplete threw', {
                error: err instanceof Error ? err.message : String(err),
              })
            }
          }

          await emit({
            type: 'session.run.completed',
            data: { sessionId: identity.sessionId },
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          log('[chat-engine] turn failed', { error: message })
          await emit({ type: 'error', data: { message } })
          await emit({
            type: 'session.run.failed',
            data: { sessionId: identity.sessionId, message },
          })
        } finally {
          if (hooks.traceFlush) {
            const flush = hooks.traceFlush().catch((err) =>
              log('[chat-engine] traceFlush threw', {
                error: err instanceof Error ? err.message : String(err),
              }),
            )
            if (input.waitUntil) input.waitUntil(flush)
            else await flush
          }
          controller.close()
        }
      },
    })

    return { body, contentType: 'application/x-ndjson' }
  }
}

/** Convenience singleton — the engine is stateless, one instance is enough. */
export const chatTurnEngine = new ChatTurnEngine()
