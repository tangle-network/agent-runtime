/**
 * `ChatTurnEngine` tests — the orchestration contract every product chat
 * handler depends on. Covers: lifecycle envelope, NDJSON encoding,
 * hook ordering, the failure envelope, the per-event side channel,
 * the pre-persist transform, the live accumulator, and swallowed
 * hook errors.
 */

import { describe, expect, it } from 'vitest'

import { type ChatStreamEvent, ChatTurnEngine } from '../chat-engine'

/** Drain an NDJSON ReadableStream into parsed events. */
async function drain(body: ReadableStream<Uint8Array>): Promise<ChatStreamEvent[]> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events: ChatStreamEvent[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    for (;;) {
      const nl = buffer.indexOf('\n')
      if (nl === -1) break
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) events.push(JSON.parse(line) as ChatStreamEvent)
    }
  }
  if (buffer.trim()) events.push(JSON.parse(buffer.trim()) as ChatStreamEvent)
  return events
}

/** A producer that streams the given text as two part-updates + a result. */
function textProducer(text: string, onConstruct?: () => void) {
  return () => {
    onConstruct?.()
    async function* stream(): AsyncGenerator<ChatStreamEvent, void, unknown> {
      yield { type: 'message.part.updated', data: { part: { type: 'text' }, delta: text } }
      yield { type: 'result', data: { finalText: text } }
    }
    return { stream: stream(), finalText: () => text }
  }
}

const IDENTITY = { tenantId: 'ws-1', sessionId: 'thread-1', userId: 'user-1', turnIndex: 0 }

describe('ChatTurnEngine', () => {
  const engine = new ChatTurnEngine()

  it('wraps the turn in the session.run.* lifecycle envelope', async () => {
    const persisted: string[] = []
    const { body, contentType } = engine.runTurn({
      identity: IDENTITY,
      hooks: {
        produce: textProducer('Hi there.'),
        persistAssistantMessage: async ({ finalText }) => {
          persisted.push(finalText)
        },
      },
    })
    expect(contentType).toBe('application/x-ndjson')
    const events = await drain(body)

    expect(events[0]?.type).toBe('session.run.started')
    expect(events.at(-1)?.type).toBe('session.run.completed')
    expect(events.some((e) => e.type === 'message.part.updated')).toBe(true)
    expect(events.some((e) => e.type === 'result')).toBe(true)
    expect(persisted).toEqual(['Hi there.'])
  })

  it('runs hooks in order: persist → onTurnComplete, after the stream', async () => {
    const order: string[] = []
    const { body } = engine.runTurn({
      identity: IDENTITY,
      hooks: {
        produce: textProducer('answer'),
        persistAssistantMessage: async () => {
          order.push('persist')
        },
        onTurnComplete: async () => {
          order.push('postProcess')
        },
      },
    })
    await drain(body)
    expect(order).toEqual(['persist', 'postProcess'])
  })

  it('a producer failure becomes error + session.run.failed, stream still closes', async () => {
    const { body } = engine.runTurn({
      identity: IDENTITY,
      hooks: {
        produce: () => {
          async function* stream(): AsyncGenerator<ChatStreamEvent, void, unknown> {
            yield { type: 'message.part.updated', data: { delta: 'partial' } }
            throw new Error('backend exploded')
          }
          return { stream: stream(), finalText: () => '' }
        },
        persistAssistantMessage: async () => undefined,
      },
    })
    const events = await drain(body)
    expect(events[0]?.type).toBe('session.run.started')
    const err = events.find((e) => e.type === 'error')
    expect(err?.data?.message).toBe('backend exploded')
    expect(events.at(-1)?.type).toBe('session.run.failed')
  })

  it('onEvent side channel receives every emitted event', async () => {
    const broadcast: string[] = []
    const { body } = engine.runTurn({
      identity: IDENTITY,
      hooks: {
        produce: textProducer('x'),
        persistAssistantMessage: async () => undefined,
        onEvent: (event) => {
          broadcast.push(event.type)
        },
      },
    })
    const events = await drain(body)
    expect(broadcast).toEqual(events.map((e) => e.type))
  })

  it('transformFinalText alters what is persisted, not the live stream', async () => {
    let persisted = ''
    const { body } = engine.runTurn({
      identity: IDENTITY,
      hooks: {
        produce: textProducer('SSN 123-45-6789'),
        transformFinalText: (t) => t.replace(/\d{3}-\d{2}-\d{4}/, '[REDACTED]'),
        persistAssistantMessage: async ({ finalText }) => {
          persisted = finalText
        },
      },
    })
    const events = await drain(body)
    const result = events.find((e) => e.type === 'result')
    expect(result?.data?.finalText).toBe('SSN 123-45-6789')
    expect(persisted).toBe('SSN [REDACTED]')
  })

  it('accumulate builds final text from events when producer.finalText() is empty', async () => {
    let persisted = ''
    const { body } = engine.runTurn({
      identity: IDENTITY,
      hooks: {
        produce: () => {
          async function* stream(): AsyncGenerator<ChatStreamEvent, void, unknown> {
            yield { type: 'message.part.updated', data: { delta: 'Hello' } }
            yield { type: 'message.part.updated', data: { delta: ' world' } }
          }
          return { stream: stream(), finalText: () => '' }
        },
        accumulate: (event, current) => {
          if (event.type !== 'message.part.updated') return undefined
          const delta = typeof event.data?.delta === 'string' ? event.data.delta : ''
          return current + delta
        },
        persistAssistantMessage: async ({ finalText }) => {
          persisted = finalText
        },
      },
    })
    await drain(body)
    expect(persisted).toBe('Hello world')
  })

  it('a throwing persist hook is swallowed — the turn still completes', async () => {
    const { body } = engine.runTurn({
      identity: IDENTITY,
      hooks: {
        produce: textProducer('ok'),
        persistAssistantMessage: async () => {
          throw new Error('db down')
        },
      },
    })
    const events = await drain(body)
    expect(events.at(-1)?.type).toBe('session.run.completed')
  })

  it('traceFlush is handed to waitUntil so the worker isolate survives the POST', async () => {
    let flushAwaited = false
    let waitUntilCalled = false
    const { body } = engine.runTurn({
      identity: IDENTITY,
      waitUntil: (p) => {
        waitUntilCalled = true
        void p.then(() => {
          flushAwaited = true
        })
      },
      hooks: {
        produce: textProducer('ok'),
        persistAssistantMessage: async () => undefined,
        traceFlush: async () => {
          flushAwaited = true
        },
      },
    })
    await drain(body)
    expect(waitUntilCalled).toBe(true)
    expect(flushAwaited).toBe(true)
  })
})
