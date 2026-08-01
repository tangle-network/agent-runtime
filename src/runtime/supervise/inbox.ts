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
 * `deliver` never throws — a malformed message is ignored and returns `false`, so no caller can
 * report delivery for bytes this inbox discarded.
 *
 * @experimental
 */

export interface InboxMessage {
  readonly kind: 'steer' | 'answer'
  readonly text: string
  /** Forceful messages abort the in-flight turn; queued ones wait for the boundary flush. */
  readonly interrupt: boolean
  /** Present for an `answer` — the question id it resolves. */
  readonly questionId?: string
}

export interface Inbox {
  /** The `Executor.deliver` implementation. Returns false when the raw message is malformed and
   * therefore was not queued; callers must not acknowledge a message this inbox discarded. */
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
  const interrupt = m.interrupt === true
  if (typeof m.steer === 'string') return { kind: 'steer', text: m.steer, interrupt }
  if (typeof m.answer === 'string')
    return {
      kind: 'answer',
      text: m.answer,
      interrupt,
      ...(typeof m.questionId === 'string' ? { questionId: m.questionId } : {}),
    }
  return undefined
}

/** Create the worker-side inbox for the down-leg: the driver's `steer_agent` / `answer_question` messages queue here and the worker's loop drains them at step boundaries and before settle. */
export function createInbox(): Inbox {
  const pending: InboxMessage[] = []
  let live: AbortController | null = null
  return {
    deliver(msg) {
      const m = parseDown(msg)
      if (!m) return false
      pending.push(m)
      // A forceful message aborts the turn currently in flight (if any).
      if (m.interrupt && live && !live.signal.aborted) live.abort()
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
      const lines = messages.map((m) => {
        if (m.kind === 'answer')
          return `- Answer to your question${m.questionId ? ` (${m.questionId})` : ''}: ${m.text}`
        return `- New instruction from your supervisor: ${m.text}`
      })
      return `[SUPERVISOR] Out-of-band message(s) — address these before continuing:\n${lines.join('\n')}`
    },
  }
}
