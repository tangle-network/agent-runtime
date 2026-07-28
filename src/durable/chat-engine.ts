/**
 * `handleChatTurn` is a framework-neutral chat-turn HTTP orchestrator.
 * Owns the NDJSON `ChatStreamEvent` line protocol, the `session.run.*`
 * lifecycle vocabulary, and the persist / post-process / trace-flush
 * hook order. Returns a `ReadableStream` body the product hands to its
 * platform `Response`.
 *
 * Sandbox owns long-running execution, reconnect, and replay.
 * The producer this engine wraps already speaks that protocol; this
 * engine frames the events and orders product callbacks.
 *
 * Hooks (`ChatTurnHooks`):
 *   - `produce`: build the backend event stream
 *   - `persistAssistantMessage`: write the assistant turn to the product DB
 *   - `onTurnComplete?`: post-process proposals, citations, and similar work
 *   - `onEvent?`: send each event to another consumer
 *   - `transformFinalText?`: transform text before persistence
 *   - `traceFlush?`: let `waitUntil` keep the worker alive for export
 *
 * Framework neutrality: takes already-resolved values (`identity` tuple,
 * a `waitUntil`), never a `Request` or a `Context`. The product's thin
 * route adapter does auth + parse + access-control, then calls
 * `handleChatTurn(...)` and returns `result.body` as its platform `Response`.
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

/** The live side of a turn returned by the product's `produce` hook. */
export interface ChatTurnProducer<TEvent extends ChatStreamEvent = ChatStreamEvent> {
  /** The turn's event stream. Forwarded verbatim to the caller. */
  stream: AsyncGenerator<TEvent, void, unknown>
  /** The turn's final assistant text. Read once, after `stream` drains. */
  finalText(): string
}

/** Product callbacks invoked while one chat turn runs. */
export interface ChatTurnHooks {
  /** Build the backend stream. The engine forwards events verbatim and
   *  reads `finalText()` once the stream drains. */
  produce(): ChatTurnProducer
  /** Persist the assistant message to the product's own store. Called
   *  once, after drain, with the assembled (transform-applied) text. */
  persistAssistantMessage(input: { identity: ChatTurnIdentity; finalText: string }): Promise<void>
  /** Optional post-processing for proposals, citations, or credit metering.
   *  Errors are logged without failing a turn that already streamed. */
  onTurnComplete?(input: { identity: ChatTurnIdentity; finalText: string }): Promise<void>
  /** Optional per-event side channel, such as a Durable Object broadcast.
   *  Runs for every emitted event, including the lifecycle envelope.
   *  Errors are logged without breaking the chat stream. */
  onEvent?(event: ChatStreamEvent): void | Promise<void>
  /** Optional pre-persist transform of the final text (e.g. PII
   *  redaction). Affects only what is persisted; the live stream is
   *  never altered. */
  transformFinalText?(text: string): string | Promise<string>
  /** Optional trace flush. Handed to `waitUntil` so the worker stays alive
   *  until export completes. */
  traceFlush?(): Promise<void>
}

/** Inputs for one streamed product chat turn. */
export interface RunChatTurnInput {
  identity: ChatTurnIdentity
  hooks: ChatTurnHooks
  /** Worker liveness hook. When omitted, trace flush is awaited inline
   *  before the stream closes. */
  waitUntil?: (p: Promise<unknown>) => void
  /** Structured logger for swallowed hook errors. Defaults to
   *  `console.error` so failures surface without product wiring. */
  log?: (message: string, meta?: Record<string, unknown>) => void
}

/** HTTP response values returned for one chat turn. */
export interface ChatTurnResult {
  /** NDJSON body to return as the platform `Response` body. */
  body: ReadableStream<Uint8Array>
  /** Content type for the response. */
  contentType: 'application/x-ndjson'
}

const encoder = new TextEncoder()

function encodeLine(event: ChatStreamEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`)
}

function defaultLog(message: string, meta?: Record<string, unknown>): void {
  if (meta) console.error(message, meta)
  else console.error(message)
}

/**
 * Run one chat turn. Returns immediately with a `ReadableStream` body;
 * execution starts while the stream is constructed. Backend
 * failures surface as `error` + `session.run.failed` events.
 */
export function handleChatTurn(input: RunChatTurnInput): ChatTurnResult {
  const log = input.log ?? defaultLog
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
        for await (const event of producer.stream) {
          await emit(event)
        }
        const rawFinal = producer.finalText()
        const finalText = hooks.transformFinalText
          ? await hooks.transformFinalText(rawFinal)
          : rawFinal

        await hooks.persistAssistantMessage({ identity, finalText })
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
