/**
 * The conversation of a router-brained agent, kept as it happens.
 *
 * A router-brained agent (`harness` omitted or `cli-base`) runs its tool loop in this process, so
 * its whole conversation is in the loop's `messages` and nowhere else. Before this, Runtime
 * metered each turn's usage and tool-call names and kept nothing the agent said, saw, or asked a
 * tool to do: a 316-agent tree on 2026-09-24 settled with 0 of 316 transcripts, and the 37 agents
 * still running when its driver process stopped left no record at all (agent-runtime#1377).
 *
 * The recorder keeps each message once, in the order the model saw it, and serves two readers:
 *   - each turn's `agent.turn` event carries the messages that turn added (the loop's inputs since
 *     the previous turn, then the reply), so an observer journal holds every agent's conversation
 *     while the run is live;
 *   - `capture()` returns the whole conversation as a harness transcript, so the agent settles
 *     with an `available` receipt instead of `executor-exposes-no-transcript`.
 *
 * The loop mutates `messages` in place: it appends the reply it was given, each tool result, and
 * any inbox message, and a compaction replaces the middle with a distilled note. The recorder
 * therefore reads new messages twice per turn, before compaction can remove them and again when
 * the model is called, and it identifies a message by object identity. The loop's own copy of a
 * reply is skipped, because the recorder already kept the reply when the model returned it.
 */
import {
  type HarnessTranscriptCapture,
  harnessTranscriptFromLines,
  harnessTranscriptUnavailable,
} from '../harness-transcript'
import type { ToolLoopMessageRecord, ToolLoopToolCall } from '../tool-loop'

/** The harness name a router-brained agent's transcript carries. */
export const ROUTER_TRANSCRIPT_HARNESS = 'router'

/**
 * The most bytes of one message's `content` a turn event carries. A longer content is cut, and
 * the message says so with its full length, so a reader never takes a cut message for the whole.
 * The settled transcript keeps the full content, within the bounds of `harnessTranscriptFromLines`.
 */
export const TURN_CONTENT_BYTES = 256 * 1024

/** What the brain returned for one turn, as the recorder keeps it. */
export interface RouterTranscriptReply {
  readonly content?: string | null
  readonly toolCalls?: ReadonlyArray<ToolLoopToolCall>
}

export interface RouterTranscript {
  /** Keep every message the loop added that is not yet kept. */
  observe(messages: ReadonlyArray<ToolLoopMessageRecord>): void
  /** Keep the model's reply for this turn, and return what this turn added, for the turn event. */
  reply(reply: RouterTranscriptReply): ReadonlyArray<ToolLoopMessageRecord>
  /** The whole conversation so far as a harness transcript. */
  capture(): HarnessTranscriptCapture
}

export function createRouterTranscript(): RouterTranscript {
  const kept: ToolLoopMessageRecord[] = []
  const seen = new WeakSet<object>()
  // Index in `kept` where the current turn's additions start.
  let turnStart = 0
  // The loop appends its own copy of the reply after the model returns; that copy is not new.
  let replyEchoPending = false
  // The loop's live array, so a capture also keeps what the loop added after its last turn.
  let live: ReadonlyArray<ToolLoopMessageRecord> | undefined

  const observe = (messages: ReadonlyArray<ToolLoopMessageRecord>): void => {
    live = messages
    for (const message of messages) {
      if (message === null || typeof message !== 'object' || seen.has(message)) continue
      seen.add(message)
      if (replyEchoPending) {
        replyEchoPending = false
        if (message.role === 'assistant') continue
      }
      kept.push(message)
    }
  }

  return {
    observe,
    reply(reply) {
      const message: ToolLoopMessageRecord = {
        role: 'assistant',
        content: reply.content ?? '',
        ...(reply.toolCalls && reply.toolCalls.length > 0
          ? {
              tool_calls: reply.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      }
      kept.push(message)
      replyEchoPending = true
      const added = kept.slice(turnStart).map(forTurnEvent)
      turnStart = kept.length
      return added
    },
    capture() {
      if (live !== undefined) observe(live)
      if (kept.length === 0) return harnessTranscriptUnavailable('execution-never-started')
      return harnessTranscriptFromLines(
        ROUTER_TRANSCRIPT_HARNESS,
        'conversation',
        kept.map((message) => JSON.stringify(message)),
      )
    },
  }
}

function forTurnEvent(message: ToolLoopMessageRecord): ToolLoopMessageRecord {
  const content = message.content
  if (typeof content !== 'string') return message
  const bytes = Buffer.byteLength(content)
  if (bytes <= TURN_CONTENT_BYTES) return message
  return {
    ...message,
    content: Buffer.from(content).subarray(0, TURN_CONTENT_BYTES).toString('utf8'),
    contentBytes: bytes,
    contentCut: true,
  }
}
