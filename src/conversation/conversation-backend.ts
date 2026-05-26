/**
 * @stable
 *
 * Wrap a `Conversation` so it satisfies `AgentExecutionBackend`. The result is
 * an addressable "single agent" whose internal behavior is an N-party
 * orchestrated conversation — the recursion primitive that lets a swarm be a
 * participant inside another swarm, or be published behind a single
 * agent-gateway endpoint.
 *
 * Stream events from inner participants are NOT forwarded verbatim. Outer
 * callers see one `text_delta` per inner turn (the turn's full text), tagged
 * with `[speaker] ` prefix so the outer transcript stays attributable. The
 * conversation's `conversation_end` halt reason rides on a `final` event.
 */

import { newRuntimeSession, nowIso } from '../sessions'
import type {
  AgentBackendContext,
  AgentBackendInput,
  AgentExecutionBackend,
  RuntimeSession,
  RuntimeStreamEvent,
} from '../types'
import { runConversationStream } from './run-conversation'
import type { Conversation, HaltReason } from './types'

export function createConversationBackend(options: {
  conversation: Conversation
  /** Optional backend kind label. Defaults to `'conversation'`. */
  kind?: string
}): AgentExecutionBackend {
  const kind = options.kind ?? 'conversation'

  return {
    kind,
    start(_input, context): RuntimeSession {
      return newRuntimeSession(kind, context.requestedSessionId, {
        participants: options.conversation.participants.map((p) => p.name),
      })
    },
    async *stream(
      input: AgentBackendInput,
      context: AgentBackendContext,
    ): AsyncIterable<RuntimeStreamEvent> {
      const seed = input.message ?? input.messages?.at(-1)?.content ?? context.task.intent
      const task = context.task
      const session = context.session

      yield { type: 'backend_start', task, session, backend: kind, timestamp: nowIso() }

      let finalText = ''
      let totalCostUsd = 0
      let totalTokensIn = 0
      let totalTokensOut = 0

      for await (const event of runConversationStream(options.conversation, {
        seed,
        signal: context.signal,
      })) {
        if (event.type === 'turn_end') {
          const tagged = `[${event.turn.speaker}] ${event.turn.text}\n`
          finalText += tagged
          yield { type: 'text_delta', task, session, text: tagged, timestamp: event.timestamp }
          if (event.turn.usage) {
            const u = event.turn.usage
            if (u.costUsd !== undefined) totalCostUsd += u.costUsd
            if (u.tokensIn !== undefined) totalTokensIn += u.tokensIn
            if (u.tokensOut !== undefined) totalTokensOut += u.tokensOut
            yield {
              type: 'llm_call',
              task,
              session,
              model: u.model ?? `${kind}/${event.turn.speaker}`,
              tokensIn: u.tokensIn,
              tokensOut: u.tokensOut,
              costUsd: u.costUsd,
              latencyMs: u.latencyMs,
              timestamp: event.timestamp,
            }
          }
        } else if (event.type === 'conversation_end') {
          const halt = event.result.halted
          yield {
            type: 'final',
            task,
            session,
            status: halt.kind === 'participant_error' ? 'failed' : 'completed',
            reason: describeHalt(halt),
            text: finalText.trim(),
            metadata: {
              conversationRunId: event.result.runId,
              turns: event.result.turns,
              spentCreditsCents: event.result.spentCreditsCents,
              halted: halt,
              durationMs: event.result.durationMs,
              tokensIn: totalTokensIn,
              tokensOut: totalTokensOut,
              costUsd: totalCostUsd,
            },
            timestamp: event.timestamp,
          }
        }
      }

      yield { type: 'backend_end', task, session, backend: kind, timestamp: nowIso() }
    },
  }
}

function describeHalt(halt: HaltReason): string {
  switch (halt.kind) {
    case 'max_turns':
      return `max_turns (${halt.turns})`
    case 'max_credits':
      return `max_credits (${halt.spentCents}/${halt.capCents}¢)`
    case 'predicate':
      return `predicate: ${halt.reason}`
    case 'abort':
      return 'abort'
    case 'participant_error':
      return `participant_error[${halt.participant}]: ${halt.message}`
  }
}
