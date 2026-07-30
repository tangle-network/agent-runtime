/**
 *
 * The worker-side receive end of the down-leg: a per-worker inbox an executor exposes as
 * `Executor.deliver`. The driver's `steer_agent` / `answer_question` land here,
 * and the worker's agent loop drains them at two points (Drew's two delivery modes):
 *
 *   - QUEUED (default): the message accumulates and is FLUSHED at the next step boundary — folded
 *     into the conversation before the next think. A worker is also forced to flush BEFORE it may
 *     settle, so it can never finish while a steer/answer it never read is still pending.
 *   - FORCEFUL (`interrupt: true`): trips `freshInterrupt()`'s signal so the loop can abort its
 *     in-flight turn immediately, then re-plan with the message folded in — breaking the worker out
 *     of a wrong path mid-task instead of waiting for it to finish the step.
 *
 * `deliver` never throws — a malformed message is ignored, per the `Executor.deliver` contract.
 *
 * @experimental
 */

export interface InboxMessage {
  readonly messageId: string
  readonly kind: 'steer' | 'answer'
  readonly text: string
  readonly deliveryMode: 'queued' | 'interrupt'
  /** Present for an `answer` — the question id it resolves. */
  readonly questionId?: string
}

export interface Inbox {
  /** The `Executor.deliver` implementation — accept a raw down-message from `Scope.send`. */
  deliver(msg: unknown): boolean
  /** Remove and return all pending messages (the flush). */
  drain(): InboxMessage[]
  pending(): number
  /** Open a fresh per-turn interrupt signal; a later forceful `deliver` aborts it. The loop links
   *  this into the signal it passes to its inference call, then re-plans when it fires. */
  freshInterrupt(): AbortSignal
  /** Render drained messages as ONE operator turn to fold into the worker's conversation. */
  fold(messages: ReadonlyArray<InboxMessage>): string
}

function parseDown(msg: unknown): InboxMessage | undefined {
  if (!msg || typeof msg !== 'object') return undefined
  const m = msg as Record<string, unknown>
  if (typeof m.messageId !== 'string' || m.messageId.length === 0) return undefined
  if (m.deliveryMode !== 'queued' && m.deliveryMode !== 'interrupt') return undefined
  const deliveryMode: InboxMessage['deliveryMode'] = m.deliveryMode
  const base = { messageId: m.messageId, deliveryMode }
  if (typeof m.steer === 'string') return { ...base, kind: 'steer', text: m.steer }
  if (typeof m.answer === 'string')
    return {
      ...base,
      kind: 'answer',
      text: m.answer,
      ...(typeof m.questionId === 'string' ? { questionId: m.questionId } : {}),
    }
  return undefined
}

/** Create the worker-side inbox for the down-leg: the driver's `steer_agent` / `answer_question` messages queue here and the worker's loop drains them at step boundaries and before settle. */
export function createInbox(): Inbox {
  const pending: InboxMessage[] = []
  const accepted = new Set<string>()
  let live: AbortController | null = null
  return {
    deliver(msg) {
      const m = parseDown(msg)
      if (!m) return false
      if (accepted.has(m.messageId)) return true
      accepted.add(m.messageId)
      pending.push(m)
      // A forceful message aborts the turn currently in flight (if any).
      if (m.deliveryMode === 'interrupt' && live && !live.signal.aborted) live.abort()
      return true
    },
    drain() {
      return pending.splice(0, pending.length)
    },
    pending: () => pending.length,
    freshInterrupt() {
      live = new AbortController()
      return live.signal
    },
    fold(messages) {
      return JSON.stringify({
        type: 'agent-runtime.down-messages',
        messages,
      })
    },
  }
}
