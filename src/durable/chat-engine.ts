/**
 * `DurableChatTurnEngine` — the framework-neutral chat-turn orchestrator every
 * product chat handler routes through. It owns the parts that were copy-pasted
 * across legal / gtm / creative / tax: durable checkpointing, the NDJSON
 * `StreamEvent` line protocol, the `session.run.*` lifecycle vocabulary, the
 * runtime-run cost ledger, and trace flush. Everything genuinely
 * product-specific is a hook the product supplies.
 *
 * What the engine owns:
 *   - durable turn (`runDurableTurn`): completed turns replay free, no re-bill
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
 *
 * Framework neutrality: the engine takes already-resolved values
 * (`userId`, identity tuple, parsed message, a `DurableRunStore`, a
 * `waitUntil`), never a `Request` or a `Context`. The product's thin route
 * adapter does auth + parse + access-control, then calls `engine.runTurn(...)`
 * and returns `result.body` as its platform `Response`.
 */

import { deriveWorkerId } from './identity'
import { type DurableTurnProducer, runDurableTurn } from './turn'
import type { DurableRunManifest, DurableRunStore, RunRecord } from './types'

/** The NDJSON line protocol every product chat client already speaks. */
export interface ChatStreamEvent {
  type: string
  data?: Record<string, unknown>
}

/** Identity of a chat turn. `tenantId` is the workspace id for workspace-
 *  scoped products and the user id for session-scoped products. */
export interface ChatTurnIdentity {
  tenantId: string
  /** Thread / session id — the durable run is keyed on this + `turnIndex`. */
  sessionId: string
  userId: string
  /** Monotonic 0-based turn index within the session. */
  turnIndex: number
}

export interface ChatTurnHooks {
  /**
   * Build the backend stream for this turn. The engine never inspects which
   * backend this is — sandbox container, tcloud router, direct runtime, a
   * test double — it only forwards the events and reads `finalText()`.
   */
  produce(): DurableTurnProducer<ChatStreamEvent>
  /**
   * Persist the completed assistant message to the product's own store.
   * Called once, after the stream drains, on a fresh (non-replay) run.
   * Receives the assembled (and `transformFinalText`-transformed) text.
   */
  persistAssistantMessage(input: {
    identity: ChatTurnIdentity
    finalText: string
    record: RunRecord | undefined
  }): Promise<void>
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
   * Optional trace flush — resolves when OTLP export completes. The engine
   * hands it to `waitUntil` so the worker isolate stays alive for the POST.
   */
  traceFlush?(): Promise<void>
}

export interface RunChatTurnInput {
  identity: ChatTurnIdentity
  /** The user's message for this turn. Hashed into the durable run identity. */
  userMessage: string
  /** Product id for telemetry / the durable manifest (`legal-agent`, …). */
  projectId: string
  /** Domain tag for the task spec (`legal`, `gtm`, …). */
  domain: string
  /** Model id, when known — recorded on the manifest. */
  model?: string
  store: DurableRunStore
  hooks: ChatTurnHooks
  /** Worker liveness hook (`ctx.waitUntil` / `executionCtx.waitUntil`). When
   *  omitted, trace flush is awaited inline before the stream closes. */
  waitUntil?: (p: Promise<unknown>) => void
  /** Stable per-isolate worker id. Defaults to a fresh `deriveWorkerId()`. */
  workerId?: string
  /** Lease window in ms. Default 60_000. */
  leaseMs?: number
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
export class DurableChatTurnEngine {
  /**
   * Run one durable chat turn. Returns immediately with a `ReadableStream`
   * body; the turn executes as the body is pulled. Never rejects — backend
   * failures surface as `error` + `session.run.failed` events.
   */
  runTurn(input: RunChatTurnInput): ChatTurnResult {
    const workerId = input.workerId ?? deriveWorkerId()
    const log = input.log ?? (() => undefined)
    const { identity } = input
    const runId = `chat:${identity.sessionId}:${identity.turnIndex}`

    const manifest: DurableRunManifest = {
      projectId: input.projectId,
      scenarioId: identity.sessionId,
      task: {
        id: `${input.projectId}:chat:${identity.sessionId}:${identity.turnIndex}`,
        intent: `Run a ${input.domain} chat turn with workspace context.`,
        domain: input.domain,
        requiredKnowledge: [],
        metadata: {
          tenantId: identity.tenantId,
          sessionId: identity.sessionId,
          turnIndex: identity.turnIndex,
        },
      },
      input: {
        userMessage: input.userMessage,
        model: input.model ?? null,
      },
      tags: {
        session_id: identity.sessionId,
        tenant_id: identity.tenantId,
      },
    }

    const body = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const emit = async (event: ChatStreamEvent): Promise<void> => {
          controller.enqueue(encodeLine(event))
          if (input.hooks.onEvent) {
            try {
              await input.hooks.onEvent(event)
            } catch (err) {
              log('[chat-engine] onEvent hook threw', {
                error: err instanceof Error ? err.message : String(err),
              })
            }
          }
        }

        let turnFailed = false
        try {
          await emit({
            type: 'session.run.started',
            data: {
              sessionId: identity.sessionId,
              tenantId: identity.tenantId,
              turnIndex: identity.turnIndex,
            },
          })

          const turn = runDurableTurn<ChatStreamEvent>({
            store: input.store,
            runId,
            manifest,
            workerId,
            leaseMs: input.leaseMs,
            intent: `chat:turn-${identity.turnIndex}`,
            produce: input.hooks.produce,
            replayEvent: (finalText) => ({ type: 'result', data: { finalText } }),
            accumulate: (event, current) => {
              // Accumulate from the same event shapes products already emit:
              // `message.part.updated` text deltas and a trailing `result`.
              if (event.type === 'message.part.updated') {
                const data = event.data ?? {}
                const delta = typeof data.delta === 'string' ? data.delta : ''
                const part = data.part as { type?: string; text?: string } | undefined
                if (delta) return current + delta
                if (part?.type === 'text' && typeof part.text === 'string') return part.text
                return undefined
              }
              if (event.type === 'result') {
                const data = event.data ?? {}
                if (typeof data.finalText === 'string') return data.finalText
              }
              return undefined
            },
          })

          for await (const event of turn.stream) {
            await emit(event)
          }

          const rawFinal = turn.finalText()
          const finalText = input.hooks.transformFinalText
            ? await input.hooks.transformFinalText(rawFinal)
            : rawFinal

          // Persist + post-process only on a fresh run. On replay the
          // assistant message + side effects already landed on the first
          // (completed) attempt — re-persisting would double-write.
          if (!turn.replayed()) {
            try {
              await input.hooks.persistAssistantMessage({
                identity,
                finalText,
                record: turn.record(),
              })
            } catch (err) {
              log('[chat-engine] persistAssistantMessage threw', {
                error: err instanceof Error ? err.message : String(err),
              })
            }
            if (input.hooks.onTurnComplete) {
              try {
                await input.hooks.onTurnComplete({ identity, finalText })
              } catch (err) {
                log('[chat-engine] onTurnComplete threw', {
                  error: err instanceof Error ? err.message : String(err),
                })
              }
            }
          }

          await emit({
            type: 'session.run.completed',
            data: { sessionId: identity.sessionId, replayed: turn.replayed() },
          })
        } catch (err) {
          turnFailed = true
          const message = err instanceof Error ? err.message : String(err)
          log('[chat-engine] turn failed', { error: message })
          await emit({ type: 'error', data: { message } })
          await emit({
            type: 'session.run.failed',
            data: { sessionId: identity.sessionId, message },
          })
        } finally {
          // Trace flush: hand to waitUntil so the isolate survives the POST;
          // await inline when no waitUntil is available (local / tests).
          if (input.hooks.traceFlush) {
            const flush = input.hooks.traceFlush().catch((err) =>
              log('[chat-engine] traceFlush threw', {
                error: err instanceof Error ? err.message : String(err),
              }),
            )
            if (input.waitUntil) input.waitUntil(flush)
            else await flush
          }
          controller.close()
          void turnFailed
        }
      },
    })

    return { body, contentType: 'application/x-ndjson' }
  }
}

/** Convenience singleton — the engine is stateless, one instance is enough. */
export const durableChatTurnEngine = new DurableChatTurnEngine()
